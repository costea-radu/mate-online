// =====================================================================
// api/_lib/liveAccess.js — dreptul la o ședință 1-la-1 (citiri din baza de date)
//
// O ședință 1-la-1 = 60 de minute cu profesorul virtual, prelungite cât elevul
// lucrează. Se ține în două locuri, cu ACELEAȘI reguli și același contor:
//   · Meditații live → „1-la-1, oricând" (un subiect de examen ales);
//   · „Planul meu" → 🎓 Pregătire de examen (exercițiu cu exercițiu).
// Abonații au L.PRIVATE_INCLUDED() pe lună (implicit 8) — COMUNE pentru ambele;
// apoi (sau fără abonament) un bilet de L.PRICE_PRIVATE_LEI() lei (implicit 20),
// folosibil în oricare dintre ele. Regula pură: L.privateAccess.
//
// Toate ședințele stau în live_sessions (kind 'privat'); cele de pregătire au
// subject_id null și state.prep = examenul ('evaluare-nationala', 'bac-mate-info'…).
// Folosit de api/live.js și de api/ai-meditatii.js (rezumatul din „Planul meu").
// =====================================================================
const L = require('./live');

// Ședințele 1-la-1 INCLUSE pornite luna aceasta (live + pregătire). Se numără doar
// cele pornite (ceasul a început): o lecție care nu a pornit nu consumă nimic.
async function includedUsedThisMonth(supa, userId) {
  const { count } = await supa.from('live_sessions').select('*', { count: 'exact', head: true })
    .eq('owner_id', userId).eq('kind', 'privat').eq('access', 'inclus').gte('created_at', L.monthStart())
    .not('state->>startedAt', 'is', null);
  return count || 0;
}

// Biletele 1-la-1 plătite și nefolosite
async function unusedPrivateTickets(supa, userId) {
  const { count } = await supa.from('live_tickets').select('*', { count: 'exact', head: true })
    .eq('user_id', userId).eq('kind', 'privat').eq('status', 'platit').is('session_id', null);
  return count || 0;
}

async function privateAccessFor(supa, profile) {
  if (!profile) return { ok: false, via: null, price: L.PRICE_PRIVATE_LEI(), included: 0, includedLeft: 0, unusedTickets: 0 };
  const [used, unused] = await Promise.all([includedUsedThisMonth(supa, profile.id), unusedPrivateTickets(supa, profile.id)]);
  return { ...L.privateAccess({ profile, includedUsed: used, unusedTickets: unused }), unusedTickets: unused, includedUsed: used };
}

// ─── Pregătirea de examen: ședințele ei ──────────────────────────────────────
const PREP_GRACE_MS = 3 * 60000;   // ca la L.extensionPlan: întoarcerea în 3 minute după sfârșit o mai prinde

// Ultima ședință de pregătire neîncheiată, cu sfârșitul cel mult de acum 3 minute
// (ceasul și prelungirea le hotărăște apoi L.extensionPlan) — sau null
async function recentPrepSession(supa, userId, now = new Date()) {
  const { data } = await supa.from('live_sessions').select('*')
    .eq('owner_id', userId).eq('kind', 'privat').not('state->>prep', 'is', null)
    .in('status', ['programata', 'activa']).gt('ends_at', new Date(now.getTime() - PREP_GRACE_MS).toISOString())
    .order('created_at', { ascending: false }).limit(1);
  return (data && data[0]) || null;
}

// Examenul ultimei ședințe de pregătire (elevii fără examen ales în „Planul meu")
async function lastPrepTarget(supa, userId) {
  const { data } = await supa.from('live_sessions').select('prep:state->>prep')
    .eq('owner_id', userId).eq('kind', 'privat').not('state->>prep', 'is', null)
    .order('created_at', { ascending: false }).limit(1);
  return (data && data[0] && data[0].prep) || null;
}

// Ce vede elevul despre ședința lui de pregătire (fără id: nu e o sală live)
function prepSessionView(s) {
  if (!s) return null;
  const base = Date.parse(L.baseEndOf(s)) || Date.parse(s.ends_at);
  return {
    via: s.access, startedAt: s.state?.startedAt || s.starts_at, endsAt: s.ends_at,
    extended: Date.parse(s.ends_at) > base, cap: new Date(base + L.EXT_MAX_MIN() * 60000).toISOString(),
  };
}

module.exports = { includedUsedThisMonth, unusedPrivateTickets, privateAccessFor, recentPrepSession, lastPrepTarget, prepSessionView };
