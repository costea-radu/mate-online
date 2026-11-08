// =====================================================================
// api/_lib/arenaFeed.js — FLUXUL DE ACTIVITATE AL ARENEI (8 nov. 2026)
//
// Cererea: „în arena să apară ca pe Facebook cine a rezolvat, a promovat, ce
// subiect, ce provocări noi apar, etc., notele să nu apară dacă sunt probleme cu
// politica de confidențialitate".
//
// Ce intră (tabela arena_feed — supabase/pregatire_zilnica.sql):
//   test       — „Ana P. a lucrat la Subiectul I · Evaluarea Națională" (testul zilei)
//   serie      — „Ana P. are o serie de 7 zile de pregătire"
//   promovare  — „Ana P. a promovat în 🥈 Liga Argint" (cronul ligii)
//   insigna    — „Ana P. a primit insigna «O săptămână de pregătire»"
//   nivel      — „Ana P. a ajuns la nivelul 5 · Constructor"
//   duel       — „Ana P. a câștigat un duel"
//   turneu     — anunț: „Turneu nou: Turneul săptămânii…"; sau „Ana P. a câștigat …"
//   provocare  — anunț: „⚡ Provocarea bonus de azi: Adună 100 XP astăzi"
//
// Confidențialitatea (elevii sunt de multe ori minori):
//   · NICIODATĂ note, punctaje, procente sau XP — doar CE a făcut elevul;
//   · numele = prenumele și inițiala („Ana P."), ca în clasamentul ligii;
//   · cine nu vrea să apară bifează „Nu mă arăta în activitatea Arenei"
//     (user_stats.arena_public = false) — rândurile lui nu mai ajung la nimeni
//     (el își vede în continuare activitatea, ca „Tu");
//   · fluxul se citește doar prin API, de utilizatorii autentificați; tabela nu
//     are politici pentru browser.
// Toate funcțiile prind erorile: fluxul nu are voie să strice nimic altceva.
// =====================================================================

const KINDS = ['test', 'serie', 'promovare', 'insigna', 'nivel', 'duel', 'turneu', 'provocare'];
const MAX_PAGINA = 30;

// câmpurile care pot ajunge în flux — orice altceva (nota, punctajul…) se aruncă
const CAMPURI = {
  examen: 'string', subiecte: 'array', complet: 'boolean', titlu: 'string', itemi: 'number',
  serie: 'number', liga: 'string', ligaIcon: 'string', insigna: 'string', insignaIcon: 'string',
  nivel: 'number', nivelNume: 'string', loc: 'number', exercitii: 'number', zile: 'number',
  eticheta: 'string', link: 'string',
};

const isMissing = (err) => !!err && /does not exist|schema cache|could not find|relation .* does not exist/i.test(String(err.message || err));

// „Ana Maria Popescu" → „Ana P." (ca în clasamentul ligii)
function shortName(full, fallback = 'Elev') {
  const s = String(full || '').trim().replace(/\s+/g, ' ');
  if (!s) return fallback;
  const p = s.split(' ');
  if (p.length === 1) return p[0];
  return `${p[0]} ${p[p.length - 1][0].toUpperCase()}.`;
}

// doar câmpurile permise, cu tipul așteptat (fără note: nu există câmp pentru ele)
function curata(payload) {
  const out = {};
  for (const [k, tip] of Object.entries(CAMPURI)) {
    const v = payload ? payload[k] : undefined;
    if (v === undefined || v === null) continue;
    if (tip === 'string' && typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 140);
    else if (tip === 'number' && Number.isFinite(Number(v))) out[k] = Math.round(Number(v));
    else if (tip === 'boolean') out[k] = !!v;
    else if (tip === 'array' && Array.isArray(v)) out[k] = v.map((x) => String(x).slice(0, 40)).slice(0, 6);
  }
  if (out.link && !/^\/[\w\-/?=&.%]*$/.test(out.link)) delete out.link;
  return out;
}

const listaRo = (xs) => (xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} și ${xs[xs.length - 1]}`);
const zileTxt = (n) => `${n} ${n === 1 ? 'zi' : n < 20 ? 'zile' : 'de zile'}`;

// Textul unui rând (fără nume — numele îl pune interfața în față, îngroșat)
function descriere(kind, p = {}) {
  switch (kind) {
    case 'test': {
      const ex = p.examen ? ` · ${p.examen}` : '';
      if (p.complet) return { icon: '📝', text: `a rezolvat un test complet${ex}` };
      const sub = Array.isArray(p.subiecte) && p.subiecte.length ? listaRo(p.subiecte) : null;
      return { icon: '📝', text: sub ? `a lucrat azi la ${sub}${ex}` : `a lucrat azi la testul zilei${ex}` };
    }
    case 'serie': return { icon: '🔥', text: `are o serie de ${zileTxt(p.serie || 0)} de pregătire pentru examen` };
    case 'promovare': return { icon: p.ligaIcon || '🏅', text: `a promovat în Liga ${p.liga || ''}`.trim() };
    case 'insigna': return { icon: p.insignaIcon || '🏅', text: `a primit insigna „${p.insigna || ''}"` };
    case 'nivel': return { icon: '⭐', text: `a ajuns la nivelul ${p.nivel || '?'}${p.nivelNume ? ` · ${p.nivelNume}` : ''}` };
    case 'duel': return { icon: '⚔️', text: 'a câștigat un duel' };
    case 'turneu':
      if (p.loc) return { icon: '🏆', text: p.loc === 1 ? `a câștigat „${p.titlu || 'turneul'}"` : `a terminat pe locul ${p.loc} în „${p.titlu || 'turneu'}"` };
      return { icon: '🏆', text: `Turneu nou: ${p.titlu || 'Turneul săptămânii'}${p.exercitii ? ` — ${p.exercitii} exerciții` : ''}${p.zile ? `, ${zileTxt(p.zile)}` : ''}. Înscrie-te din Arenă!` };
    case 'provocare': return { icon: '⚡', text: `Provocarea bonus de azi: ${p.eticheta || 'rezolvă exerciții și adună XP'}` };
    default: return { icon: '•', text: '' };
  }
}

