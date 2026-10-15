-- Each product says which room packs it after its mezclas: RTE (pouches) or MFO (bins of cases). The office's daily
-- sheets list every code under one of them; Avance uses it so a code MFO packs never shows RTE pouches to make.
-- null = not said (the app then goes by the room that has registered the code). Run once in Supabase > SQL Editor,
-- BEFORE the new version of the app is published. Safe to run again. It only ADDS a column: nothing that exists is
-- changed, and the rules of who reads and writes act_products stay as they are.
alter table public.act_products add column if not exists room text;
