-- NAV-PIN-2: explicit nav pins. v1 (NAV-PIN-1) auto-derived a single LEAGUE pin;
-- v2 is fully user-chosen — up to 3 pins (one each: league / team / tournament),
-- pinned via a 📌 toggle on each page. Tournament pins auto-expire 7 days after
-- the event ends (filtered on read; no cron). Decisions (Pete, Jun 9): 3 pins,
-- user choice (no auto-derive), tournament expiry = end_date + 7d.

CREATE TABLE IF NOT EXISTS public.nav_pins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_type   text NOT NULL CHECK (pin_type IN ('league','team','tournament')),
  target_id  uuid NOT NULL,             -- polymorphic; NO FK (cross-table + keeps embeds clean)
  expires_at timestamptz,               -- tournament: end_date + 7d; else null (permanent)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, pin_type)            -- one pin per type → max 3
);

CREATE INDEX IF NOT EXISTS nav_pins_user_idx ON public.nav_pins(user_id);

ALTER TABLE public.nav_pins ENABLE ROW LEVEL SECURITY;

-- A user sees + manages ONLY their own pins.
CREATE POLICY nav_pins_select_own ON public.nav_pins FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY nav_pins_insert_own ON public.nav_pins FOR INSERT WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY nav_pins_update_own ON public.nav_pins FOR UPDATE USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY nav_pins_delete_own ON public.nav_pins FOR DELETE USING (user_id = (SELECT auth.uid()));

-- Pin (or re-pin) a type. Centralizes the tournament-expiry rule so the client
-- can't get it wrong. Upsert on (user_id, pin_type) → re-pinning swaps target.
CREATE OR REPLACE FUNCTION public.set_nav_pin(p_pin_type text, p_target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
declare
  v_user uuid := (select auth.uid());
  v_expires timestamptz := null;
  v_end date;
begin
  if v_user is null then raise exception 'Sign in to pin' using errcode = '28000'; end if;
  if p_pin_type not in ('league','team','tournament') then
    raise exception 'Invalid pin type %', p_pin_type using errcode = '22023';
  end if;
  if p_pin_type = 'tournament' then
    select end_date into v_end from tournaments where id = p_target_id;
    if v_end is not null then v_expires := (v_end + interval '7 days'); end if;
  end if;
  insert into nav_pins (user_id, pin_type, target_id, expires_at, created_at)
  values (v_user, p_pin_type, p_target_id, v_expires, now())
  on conflict (user_id, pin_type)
  do update set target_id = excluded.target_id, expires_at = excluded.expires_at, created_at = now();
end;
$$;

CREATE OR REPLACE FUNCTION public.clear_nav_pin(p_pin_type text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
begin
  delete from nav_pins where user_id = (select auth.uid()) and pin_type = p_pin_type;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.set_nav_pin(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.clear_nav_pin(text)     FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_nav_pin(text, uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.clear_nav_pin(text)     TO authenticated;
