-- Photos in the messages between a room and the office (Jose, 2026-10-28: "que se puedan agregar imágenes, como yo
-- pego aquí, o dar a un + para buscar alguna"). The photo itself goes to the bucket act_chat under its room
-- ('<room>/<message id>.jpg', made small by the app, JPEG, at most 2 MB), and the message (act_changes, kind act_chat)
-- names it. Who may put a photo there and who may see it: the chat's own rules (018's act_can_write / act_can_read by
-- the room in the path; the freezer's people for 'Freezer', as in 023). Nobody deletes or replaces one from the app.
--
-- Run once in Supabase > SQL Editor, BEFORE the build that uses it is published. Safe to run again. On a copy of the
-- server without Supabase's storage (the local Postgres of npm run check) it does nothing and says so.

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice '027: no storage schema here (a local copy of the server): nothing to do';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('act_chat', 'act_chat', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

  drop policy if exists act_chat_photo_read on storage.objects;
  create policy act_chat_photo_read on storage.objects for select to authenticated
    using (bucket_id = 'act_chat' and (public.act_can_read(split_part(name, '/', 1)) or (split_part(name, '/', 1) = 'Freezer' and public.act_is_freezer())));

  drop policy if exists act_chat_photo_insert on storage.objects;
  create policy act_chat_photo_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'act_chat' and (public.act_can_write(split_part(name, '/', 1)) or (split_part(name, '/', 1) = 'Freezer' and public.act_is_freezer())));

  raise notice '027: bucket act_chat and its two rules are in place';
end $$;
