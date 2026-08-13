// =====================================================================
// api/_lib/costwatch.js — supravegherea costului AI (pasul 4, ultimul,
// din GHID_LIMITE_AI.md). Două mecanisme, ambele pe cron-urile existente:
//
//   · dailyReport(supa)   — raport pe email către admin: costul ultimelor
//     24h pe endpoint/model, top utilizatori, serviri gratuite din
//     pre-generare. Apelat de scanarea ZILNICĂ din /api/ai-notify.
//   · checkThreshold(supa) — alarma 🚨: dacă costul de AZI (ora României)
//     depășește AI_ALERT_DAY_LEI, trimite email IMEDIAT. Apelat la fiecare
//     10 minute de cronul de ingest; dedup „o dată pe zi" prin tabela
//     ai_cost_alerts (inserția e atomică — două rulări simultane nu
//     trimit două emailuri).
//
// Totul e best-effort: fără migrarea supabase/ai_alerte.sql sau fără SMTP
// configurat, funcțiile se retrag tăcut (cu un avertisment în loguri) și
// nu afectează niciodată cron-urile care le găzduiesc.
// =====================================================================
const ai = require('./ai');
const mailer = require('./mailer');

const ALERT_DAY_LEI = parseFloat(process.env.AI_ALERT_DAY_LEI || '20');
const REPORT_ENABLED = process.env.AI_COST_REPORT !== '0';

const warned = new Set();
const warnOnce = (k, msg) => { if (!warned.has(k)) { warned.add(k); console.warn(msg); } };

// ─── Utilitare pure (exportate pentru teste) ─────────────────────────────────
const fmtLei = (x) => `${(Math.round((+x || 0) * 100) / 100).toFixed(2)} lei`;

// Data de AZI pe ora României, ca 'YYYY-MM-DD' (cheia de dedup a alarmei).
function bucharestDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(now);
}

// Agregă rândurile din ai_cost_breakdown: totaluri + pe endpoint + economia
// din pre-generare (servirile ':pregen' au cost 0; generarea 'ai-pregen:*'
// e costul de platformă al pre-generării).
function summarize(rows = []) {
  const s = { totalLei: 0, totalActions: 0, byEndpoint: new Map(), pregenServed: 0, platformLei: 0 };
  for (const r of rows) {
    const lei = +r.lei || 0, n = +r.actiuni || 0;
    s.totalLei += lei; s.totalActions += n;
    const e = s.byEndpoint.get(r.endpoint) || { lei: 0, actiuni: 0 };
    e.lei += lei; e.actiuni += n;
    s.byEndpoint.set(r.endpoint, e);
    if (/:pregen$/.test(r.endpoint || '')) s.pregenServed += n;
    if (/^ai-pregen:/.test(r.endpoint || '')) s.platformLei += lei;
  }
  s.byEndpoint = [...s.byEndpoint.entries()]
    .map(([endpoint, v]) => ({ endpoint, ...v }))
    .sort((a, b) => b.lei - a.lei || b.actiuni - a.actiuni);
  s.totalLei = Math.round(s.totalLei * 10000) / 10000;
  return s;
}

const reportSubject = (s) => `📊 AI pe ExamenMate — ${fmtLei(s.totalLei)} · ${s.totalActions} acțiuni (24h)`;
const alertSubject = (totalLei) => `🚨 Cost AI peste prag AZI: ${fmtLei(totalLei)} (prag ${fmtLei(ALERT_DAY_LEI)})`;

// ─── Interogări (best-effort; null = migrarea ai_alerte.sql nerulată) ────────
async function breakdown(supa, since, until = null) {
  try {
    const { data, error } = await supa.rpc('ai_cost_breakdown', { p_since: since, p_until: until });
    if (error) throw new Error(error.message);
    return data || [];
  } catch (e) {
    warnOnce('breakdown', `Alertele de cost inactive — rulează supabase/ai_alerte.sql. Detaliu: ${e.message}`);
    return null;
  }
}

