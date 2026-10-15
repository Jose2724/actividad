-- Packing redesign: what a Packing run carries besides its finished pallets, in one column of act_runs:
--   bin    = the line fills bins instead of pallets, and the word for what a bin holds (platos, copas, pouches...)
--   lotNow = the lot being packed now, once a lot ran out on a pallet and the next one came
--   open   = the pallet being built: the lots it already holds, each with its cases and its tag, and its PO
-- Every tablet of the room sees the pallet being built, as it is built. Run once in Supabase > SQL Editor, BEFORE the
-- new version of the app is published. Safe to run again. It only ADDS a column: nothing that exists is changed, and
-- the rules of who reads and writes act_runs stay as they are.
alter table public.act_runs add column if not exists extra jsonb;
