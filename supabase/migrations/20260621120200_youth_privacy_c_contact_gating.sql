-- ============================================================================
-- YOUTH-PRIVACY · Migration C — personal contact gating (email / DOB / invite)
-- ----------------------------------------------------------------------------
-- Personal contact info is member-gated on ALL teams (youth AND adult). A
-- public adult team means discoverable names + results — NOT a stranger's
-- harvest of phone/email. Enforced at the column-grant layer (RLS is row-level
-- and cannot gate a single column), with SECURITY DEFINER RPCs for the few
-- legitimate consumers (self, team insiders, signup auto-link).
--
-- NOTE: Postgres column REVOKE cannot subtract from a table-level GRANT, so we
-- drop the table grant and re-grant the allowed column list. If a future
-- migration adds a profiles/team_members column the client must read, ADD IT
-- to the grant list below.
-- ============================================================================

-- anon already has no SELECT on profiles/team_members; this scopes `authenticated`.
revoke select on public.profiles from authenticated;
grant select (
  id, name, handle, avatar_color, avatar_initials, bio, "position", level, home_rink,
  points, tier, created_at, updated_at, is_premium, premium_until, stripe_customer_id,
  cover_image_url, onboarding_completed_at, welcome_seen, avatar_url, is_admin, persona,
  gender, last_seen_at, notification_email_transactional, notification_email_marketing,
  notification_push, profile_complete, auth_user_id, account_type
) on public.profiles to authenticated;

revoke select on public.team_members from authenticated;
grant select (
  id, team_id, user_id, role, jersey_number, "position", shot_hand, is_captain,
  is_alternate, status, joined_at, invite_name, external_source, external_id
) on public.team_members to authenticated;

-- ---- self: own email + DOB (e.g. GDPR export, checkout prefill) --------------
create or replace function public.get_my_contact()
returns table(email text, date_of_birth date)
language sql stable security definer set search_path to 'public'
as $$
  select p.email, p.date_of_birth
  from public.profiles p
  where p.id = public.current_profile_id();
$$;

-- ---- find an existing account by email (bind on invite / add-member).
--      Returns identity only — never echoes the email back. Auth-gated. -------
create or replace function public.find_account_by_email(p_email text)
returns table(id uuid, name text, handle text)
language sql stable security definer set search_path to 'public'
as $$
  select p.id, p.name, p.handle
  from public.profiles p
  where public.current_profile_id() is not null
    and p.email = lower(trim(p_email))
    and p.auth_user_id is not null
  limit 1;
$$;

-- ---- signup auto-link: bind pending invite slots matching the user's email.
--      Replaces the client-side invite_email scan in linkPendingInvitesForUser.
--      Runs as the just-created user (current_profile_id()); only binds slots
--      that carry their email. ----------------------------------------------
create or replace function public.link_pending_team_invites(p_email text)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare v_pid uuid; v_count int := 0;
begin
  v_pid := public.current_profile_id();
  if v_pid is null or coalesce(trim(p_email),'') = '' then return 0; end if;
  with bound as (
    update public.team_members tm
       set user_id = v_pid, status = 'active'
     where tm.user_id is null
       and tm.status = 'pending'
       and lower(tm.invite_email) = lower(trim(p_email))
    returning 1
  ) select count(*) into v_count from bound;
  return v_count;
end;
$$;

-- ---- team insiders: roster contact emails for the manage view --------------
create or replace function public.get_team_contacts(p_team_id uuid)
returns table(member_id uuid, user_id uuid, invite_name text, invite_email text, account_email text)
language sql stable security definer set search_path to 'public'
as $$
  select tm.id, tm.user_id, tm.invite_name, tm.invite_email, p.email
  from public.team_members tm
  left join public.profiles p on p.id = tm.user_id
  where public.is_team_insider(p_team_id, public.current_profile_id())
    and tm.team_id = p_team_id;
$$;

-- ---- team insiders: existing invite emails (RosterUpload dedupe) ------------
create or replace function public.team_invite_emails(p_team_id uuid)
returns setof text
language sql stable security definer set search_path to 'public'
as $$
  select tm.invite_email
  from public.team_members tm
  where public.is_team_insider(p_team_id, public.current_profile_id())
    and tm.team_id = p_team_id
    and tm.invite_email is not null;
$$;

-- ---- seed-follow suggestions (OnboardingModal) without exposing emails ------
create or replace function public.suggested_follow_accounts(p_seed_emails text[])
returns table(id uuid, name text, handle text, "position" text, avatar_color text, avatar_initials text, tier text, is_seed boolean)
language sql stable security definer set search_path to 'public'
as $$
  select p.id, p.name, p.handle, p.position, p.avatar_color, p.avatar_initials, p.tier,
         (p.email = any(select lower(e) from unnest(p_seed_emails) e)) as is_seed
  from public.profiles p
  where public.current_profile_id() is not null
    and p.id <> public.current_profile_id()
    and p.account_type is distinct from 'minor'
    and (p.email is null or p.email not ilike '%@demo.rinkd.app')
  order by (p.email = any(select lower(e) from unnest(p_seed_emails) e)) desc nulls last,
           p.points desc nulls last
  limit 24;
$$;

revoke all on function public.get_my_contact() from public;
revoke all on function public.find_account_by_email(text) from public;
revoke all on function public.link_pending_team_invites(text) from public;
revoke all on function public.get_team_contacts(uuid) from public;
revoke all on function public.team_invite_emails(uuid) from public;
revoke all on function public.suggested_follow_accounts(text[]) from public;
grant execute on function public.get_my_contact() to authenticated, service_role;
grant execute on function public.find_account_by_email(text) to authenticated, service_role;
grant execute on function public.link_pending_team_invites(text) to authenticated, service_role;
grant execute on function public.get_team_contacts(uuid) to authenticated, service_role;
grant execute on function public.team_invite_emails(uuid) to authenticated, service_role;
grant execute on function public.suggested_follow_accounts(text[]) to authenticated, service_role;
