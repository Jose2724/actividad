-- Two lines of one room never share a name (2026-10-17: Packing had two "Línea 2"; one was added on a tablet that had
-- opened without its room's lines). The app asks the server before adding or renaming a line; this is the server's own
-- guard, the one place that sees every tablet at once. A new line (or one put back) that arrives with the name of
-- another line of its room (the same name whatever the capitals, accents or spaces) is kept with " (2)", " (3)"...
-- added. It is never refused: a refused row would hold back everything a tablet still has to send. Two tablets adding
-- lines in one room at the same moment are taken one after the other. Lines that trade names, and renames, are the
-- app's to check (they pass through a moment with one name twice).
-- It also renames, once, the copies there are today: in each room the line with more codes keeps its name.
-- Run once in Supabase > SQL Editor. Safe to run again.

-- a line's name as it is compared: no capitals, no accents, single spaces
create or replace function public.act_line_key(n text) returns text
language sql immutable as $$
  select lower(regexp_replace(translate(btrim(coalesce(n, '')),
    'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
    'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun'), '\s+', ' ', 'g'))
$$;

create or replace function public.act_lines_unique_name() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base text := btrim(coalesce(new.name, ''));
  n int := 2;
begin
  if new.deleted or base = '' then return new; end if;
  -- an active line that is already there is being renamed or touched: the app checks those
  if exists (select 1 from public.act_lines l where l.id = new.id and not l.deleted) then return new; end if;
  -- one room at a time: two tablets adding lines at the same moment are taken one after the other
  perform pg_advisory_xact_lock(hashtext('act_lines:' || new.dept));
  while n < 100 and exists (
    select 1 from public.act_lines l
    where l.dept = new.dept and l.id <> new.id and not l.deleted and public.act_line_key(l.name) = public.act_line_key(new.name)
  ) loop
    new.name := base || ' (' || n || ')';
    n := n + 1;
  end loop;
  return new;
end $$;

drop trigger if exists act_lines_unique_name on public.act_lines;
create trigger act_lines_unique_name before insert on public.act_lines
  for each row execute function public.act_lines_unique_name();

-- the copies there are today: in each room the line with more codes keeps its name, the others get " (2)", " (3)"...
do $$
declare
  d record;
  n int;
  candidate text;
begin
  for d in
    select x.id, x.dept, btrim(x.name) as base, x.k from (
      select l.id, l.dept, l.name, row_number() over (
        partition by l.dept, public.act_line_key(l.name)
        order by (select count(*) from public.act_runs r where r.line_id = l.id and not r.deleted) desc, l.synced_at nulls last, l.id
      ) as k
      from public.act_lines l where not l.deleted
    ) x
    where x.k > 1
  loop
    n := d.k;
    loop
      candidate := d.base || ' (' || n || ')';
      exit when not exists (select 1 from public.act_lines l where l.dept = d.dept and not l.deleted and public.act_line_key(l.name) = public.act_line_key(candidate));
      n := n + 1;
    end loop;
    update public.act_lines set name = candidate, updated_at = now(), updated_by = 'servidor' where id = d.id;
  end loop;
end $$;
