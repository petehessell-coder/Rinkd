-- ============================================================================
-- C12 · Operator Front Door — featured_operators (+ link table) + admin RPCs
-- ----------------------------------------------------------------------------
-- The branded operator landing page /o/:slug reads two new tables; every WRITE
-- goes through SECURITY DEFINER RPCs gated on public.current_user_is_admin()
-- (mirroring admin_set_activation / admin_delete_*). No RLS write policies at
-- all — the tables are read-only to every client role and fail closed.
--
-- Data model (spec §1b): featured_operators is the branded card; a curated set
-- of pinned events lives in featured_operator_events, each row pointing at
-- EXACTLY one of league_id / tournament_id (two nullable FKs + num_nonnulls=1,
-- not a polymorphic FK-less id — real referential integrity + clean cascade on
-- the admin hard-deletes). These are FIRST FKs from a NEW table to
-- leagues/tournaments, so they introduce no PostgREST embed ambiguity for the
-- existing bare embeds (the Jun-2 P0 footgun); page loaders still FK-qualify.
--
-- Guardrails baked into the write RPCs (can't live in a bare `with check`):
--   * slug format validated at the column (check constraint) AND server side.
--   * admin_set_featured_operator_events REFUSES any league with
--     `is_public is distinct from true` (fail-closed: NULL => not public) and
--     any tournament with `is_youth is distinct from false` (fail-closed:
--     NULL => youth) — the same youth/public exclusion the Home feed applies at
--     read time, enforced at WRITE time too.
--   * the never-empty invariant: an operator can't be is_active=true with zero
--     pinned events. admin_upsert refuses activating an empty operator
--     (`operator_needs_events`); admin_set_..._events flips an active operator
--     back to inactive if a replacement empties it.
--
-- Also closes the pinnable-inventory gap: admin_set_featured(kind,id,value) is
-- the first product control over leagues/tournaments.is_featured (pinned once
-- via raw SQL to date). Cloned from admin_set_activation's scoping discipline.
--
-- Repo conventions: idempotent DDL; every function `set search_path to 'public'`,
-- explicit `revoke all` + `grant execute to anon, authenticated, service_role`;
-- raises `admin_only` (42501) for non-admins like admin_delete_*.
--
-- APPLY RUNBOOK: prod-shape-tested first on the PGlite harness
--   `node scripts/c12-smoke/pglite-migrations.mjs` (must be all-green),
-- THEN applied via Supabase MCP `apply_migration` (NOT `supabase db push`).
-- Prod-audited 2026-07-02: no `featured_operator*` table and none of the four
-- new RPC names exist on prod (IF-NOT-EXISTS/CREATE-OR-REPLACE cannot silently
-- collide with an abandoned stub). leagues.is_public (nullable, default true),
-- tournaments.is_youth (not null, default false), profiles.is_admin/auth_user_id
-- verified live. Run get_advisors (security) post-apply.
-- ============================================================================

-- ─── featured_operators ─────────────────────────────────────────────────────
create table if not exists public.featured_operators (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique
                  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
  name            text not null,
  tagline         text,
  logo_url        text,
  logo_initials   text,
  brand_color     text,
  accent_color    text,
  cover_image_url text,
  website_url     text,
  platform_label  text,
  is_active       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.featured_operators is
  'C12 Operator Front Door: branded /o/:slug landing card. Public reads only is_active rows (admins see drafts); all writes via admin_* DEFINER RPCs.';

-- ─── featured_operator_events (pinned inventory) ────────────────────────────
create table if not exists public.featured_operator_events (
  id            uuid primary key default gen_random_uuid(),
  operator_id   uuid not null references public.featured_operators(id) on delete cascade,
  league_id     uuid references public.leagues(id)     on delete cascade,
  tournament_id uuid references public.tournaments(id) on delete cascade,
  sort_order    int  not null default 0,
  constraint featured_operator_events_exactly_one_target
    check (num_nonnulls(league_id, tournament_id) = 1),
  constraint featured_operator_events_operator_league_uniq    unique (operator_id, league_id),
  constraint featured_operator_events_operator_tournament_uniq unique (operator_id, tournament_id)
);

comment on table public.featured_operator_events is
  'C12: events pinned to an operator card. Exactly one of league_id/tournament_id (num_nonnulls=1). Youth tournaments + non-public leagues refused at write.';

create index if not exists idx_featured_operator_events_operator_sort
  on public.featured_operator_events (operator_id, sort_order);

-- ─── RLS: enabled on both, fail-closed, NO write policies ────────────────────
alter table public.featured_operators       enable row level security;
alter table public.featured_operator_events enable row level security;

-- Public read of active operators; admins see drafts for preview.
drop policy if exists featured_operators_public_read on public.featured_operators;
create policy featured_operators_public_read on public.featured_operators
  for select using (is_active = true or public.current_user_is_admin());

-- Event rows readable iff their operator is readable.
drop policy if exists featured_operator_events_public_read on public.featured_operator_events;
create policy featured_operator_events_public_read on public.featured_operator_events
  for select using (
    exists (
      select 1 from public.featured_operators fo
      where fo.id = operator_id
        and (fo.is_active = true or public.current_user_is_admin())
    )
  );

-- ─── RPC 1: upsert an operator card ─────────────────────────────────────────
-- Insert when p_id is null, else update that row. Bumps updated_at. Server-side
-- slug validation (belt to the column-check braces). REFUSES activating an
-- operator with zero pinned events (the never-empty guardrail).
create or replace function public.admin_upsert_featured_operator(
  p_slug            text,
  p_name            text,
  p_id              uuid    default null,
  p_tagline         text    default null,
  p_logo_url        text    default null,
  p_logo_initials   text    default null,
  p_brand_color     text    default null,
  p_accent_color    text    default null,
  p_cover_image_url text    default null,
  p_website_url     text    default null,
  p_platform_label  text    default null,
  p_is_active       boolean default false
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if not public.current_user_is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;

  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or char_length(p_slug) not between 3 and 40 then
    raise exception 'invalid_slug' using errcode = '22023',
      hint = 'lowercase letters/digits/hyphens, 3-40 chars';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'name_required' using errcode = '22004';
  end if;

  -- Never-empty guardrail: an operator can only go active with >=1 pinned event.
  if coalesce(p_is_active, false)
     and (p_id is null
          or not exists (select 1 from public.featured_operator_events e
                         where e.operator_id = p_id)) then
    raise exception 'operator_needs_events' using errcode = 'P0001',
      hint = 'pin at least one event before activating';
  end if;

  if p_id is null then
    insert into public.featured_operators
      (slug, name, tagline, logo_url, logo_initials, brand_color, accent_color,
       cover_image_url, website_url, platform_label, is_active)
    values
      (p_slug, p_name, p_tagline, p_logo_url, p_logo_initials, p_brand_color,
       p_accent_color, p_cover_image_url, p_website_url, p_platform_label,
       coalesce(p_is_active, false))
    returning id into v_id;
  else
    update public.featured_operators set
      slug            = p_slug,
      name            = p_name,
      tagline         = p_tagline,
      logo_url        = p_logo_url,
      logo_initials   = p_logo_initials,
      brand_color     = p_brand_color,
      accent_color    = p_accent_color,
      cover_image_url = p_cover_image_url,
      website_url     = p_website_url,
      platform_label  = p_platform_label,
      is_active       = coalesce(p_is_active, false),
      updated_at      = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'operator_not_found' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.admin_upsert_featured_operator(text,text,uuid,text,text,text,text,text,text,text,text,boolean) from public;
grant execute on function public.admin_upsert_featured_operator(text,text,uuid,text,text,text,text,text,text,text,text,boolean) to anon, authenticated, service_role;

-- ─── RPC 2: full-replace the operator's pinned events ───────────────────────
-- p_events is a jsonb array of {league_id?, tournament_id?, sort_order?}. Full
-- replace (delete then insert). Per item: exactly one target; league must be
-- public; tournament must be non-youth (both fail-closed). If the replacement
-- leaves an is_active operator with zero events, flip it inactive (invariant).
create or replace function public.admin_set_featured_operator_events(
  p_operator_id uuid,
  p_events      jsonb
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_item   jsonb;
  v_league uuid;
  v_tourn  uuid;
  v_sort   int;
  v_count  int := 0;
begin
  if not public.current_user_is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;

  if not exists (select 1 from public.featured_operators where id = p_operator_id) then
    raise exception 'operator_not_found' using errcode = 'P0002';
  end if;

  if p_events is not null and jsonb_typeof(p_events) <> 'array' then
    raise exception 'events_must_be_array' using errcode = '22023';
  end if;

  delete from public.featured_operator_events where operator_id = p_operator_id;

  if p_events is not null then
    for v_item in select * from jsonb_array_elements(p_events)
    loop
      v_league := nullif(v_item->>'league_id', '')::uuid;
      v_tourn  := nullif(v_item->>'tournament_id', '')::uuid;
      v_sort   := coalesce((v_item->>'sort_order')::int, 0);

      if num_nonnulls(v_league, v_tourn) <> 1 then
        raise exception 'exactly_one_target' using errcode = '22023',
          hint = 'each event needs exactly one of league_id / tournament_id';
      end if;

      if v_league is not null then
        -- fail-closed: NULL is_public counts as NOT public.
        if (select is_public from public.leagues where id = v_league) is distinct from true then
          raise exception 'league_not_public' using errcode = 'P0001',
            hint = 'only public leagues can be pinned';
        end if;
      else
        -- fail-closed: NULL is_youth counts as youth.
        if (select is_youth from public.tournaments where id = v_tourn) is distinct from false then
          raise exception 'tournament_is_youth' using errcode = 'P0001',
            hint = 'youth tournaments cannot be pinned';
        end if;
      end if;

      insert into public.featured_operator_events
        (operator_id, league_id, tournament_id, sort_order)
      values (p_operator_id, v_league, v_tourn, v_sort);
      v_count := v_count + 1;
    end loop;
  end if;

  -- Never-empty invariant: an active operator can't be left with zero events.
  if v_count = 0 then
    update public.featured_operators
       set is_active = false, updated_at = now()
     where id = p_operator_id and is_active = true;
  end if;
end;
$$;

revoke all on function public.admin_set_featured_operator_events(uuid,jsonb) from public;
grant execute on function public.admin_set_featured_operator_events(uuid,jsonb) to anon, authenticated, service_role;

-- ─── RPC 3: delete an operator card (events cascade) ────────────────────────
create or replace function public.admin_delete_featured_operator(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  delete from public.featured_operators where id = p_id;
end;
$$;

revoke all on function public.admin_delete_featured_operator(uuid) from public;
grant execute on function public.admin_delete_featured_operator(uuid) to anon, authenticated, service_role;

-- ─── RPC 4: pin/unpin an event (leagues/tournaments.is_featured) ────────────
-- Clone of admin_set_activation's scoping discipline: admin-gated, updates ONLY
-- is_featured on the named row, rejects unknown kinds.
create or replace function public.admin_set_featured(
  p_kind  text,
  p_id    uuid,
  p_value boolean
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;

  if p_kind = 'league' then
    update public.leagues set is_featured = p_value where id = p_id;
  elsif p_kind = 'tournament' then
    update public.tournaments set is_featured = p_value where id = p_id;
  else
    raise exception 'unknown_kind' using errcode = '22023';
  end if;

  return p_value;
end;
$$;

revoke all on function public.admin_set_featured(text,uuid,boolean) from public;
grant execute on function public.admin_set_featured(text,uuid,boolean) to anon, authenticated, service_role;
