-- =====================================================================
-- ExamenMate · STATISTICI DE UTILIZARE (Admin → 🤖 AI Tutor → „📊 Statistici
-- de utilizare", 30 octombrie 2026)
--
--   page_views              — vizitele din site, scrise DOAR de server
--                             (api/vizita.js, rolul de serviciu): ruta, materialul
--                             deschis (PDF / exercițiu), utilizatorul autentificat,
--                             dispozitivul și sursa (domeniul de unde a venit).
--                             Vizitatorii fără cont au un id anonim DOAR dacă au
--                             acceptat cookie-urile; adminii nu se numără. Se
--                             păstrează 180 de zile (api/account-cleanup.js).
--   admin_statistici(zile)  — tot panoul dintr-un singur apel: paginile cele mai
--                             vizitate, materialele cele mai deschise, testele
--                             cele mai folosite (progress), utilizatorii care revin
--                             cel mai des și cei cu cele mai multe accesări,
--                             funcțiile AI folosite (ai_usage), conturile noi,
--                             dispozitivele, orele, sursele, retenția, Arena.
--                             O cheamă doar serverul (api/admin-stats.js, admin).
--
-- Rulează în Supabase → SQL Editor → New Query → Run. Idempotent.
-- =====================================================================

-- ─── 1. Vizitele ─────────────────────────────────────────────────────────────
create table if not exists public.page_views (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  path        text not null,                         -- ruta, fără ?… (ex. /clase/clasa-7)
  content_id  uuid,                                  -- materialul deschis (/pdf-viewer?id=…, /exercitiu?id=…)
  user_id     uuid references auth.users(id) on delete cascade,  -- doar utilizatorii autentificați
  visitor     text,                                  -- id anonim, DOAR cu acordul pentru cookie-uri
  device      text check (device in ('telefon', 'tableta', 'calculator')),
  referrer    text                                   -- domeniul de unde a venit (prima pagină din vizită)
);
alter table public.page_views enable row level security;

grant select, insert, update, delete on public.page_views to authenticated;
grant select, insert, update, delete on public.page_views to service_role;

create index if not exists idx_page_views_time on public.page_views(created_at desc);
create index if not exists idx_page_views_user_time on public.page_views(user_id, created_at desc) where user_id is not null;
create index if not exists idx_page_views_content_time on public.page_views(content_id, created_at desc) where content_id is not null;

do $$
begin
  -- scrie și citește DOAR serverul; nicio politică pentru authenticated:
  -- nimeni nu vede, din browser, vizitele altcuiva (nici pe ale lui)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'page_views' and policyname = 'page_views_service') then
    create policy page_views_service on public.page_views for all to service_role
      using (true) with check (true);
  end if;
end $$;

-- ─── 2. Panoul de statistici, într-un singur apel ────────────────────────────
-- Fiecare parte stă în blocul ei: dacă o tabelă opțională lipsește (ex.
-- migrarea Arenei nerulată), partea aceea vine null, iar restul panoului merge.
create or replace function public.admin_statistici(p_zile integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_zile  integer := greatest(1, least(coalesce(p_zile, 30), 365));
  v_de_la timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_zile, 30), 365)));
  v_prev  timestamptz := now() - make_interval(days => 2 * greatest(1, least(coalesce(p_zile, 30), 365)));
  v_out   jsonb;
  v_part  jsonb;
  v_lipsa text[] := '{}';
