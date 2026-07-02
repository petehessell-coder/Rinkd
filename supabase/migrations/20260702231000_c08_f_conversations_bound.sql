-- ============================================================================
-- C08 · PR-F — "Freshness + pagination debt" — item 3b: bound list_my_conversations
-- Plan: Fable_Elevation_Program/audits/C08_performance.md §3 PR-F (P1, Sonnet 5)
-- ----------------------------------------------------------------------------
-- WHAT & WHY
--   list_my_conversations() returned every conversation the caller
--   participates in via jsonb_agg with NO LIMIT — "bound currently
--   unverifiable from the repo" per the audit (the function isn't defined in
--   any repo migration; it was applied out-of-band). Prod def fetched live via
--   pg_get_functiondef 2026-07-02 (see below) and confirmed unbounded.
--
--   This migration adds `p_limit int default 50` (clamped
--   greatest(1, least(p_limit, 200))) with a `LIMIT` applied INSIDE the CTE
--   pipeline (before the jsonb_agg), ordered by the same
--   `c.last_message_at desc nulls last` the prod body already used for the
--   final aggregate order — so the limit and the display order agree.
--   Everything else — the participant scope, unread computation, blocked-user
--   exclusion, output shape (jsonb array of the same object keys) — is
--   preserved BYTE-FOR-BYTE against the fetched prod definition.
--
--   ⚠ SIGNATURE CHANGE. Adding a parameter creates a NEW Postgres overload;
--   `create or replace` cannot drop the old zero-arg arity, so the old
--   signature is dropped first (same pattern as 20260702200000_c08_a…).
--   Clients pass no args (see src/lib/messages.js listConversations()), so the
--   default applies automatically — no client change required to ship this.
--
-- PROD DEF FETCHED LIVE (2026-07-02, via Supabase MCP pg_get_functiondef) —
--   unbounded jsonb_agg, same CTE shape reproduced below with only the LIMIT
--   (inside a new `capped` CTE) and the `p_limit` param added:
--
--   CREATE OR REPLACE FUNCTION public.list_my_conversations()
--    RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
--   AS $function$
--     with mine as (
--       select cp.conversation_id, cp.last_read_at
--       from conversation_participants cp
--       where cp.user_id = public.current_profile_id()
--     ),
--     other as (
--       select cp.conversation_id, p.id, p.name, p.handle,
--              p.avatar_color, p.avatar_initials, p.avatar_url
--       from conversation_participants cp
--       join mine on mine.conversation_id = cp.conversation_id
--       join profiles p on p.id = cp.user_id
--       where cp.user_id <> public.current_profile_id()
--     ),
--     unread as (
--       select m.conversation_id, count(*) c
--       from messages m
--       join mine on mine.conversation_id = m.conversation_id
--       where m.sender_id <> public.current_profile_id() and m.created_at > mine.last_read_at
--       group by m.conversation_id
--     )
--     select coalesce(jsonb_agg(
--       jsonb_build_object(
--         'conversation_id', c.id, 'last_message_at', c.last_message_at,
--         'last_message_preview', c.last_message_preview,
--         'last_message_sender_id', c.last_message_sender_id,
--         'other', jsonb_build_object('id', o.id, 'name', o.name, 'handle', o.handle,
--           'avatar_color', o.avatar_color, 'avatar_initials', o.avatar_initials, 'avatar_url', o.avatar_url),
--         'unread', coalesce(u.c, 0)
--       ) order by c.last_message_at desc nulls last
--     ), '[]'::jsonb)
--     from conversations c
--     join mine on mine.conversation_id = c.id
--     join other o on o.conversation_id = c.id
--     left join unread u on u.conversation_id = c.id
--     where not exists (
--       select 1 from user_blocks
--       where (blocker_id = public.current_profile_id() and blocked_id = o.id)
--          or (blocker_id = o.id and blocked_id = public.current_profile_id())
--     );
--   $function$;
--   Grants (prod, verified via information_schema.routine_privileges):
--     PUBLIC, postgres, anon, authenticated, service_role — all EXECUTE.
--   This migration tightens to the repo convention (revoke public + explicit
--   anon/authenticated/service_role) same as PR-A; every PostgREST role keeps
--   execute, so no client-visible behavior change from the grant tightening.
--
-- IDEMPOTENCY
--   drop-if-exists + create-or-replace. Safe to run twice.
--
-- APPLY RUNBOOK
--   1. Merge to main.
--   2. Prod-shape test (this repo's PGlite harness — see scripts/c08-e-smoke
--      if present; otherwise verify manually per step 3).
--   3. Apply to prod via Supabase MCP apply_migration OR `supabase db push`.
--   4. Verify the old zero-arg overload is gone and the new one is in place:
--        select proname, pg_get_function_identity_arguments(oid)
--        from pg_proc where proname = 'list_my_conversations';
--      Must show exactly ONE row: "p_limit integer DEFAULT 50".
--   5. Smoke: call list_my_conversations() as an authenticated user with >50
--      conversations (or lower p_limit temporarily) and confirm the jsonb
--      array length is capped and still ordered newest-first.
--   NOTE: no client change is required — src/lib/messages.js's
--   listConversations() calls with zero args, so the default applies.
-- ============================================================================

