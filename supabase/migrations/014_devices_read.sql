-- An operator's tablet could not keep its row on the devices table: writing over its own row again needs to see the
-- row, and only the managers could see the table. Every signed-in person reads it now (the list itself is only shown
-- to managers and the office). Run once in Supabase > SQL Editor, after 013. Safe to run again.
drop policy if exists act_devices_read on public.act_devices;
create policy act_devices_read on public.act_devices for select to authenticated using (exists (select 1 from public.act_me()));
