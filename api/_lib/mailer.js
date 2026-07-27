// =====================================================================
// api/_lib/mailer.js — trimitere de EMAIL pentru toată platforma.
//
// Default: Gmail SMTP (adresa admin.examenmate@gmail.com + App Password).
//   Env necesare (Vercel → Settings → Environment Variables):
//     EMAIL_USER          = admin.examenmate@gmail.com
//     EMAIL_APP_PASSWORD  = parola de aplicație Google (16 caractere)
//   Opționale:
//     EMAIL_FROM_NAME     = ExamenMate        (numele expeditorului)
//     ADMIN_EMAIL         = admin.examenmate@gmail.com (destinatar alerte)
//
// Upgrade ulterior (fără schimbări de cod): dacă setezi RESEND_API_KEY +
// EMAIL_FROM (adresă pe domeniu verificat în Resend), emailurile pleacă
// prin API-ul Resend în loc de SMTP Gmail.
//
// Limită Gmail: ~500 emailuri/zi pe cont normal — suficient pentru început;
// pentru volume mari treci pe Resend/SES.
// =====================================================================

const FROM_NAME = process.env.EMAIL_FROM_NAME || 'ExamenMate';
const GMAIL_USER = process.env.EMAIL_USER || '';
const GMAIL_PASS = String(process.env.EMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM = process.env.EMAIL_FROM || '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || GMAIL_USER || 'admin.examenmate@gmail.com';

const useResend = !!(RESEND_KEY && RESEND_FROM);

// Emailul e configurat? (rutele verifică asta și sar peste trimitere elegant)
function enabled() {
  return useResend || !!(GMAIL_USER && GMAIL_PASS);
}

// Transporter Nodemailer (lazy + tolerant: dacă pachetul lipsește, nu crăpăm
// toată ruta — doar raportăm că emailul e dezactivat).
let _tx = null;
let _txErr = null;
function transporter() {
  if (_tx || _txErr) return _tx;
  try {
    const nodemailer = require('nodemailer');
    _tx = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // TLS direct — cel mai fiabil pe serverless (587 e mai lent)
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });
  } catch (e) {
    _txErr = e;
    console.error('mailer: nodemailer lipsește — rulează `npm install nodemailer`:', e.message);
  }
  return _tx;
}

// ─── Trimitere unică ─────────────────────────────────────────────────────────
// sendMail({ to, subject, html, text?, replyTo?, bcc? }) → { ok, id?, error?, skipped? }
// NU aruncă niciodată — cine cheamă decide dacă eșecul contează.
async function sendMail({ to, subject, html, text = null, replyTo = null, bcc = null }) {
  if (!to || !subject) return { ok: false, error: 'to și subject sunt obligatorii' };
  if (!enabled()) return { ok: false, skipped: 'email neconfigurat (EMAIL_USER + EMAIL_APP_PASSWORD sau RESEND_API_KEY + EMAIL_FROM)' };

  try {
    if (useResend) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `${FROM_NAME} <${RESEND_FROM}>`,
          to: Array.isArray(to) ? to : [to],
          subject,
          html,
          ...(text ? { text } : {}),
          ...(replyTo ? { reply_to: replyTo } : {}),
          ...(bcc ? { bcc: Array.isArray(bcc) ? bcc : [bcc] } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.message || `Resend HTTP ${res.status}` };
      return { ok: true, id: data?.id || null, provider: 'resend' };
    }

    const tx = transporter();
    if (!tx) return { ok: false, skipped: 'nodemailer neinstalat' };
    const info = await tx.sendMail({
      from: `"${FROM_NAME}" <${GMAIL_USER}>`,
      to,
      subject,
      html,
      ...(text ? { text } : {}),
      ...(replyTo ? { replyTo } : {}),
      ...(bcc ? { bcc } : {}),
    });
    return { ok: true, id: info?.messageId || null, provider: 'gmail' };
  } catch (e) {
    console.error('mailer: trimitere eșuată:', e.message);
    return { ok: false, error: e.message };
  }
}

// ─── Utilitare ───────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Convertor minimal Markdown → HTML pentru emailuri (titluri, bold, linkuri,
// liste, paragrafe). Suficient pentru textele agentului SEO; NU e un parser
// complet — orice HTML din sursă e escapat mai întâi (siguranță).
function mdToHtml(md) {
  const esc = escapeHtml(md);
  const lines = esc.split(/\r?\n/);
  const out = [];
  let inList = null; // 'ul' | 'ol' | null
  const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = null; } };
  const inline = (s) => s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" style="color:#1d4ed8">$1</a>');

  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) { closeList(); continue; }
    let m;
    if ((m = t.match(/^(#{1,3})\s+(.*)$/))) {
      closeList();
      const lvl = m[1].length;
      const size = lvl === 1 ? 22 : lvl === 2 ? 18 : 16;
      out.push(`<h${lvl + 1} style="margin:18px 0 8px;font-size:${size}px;color:#17233f">${inline(m[2])}</h${lvl + 1}>`);
    } else if ((m = t.match(/^[-*•]\s+(.*)$/))) {
      if (inList !== 'ul') { closeList(); out.push('<ul style="margin:6px 0 12px;padding-left:22px">'); inList = 'ul'; }
      out.push(`<li style="margin:3px 0">${inline(m[1])}</li>`);
    } else if ((m = t.match(/^\d+[.)]\s+(.*)$/))) {
      if (inList !== 'ol') { closeList(); out.push('<ol style="margin:6px 0 12px;padding-left:22px">'); inList = 'ol'; }
      out.push(`<li style="margin:3px 0">${inline(m[1])}</li>`);
    } else {
      closeList();
      out.push(`<p style="margin:8px 0;line-height:1.6">${inline(t)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

// Șablon HTML brand ExamenMate (albastru-navy + auriu, ca site-ul).
// template({ title, bodyHtml, preheader?, footerNote?, unsubscribeUrl? })
function template({ title, bodyHtml, preheader = '', footerNote = '', unsubscribeUrl = null }) {
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f4f8;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#26314d">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f8;padding:24px 12px">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">
    <tr><td style="background:#17233f;border-radius:14px 14px 0 0;padding:20px 28px">
      <span style="font-size:20px;font-weight:800;color:#ffffff;letter-spacing:.3px">Examen<span style="color:#e8b931">Mate</span></span>
    </td></tr>
    <tr><td style="background:#ffffff;padding:28px;border-radius:0 0 14px 14px">
      <h1 style="margin:0 0 14px;font-size:20px;color:#17233f">${escapeHtml(title)}</h1>
      <div style="font-size:15px;line-height:1.6">${bodyHtml}</div>
      ${footerNote ? `<p style="margin:18px 0 0;font-size:12.5px;color:#8b93a7">${footerNote}</p>` : ''}
    </td></tr>
    <tr><td style="padding:16px 10px;text-align:center;font-size:12px;color:#8b93a7">
      © ${year} ExamenMate · <a href="https://examenmate.com" style="color:#8b93a7">examenmate.com</a>
      ${unsubscribeUrl ? ` · <a href="${unsubscribeUrl}" style="color:#8b93a7">Dezabonare</a>` : ''}
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

module.exports = { enabled, sendMail, template, mdToHtml, escapeHtml, sleep, ADMIN_EMAIL, FROM_NAME };
