-- =====================================================================
-- ExamenMate · cache PDF — completare v2 (Etapa 2 din AUDIT_AGENTI_AI.md)
-- Rulează DUPĂ supabase/ai_pdf_cache.sql. Idempotent.
--
--   · page_texts        — textul FIECĂREI pagini: serverul găsește pagina pe care
--                         stă exercițiul întrebat și o trimite modelului ca PDF
--                         (text + imagine), nu doar textul extras (punctul 1.1);
--   · barem_override_id — baremul ales MANUAL de administrator pentru un test
--                         (are prioritate față de potrivirea automată; punctul 3.1).
-- =====================================================================

alter table public.ai_pdf_text add column if not exists page_texts jsonb;
alter table public.ai_pdf_text add column if not exists barem_override_id uuid references public.content(id) on delete set null;

-- un barem nou încărcat NU mai șterge intrările asociate manual (ok_admin)
create or replace function public.ai_pdf_text_on_new_content()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.content_type = 'pdf' and new.category is not null then
    delete from public.ai_pdf_text t
      using public.content c
      where t.content_id = c.id and c.category = new.category
        and t.barem_override_id is null
        and t.barem_status not in ('ok','ok_antet','ok_continut','inclus','este_barem','ok_admin');
  end if;
  return new;
end$$;

-- la schimbarea fișierului unui test păstrăm asocierea manuală (doar textul se recalculează)
create or replace function public.ai_pdf_text_invalidate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.file_url is distinct from old.file_url then
    update public.ai_pdf_text
      set text = '', chars = 0, page_texts = null, barem_text = '',
          barem_status = case when barem_override_id is null then 'negasit' else barem_status end,
          updated_at = to_timestamp(0)
      where content_id = new.id;
  end if;
  return new;
end$$;

-- Funcțiile de trigger sunt SECURITY DEFINER → nu trebuie să fie chemabile din
-- browser prin /rest/v1/rpc/. `from public` singur nu ajunge în Supabase:
-- privilegiile implicite dau EXECUTE direct pe anon/authenticated.
-- Triggerele NU se strică — EXECUTE se verifică la CREATE TRIGGER, nu la declanșare.
revoke all on function public.ai_pdf_text_on_new_content() from public, anon, authenticated;
revoke all on function public.ai_pdf_text_invalidate()     from public, anon, authenticated;
