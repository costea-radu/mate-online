-- =====================================================================
-- ExamenMate · TOȚI VIZITATORII, PE PAGINI (Admin → 🤖 Unelte AI → „📊 Statistici
-- de utilizare" → „🔁 Utilizatorii care revin cel mai des", 18 noiembrie 2026)
--
-- Cererea: „fă să văd mai mulți vizitatori care intră pe site, puși pe pagini (…).
-- Pune mai mulți decât 25, pune-i pe toți care au accesat în ultimele x zile."
--
--   admin_vizitatori(zile, ordine, tip, limita, de_la) — TOȚI cei care au intrat pe
--     site în ultimele `zile` zile, câte o pagină de tabel o dată (`limita` rânduri,
--     de la rândul `de_la`):
--       tip    'cont'    — utilizatorii cu cont (nume, email, rol, Premium);
--              'anonimi' — vizitatorii fără cont (id-ul anonim, DOAR cu acordul
--                          pentru cookie-uri — cei fără acord nu au id și nu apar);
--              'toti'    — amândoi;
--       ordine 'zile'     — „revin cel mai des" (zilele diferite cu vizite);
--              'accesari' — „cele mai multe accesări" (paginile văzute).
--     Pe fiecare rând: zilele active, paginile văzute, prima și ultima vizită,
--     dispozitivul folosit cel mai des, de unde a venit prima dată și paginile pe
--     care le-a văzut cel mai des (primele 6). Plus `total` — câți sunt în toată
--     perioada (pentru paginare). Adminii nu apar (vizitele lor nu se scriu).
--     O cheamă doar serverul (api/admin-stats.js → action 'vizitatori', admin).
--
-- Fără tabele noi: citește public.page_views (supabase/statistici_vizite.sql —
-- rulat deja). Rulează în Supabase → SQL Editor → New Query → Run. Idempotent.
-- Fără el, panoul arată ca până acum (primii 25) și spune că lipsește scriptul.
-- =====================================================================

-- vizitatorii fără cont, căutați după id-ul anonim (paginile lor, pe rând)
create index if not exists idx_page_views_visitor_time on public.page_views(visitor, created_at desc)
  where visitor is not null and user_id is null;

create or replace function public.admin_vizitatori(
  p_zile   integer default 30,
  p_ordine text    default 'zile',
  p_tip    text    default 'cont',
  p_limita integer default 25,
  p_de_la  integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_zile  integer := greatest(1, least(coalesce(p_zile, 30), 365));
  v_start timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_zile, 30), 365)));
  v_lim   integer := greatest(1, least(coalesce(p_limita, 25), 100));
  v_off   integer := greatest(0, coalesce(p_de_la, 0));
  v_tip   text := case when p_tip in ('cont', 'anonimi', 'toti') then p_tip else 'cont' end;
  v_ord   text := case when p_ordine = 'accesari' then 'accesari' else 'zile' end;
  v_rows  jsonb;
  v_total integer;
begin
  with v as (
    -- „cine": contul (dacă era autentificat) sau id-ul anonim
    select coalesce(user_id::text, 'v:' || visitor) as cine, user_id, visitor, created_at, path, device, referrer
      from page_views
     where created_at >= v_start
       and (user_id is not null or visitor is not null)
       and (v_tip = 'toti'
            or (v_tip = 'cont' and user_id is not null)
            or (v_tip = 'anonimi' and user_id is null))
  ), g as (
    select cine,
           max(user_id::text)::uuid as user_id,
           max(visitor) as visitor,
           count(distinct (created_at at time zone 'Europe/Bucharest')::date) as zile,
           count(*) as n,
           max(created_at) as ultima,
           min(created_at) as prima,
           mode() within group (order by device) as dispozitiv,
           (array_agg(referrer order by created_at) filter (where referrer is not null))[1] as sursa
      from v
     group by cine
  ), ord as (
    select g.*,
           row_number() over (
             order by (case when v_ord = 'zile' then g.zile else g.n end) desc,
                      (case when v_ord = 'zile' then g.n else g.zile end) desc,
                      g.ultima desc, g.cine) as rn
      from g
  ), pagina as (
    select * from ord where rn > v_off and rn <= v_off + v_lim
  ), pag as (
    -- paginile văzute cel mai des, doar pentru rândurile din pagina cerută
    select v.cine, v.path, count(*) as n
      from v join pagina p on p.cine = v.cine
     group by v.cine, v.path
  ), pag_top as (
    select cine, jsonb_agg(jsonb_build_object('path', path, 'n', n) order by n desc, path) as pagini
      from (select cine, path, n, row_number() over (partition by cine order by n desc, path) as k from pag) z
     where k <= 6
     group by cine
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'tip', case when p.user_id is not null then 'cont' else 'anonim' end,
           'id', coalesce(p.user_id::text, p.visitor),
           'nume', pr.full_name, 'email', pr.email, 'rol', pr.role,
           'premium', coalesce(pr.subscription_status = 'active', false),
           'zile', p.zile, 'vizualizari', p.n, 'prima', p.prima, 'ultima', p.ultima,
           'dispozitiv', p.dispozitiv, 'sursa', p.sursa,
           'pagini', coalesce(t.pagini, '[]'::jsonb),
           'loc', p.rn
         ) order by p.rn), '[]'::jsonb),
         (select count(*) from g)
    into v_rows, v_total
    from pagina p
    left join profiles pr on pr.id = p.user_id
    left join pag_top t on t.cine = p.cine;

  return jsonb_build_object(
    'zile', v_zile, 'tip', v_tip, 'ordine', v_ord,
    'limita', v_lim, 'de_la', v_off, 'total', coalesce(v_total, 0),
    'randuri', v_rows
  );
end;
$$;

-- o apelează DOAR serverul (api/admin-stats.js, după verificarea de admin)
revoke all on function public.admin_vizitatori(integer, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_vizitatori(integer, text, text, integer, integer) to service_role;

-- Verificare rapidă:
-- select public.admin_vizitatori(30, 'zile', 'cont', 25, 0);
-- select public.admin_vizitatori(30, 'accesari', 'anonimi', 25, 25);
