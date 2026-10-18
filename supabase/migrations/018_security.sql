-- The server's own guards, after the security review of 2026-10-17/18. Run once in Supabase > SQL Editor (the whole
-- file at once). Safe to run again: every statement replaces itself or does nothing the second time. No row is erased
-- or rewritten, and nothing a screen of the app sends, in this version or the ones before, is refused (what is now
-- refused are hand-made requests no screen produces): the tablets go on exactly as they are, and it can be run before
-- or after a new build is published. tests/db.mjs checks every write of every role and power against it.
-- What it changes:
--   1. A unit (cart, mezcla, bin, pallet) the server already has is never lost to an older copy from another
--      tablet: one that was taken off on purpose carries its mark (extra.removed) and stays off.
--   2. Two indexes so the Set up check of 016 does not read every stop on each tap.
--   3. act_runs_log now keeps WHO sent each version (their account id, column uid), and also keeps the lines'
--      versions (renames, removals), so a change made by hand through the API can be traced to its account.
--   4. The history (act_changes). A row of a room can no longer pass for one of the plant's own marks (the start of
--      the day, a purge and its restore, an order and its log), and a row without a room is written, and stays,
--      only under the power it is about. Until now an operator could, through the API, plant a fake start of the
--      day or a fake order that every tablet obeyed. The app writes those marks only without a room. The id of a
--      day's start (day:...) or of an order (po:...) goes only with that mark, on any row.
--   5. The history without a room (orders, day starts, products) is read only by people with an Actividad role,
--      no longer by every account of the shared project (Freezer RTE workers included).
--   6. The calendar (shiftweek:, shiftday:) goes with the power "Cambiar el horario de los turnos", like the shift
--      hours; until now a person given that power alone had their week and days apart refused and lost. The
--      operators' line rules (opt:) are the managers' and the office's alone.
--   7. Each device's row in the Tablets list says who really sent it (the server fills in the person signed in).
--   8. Nobody can DELETE or TRUNCATE an Actividad table from the app's side (the app never does; rows are only
--      marked deleted). The Freezer RTE tables are not touched.
--   9. (Jose, 2026-10-18) A run is marked deleted only by someone holding "Borrar corridas y paros"; from anybody
--      else the server keeps it as it was, without refusing anything. Putting a run back always works.
--  10. (Jose, 2026-10-18) A line is taken off only by a manager, the office, someone holding "Corregir registros", or
--      an operator while the rule "quitar líneas libres" is on (the app's own rules); from anybody else the server
--      keeps it. Renames and putting a line back are not touched. The stops are not guarded (see 9 and 10 below).
-- The order matters while the floor is working: a tablet's write takes act_runs or act_stops (or act_lines) first and
-- act_runs_log after, so this file does the same, and a tablet's write that meets it waits a moment instead of
-- failing. The new triggers are created only when they are not there (no DROP, which would lock the table for reading).

-- 1. a unit the server has is never lost to an older copy. Two tablets on one run within a second (one refreshes,
-- the other's pallet lands, the first one's copy then goes up without it) used to leave the server without that
-- pallet. Now a unit the server had, which the new version neither carries nor marks as taken off on purpose
-- (extra.removed, written by every removal of the app), is put back, in order of its moment. It only ever ADDS units
-- back, never removes or changes one, never touches extra, and never refuses: a version that loses nothing passes
-- untouched.
create or replace function public.act_runs_keep_units() returns trigger
language plpgsql set search_path = public as $$
declare dead jsonb := case when jsonb_typeof(new.extra -> 'removed') = 'array' then new.extra -> 'removed' else '[]'::jsonb end;
begin
  if jsonb_typeof(old.units) is distinct from 'array' or jsonb_typeof(new.units) is distinct from 'array' then return new; end if;
  -- units the server had, that the new version lacks and does not say it took off on purpose
  if not exists (
    select 1 from jsonb_array_elements(old.units) o
    where jsonb_typeof(o -> 'at') = 'number'
      and not exists (select 1 from jsonb_array_elements(new.units) x where x -> 'at' = o -> 'at')
      and not dead @> jsonb_build_array(o -> 'at')) then return new; end if;
  -- the app takes the last unit as the newest: everything in order of its moment
  select coalesce(jsonb_agg(y.e order by y.k nulls first, y.i), '[]'::jsonb) into new.units from (
    select x.e, case when jsonb_typeof(x.e -> 'at') = 'number' then (x.e ->> 'at')::numeric end as k, x.i
      from jsonb_array_elements(new.units) with ordinality as x(e, i)
    union all
    select o.e, (o.e ->> 'at')::numeric, 0
      from jsonb_array_elements(old.units) with ordinality as o(e, i)
     where jsonb_typeof(o.e -> 'at') = 'number'
       and not exists (select 1 from jsonb_array_elements(new.units) x where x -> 'at' = o.e -> 'at')
       and not dead @> jsonb_build_array(o.e -> 'at')
  ) y;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.act_runs'::regclass and tgname = 'act_runs_keep_units') then
    create trigger act_runs_keep_units before update on public.act_runs for each row execute function public.act_runs_keep_units();
  end if;
end $$;

-- 2. what is still open on a line, found without reading every run and every stop: 016 asks it on each tap (the
-- predicate is "ended_at is null" alone, the only part of 016's question the planner can match)
create index if not exists act_runs_open_line on public.act_runs (line_id) where ended_at is null;
create index if not exists act_stops_open_line on public.act_stops (line_id) where ended_at is null;

-- 9 and 10, Jose's decision of 2026-10-18: deleting a run and taking a line off are the server's rule too, not only
-- the app's buttons (until now an operator could do both through the API, whatever her powers or the managers' rule).
-- They are written here, before 3, and not at the end of the file: like a tablet's write, this file must take act_runs
-- and act_lines before act_runs_log (3 locks act_runs_log until the whole file ends; a trigger made on act_runs after
-- that would wait for a tablet's write that waits for this file, and Postgres would cancel one of the two).
-- Neither ever refuses: a refused row stays in a tablet's queue and holds back what comes after it (outbox.ts), and
-- when someone else signs in on that tablet it goes up under their account. The server only keeps the run or the
-- line as it was (deleted stays false). Everything else of that same write is taken as sent, updated_at included, so
-- the tablet that sent it shows the run or the line again with the next word from the server, and sends nothing more
-- (store.ts, reconcile: the stamp is the one it kept when it took the row off). Who sent it is in act_runs_log
-- (3: the account in uid; the history triggers run before these). The SQL Editor and the service (no account,
-- auth.uid() null) are not limited. Putting a run or a line back (deleted true -> false), and a row that arrives
-- already deleted (it was never on the server: nothing there to keep), are not touched. The stops are not guarded:
-- the app itself takes off, on any operator's tablet and with no power, a Set up left open or one under a minute
-- (store.ts: startRun, startSetup, endShift, dropSetup, healSetup), and 016 does the same on the server.

-- 9. a run is marked deleted only by someone holding "Borrar corridas y paros" (del). The app shows "Borrar corrida"
-- only to them, and the start of the day that clears a day only to the owner (a Freezer RTE admin, who holds every
-- power); act_has reads the powers as the app does (powers.ts): the office and the managers hold it unless it was
-- taken from them in Empleados. From anybody else (a hand-made request, a tablet that still had a power taken away
-- minutes before) the run stays. A run a tablet still had as deleted while someone put it back is not deleted again.
create or replace function public.act_runs_keep() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted and not coalesce(old.deleted, false) and auth.uid() is not null and not public.act_has('del') then
    new.deleted := false;
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.act_runs'::regclass and tgname = 'act_runs_keep') then
    create trigger act_runs_keep before update on public.act_runs for each row execute function public.act_runs_keep();
  end if;
end $$;

-- 10. a line is taken off only by whom the app lets: a manager or the office (Ajustes > Líneas, whatever their
-- powers), someone holding "Corregir registros" (fix: the line card, two lines with one name), or any operator of the
-- room while the managers' rule "quitar líneas libres" is on (act_targets 'opt:oplines', per_shift 1: store.ts,
-- setLineRules). Renaming is every operator's (the pencil on each line card) and is not touched.
create or replace function public.act_lines_keep() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted and not coalesce(old.deleted, false) and auth.uid() is not null
     and not public.act_is_mgr() and not public.act_has('fix')
     and not exists (select 1 from public.act_targets t where t.dept = 'opt:oplines' and t.per_shift = 1) then
    new.deleted := false;
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.act_lines'::regclass and tgname = 'act_lines_keep') then
    create trigger act_lines_keep before update on public.act_lines for each row execute function public.act_lines_keep();
  end if;
end $$;

-- 3. who sent each version, by the server. The lines' versions are kept too (a line renamed or removed), with the
-- same trigger as the runs and the stops. Then the account of the request (null from the SQL Editor): the 011
-- trigger does not name this column, so the default fills it in, and it keeps doing so if 011 is run again. Existing
-- rows read null; the table is not rewritten.
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.act_lines'::regclass and tgname = 'act_lines_history') then
    create trigger act_lines_history before update on public.act_lines for each row execute function public.act_keep_history();
  end if;
end $$;
alter table public.act_runs_log add column if not exists uid uuid default auth.uid();

-- 4. act_changes: the room rows never carry the plant's marks; the rows without a room keep their power to the end.
-- Until now the update rule of the powers checked only "dept is null" on the new row, so an operator could take a row
-- of her own room and turn it into a start of the day or an order (verified 2026-10-17 on a copy of the server).
-- The ids the app finds a mark by (day:<date>, the start of that day; po:<id>, an order) go only with that mark, on
-- every row: anyone with another power (goals, shifts, products) could take a day's id for a row of theirs without a
-- room, and the start of that day by an operator with "Empezar el día" then landed on it and was refused, and never
-- reached the other tablets (review of 2026-10-18). The app writes day: ids only for act_days and po: ids only for
-- act_orders, so nothing it sends is refused; a row planted before stays as it is (a manager's start of that day
-- still writes over it).
drop policy if exists act_changes_insert on public.act_changes;
create policy act_changes_insert on public.act_changes for insert to authenticated
  with check (public.act_can_write(dept)
    and (dept is null or ref_table not in ('act_days', 'act_days:purge', 'act_days:restore', 'act_orders', 'act_orders_log'))
    and (id not like 'day:%' or ref_table = 'act_days')
    and (id not like 'po:%' or ref_table = 'act_orders'));
drop policy if exists act_changes_update on public.act_changes;
create policy act_changes_update on public.act_changes for update to authenticated
  using (public.act_can_write(dept))
  with check (public.act_can_write(dept)
    and (dept is null or ref_table not in ('act_days', 'act_days:purge', 'act_days:restore', 'act_orders', 'act_orders_log'))
    and (id not like 'day:%' or ref_table = 'act_days')
    and (id not like 'po:%' or ref_table = 'act_orders'));
drop policy if exists act_changes_insert_power on public.act_changes;
create policy act_changes_insert_power on public.act_changes for insert to authenticated
  with check (dept is null and (
    (ref_table in ('act_orders', 'act_orders_log') and public.act_has('orders'))
    or (ref_table = 'act_days' and public.act_has('day'))
    or (ref_table = 'act_targets' and (public.act_has('shifts') or public.act_has('goals')))
    or (ref_table in ('act_products', 'act_schedule') and public.act_has('products')))
    and (id not like 'day:%' or ref_table = 'act_days')
    and (id not like 'po:%' or ref_table = 'act_orders'));
drop policy if exists act_changes_update_power on public.act_changes;
create policy act_changes_update_power on public.act_changes for update to authenticated
  using (dept is null and (
    (ref_table in ('act_orders', 'act_orders_log') and public.act_has('orders'))
    or (ref_table = 'act_days' and public.act_has('day'))
    or (ref_table = 'act_targets' and (public.act_has('shifts') or public.act_has('goals')))
    or (ref_table in ('act_products', 'act_schedule') and public.act_has('products'))))
  with check (dept is null and (
    (ref_table in ('act_orders', 'act_orders_log') and public.act_has('orders'))
    or (ref_table = 'act_days' and public.act_has('day'))
    or (ref_table = 'act_targets' and (public.act_has('shifts') or public.act_has('goals')))
    or (ref_table in ('act_products', 'act_schedule') and public.act_has('products')))
    and (id not like 'day:%' or ref_table = 'act_days')
    and (id not like 'po:%' or ref_table = 'act_orders'));

-- 5. the history without a room is Actividad's: read by everyone with a role (op, mgr, office, viewer), not by an
-- account of the shared project that has none (the orders carry customers and POs)
drop policy if exists act_changes_read on public.act_changes;
create policy act_changes_read on public.act_changes for select to authenticated
  using ((dept is null and exists (select 1 from public.act_me())) or public.act_can_read(dept));

-- 6. act_targets: the plant's calendar (shift hours, the week, days apart) is the power "shifts"; the operators' line
-- rules (opt:) only the managers and the office write (005's rules); everything else is a goal
drop policy if exists act_targets_insert_power on public.act_targets;
create policy act_targets_insert_power on public.act_targets for insert to authenticated
  with check (case when dept like 'shifts:%' or dept like 'shiftweek:%' or dept like 'shiftday:%' then public.act_has('shifts')
                   when dept like 'opt:%' then false
                   else public.act_has('goals') end);
drop policy if exists act_targets_update_power on public.act_targets;
create policy act_targets_update_power on public.act_targets for update to authenticated
  using (case when dept like 'shifts:%' or dept like 'shiftweek:%' or dept like 'shiftday:%' then public.act_has('shifts')
              when dept like 'opt:%' then false
              else public.act_has('goals') end)
  with check (case when dept like 'shifts:%' or dept like 'shiftweek:%' or dept like 'shiftday:%' then public.act_has('shifts')
                   when dept like 'opt:%' then false
                   else public.act_has('goals') end);

-- 7. a device's row says who is signed in on it as the server knows them. It never refuses (a refused word would
-- make a working tablet look silent, and a person switch on the same tablet must go through): it only fills in the
-- name and the employee id of whoever sent it, which is what an honest tablet already sends.
create or replace function public.act_devices_who() returns trigger
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  if auth.uid() is null then return new; end if; -- the SQL Editor or the service: left as written
  select x.id, x.name into e from public.employees x where x.user_id = auth.uid() limit 1;
  if found then
    new.user_id := e.id::text;
    new.name := e.name;
    new.updated_by := e.name;
  end if;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.act_devices'::regclass and tgname = 'act_devices_who') then
    create trigger act_devices_who before insert or update on public.act_devices for each row execute function public.act_devices_who();
  end if;
end $$;

-- 8. nothing of Actividad is erased from the app's side: no DELETE, no TRUNCATE (TRUNCATE skips the row rules).
-- Supabase usually grants every new table ALL to anon and authenticated; revoking what was never granted does
-- nothing. An explicit list of Actividad's tables: the Freezer RTE tables need their DELETE.
do $$
declare t text;
begin
  foreach t in array array['act_lines', 'act_runs', 'act_stops', 'act_products', 'act_schedule', 'act_changes',
                           'act_targets', 'act_plan', 'act_runs_log', 'act_devices'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke delete, truncate on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
