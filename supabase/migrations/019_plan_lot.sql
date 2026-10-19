-- The lot of a room's program (Jose, 2026-10-19, from the floor: "cuando se vaya a hacer una programación para
-- cualquier cuarto tenga una opción también de poner el lote, que por defecto salga el lote del día, y que sea
-- opcional"). Each code of a room's program for a day may say which lot it is for: the app offers the day's lot and
-- the office may change it or leave it blank ('' = no lot: the day's program, as before). "Flujo de datos" adds up, lot
-- by lot, what was programmed of each code and says what is still to make. Run once in Supabase > SQL Editor. Safe to
-- run again. It only ADDS a column, with '' for every row that is there: nothing that exists is changed.
alter table public.act_plan add column if not exists lot text not null default '';
