-- An operator's tablet reads only its own room. Until now every signed-in person could read every room's lines,
-- codes, stops, program and history (the office and the managers need them all; an operator does not), so each
-- tablet downloaded the whole plant. Now: managers, the office and "Solo ver" read every room; an operator reads the
-- rooms' tables only for their own room (history lines without a room, like the start of the day, stay readable by
-- everyone with an Actividad role). Products, the program's codes, goals and shift hours and the devices list stay
-- as they were.
-- Run once in Supabase > SQL Editor. Safe to run again. Nothing that works today stops: an operator's screen only
-- ever showed their own room. Realtime follows these same rules by itself.
create or replace function public.act_can_read(d text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.act_me() m where m.role in ('mgr', 'office', 'viewer') or (m.role = 'op' and m.dept = d))
$$;
grant execute on function public.act_can_read(text) to authenticated;

drop policy if exists act_lines_read on public.act_lines;
create policy act_lines_read on public.act_lines for select to authenticated using (public.act_can_read(dept));
drop policy if exists act_runs_read on public.act_runs;
create policy act_runs_read on public.act_runs for select to authenticated using (public.act_can_read(dept));
drop policy if exists act_stops_read on public.act_stops;
create policy act_stops_read on public.act_stops for select to authenticated using (public.act_can_read(dept));
drop policy if exists act_plan_read on public.act_plan;
create policy act_plan_read on public.act_plan for select to authenticated using (public.act_can_read(dept));
-- (the history without a room was readable here by any account of the shared project, Freezer RTE's included; 018
-- asks for an Actividad role. The same rule as 018's, so running this file again never opens it, 2026-10-18)
drop policy if exists act_changes_read on public.act_changes;
create policy act_changes_read on public.act_changes for select to authenticated
  using ((dept is null and exists (select 1 from public.act_me())) or public.act_can_read(dept));
