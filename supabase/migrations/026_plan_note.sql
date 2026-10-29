-- A comment on a row of a room's program (the office through Jose, 2026-10-28: "agregar comentarios en programas de
-- cada departamento en una columna"): act_plan.note, free text up to 200 characters, shown on the room's card in its
-- own column and on the Programa tab. Null = none.
--
-- Run once in Supabase > SQL Editor, BEFORE the build that uses it is published. Safe to run again. Rows that are
-- there keep note null. A build from before never sends the column; the new build sends it only for a row with (or
-- that had) a comment, and while this file has not been run such a row waits on the device and the screen says so
-- ("Falta ejecutar en Supabase el SQL 026").
alter table public.act_plan add column if not exists note text;
