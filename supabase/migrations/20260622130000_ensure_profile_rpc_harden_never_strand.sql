-- PROFILE-CREATE-RPC HARDENING: make ensure_profile_for_current_user() never
-- strand a signup (an auth.users row with no profile) on a UNIQUE/CHECK violation
-- for a non-id column. The happy path is unchanged (insert succeeds on attempt 0).
-- Not reachable via the current signup form, but this is the single provisioning
-- chokepoint at Black Bear scale, so it must be robust to legacy/non-form metadata.
--
--   1. Malformed date_of_birth ("2000-02-31" passes the client JS Date() COPPA
--      gate but fails ::date) -> coerce to NULL. COPPA-safe: under-13 is already
--      hard-blocked client-side before the auth user exists; the user re-enters DOB.
--   2. Colliding or empty derived handle -> retry with progressively more of THIS
--      user's globally-unique uuid; the terminal candidate is the full uuid, which
--      cannot collide with any other user. (The default user-<8hex> handle has a
--      birthday-paradox collision tail at ~100k cumulative users.)
--   3. Duplicate email -> fail loud with a DISTINCT, catchable error
--      (errcode 23505 + hint 'email_already_linked') instead of a raw/confusing
--      strand. A future email-claim flow detects the hint. (Pete's call, Jun 22.)
--
-- Core safety property is unchanged: keys SOLELY off auth.uid() (no target param),
-- idempotent, SECURITY DEFINER with a locked empty search_path.

create or replace function public.ensure_profile_for_current_user()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_user       auth.users%rowtype;
  v_meta       jsonb;
  v_name       text;
  v_handle     text;
  v_base       text;
  v_hex        text;
  v_color      text;
  v_init       text;
  v_dob        date;
  v_found      uuid;
  v_attempt    int := 0;
  v_constraint text;
begin
  if v_uid is null then
    raise exception 'ensure_profile: no authenticated user' using errcode = '28000';
  end if;

  -- Idempotent: already provisioned? (cheap PK lookup; returning-user common case.)
  select id into v_found from public.profiles where id = v_uid;
  if found then
    return v_found;
  end if;

  select * into v_user from auth.users where id = v_uid;
  if not found then
    raise exception 'ensure_profile: auth user % not found', v_uid using errcode = 'P0002';
  end if;
  v_meta := coalesce(v_user.raw_user_meta_data, '{}'::jsonb);
  v_hex  := replace(v_uid::text, '-', '');   -- 32 globally-unique hex chars

  -- Field derivation mirrors src/lib/auth.js ensureProfileForUser() exactly
  -- (see base migration 20260622120000 for the per-field rationale).
  v_name   := coalesce(nullif(v_meta->>'name',''), nullif(split_part(v_user.email,'@',1),''), 'player');
  v_handle := regexp_replace(coalesce(nullif(v_meta->>'handle',''), 'user-' || left(v_hex, 8)),
                             '[^a-zA-Z0-9_-]', '', 'g');
  if v_handle = '' then                      -- symbol-only meta.handle stripped to ''
    v_handle := 'user-' || left(v_hex, 8);
  end if;
  v_init   := coalesce(
                nullif(v_meta->>'avatar_initials',''),
                nullif(upper(left(regexp_replace(regexp_replace(v_name, '^\s+|\s+$', '', 'g'),
                                                 '(\S)\S*\s*', '\1', 'g'), 2)), ''),
                '?');
  v_color  := coalesce(nullif(v_meta->>'avatar_color',''),
                       (array['#D72638','#2E5B8C','#22C55E','#F59E0B','#8B5CF6','#0EA5E9'])[1 + floor(random()*6)::int]);

  -- HARDENING 1: a calendar-invalid DOB coerces to NULL instead of throwing.
  begin
    v_dob := nullif(v_meta->>'date_of_birth','')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    v_dob := null;
  end;

  v_base := left(v_handle, 26);              -- leaves room for a '-' + uuid suffix

  -- HARDENING 2 (handle uniquify) + 3 (email fail-loud). Loop retries a handle
  -- collision with more of v_hex; on conflict (id) keeps the same-user race a no-op.
  loop
    begin
      insert into public.profiles (
        id, auth_user_id, email, name, handle, avatar_color, avatar_initials,
        date_of_birth, notification_email_marketing,
        position, level, points, tier, bio, home_rink, created_at
      ) values (
        v_uid, v_uid, lower(v_user.email), v_name, v_handle, v_color, v_init,
        v_dob,
        coalesce((v_meta->>'marketing_opt_in')::boolean, false),
        '', '', 0, 'Mite', '', '', now()
      )
      on conflict (id) do nothing;          -- concurrent same-user insert: success
      return v_uid;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'profiles_handle_key' then
        v_attempt := v_attempt + 1;
        if v_attempt >= 6 then
          v_handle := 'user-' || v_hex;     -- terminal: full uuid, cannot collide
          if v_attempt > 6 then raise; end if;   -- unreachable safety net
        else
          v_handle := v_base || '-' || left(v_hex, v_attempt * 6);  -- 6,12,18,24,30 hex
        end if;
        -- loop: retry the insert with the new handle
      elsif v_constraint = 'profiles_email_key' then
        raise exception 'ensure_profile: email already linked to an existing profile'
          using errcode = '23505', hint = 'email_already_linked';
      else
        raise;                              -- any other unique violation: surface it
      end if;
    end;
  end loop;
end;
$$;

revoke all on function public.ensure_profile_for_current_user() from public;
revoke all on function public.ensure_profile_for_current_user() from anon;
grant execute on function public.ensure_profile_for_current_user() to authenticated;
