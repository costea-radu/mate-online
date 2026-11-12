// =====================================================================
// api/_lib/abonamentCopil.js — PĂRINTELE PLĂTEȘTE ABONAMENTUL COPILULUI
// (11 nov. 2026, seara)
//
// De ce: abonamentul se punea DOAR pe contul care plătea. Un părinte care se
// abona de pe contul lui de părinte plătea, iar copilul rămânea pe gratuit —
// ca să-l aboneze trebuia să intre cu contul copilului. Cumpărătorul (părintele)
// și utilizatorul (elevul) sunt însă conturi diferite.
//
// Acum, pe /preturi, părintele alege copilul (unul asociat cu contul lui —
// mentor_students, mentor_role = 'parinte'); plata se face cu e-mailul
// părintelui (factura ajunge la el), iar abonamentul se activează pe contul
// ELEVULUI: api/create-checkout.js pune în metadata `supabase_user_id` =
// elevul și `platit_de` = părintele, iar webhookul (neschimbat) activează
// contul din `supabase_user_id`.
// Părintele își gestionează / anulează abonamentul copilului din contul lui
// (api/create-portal.js, cu `pentruElev`) — doar pe cel plătit de el
// (`platit_de` din metadata abonamentului, citită din Stripe).
//
// Fără tabele și fără coloane noi. Testat în test/abonament-copil.test.js.
// =====================================================================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(status, message, code = null) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

const areAbonament = (p) => !!p && p.subscription_status === 'active';
const numeDin = (p) => String((p && (p.full_name || String(p.email || '').split('@')[0])) || 'Elev').trim() || 'Elev';

// Copiii asociați cu acest părinte, cu starea abonamentului fiecăruia.
// → [{ id, nume, premium }]
async function copiiiParintelui(supa, parinteId) {
  const { data: links, error } = await supa.from('mentor_students')
    .select('student_id').eq('mentor_id', parinteId).eq('mentor_role', 'parinte');
  if (error) throw fail(500, `Asocierile nu s-au putut citi: ${error.message}`);
  const ids = [...new Set((links || []).map((l) => l.student_id).filter(Boolean))];
  if (!ids.length) return [];
  const { data: rows, error: e2 } = await supa.from('profiles')
    .select('id, full_name, email, subscription_status').in('id', ids);
  if (e2) throw fail(500, `Conturile copiilor nu s-au putut citi: ${e2.message}`);
  return (rows || [])
    .map((p) => ({ id: p.id, nume: numeDin(p), premium: areAbonament(p) }))
    .sort((a, b) => a.nume.localeCompare(b.nume, 'ro'));
}

// Copilul pentru care plătește părintele: DOAR un elev asociat cu el ca părinte.
// → rândul din profiles (id, nume, e-mail, abonament, client Stripe)
async function copilulParintelui(supa, parinteId, elevId) {
  const id = String(elevId || '').trim();
  if (!UUID_RE.test(id) || id === parinteId) throw fail(400, 'Alege copilul pentru care faci abonamentul.', 'COPIL_NEALES');
  const { data: link, error } = await supa.from('mentor_students')
    .select('student_id').eq('mentor_id', parinteId).eq('student_id', id).eq('mentor_role', 'parinte').maybeSingle();
  if (error) throw fail(500, `Asocierea nu s-a putut verifica: ${error.message}`);
  if (!link) throw fail(403, 'Poți face abonamentul doar pentru un copil asociat cu contul tău. Trimite-i întâi linkul de asociere din „Contul meu".', 'NU_E_COPILUL_TAU');
  const { data: p, error: e2 } = await supa.from('profiles')
    .select('id, full_name, email, subscription_status, stripe_customer_id, subscription_id').eq('id', id).maybeSingle();
  if (e2) throw fail(500, `Contul copilului nu s-a putut citi: ${e2.message}`);
  if (!p) throw fail(404, 'Contul copilului nu a fost găsit.');
  return p;
}

// Părintele poate deschide portalul de plată al copilului doar dacă el a plătit
// abonamentul (metadata.platit_de, pusă la checkout). `stripe` = clientul Stripe.
async function clientulPlatitDeParinte(supa, stripe, parinteId, elevId) {
  const copil = await copilulParintelui(supa, parinteId, elevId);
  if (!copil.stripe_customer_id || !copil.subscription_id) throw fail(400, 'Copilul nu are un abonament activ făcut de pe contul tău.', 'FARA_ABONAMENT');
  let sub = null;
  try { sub = await stripe.subscriptions.retrieve(copil.subscription_id); } catch { sub = null; }
  if (!sub || !sub.metadata || sub.metadata.platit_de !== parinteId) {
    throw fail(403, 'Abonamentul copilului nu a fost făcut de pe contul tău — îl gestionează cine l-a plătit (din contul copilului).', 'NU_L_AI_PLATIT_TU');
  }
  return copil.stripe_customer_id;
}

module.exports = { UUID_RE, areAbonament, numeDin, copiiiParintelui, copilulParintelui, clientulPlatitDeParinte };
