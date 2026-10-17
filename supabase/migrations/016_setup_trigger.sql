-- When a code starts on a line, a Set up still open on that line ends where the code began, or is dropped when it
-- was left from hours before (over six) or from another day of work (the day turns at 3:30 AM, plant time). Until
-- now each tablet did this on its own, only for its room and only if it had heard of the Set up; now the server does
-- it once, with its authority, whichever device started the code, and every tablet sees the result. The same rule
-- applies to a Set up that reaches the server after the code's start. The app's own rule stays as a fallback and
-- gives the same result. Run once in Supabase > SQL Editor. Safe to run again. Nothing that exists is changed.

-- 'end' = the set up ends where the code began; 'drop' = it is taken away (left from hours before or from another day)
create or replace function public.act_setup_fate(setup_started timestamptz, code_started timestamptz) returns text
language sql immutable as $$
  select case
    when code_started - setup_started > interval '6 hours' then 'drop'
    when date_trunc('day', (setup_started at time zone 'America/New_York') - interval '3 hours 30 minutes')
      <> date_trunc('day', (code_started at time zone 'America/New_York') - interval '3 hours 30 minutes') then 'drop'
    else 'end' end
$$;

-- a code starts (or is opened again): the Set ups open on its line from before it began
create or replace function public.act_heal_setup_on_run() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.deleted, false) or new.ended_at is not null or new.line_id is null or new.started_at is null then return new; end if;
  update public.act_stops s
     set ended_at = case when public.act_setup_fate(s.started_at, new.started_at) = 'end' then new.started_at else s.ended_at end,
         deleted = case when public.act_setup_fate(s.started_at, new.started_at) = 'drop' then true else s.deleted end,
         updated_at = now(),
         updated_by = 'servidor'
   where s.line_id = new.line_id and s.dept = new.dept and s.reason = 'Set up'
     and s.ended_at is null and coalesce(s.deleted, false) = false and s.started_at <= new.started_at;
  return new;
end $$;
drop trigger if exists act_runs_heal_setup on public.act_runs;
create trigger act_runs_heal_setup after insert or update of started_at, ended_at, deleted on public.act_runs
  for each row execute function public.act_heal_setup_on_run();

-- a Set up arrives (or is opened again) for a line that already runs a code started after it
create or replace function public.act_heal_setup_on_stop() returns trigger
language plpgsql security definer set search_path = public as $$
declare code_started timestamptz;
begin
  if new.reason is distinct from 'Set up' or new.ended_at is not null or coalesce(new.deleted, false) or new.line_id is null then return new; end if;
  select r.started_at into code_started from public.act_runs r
   where r.line_id = new.line_id and r.dept = new.dept and r.ended_at is null and coalesce(r.deleted, false) = false and r.started_at >= new.started_at
   order by r.started_at limit 1;
  if code_started is null then return new; end if;
  if public.act_setup_fate(new.started_at, code_started) = 'drop' then new.deleted := true; else new.ended_at := code_started; end if;
  new.updated_at := now();
  new.updated_by := 'servidor';
  return new;
end $$;
drop trigger if exists act_stops_heal_setup on public.act_stops;
create trigger act_stops_heal_setup before insert or update of started_at, ended_at, deleted on public.act_stops
  for each row execute function public.act_heal_setup_on_stop();
