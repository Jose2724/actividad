-- A room's program by lot (Jose and the office, 2026-10-20). RTE had to make 889 of lot 6292 (15,688 pouches) and
-- 889 of lot 6290 (2,482) the same day. The program kept one row per day, room and code, so the second lot could not
-- be typed ("El código 889 está dos veces"), and the room's card added both lots up under the first one ("hecho
-- 25,244 · ✓ completo (+9,556)"). Jose's rule: "la clave está en el lote: si los lotes son iguales que lo descuente;
-- si el lote es diferente que sea otra programación aun si es el mismo código". From this file on, a row of act_plan
-- is a day, a room, a code AND a lot ('' = no lot, a row of its own as before): one code may have a row per lot on the
-- same day, and each row counts only what was made of its lot.
--
-- Run once in Supabase > SQL Editor (the whole file at once), right BEFORE the build that uses it is published. Safe
-- to run again: it first looks at the table's key, and when it is already (date, dept, code, lot) it does nothing.
--
-- What it changes: only the primary key of act_plan, from (date, dept, code) to (date, dept, code, lot). Every row
-- that is there stays exactly as it is: each one was the only row of its day, room and code, so it is also the only
-- one of its day, room, code and lot. The column lot is there since 019, never null ('' when none); it is added here
-- too, the same way, only in case 019 was never run.
--
-- What each tablet meets:
--   * the new build sends every program by (date, dept, code, lot): taken.
--   * a tablet still on the build of before sends it by (date, dept, code): the server answers that it has no such
--     key (42P10) and takes nothing of that row. The program waits on that tablet and goes up by itself once the
--     tablet has the new build (it reloads on its own within a few minutes, when nobody is touching it). That build
--     stops its sending at that row and tries again every 20 s, so what it recorded after the program waits behind it
--     on that same device until it reloads. Only programs go by that key, and only the office, the managers and
--     whoever holds "Productos y programa" type them: the rest of the floor goes on as it is.
--     BUT that build of before takes all the rows of a code as one: while its program waits, a row of ANOTHER lot of
--     the same code typed later on another device (the office on the new build) makes it throw its own away, and the
--     history says "no se subió: … lo cambió después" (review of 2026-10-20). Nothing on the server can stop that,
--     since it happens on the old tablet. So: once this file is run and the new build is published, nobody types a
--     program on a device until that device shows the new version (the Tablets tab says each one's); after that,
--     look in the history for "no se subió" lines and type again what one of them names.
--   * before this file is run, the new build's programs wait the same way, and its screen says "Falta ejecutar en
--     Supabase el SQL 021 (el programa por lote)".
alter table public.act_plan add column if not exists lot text not null default '';

do $$
declare
  pk name;
  cols text[];
begin
  -- the table's primary key now: its name and its columns, in order
  select c.conname, array_agg(a.attname::text order by k.n)
    into pk, cols
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, n)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = 'public.act_plan'::regclass and c.contype = 'p'
   group by c.conname;
  if cols is not distinct from array['date', 'dept', 'code', 'lot'] then
    raise notice 'act_plan ya tiene la llave (date, dept, code, lot): nada que hacer';
    return;
  end if;
  -- the key of before goes and the new one comes, in this same transaction: no moment without a key
  if pk is not null then
    execute format('alter table public.act_plan drop constraint %I', pk);
  end if;
  alter table public.act_plan add constraint act_plan_pkey primary key (date, dept, code, lot);
end $$;
