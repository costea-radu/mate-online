-- =====================================================================
-- ExamenMate · FĂRĂ NOTIFICĂRI LA BAREME — 21 noiembrie 2026
--
-- Cererea: „oprește notificările pentru bareme".
--
-- Triggerul trg_notify_new_content (AFTER INSERT pe public.content) trimitea elevilor o
-- notificare („PDF nou · …") la ORICE material nou — și la bareme (Admin → ✅ Încarcă
-- bareme, 🤖 botul de examene, „✨ Variante AI" cu baremul lor, skill-ul de conținut).
-- De acum baremele nu mai trimit notificări; restul materialelor — ca înainte.
--
-- Barem = la fel ca pe site (api/_lib/barem.js → isBaremRow): rubrica `bareme` SAU un
-- titlu cu cuvântul „barem" („Barem — …", „BAREM clasa a VI-a", „Bareme 2025").
-- Notificările deja trimise rămân (nu se șterge nimic).
-- Rulează în Supabase → SQL Editor → New Query → Run. Idempotent.
-- =====================================================================

create or replace function public.notify_new_content()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  type_label text;
begin
  -- baremele nu trimit notificări (21 nov. 2026)
  if new.subcategory = 'bareme' or lower(coalesce(new.title, '')) ~ '(^|[^a-z0-9])barem' then
    return new;
  end if;

  type_label := case new.content_type
    when 'pdf' then 'PDF nou'
    when 'interactive' then 'Exercițiu interactiv nou'
    when 'manual' then 'Manual nou'
    else 'Material nou' end;
  insert into public.ai_broadcasts (type, title, body, data)
  values (
    'material',
    type_label || ' · ' || public.ai_category_label(new.category),
    coalesce(new.title, 'Material nou') ,
    jsonb_build_object(
      'url', public.ai_material_url(new.id, new.content_type, new.category),
      'category', new.category, 'contentType', new.content_type, 'contentId', new.id, 'isFree', new.is_free
    )
  );
  return new;
end $function$;

-- Verificare rapidă (după ce încarci un barem, nu apare nicio notificare nouă):
-- select created_at, title, body from public.ai_broadcasts where type = 'material' order by created_at desc limit 10;
