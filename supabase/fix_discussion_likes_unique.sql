-- =====================================================================
-- ExamenMate — constrângere unică pentru like-uri (dacă lipsește)
-- Împiedică like-uri duplicate (același user, aceeași postare).
-- Sigur de rulat: nu face nimic dacă indexul există deja.
-- Rulează în Supabase → SQL Editor → New Query.
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'discussion_likes'
      and indexdef ilike '%unique%(discussion_id, user_id)%'
  ) and not exists (
    select 1 from pg_constraint
    where conrelid = 'public.discussion_likes'::regclass and contype = 'u'
  ) then
    -- curăță eventualele duplicate existente înainte de a adăuga constrângerea
    delete from public.discussion_likes a using public.discussion_likes b
    where a.ctid < b.ctid and a.discussion_id = b.discussion_id and a.user_id = b.user_id;

    alter table public.discussion_likes
      add constraint discussion_likes_unique unique (discussion_id, user_id);
    raise notice 'Constrângere unică adăugată pe discussion_likes.';
  else
    raise notice 'discussion_likes are deja o constrângere/unic index — nu s-a modificat nimic.';
  end if;
end $$;
