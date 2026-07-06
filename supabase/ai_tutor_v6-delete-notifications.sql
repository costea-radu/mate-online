-- =====================================================================
-- ai_tutor_v6 — la ȘTERGEREA unui material, șterge și anunțul (broadcast)
-- creat automat de trg_notify_new_content la adăugare.
-- Rulează o singură dată în Supabase → SQL Editor.
-- =====================================================================
create or replace function public.remove_content_broadcast()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- curăță „citirile" anunțurilor vizate (dacă nu există ON DELETE CASCADE)
  delete from public.ai_broadcast_reads
   where broadcast_id in (
     select id from public.ai_broadcasts
      where type = 'material' and (data->>'contentId') = old.id::text
   );
  -- șterge anunțul materialului
  delete from public.ai_broadcasts
   where type = 'material' and (data->>'contentId') = old.id::text;
  return old;
end $$;

drop trigger if exists trg_remove_content_broadcast on public.content;
create trigger trg_remove_content_broadcast after delete on public.content
  for each row execute function public.remove_content_broadcast();
