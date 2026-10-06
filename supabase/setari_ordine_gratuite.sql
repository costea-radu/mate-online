-- =====================================================================
-- ExamenMate · SETĂRILE DIN ADMIN: unde apar materialele noi + meditațiile gratuite
--
--   app_settings  — setările alese din Admin (cheie → valoare JSON):
--                   • 'content_new_position' — Admin → 📋 Tot Conținutul →
--                     ↕ Ordinea de afișare → „📥 Materialele noi apar: primele /
--                     ultimele" (pe tot site-ul, pe categorie sau pe rubrică)
--                   • 'live_free_lessons' — Admin → 🎥 Meditații live →
--                     „🎁 Meditațiile gratuite" (lecțiile 1-la-1 fără plată)
--   content_new_position (trigger) — la ORICE material nou (Adaugă PDF /
--                   Interactiv din Admin, testele postate de agentul Claude):
--                   dacă rubrica lui are „⤓ ultimele", primește poziția de după
--                   ultimul material din rubrică, deci apare la SFÂRȘIT. Altfel
--                   rămâne ca până acum (poziția 0 → apare primul).
--
-- Toate citirile și scrierile setărilor trec prin server (api/content-admin.js,
-- api/live.js — service role). Browserul nu citește direct tabela.
--
-- Rulează în Supabase → SQL Editor → New Query → Run. Idempotent (se poate rula
-- de mai multe ori). Fără el, site-ul merge ca înainte: materialele noi apar
-- primele, iar meditațiile gratuite sunt cele alese automat (nu se pot schimba).
-- =====================================================================

-- ─── 1. Setările ─────────────────────────────────────────────────────────────
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

alter table public.app_settings enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_settings' and policyname = 'app_settings_service') then
    create policy app_settings_service on public.app_settings for all
      using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');
  end if;
end $$;
revoke all on public.app_settings from anon, authenticated;

-- ─── 2. Rubrica unui material (lista în care apare pe site) ──────────────────
-- Aceeași regulă ca matchesGroup (src/lib/contentMeta.js) și rubricKey
-- (api/_lib/contentAdmin.js):
--   • clase / auxiliare: categoria + tipul (tab-ul paginii);
--   • Evaluare Națională: + subcategoria;
--   • Bacalaureat: + subcategoria + profilul (mai puțin la „Capitole").
create or replace function public.content_rubric_key(cat text, sub text, prof text, typ text)
returns text language sql immutable set search_path = public as $$
  select coalesce(cat, '') || '|'
      || case when cat in ('evaluare-nationala', 'bacalaureat') then coalesce(sub, '') else '' end || '|'
      || case when cat = 'bacalaureat' and coalesce(sub, '') not in ('', 'capitole') then coalesce(prof, '') else '' end || '|'
      || coalesce(typ, '');
$$;

-- ─── 3. Poziția materialelor noi ─────────────────────────────────────────────
-- Prioritatea: rubrica → categoria → tot site-ul → „start" (poziția 0, ca înainte).
-- Se aplică doar când materialul vine fără o poziție anume (sort_order 0 / gol),
-- adică exact cum îl trimit formularele din Admin și agentul.
create or replace function public.content_new_position()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb;
  k   text;
  pos text;
  mx  int;
begin
  if coalesce(new.sort_order, 0) <> 0 then
    return new;                       -- poziție dată explicit → o păstrăm
  end if;
  select s.value into cfg from public.app_settings s where s.key = 'content_new_position';
  if cfg is null then
    return new;                       -- nicio setare → ca înainte (apare primul)
  end if;
  k := public.content_rubric_key(new.category, new.subcategory, new.profile, new.content_type);
  pos := coalesce(cfg -> 'rubrics' ->> k, cfg -> 'categories' ->> new.category, cfg ->> 'site', 'start');
  if pos is distinct from 'end' then
    return new;
  end if;
  select coalesce(max(c.sort_order), 0) into mx
    from public.content c
    where c.category = new.category
      and c.content_type = new.content_type
      and public.content_rubric_key(c.category, c.subcategory, c.profile, c.content_type) = k;
  new.sort_order := mx + 1;           -- după ultimul din rubrică → apare la sfârșit
  return new;
end $$;

drop trigger if exists trg_content_new_position on public.content;
create trigger trg_content_new_position
  before insert on public.content
  for each row execute function public.content_new_position();

-- Funcții de trigger / ajutătoare, nu de API: le scoatem din /rest/v1/rpc.
-- (În Supabase, `from public` singur nu ajunge: privilegiile implicite dau
-- EXECUTE direct rolurilor anon/authenticated. Triggerul NU se strică —
-- EXECUTE se verifică la CREATE TRIGGER, nu la declanșare.)
revoke all on function public.content_new_position() from public, anon, authenticated;
revoke all on function public.content_rubric_key(text, text, text, text) from public, anon, authenticated;

-- Verificare (opțional):
--   select * from public.app_settings;
--   -- după ce alegi „⤓ ultimele" la o rubrică și încarci un material în ea:
--   select title, sort_order, created_at from public.content order by created_at desc limit 5;
-- =====================================================================