// ─── Raportul zilnic (apelat din scanarea zilnică a ai-notify) ───────────────
async function dailyReport(supa) {
  if (!REPORT_ENABLED) return { skipped: 'AI_COST_REPORT=0' };
  if (!mailer.enabled()) return { skipped: 'mailer neconfigurat' };
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const rows = await breakdown(supa, since);
  if (!rows) return { skipped: 'migrarea ai_alerte.sql nerulată' };
  const s = summarize(rows);
  if (!s.totalActions) return { skipped: 'fără activitate AI în ultimele 24h' };

  let top = [];
  try {
    const { data } = await supa.rpc('ai_top_users', { p_since: since, p_limit: 5 });
    top = data || [];
  } catch { /* raportul merge și fără top */ }

  const esc = mailer.escapeHtml;
  const rowsHtml = s.byEndpoint.slice(0, 12).map((r) =>
    `<tr><td style="padding:4px 10px 4px 0">${esc(r.endpoint)}</td><td style="padding:4px 10px;text-align:right">${r.actiuni}</td><td style="padding:4px 0;text-align:right"><strong>${fmtLei(r.lei)}</strong></td></tr>`).join('');
  const topHtml = top.map((u) =>
    `<tr><td style="padding:4px 10px 4px 0">${esc(u.full_name || u.email || (u.user_id ? String(u.user_id).slice(0, 8) : '(platformă — pre-generare etc.)'))}</td><td style="padding:4px 10px;text-align:right">${u.actiuni}</td><td style="padding:4px 0;text-align:right"><strong>${fmtLei(u.lei)}</strong></td></tr>`).join('');

  const bodyHtml = `
    <p style="margin:6px 0">Ultimele 24 de ore: <strong>${fmtLei(s.totalLei)}</strong> · ${s.totalActions} acțiuni AI.</p>
    ${s.pregenServed ? `<p style="margin:6px 0">✅ ${s.pregenServed} răspunsuri servite GRATUIT din pre-generare${s.platformLei ? ` (generarea lor de fond: ${fmtLei(s.platformLei)})` : ''}.</p>` : ''}
    <p style="margin:12px 0 4px"><strong>Pe funcții</strong></p>
    <table style="border-collapse:collapse;font-size:13px">${rowsHtml}</table>
    ${topHtml ? `<p style="margin:12px 0 4px"><strong>Top utilizatori</strong></p><table style="border-collapse:collapse;font-size:13px">${topHtml}</table>` : ''}
    <p style="margin:12px 0 0;font-size:12px;color:#667">Prag de alarmă zilnic: ${fmtLei(ALERT_DAY_LEI)} (AI_ALERT_DAY_LEI). Detalii pe zile: vederea <code>ai_usage_daily</code> din Supabase.</p>`;

  try {
    await mailer.sendMail({
      to: mailer.ADMIN_EMAIL,
      subject: reportSubject(s),
      html: mailer.template({ title: 'Raport zilnic — consum AI', bodyHtml, footerNote: 'Raport automat (GHID_LIMITE_AI.md, pasul 4). Oprire: AI_COST_REPORT=0.' }),
    });
    return { sent: true, totalLei: s.totalLei, actions: s.totalActions };
  } catch (e) {
    console.error('costwatch dailyReport: email eșuat:', e.message);
    return { sent: false, error: e.message };
  }
}

// ─── Alarma de prag (apelată la 10 minute din cronul de ingest) ──────────────
async function checkThreshold(supa) {
  if (!(ALERT_DAY_LEI > 0)) return { ok: true, skipped: 'prag dezactivat' };
  if (!mailer.enabled()) return { ok: true, skipped: 'mailer neconfigurat' };
  const rows = await breakdown(supa, ai.dayStartBucharest());
  if (!rows) return { ok: true, skipped: 'migrare nerulată' };
  const s = summarize(rows);
  if (s.totalLei < ALERT_DAY_LEI) return { ok: true, totalLei: s.totalLei };

  // Dedup ATOMIC: inserăm întâi; conflict = alarma zilei a fost deja trimisă.
  const day = bucharestDay();
  const { error: insErr } = await supa.from('ai_cost_alerts')
    .insert({ day, kind: 'day_total', total_micro: Math.round(s.totalLei * 1e6) });
  if (insErr) return { ok: true, already: true, totalLei: s.totalLei };

  const esc = mailer.escapeHtml;
  const topLines = s.byEndpoint.slice(0, 6).map((r) => `<li>${esc(r.endpoint)}: <strong>${fmtLei(r.lei)}</strong> (${r.actiuni} acțiuni)</li>`).join('');
  const bodyHtml = `
    <p style="margin:6px 0">Costul AI de AZI (de la miezul nopții, ora României) a ajuns la <strong>${fmtLei(s.totalLei)}</strong> — peste pragul de ${fmtLei(ALERT_DAY_LEI)}.</p>
    <ul style="margin:8px 0;padding-left:18px;font-size:13px">${topLines}</ul>
    <p style="margin:10px 0 0;font-size:13px">De verificat: top utilizatori (<code>ai_top_users</code>), un endpoint scăpat de sub control sau un model scump configurat greșit. Oprire de urgență: <code>AI_RATE_PER_HOUR=0</code> în Vercel. Pragul se schimbă din <code>AI_ALERT_DAY_LEI</code>.</p>`;
  try {
    await mailer.sendMail({
      to: mailer.ADMIN_EMAIL,
      subject: alertSubject(s.totalLei),
      html: mailer.template({ title: 'Alarmă cost AI', bodyHtml, footerNote: 'Alarmă automată — cel mult una pe zi (GHID_LIMITE_AI.md, pasul 4).' }),
    });
    return { ok: false, alerted: true, totalLei: s.totalLei };
  } catch (e) {
    // emailul a picat → scoatem dedup-ul ca următoarea rulare să reîncerce
    await supa.from('ai_cost_alerts').delete().eq('day', day).eq('kind', 'day_total');
    console.error('costwatch checkThreshold: email eșuat:', e.message);
    return { ok: false, alerted: false, error: e.message };
  }
}

module.exports = { dailyReport, checkThreshold, summarize, fmtLei, bucharestDay, reportSubject, alertSubject, ALERT_DAY_LEI };
