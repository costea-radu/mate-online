// =====================================================================
// api/review-invite.js — emailul automat „Ce părere ai despre ExamenMate?"
//
// CRON (vercel.json, zilnic):  GET /api/review-invite?action=run
//   (autorizat prin Authorization: Bearer CRON_SECRET sau ?secret=AI_CRON_SECRET)
// ADMIN (Admin → ⭐ Recenzii → „Invitații la recenzie"):
//   POST { action:'preview' }  → { eligible, sample[], sentTotal, emailEnabled } — NU trimite
//   POST { action:'run' }      → trimite un lot (max REVIEW_INVITE_BATCH, implicit 80)
//
// Cine primește (funcția SQL review_invite_candidates — supabase/reviews_v2.sql):
//   · are email, nu a fost invitat niciodată (profiles.review_invite_sent_at IS NULL),
//   · nu s-a dezabonat de la emailuri (profiles.newsletter_opt_in),
//   · nu a lăsat deja o recenzie despre site,
//   · a rezolvat ≥ 3 teste interactive SAU e abonat Premium de ≥ 7 zile.
// Fiecare cont primește invitația O SINGURĂ DATĂ; linkul de dezabonare e cel
// din newsletter (newsletter_opt_in = false oprește și invitațiile viitoare).
// Emailul pleacă prin api/_lib/mailer.js (Gmail SMTP sau Resend); dacă emailul
// nu e configurat, ruta răspunde { skipped } fără să marcheze pe nimeni.
// =====================================================================
const ai = require('./_lib/ai');
const mailer = require('./_lib/mailer');

const SITE_URL = (process.env.SITE_URL || 'https://examenmate.com').replace(/\/$/, '');
const BATCH = Math.max(1, Math.min(300, parseInt(process.env.REVIEW_INVITE_BATCH || '80', 10)));

function unsubUrl(userId) {
  const token = ai.signToken({ t: 'unsub', uid: userId });
  return `${SITE_URL}/api/newsletter?action=unsubscribe&token=${encodeURIComponent(token)}`;
}

const firstName = (full) => String(full || '').trim().split(/\s+/)[0] || '';

// De ce îi scriem — fraza personalizată din email.
function reasonLine(c) {
  const tests = Number(c.tests) || 0;
  const days = c.premium_days == null ? null : Number(c.premium_days);
  if (tests >= 3) {
    return `Ai rezolvat deja <strong>${tests} ${tests === 1 ? 'test' : 'teste'}</strong> pe ExamenMate`
      + (days != null && days >= 7 ? ` și folosești Premium de ${days >= 14 ? 'câteva săptămâni' : 'o săptămână'}` : '') + '.';
  }
  if (days != null && days >= 7) {
    return `Folosești ExamenMate Premium de ${days >= 14 ? 'câteva săptămâni' : 'o săptămână'}.`;
  }
  return 'Folosești ExamenMate de ceva vreme.';
}

function roleLine(role) {
  if (role === 'profesor') return 'Părerea unui profesor contează dublu pentru noi — și pentru colegii care caută materiale bune.';
  if (role === 'parinte') return 'Părerea unui părinte îi ajută pe alți părinți să decidă dacă ExamenMate e potrivit pentru copilul lor.';
  return 'Părerea ta îi ajută pe alți elevi să aleagă cu încredere — și pe noi să facem platforma mai bună.';
}

function buildEmail(c) {
  const name = firstName(c.full_name);
  const link = `${SITE_URL}/recenzii#formular`;
  const html = mailer.template({
    title: 'Ce părere ai despre ExamenMate?',
    preheader: 'O părere sinceră, într-un minut — ne ajută enorm.',
    bodyHtml: `
      <p>Salut${name ? ', ' + mailer.escapeHtml(name) : ''}!</p>
      <p>${reasonLine(c)} Ne-ar ajuta enorm o părere sinceră: ce ți-a plăcut, ce te-a ajutat, ce ai îmbunătăți. Durează un minut.</p>
      <p>${mailer.escapeHtml(roleLine(c.role))}</p>
      <p style="margin:22px 0"><a href="${link}" style="display:inline-block;background:#e8b931;color:#17233f;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700">⭐ Lasă o recenzie</a></p>
      <p style="font-size:13.5px;color:#5a6379">Recenzia apare pe site după o scurtă verificare. Notele ★ pentru fiecare test le poți lăsa direct după ce îl rezolvi — ne spun repede dacă un test are o problemă.</p>`,
    footerNote: 'Primești acest email o singură dată, fiindcă ai un cont pe examenmate.com.',
    unsubscribeUrl: unsubUrl(c.id),
  });
  const text = `Salut${name ? ', ' + name : ''}!\n\n${reasonLine(c).replace(/<[^>]+>/g, '')} Ne-ar ajuta enorm o părere sinceră — durează un minut: ${link}\n\nRecenzia apare pe site după o scurtă verificare. Primești acest email o singură dată.`;
  return { html, text };
}

async function candidates(supa, limit) {
  const { data, error } = await supa.rpc('review_invite_candidates', { p_limit: limit });
  if (error) {
    const e = new Error(`Funcția review_invite_candidates lipsește sau a eșuat (ai rulat supabase/reviews_v2.sql?): ${error.message}`);
    e.status = 500; throw e;
  }
  return data || [];
}

async function sentTotal(supa) {
  try {
    const { count } = await supa.from('profiles').select('id', { count: 'exact', head: true }).not('review_invite_sent_at', 'is', null);
    return count || 0;
  } catch { return 0; }
}

async function preview(supa) {
  const list = await candidates(supa, 500);
  return {
    eligible: list.length,
    sample: list.slice(0, 10).map((c) => ({ id: c.id, email: c.email, tests: c.tests, premium_days: c.premium_days, role: c.role })),
    sentTotal: await sentTotal(supa),
    emailEnabled: mailer.enabled(),
    batch: BATCH,
  };
}

async function run(supa) {
  if (!mailer.enabled()) {
    return { sent: 0, failed: 0, eligible: 0, skipped: 'email neconfigurat (EMAIL_USER + EMAIL_APP_PASSWORD sau RESEND_API_KEY + EMAIL_FROM)' };
  }
  const list = await candidates(supa, BATCH);
  let sent = 0, failed = 0;
  for (const c of list) {
    const { html, text } = buildEmail(c);
    const r = await mailer.sendMail({ to: c.email, subject: 'Ce părere ai despre ExamenMate? ⭐', html, text });
    if (r.ok) {
      sent++;
      // marcăm DOAR după trimitere reușită — la eșec reîncercăm a doua zi
      await supa.from('profiles').update({ review_invite_sent_at: new Date().toISOString() }).eq('id', c.id);
    } else if (r.skipped) {
      break; // email dezactivat global
    } else {
      failed++;
      console.warn('review-invite: eșec către', c.email, r.error);
    }
    await mailer.sleep(200); // ~5/sec — sub limitele SMTP Gmail
  }
  return { sent, failed, eligible: list.length, batch: BATCH };
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const supa = ai.admin();
  try {
    if (req.method === 'GET') {
      if (req.query.action === 'run' && ai.isCronRequest(req)) return res.status(200).json(await run(supa));
      return res.status(403).json({ error: 'Neautorizat' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const userId = await ai.authUser(req, supa);
    await ai.requireAdmin(supa, userId);
    const { action = 'preview' } = req.body || {};
    if (action === 'preview') return res.status(200).json(await preview(supa));
    if (action === 'run') return res.status(200).json(await run(supa));
    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('review-invite error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};

// pentru teste (fără rețea)
module.exports.reasonLine = reasonLine;
module.exports.buildEmail = buildEmail;
