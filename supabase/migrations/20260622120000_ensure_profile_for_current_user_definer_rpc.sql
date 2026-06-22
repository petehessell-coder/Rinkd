-- PROFILE-CREATE-RPC: own-profile creation runs server-side as SECURITY DEFINER,
-- bypassing the YOUTH-PRIVACY column gate (SELECT revoked on profiles.email +
-- date_of_birth from `authenticated`). The client never again needs table grants
-- on profiles to create its own row, so future grant changes can't break signup.
--
-- Safety property: keys SOLELY off auth.uid() (no target-user parameter), so a
-- caller can only ever create THEIR OWN profile. Idempotent. Derives every field
-- from the caller's auth.users row + raw_user_meta_data, mirroring
-- src/lib/auth.js ensureProfileForUser() exactly. AFTER-INSERT triggers
-- (tr_auto_follow_seed_accounts, tr_link_invited_player_on_profile) fire on the
-- insert to seed follows + link pending team invites.

create or replace function public.ensure_profile_for_current_user()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_user   auth.users%rowtype;
  v_meta   jsonb;
  v_name   text;
  v_handle text;
  v_color  text;
  v_init   text;
  v_found  uuid;
begin
  if v_uid is null then
    raise exception 'ensure_profile: no authenticated user' using errcode = '28000';
  end if;

  -- Idempotent: already provisioned? (cheap PK lookup; common case for returning
  -- users when onAuthStateChange re-fires on every sign-in.)
  select id into v_found from public.profiles where id = v_uid;
  if found then
    return v_found;
  end if;

  select * into v_user from auth.users where id = v_uid;
  if not found then
    raise exception 'ensure_profile: auth user % not found', v_uid using errcode = 'P0002';
  end if;
  v_meta := coalesce(v_user.raw_user_meta_data, '{}'::jsonb);

  -- Mirror src/lib/auth.js ensureProfileForUser() EXACTLY:
  --   name     = meta.name || email-local || 'player'
  --   handle   = (meta.handle || 'user-<uuid8>') with non [A-Za-z0-9_-] stripped
  --   initials = pickInitials(name): first char of EACH whitespace-split word,
  --              uppercased, first 2 chars (NOT first-2-letters-of-name — that
  --              would silently change the avatar for the common email-local case)
  --   color    = meta.avatar_color || random AVATAR_COLORS entry
  v_name   := coalesce(nullif(v_meta->>'name',''), nullif(split_part(v_user.email,'@',1),''), 'player');
  v_handle := regexp_replace(coalesce(nullif(v_meta->>'handle',''), 'user-' || left(v_uid::text, 8)),
                             '[^a-zA-Z0-9_-]', '', 'g');
  v_init   := coalesce(
                nullif(v_meta->>'avatar_initials',''),
                nullif(upper(left(regexp_replace(trim(v_name), '(\S)\S*\s*', '\1', 'g'), 2)), ''),
                '?');
  v_color  := coalesce(nullif(v_meta->>'avatar_color',''),
                       (array['#D72638','#2E5B8C','#22C55E','#F59E0B','#8B5CF6','#0EA5E9'])[1 + floor(random()*6)::int]);

  insert into public.profiles (
    id, auth_user_id, email, name, handle, avatar_color, avatar_initials,
    date_of_birth, notification_email_marketing,
    position, level, points, tier, bio, home_rink, created_at
  ) values (
    v_uid, v_uid, lower(v_user.email), v_name, v_handle, v_color, v_init,
    nullif(v_meta->>'date_of_birth','')::date,
    coalesce((v_meta->>'marketing_opt_in')::boolean, false),
    '', '', 0, 'Mite', '', '', now()
  )
  on conflict (id) do nothing;  -- concurrent call already inserted; still a success

  return v_uid;
end;
$$;

revoke all on function public.ensure_profile_for_current_user() from public;
revoke all on function public.ensure_profile_for_current_user() from anon;
grant execute on function public.ensure_profile_for_current_user() to authenticated;
