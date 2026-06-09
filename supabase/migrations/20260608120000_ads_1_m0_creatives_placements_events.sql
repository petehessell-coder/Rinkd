-- ADS-1 M0: on-page sponsor inventory data model (league + tournament, Phase 1).
-- Additive; nothing reads these until the app ships. owner/target = league|tournament
-- (team = Phase 2). Measurement is owner-scoped + batched via RPCs only.
-- Applied to prod via MCP + verified (anon serving read, write-deny, RPC paths).

create table if not exists public.ad_creatives (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  owner_type text not null check (owner_type in ('league','tournament')),
  owner_id uuid not null,
  sponsor_name text not null,
  image_url text,
  link_url text,
  category text,                       -- youth content rule keys off this (app-side)
  moderation_status text not null default 'approved'
    check (moderation_status in ('pending','approved','rejected')),
  created_by uuid                      -- profiles.id (audit; NO FK — avoid embed traps)
);
create index if not exists ad_creatives_owner_idx on public.ad_creatives (owner_type, owner_id);

create table if not exists public.ad_placements (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  creative_id uuid not null references public.ad_creatives(id) on delete cascade,
  slot text not null check (slot in
    ('event_banner','feed_native','standings_presented','schedule_presented',
     'stats_presented','side_rail','team_banner')),
  target_type text not null check (target_type in ('league','tournament')),
  target_id uuid not null,
  weight int not null default 1,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true
);
create index if not exists ad_placements_target_idx
  on public.ad_placements (target_type, target_id, slot, is_active);
create index if not exists ad_placements_creative_idx on public.ad_placements (creative_id);

create table if not exists public.ad_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  placement_id uuid not null references public.ad_placements(id) on delete cascade,
  kind text not null check (kind in ('impression','tap')),
  session_id text                      -- de-dupe/reach; NO user_id (privacy)
);
create index if not exists ad_events_placement_idx on public.ad_events (placement_id, kind, created_at);

-- One owner-or-admin gate, reused by every policy.
create or replace function public.ad_can_manage(p_owner_type text, p_owner_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    case
      when p_owner_type = 'league'     then public.is_league_commissioner(p_owner_id, (select auth.uid()))
      when p_owner_type = 'tournament' then public.is_tournament_director(p_owner_id, (select auth.uid()))
      else false
    end, false) or coalesce(public.is_commissioner((select auth.uid())), false);
$$;

alter table public.ad_creatives  enable row level security;
alter table public.ad_placements enable row level security;
alter table public.ad_events     enable row level security;

create policy ad_creatives_read on public.ad_creatives
  for select to public
  using (moderation_status = 'approved' or public.ad_can_manage(owner_type, owner_id));
create policy ad_creatives_insert on public.ad_creatives
  for insert to authenticated
  with check (public.ad_can_manage(owner_type, owner_id));
create policy ad_creatives_update on public.ad_creatives
  for update to authenticated
  using (public.ad_can_manage(owner_type, owner_id))
  with check (public.ad_can_manage(owner_type, owner_id));
create policy ad_creatives_delete on public.ad_creatives
  for delete to authenticated
  using (public.ad_can_manage(owner_type, owner_id));

create policy ad_placements_read on public.ad_placements
  for select to public
  using (
    (is_active
      and (starts_at is null or starts_at <= now())
      and (ends_at   is null or ends_at   >= now())
      and exists (select 1 from public.ad_creatives c
                  where c.id = creative_id and c.moderation_status = 'approved'))
    or exists (select 1 from public.ad_creatives c
               where c.id = creative_id and public.ad_can_manage(c.owner_type, c.owner_id))
  );
create policy ad_placements_write on public.ad_placements
  for all to authenticated
  using (exists (select 1 from public.ad_creatives c
                 where c.id = creative_id and public.ad_can_manage(c.owner_type, c.owner_id)))
  with check (exists (select 1 from public.ad_creatives c
                      where c.id = creative_id and public.ad_can_manage(c.owner_type, c.owner_id)));

-- ad_events: NO direct policies — accessed only via the SECURITY DEFINER RPCs below.

create or replace function public.record_ad_events(p_events jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) = 0 then
    return;
  end if;
  if jsonb_array_length(p_events) > 200 then
    raise exception 'too many events';
  end if;
  insert into public.ad_events (placement_id, kind, session_id, created_at)
  select (e->>'placement_id')::uuid, e->>'kind', nullif(e->>'session_id',''), now()
  from jsonb_array_elements(p_events) e
  where (e->>'kind') in ('impression','tap')
    and (e->>'placement_id') ~ '^[0-9a-fA-F-]{36}$'
    and exists (select 1 from public.ad_placements p where p.id = (e->>'placement_id')::uuid);
end;
$$;
grant execute on function public.record_ad_events(jsonb) to anon, authenticated;

create or replace function public.get_ad_report(p_owner_type text, p_owner_id uuid, p_days int default 30)
returns table (placement_id uuid, slot text, sponsor_name text, impressions bigint, taps bigint)
language sql stable security definer set search_path = public as $$
  select pl.id, pl.slot, c.sponsor_name,
    count(ev.id) filter (where ev.kind = 'impression') as impressions,
    count(ev.id) filter (where ev.kind = 'tap')        as taps
  from public.ad_placements pl
  join public.ad_creatives c on c.id = pl.creative_id
  left join public.ad_events ev
    on ev.placement_id = pl.id and ev.created_at >= now() - make_interval(days => p_days)
  where c.owner_type = p_owner_type and c.owner_id = p_owner_id
    and public.ad_can_manage(p_owner_type, p_owner_id)
  group by pl.id, pl.slot, c.sponsor_name
  order by impressions desc;
$$;
grant execute on function public.get_ad_report(text, uuid, int) to authenticated;
-- Owner-gated report is signed-in only; drop the default PUBLIC execute (anon).
revoke execute on function public.get_ad_report(text, uuid, int) from public;