begin
  v_out := jsonb_build_object('zile', v_zile, 'de_la', v_de_la, 'pana_la', now());

  -- ── Vizitele (page_views) ──
  begin
    select jsonb_build_object(
      'vizualizari', count(*),
      'utilizatori', count(distinct user_id),
      'anonimi', count(distinct visitor) filter (where user_id is null),
      'faraCont', count(*) filter (where user_id is null),
      'materialeDeschise', count(*) filter (where content_id is not null)
    ) into v_part
    from page_views where created_at >= v_de_la;
    v_out := v_out || jsonb_build_object('vizite', v_part);

    -- pe zile (ora României)
    select coalesce(jsonb_agg(jsonb_build_object('zi', zi, 'vizualizari', n, 'utilizatori', u) order by zi), '[]'::jsonb)
      into v_part
      from (select (created_at at time zone 'Europe/Bucharest')::date as zi, count(*) as n, count(distinct user_id) as u
              from page_views where created_at >= v_de_la group by 1) t;
    v_out := v_out || jsonb_build_object('peZile', v_part);

    -- paginile cele mai vizitate
    select coalesce(jsonb_agg(jsonb_build_object('path', path, 'vizualizari', n, 'persoane', u) order by n desc, path), '[]'::jsonb)
      into v_part
      from (select path, count(*) as n, count(distinct coalesce(user_id::text, visitor)) as u
              from page_views where created_at >= v_de_la
              group by path order by count(*) desc, path limit 20) t;
    v_out := v_out || jsonb_build_object('pagini', v_part);

    -- materialele cele mai deschise (PDF-uri, exerciții interactive)
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.content_id, 'titlu', c.title, 'categorie', c.category, 'tip', c.content_type,
        'deschideri', t.n, 'persoane', t.u) order by t.n desc, t.content_id), '[]'::jsonb)
      into v_part
      from (select content_id, count(*) as n, count(distinct coalesce(user_id::text, visitor)) as u
              from page_views where created_at >= v_de_la and content_id is not null
              group by content_id order by count(*) desc, content_id limit 20) t
      left join content c on c.id = t.content_id;
    v_out := v_out || jsonb_build_object('materiale', v_part);

    -- dispozitivele și orele de vârf
    select coalesce(jsonb_object_agg(coalesce(device, 'necunoscut'), n), '{}'::jsonb) into v_part
      from (select device, count(*) as n from page_views where created_at >= v_de_la group by device) t;
    v_out := v_out || jsonb_build_object('dispozitive', v_part);

    select coalesce(jsonb_agg(jsonb_build_object('ora', ora, 'vizualizari', n) order by ora), '[]'::jsonb) into v_part
      from (select extract(hour from created_at at time zone 'Europe/Bucharest')::int as ora, count(*) as n
              from page_views where created_at >= v_de_la group by 1) t;
    v_out := v_out || jsonb_build_object('ore', v_part);

    -- de unde vin (domeniul, la prima pagină din vizită)
    select coalesce(jsonb_agg(jsonb_build_object('sursa', referrer, 'vizite', n) order by n desc, referrer), '[]'::jsonb) into v_part
      from (select referrer, count(*) as n from page_views
              where created_at >= v_de_la and coalesce(referrer, '') <> ''
              group by referrer order by count(*) desc, referrer limit 10) t;
    v_out := v_out || jsonb_build_object('surse', v_part);

    -- cine revine cel mai des (zile distincte cu vizite) …
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.user_id, 'nume', p.full_name, 'email', p.email, 'rol', p.role,
        'premium', coalesce(p.subscription_status = 'active', false),
        'zile', t.zile, 'vizualizari', t.n, 'ultima', t.ultima, 'prima', t.prima) order by t.zile desc, t.n desc, t.user_id), '[]'::jsonb)
      into v_part
      from (select user_id, count(distinct (created_at at time zone 'Europe/Bucharest')::date) as zile, count(*) as n,
                   max(created_at) as ultima, min(created_at) as prima
              from page_views where created_at >= v_de_la and user_id is not null
              group by user_id order by 2 desc, 3 desc, user_id limit 25) t
      left join profiles p on p.id = t.user_id;
    v_out := v_out || jsonb_build_object('revin', v_part);

    -- … și cine are cele mai multe accesări (pagini văzute)
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.user_id, 'nume', p.full_name, 'email', p.email, 'rol', p.role,
        'premium', coalesce(p.subscription_status = 'active', false),
        'zile', t.zile, 'vizualizari', t.n, 'ultima', t.ultima) order by t.n desc, t.user_id), '[]'::jsonb)
      into v_part
      from (select user_id, count(*) as n, count(distinct (created_at at time zone 'Europe/Bucharest')::date) as zile,
                   max(created_at) as ultima
              from page_views where created_at >= v_de_la and user_id is not null
              group by user_id order by 2 desc, user_id limit 25) t
      left join profiles p on p.id = t.user_id;
    v_out := v_out || jsonb_build_object('accesari', v_part);

    -- retenția: din cei activi în perioada DINAINTE, câți au revenit acum
    select jsonb_build_object('inainte', count(*), 'auRevenit', count(*) filter (where revenit)) into v_part
      from (select a.user_id,
                   exists (select 1 from page_views b where b.user_id = a.user_id and b.created_at >= v_de_la) as revenit
              from (select distinct user_id from page_views
                      where created_at >= v_prev and created_at < v_de_la and user_id is not null) a) t;
    v_out := v_out || jsonb_build_object('retentie', v_part);
  exception when undefined_table or undefined_column then
    v_lipsa := array_append(v_lipsa, 'page_views');
  end;

  -- ── Testele cele mai folosite (rezolvate în perioadă — progress) ──
  begin
    select jsonb_build_object('rezolvari', count(*), 'elevi', count(distinct user_id)) into v_part
      from progress where completed_at >= v_de_la;
    v_out := v_out || jsonb_build_object('rezolvari', v_part);

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.content_id, 'titlu', c.title, 'categorie', c.category, 'tip', c.content_type,
        'elevi', t.elevi, 'incercari', t.incercari, 'medie', t.medie) order by t.elevi desc, t.incercari desc, t.content_id), '[]'::jsonb)
      into v_part
      from (select content_id, count(distinct user_id) as elevi, sum(coalesce(attempts, 1)) as incercari,
                   round(avg(case when max_score > 0 then score * 100.0 / max_score end))::int as medie
              from progress where completed_at >= v_de_la and content_id is not null
              group by content_id order by 2 desc, 3 desc, content_id limit 20) t
      left join content c on c.id = t.content_id;
    v_out := v_out || jsonb_build_object('teste', v_part);
  exception when undefined_table or undefined_column then
    v_lipsa := array_append(v_lipsa, 'progress');
  end;

  -- ── Funcțiile AI folosite (ai_usage; costul doar dacă există coloana) ──
  begin
    begin
      select coalesce(jsonb_agg(jsonb_build_object('functie', f, 'cereri', n, 'persoane', u, 'lei', lei) order by n desc, f), '[]'::jsonb)
        into v_part
        from (select split_part(coalesce(endpoint, '?'), ':', 1) as f, count(*) as n, count(distinct user_id) as u,
                     round(coalesce(sum(cost_micro), 0) / 1000000.0, 2) as lei
                from ai_usage where created_at >= v_de_la
                group by 1 order by 2 desc, 1 limit 15) t;
    exception when undefined_column then
      select coalesce(jsonb_agg(jsonb_build_object('functie', f, 'cereri', n, 'persoane', u, 'lei', null) order by n desc, f), '[]'::jsonb)
        into v_part
        from (select split_part(coalesce(endpoint, '?'), ':', 1) as f, count(*) as n, count(distinct user_id) as u
                from ai_usage where created_at >= v_de_la
                group by 1 order by 2 desc, 1 limit 15) t;
    end;
    v_out := v_out || jsonb_build_object('ai', v_part);
  exception when undefined_table then
    v_lipsa := array_append(v_lipsa, 'ai_usage');
  end;

  -- ── Conturile ──
  begin
    select jsonb_build_object(
      'total', count(*),
      'noi', count(*) filter (where created_at >= v_de_la),
      'premium', count(*) filter (where subscription_status = 'active'),
      'peRol', (select coalesce(jsonb_object_agg(coalesce(r.role, 'nesetat'), r.n), '{}'::jsonb)
                  from (select role, count(*) as n from profiles group by role) r),
      'noiPeRol', (select coalesce(jsonb_object_agg(coalesce(r.role, 'nesetat'), r.n), '{}'::jsonb)
                     from (select role, count(*) as n from profiles where created_at >= v_de_la group by role) r)
    ) into v_part
    from profiles;
    v_out := v_out || jsonb_build_object('conturi', v_part);
  exception when undefined_table or undefined_column then
    v_lipsa := array_append(v_lipsa, 'profiles');
  end;

  -- ── Arena (XP + misiunea zilnică) — opțional ──
  begin
    select jsonb_build_object('xp', coalesce(sum(xp), 0), 'elevi', count(distinct user_id)) into v_part
      from xp_events where created_at >= v_de_la;
    v_out := v_out || jsonb_build_object('arena', v_part);
  exception when undefined_table or undefined_column then
    v_lipsa := array_append(v_lipsa, 'xp_events');
  end;
  begin
    select jsonb_build_object('indeplinite', count(*) filter (where status = 'indeplinit'), 'elevi', count(distinct user_id)) into v_part
      from daily_exercises where day >= (v_de_la at time zone 'Europe/Bucharest')::date;
    v_out := v_out || jsonb_build_object('misiuni', v_part);
  exception when undefined_table or undefined_column then
    v_lipsa := array_append(v_lipsa, 'daily_exercises');
  end;

  return v_out || jsonb_build_object('lipsa', to_jsonb(v_lipsa));
end;
$$;

-- o apelează DOAR serverul (api/admin-stats.js, după verificarea de admin)
revoke all on function public.admin_statistici(integer) from public, anon, authenticated;
grant execute on function public.admin_statistici(integer) to service_role;

-- Verificare rapidă:
-- select public.admin_statistici(7);
-- select path, count(*) from public.page_views group by path order by 2 desc limit 20;
