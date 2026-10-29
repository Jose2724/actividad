-- Voice notes in the chat (Jose, 2026-10-29: "¿y el audio?"): the same bucket as the photos (027), now taking the
-- recordings a browser makes (Opus in WebM on Chrome and Android, MP4 on Safari, Ogg) up to 4 MB (a minute of voice
-- is under 1 MB). The two rules of 027 stay as they are: who may put a note there and who may hear it is the chat's.
--
-- Run once in Supabase > SQL Editor, BEFORE the build that uses it is published. Safe to run again. On a copy of the
-- server without Supabase's storage (the local Postgres of npm run check) it does nothing and says so.

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice '028: no storage schema here (a local copy of the server): nothing to do';
    return;
  end if;
  update storage.buckets
     set file_size_limit = 4194304,
         allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mpeg']
   where id = 'act_chat';
  if not found then
    raise exception '028: the bucket act_chat is not there: run 027 first';
  end if;
  raise notice '028: the bucket act_chat now takes voice notes too';
end $$;
