-- INTEGRATIONS-1 — reusable data-sync authorization (clickwrap) record.
--
-- One row per (owner, integration) acknowledgment: the commissioner/director
-- clicks "I authorize Rinkd to sync our <provider> data and confirm we have the
-- right to share it." We store WHO clicked, WHEN, the exact STATEMENT text, and
-- a VERSION so a later wording change is auditable. Satisfies the provider ToS
-- data-sync authorization requirement (HockeyShift today; reusable for any
-- integration — GameSheet, future providers — via the `integration` discriminator).
--
-- Polymorphic owner: owner_type in ('league','tournament'), owner_id is the
-- league/tournament id. Deliberately FK-less on owner_id (the discriminator
-- decides the parent table) — mirrors how the app already gates these surfaces.

create table public.integration_authorizations (
  id            uuid primary key default gen_random_uuid(),
  owner_type    text not null check (owner_type in ('league','tournament')),
  owner_id      uuid not null,
  integration   text not null,                 -- 'hockeyshift' | 'gamesheet' | ...
  statement     text not null,                 -- exact clickwrap text agreed to
  version       text not null default 'v1',
  authorized_by uuid not null references auth.users(id) on delete set null,
  authorized_at timestamptz not null default now(),
  revoked_at    timestamptz,                   -- null = active authorization
  created_at    timestamptz not null default now()
);

-- One lookup path: "is there an active authorization for this owner+integration?"
create index idx_integration_auth_owner
  on public.integration_authorizations (owner_type, owner_id, integration);

alter table public.integration_authorizations enable row level security;

-- READ: only the owner's staff (commissioner of the league / director of the
-- tournament) can see the authorization record.
create policy integration_auth_select on public.integration_authorizations
  for select to authenticated
  using (
    (owner_type = 'league'     and public.is_league_commissioner(owner_id, auth.uid()))
    or (owner_type = 'tournament' and public.is_tournament_director(owner_id, auth.uid()))
  );

-- INSERT: the acting user must be the owner's staff AND must stamp themselves as
-- the authorizer (no recording an authorization on someone else's behalf).
create policy integration_auth_insert on public.integration_authorizations
  for insert to authenticated
  with check (
    authorized_by = auth.uid()
    and (
      (owner_type = 'league'     and public.is_league_commissioner(owner_id, auth.uid()))
      or (owner_type = 'tournament' and public.is_tournament_director(owner_id, auth.uid()))
    )
  );

-- REVOKE: owner staff may set revoked_at (soft-revoke; we never hard-delete an
-- audit record). No other column is mutable from the client.
create policy integration_auth_update on public.integration_authorizations
  for update to authenticated
  using (
    (owner_type = 'league'     and public.is_league_commissioner(owner_id, auth.uid()))
    or (owner_type = 'tournament' and public.is_tournament_director(owner_id, auth.uid()))
  )
  with check (
    (owner_type = 'league'     and public.is_league_commissioner(owner_id, auth.uid()))
    or (owner_type = 'tournament' and public.is_tournament_director(owner_id, auth.uid()))
  );
