// =====================================================================
// api/contact.js — formularul public de contact (fără autentificare).
// Mesajul se salvează în tabelul contact_messages (dovadă + anti-spam)
// și pleacă pe email către ADMIN_EMAIL (admin.examenmate@gmail.com),
// cu Reply-To către expeditor → răspunzi direct din Gmail cu „Reply”.
// Expeditorul primește și o confirmare automată.
//
// Anti-spam: honeypot (câmpul ascuns „website”), validări de lungime,
// max 5 mesaje/oră de la același IP (numărat în contact_messages).
// Necesită: supabase/email_system.sql rulat + EMAIL_USER/EMAIL_APP_PASSWORD.
// =====================================================================
const crypto = require('crypto');
const { applyCors, admin } = require('./_lib/http');
const mailer = require('./_lib/mailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { name = '', email = '', subject = '', message = '', website = '' } = req.body || {};

    // Honeypot: roboții completează câmpul invizibil → răspundem „ok” fără să facem nimic.
    if (String(website).trim()) return res.status(200).json({ ok: true });

    const nm = String(name).trim();
    const em = String(email).trim().toLowerCase();
    const sj = String(subject).trim().slice(0, 120);
    const msg = String(message).trim();

    if (nm.length < 2 || nm.length > 80) return res.status(400).json({ error: 'Numele trebuie să aibă între 2 și 80 de caractere.' });
    if (!EMAIL_RE.test(em)) return res.status(400).json({ error: 'Adresa de email nu pare validă.' });
    if (msg.length < 10 || msg.length > 5000) return res.status(400).json({ error: 'Mesajul trebuie să aibă între 10 și 5000 de caractere.' });

    const supa = admin();
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
    const ipHash = crypto.createHash('sha256').update(ip + '|examenmate-contact').digest('hex');

    // Rate limit: max 5 mesaje/oră per IP (dacă tabelul lipsește, nu blocăm).
    try {
      const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
      const { count } = await supa.from('contact_messages')
        .select('*', { count: 'exact', head: true })
        .eq('ip_hash', ipHash).gte('created_at', hourAgo);
      if ((count || 0) >= 5) return res.status(429).json({ error: 'Ai trimis prea multe mesaje. Încearcă din nou peste o oră.' });
    } catch { /* tabel lipsă → continuăm */ }

    // Salvăm mesajul (best-effort — emailul rămâne canalul principal).
    try {
      await supa.from('contact_messages').insert({
        name: nm, email: em, subject: sj || null, message: msg,
        ip_hash: ipHash, user_agent: String(req.headers['user-agent'] || '').slice(0, 300),
      });
    } catch (e) { console.error('contact: salvare eșuată (rulează supabase/email_system.sql):', e.message); }

    if (!mailer.enabled()) {
      // Emailul nu e configurat încă — mesajul e măcar salvat în DB.
      return res.status(200).json({ ok: true, note: 'Mesaj înregistrat.' });
    }

    // 1) Către admin — cu Reply-To expeditor, ca să răspunzi direct din Gmail.
    const adminHtml = mailer.template({
      title: sj ? `Mesaj nou: ${sj}` : 'Mesaj nou de pe pagina de contact',
      preheader: msg.slice(0, 90),
      bodyHtml: `
        <p style="margin:6px 0"><strong>De la:</strong> ${mailer.escapeHtml(nm)} &lt;${mailer.escapeHtml(em)}&gt;</p>
        ${sj ? `<p style="margin:6px 0"><strong>Subiect:</strong> ${mailer.escapeHtml(sj)}</p>` : ''}
        <div style="margin-top:12px;padding:14px 16px;background:#f7f9fc;border-radius:10px;white-space:pre-wrap">${mailer.escapeHtml(msg)}</div>`,
      footerNote: 'Apasă „Reply” în Gmail ca să răspunzi direct expeditorului.',
    });
    const sent = await mailer.sendMail({
      to: mailer.ADMIN_EMAIL,
      subject: `[Contact ExamenMate] ${sj || nm}`,
      html: adminHtml,
      text: `De la: ${nm} <${em}>\n\n${msg}`,
      replyTo: `${nm} <${em}>`,
    });
    if (!sent.ok && !sent.skipped) console.error('contact: email admin eșuat:', sent.error);

    // 2) Confirmare către expeditor (best-effort). Adresa NU e verificată, deci
    // NU mai ecouăm conținutul mesajului înapoi (altfel formularul putea fi
    // folosit ca vector de backscatter/hărțuire către o victimă cu text arbitrar).
    // Păstrăm doar confirmarea generică de primire.
    const confHtml = mailer.template({
      title: 'Am primit mesajul tău 👍',
      preheader: 'Îți răspundem în maxim 24 de ore.',
      bodyHtml: `
        <p>Salut, ${mailer.escapeHtml(nm.split(' ')[0])}!</p>
        <p>Mesajul tău a ajuns la echipa ExamenMate. Îți răspundem în <strong>maxim 24 de ore</strong> pe această adresă.</p>`,
      footerNote: 'Ai primit acest email fiindcă ai completat formularul de contact pe examenmate.com.',
    });
    await mailer.sendMail({ to: em, subject: 'Am primit mesajul tău — ExamenMate', html: confHtml });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('contact error:', err);
    return res.status(500).json({ error: 'Nu am putut trimite mesajul. Scrie-ne direct la admin.examenmate@gmail.com.' });
  }
};
