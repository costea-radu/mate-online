-- =====================================================================
-- ExamenMate · Profesor Virtual — CACHE pentru textul PDF-urilor + barem
-- (Etapa 1 din AUDIT_AGENTI_AI.md, punctele 2.1 și 3.1)
--
-- Până acum, la fiecare deschidere a unui test PDF cu Profesorul Virtual,
-- serverul descărca și parsa testul + până la 8 bareme-candidat. De acum
-- rezultatul (textul extras, baremul asociat și textul lui) se păstrează
-- aici, pe content_id, și:
--   · deschiderea PDF-ului devine o citire din DB (rapidă);
--   · corectarea („Răspunde în chat") recitește testul și baremul DE PE
--     SERVER, după contentId — nu mai are încredere în textul/baremul trimise
--     din browser (un elev putea trimite un „barem" propriu și puncte umflate).
-- Intrarea se invalidează automat când se schimbă fișierul (file_url);
-- o asociere „negăsit"/„ambiguu" se reîncearcă după 24h (AI_PDF_CACHE_RETRY_HOURS).
-- Rulează o dată în Supabase → SQL Editor. Idempotent.
-- =====================================================================

create table if not exists public.ai_pdf_text (
  content_id    uuid primary key references public.content(id) on delete cascade,
  file_url      text not null,                 -- fișierul pentru care e valabil textul
  text          text not null default '',      -- textul testului (max AI_PDF_MAX_CHARS)
  chars         int  not null default 0,
  truncated     boolean not null default false,
  barem_id      uuid,                          -- content.id al baremului asociat (sau null)
  barem         jsonb,                         -- {id,title,fileName,matchedBy,evidence,contentScore}
  barem_text    text not null default '',      -- textul baremului (max AI_BAREM_MAX_CHARS)
  barem_status  text not null default 'negasit', -- ok|ok_antet|ok_continut|inclus|este_barem|negasit|ambiguu|continut_diferit
  updated_at    timestamptz not null default now()
);
create index if not exists idx_ai_pdf_text_barem on public.ai_pdf_text(barem_id);

-- Doar serverul (service_role) citește/scrie — textul materialelor premium
-- nu trebuie să ajungă la clienți pe această cale.
alter table public.ai_pdf_text enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='ai_pdf_text' and policyname='ai_pdf_text_service') then
    create policy "ai_pdf_text_service" on public.ai_pdf_text for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;
revoke all on public.ai_pdf_text from anon, authenticated;

-- Când se înlocuiește fișierul unui material (sau se șterge), intrarea din
-- cache dispare — următoarea deschidere recalculează textul și baremul.
create or replace function public.ai_pdf_text_invalidate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.file_url is distinct from old.file_url then
    delete from public.ai_pdf_text where content_id = new.id;
  end if;
  return new;
end$$;
drop trigger if exists trg_ai_pdf_text_invalidate on public.content;
create trigger trg_ai_pdf_text_invalidate
  after update of file_url on public.content
  for each row execute function public.ai_pdf_text_invalidate();

-- Un BAREM nou încărcat poate fi asocierea așteptată de testele din aceeași
-- categorie care au rămas „negăsit" → le lăsăm să se recalculeze la următoarea
-- deschidere (ștergem doar intrările fără barem confirmat din acea categorie).
create or replace function public.ai_pdf_text_on_new_content()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.content_type = 'pdf' and new.category is not null then
    delete from public.ai_pdf_text t
      using public.content c
      where t.content_id = c.id and c.category = new.category
        and t.barem_status not in ('ok','ok_antet','ok_continut','inclus','este_barem');
  end if;
  return new;
end$$;
drop trigger if exists trg_ai_pdf_text_on_new_content on public.content;
create trigger trg_ai_pdf_text_on_new_content
  after insert on public.content
  for each row execute function public.ai_pdf_text_on_new_content();