// Pune un rând în flux. dedupeKey: o singură dată (ex. „test:<user>:<zi>");
// cu `actualizeaza`, un rând existent cu aceeași cheie primește noile detalii.
async function post(supa, { userId = null, kind, payload = {}, dedupeKey = null, actualizeaza = false } = {}) {
  try {
    if (!supa || !KINDS.includes(kind)) return false;
    const row = { user_id: userId || null, kind, payload: curata(payload), dedupe_key: dedupeKey ? String(dedupeKey).slice(0, 200) : null };
    const { error } = await supa.from('arena_feed').insert(row);
    if (!error) return true;
    if (dedupeKey && actualizeaza && /duplicate|unique/i.test(error.message || '')) {
      const { error: e2 } = await supa.from('arena_feed').update({ payload: row.payload }).eq('dedupe_key', row.dedupe_key);
      return !e2;
    }
    return false;
  } catch {
    return false;
  }
}

// Fluxul pentru un elev autentificat. `inainte` = id-ul ultimului rând văzut (paginare).
async function list(supa, { viewerId = null, limit = 20, inainte = null } = {}) {
  const n = Math.max(1, Math.min(MAX_PAGINA, Number(limit) || 20));
  try {
    let q = supa.from('arena_feed').select('id, user_id, kind, payload, created_at')
      .order('id', { ascending: false }).limit(n * 2 + 10);
    if (inainte) q = q.lt('id', Number(inainte));
    const { data, error } = await q;
    if (error) return { ok: false, setup: !isMissing(error), items: [], mesaj: error.message };
    const rows = data || [];
    const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
    let nume = {}, ascunsi = new Set();
    if (ids.length) {
      const [{ data: profs }, { data: st }] = await Promise.all([
        supa.from('profiles').select('id, full_name').in('id', ids),
        supa.from('user_stats').select('user_id, arena_public').in('user_id', ids),
      ]);
      nume = Object.fromEntries((profs || []).map((p) => [p.id, p.full_name]));
      ascunsi = new Set((st || []).filter((s) => s.arena_public === false).map((s) => s.user_id));
    }
    const vizibile = rows.filter((r) => !r.user_id || r.user_id === viewerId || !ascunsi.has(r.user_id));
    const items = vizibile.slice(0, n).map((r) => {
      const d = descriere(r.kind, r.payload || {});
      const eu = !!viewerId && r.user_id === viewerId;
      return {
        id: r.id, kind: r.kind, icon: d.icon, text: d.text,
        nume: r.user_id ? (eu ? 'Tu' : shortName(nume[r.user_id])) : null,
        eu, anunt: !r.user_id, cand: r.created_at,
        link: (r.payload && r.payload.link) || null,
      };
    });
    const ultim = rows.length ? rows[rows.length - 1].id : null;
    return { ok: true, setup: true, items, maiMulte: rows.length >= n * 2 + 10 || vizibile.length > n, inainte: items.length ? items[items.length - 1].id : ultim };
  } catch (e) {
    return { ok: false, setup: false, items: [], mesaj: e?.message || 'eroare' };
  }
}

// Apar sau nu în flux (user_stats.arena_public)
async function stare(supa, userId) {
  try {
    const { data, error } = await supa.from('user_stats').select('arena_public').eq('user_id', userId).maybeSingle();
    if (error) return { setup: !isMissing(error), public: true };
    return { setup: true, public: !data || data.arena_public !== false };
  } catch { return { setup: false, public: true }; }
}

async function setPublic(supa, userId, on) {
  const { error } = await supa.from('user_stats')
    .upsert({ user_id: userId, arena_public: !!on, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) {
    const e = new Error(isMissing(error) ? 'Fluxul Arenei nu e încă activ (Admin: rulează supabase/pregatire_zilnica.sql).' : `Nu am putut salva alegerea (${error.message}).`);
    e.status = isMissing(error) ? 503 : 500;
    throw e;
  }
  return { ok: true, public: !!on };
}

module.exports = { KINDS, CAMPURI, shortName, curata, descriere, post, list, stare, setPublic };