drop function if exists public.list_my_conversations();

create or replace function public.list_my_conversations(p_limit int default 50)
 returns jsonb
 language sql stable security definer set search_path to 'public'
as $function$
  with mine as (
    select cp.conversation_id, cp.last_read_at
    from conversation_participants cp
    where cp.user_id = public.current_profile_id()
  ),
  other as (
    select cp.conversation_id, p.id, p.name, p.handle,
           p.avatar_color, p.avatar_initials, p.avatar_url
    from conversation_participants cp
    join mine on mine.conversation_id = cp.conversation_id
    join profiles p on p.id = cp.user_id
    where cp.user_id <> public.current_profile_id()
  ),
  unread as (
    select m.conversation_id, count(*) c
    from messages m
    join mine on mine.conversation_id = m.conversation_id
    where m.sender_id <> public.current_profile_id() and m.created_at > mine.last_read_at
    group by m.conversation_id
  ),
  -- The only substantive change from the prod body: a bounded, deterministically
  -- ordered page BEFORE the jsonb_agg, instead of aggregating every row the
  -- caller participates in. Order matches the final aggregate's ORDER BY
  -- exactly (last_message_at desc nulls last) so the limit and the display
  -- order agree — capping never surfaces an out-of-order page.
  capped as (
    select c.id, c.last_message_at, c.last_message_preview, c.last_message_sender_id,
           o.id as other_id, o.name as other_name, o.handle as other_handle,
           o.avatar_color as other_avatar_color, o.avatar_initials as other_avatar_initials,
           o.avatar_url as other_avatar_url,
           coalesce(u.c, 0) as unread
    from conversations c
    join mine on mine.conversation_id = c.id
    join other o on o.conversation_id = c.id
    left join unread u on u.conversation_id = c.id
    where not exists (
      select 1 from user_blocks
      where (blocker_id = public.current_profile_id() and blocked_id = o.id)
         or (blocker_id = o.id and blocked_id = public.current_profile_id())
    )
    order by c.last_message_at desc nulls last
    limit greatest(1, least(p_limit, 200))
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'conversation_id', capped.id,
      'last_message_at', capped.last_message_at,
      'last_message_preview', capped.last_message_preview,
      'last_message_sender_id', capped.last_message_sender_id,
      'other', jsonb_build_object(
        'id', capped.other_id, 'name', capped.other_name, 'handle', capped.other_handle,
        'avatar_color', capped.other_avatar_color, 'avatar_initials', capped.other_avatar_initials,
        'avatar_url', capped.other_avatar_url
      ),
      'unread', capped.unread
    ) order by capped.last_message_at desc nulls last
  ), '[]'::jsonb)
  from capped;
$function$;

revoke all on function public.list_my_conversations(int) from public;
grant execute on function public.list_my_conversations(int) to anon, authenticated, service_role;
