// =====================================================================
// api/newsletter.js — NEWSLETTERE scrise de agentul SEO, trimise de admin
// de pe adresa platformei (admin.examenmate@gmail.com prin SMTP Gmail).
//
// POST (admin, autentificat):
//   { action:'create', subject, markdown }   → { campaignId, recipients, adminEmail }
//   { action:'test',   campaignId }          → trimite DOAR către ADMIN_EMAIL
//   { action:'send',   campaignId }          → trimite un LOT (max NEWSLETTER_BATCH,
//                                              implicit 120) și răspunde { sent, remaining };
//                                              se apelează repetat până remaining=0.
//   { action:'list' }                        → ultimele campanii
//
// GET ?action=unsubscribe&token=...          → dezabonare cu un click (link din email)
//
// Destinatari: profiles cu email, fără newsletter_opt_in=false (soft opt-in,
// utilizatori existenți ai platformei; fiecare email are link de dezabonare).
// Evidența trimiterilor e în newsletter_sends → fără duplicate între loturi.
// Necesită: supabase/email_system.sql rulat.
// =====================================================================
const ai = require('./_lib/ai');
const mailer = require('./_lib/mailer');

const SITE_URL = (process.env.SITE_URL || 'https://examenmate.com').replace(/\/$/, '');
const BATCH = Math.max(1, Math.min(300, parseInt(process.env.NEWSLETTER_BATCH || '120', 10)));

function unsubUrl(userId) {
  const token = ai.signToken({ t: 'unsub', uid: userId });
  return `${SITE_URL}/api/newsletter?action=unsubscribe&token=${encodeURIComponent(token)}`;
}

// Destinatari eligibili (id + email). newsletter_opt_in poate lipsi (SQL nerulat)
// → reîncercăm fără filtru și tratăm toți ca abonați.
async function recipients(supa) {
  let q = await supa.from('profiles').select('id, email')
    .not('email', 'is', null)
    .or('newsletter_opt_in.eq.true,newsletter_opt_in.is.null');
  if (q.error) q = await supa.from('profiles').select('id, email').not('email', 'is', null);
  return (q.data || []).filter((p) => p.email && /@/.test(p.email));
}

function buildHtml(campaign, userIdForUnsub) {
  return mailer.template({
    title: campaign.subject,
    preheader: String(campaign.markdown).replace(/[#*\[\]]/g, '').slice(0, 90),
    bodyHtml: mailer.mdToHtml(campaign.markdown),
    footerNote: 'Primești acest email fiindcă ai un cont pe examenmate.com.',
    unsubscribeUrl: userIdForUnsub ? unsubUrl(userIdForUnsub) : null,
  });
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const supa = ai.admin();
  try {
    // ── Dezabonare publică (link din email, fără autentificare) ──────────────
    if (req.method === 'GET') {
      if (req.query.action !== 'unsubscribe') return res.status(400).json({ error: 'action invalid' });
      const payload = ai.verifyToken(String(req.query.token || ''));
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (!payload || payload.t !== 'unsub' || !payload.uid) {
        return res.status(400).send('<html lang="ro"><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Link invalid</h2><p>Linkul de dezabonare nu este valid. Scrie-ne la admin.examenmate@gmail.com.</p></body></html>');
      }
      const { error } = await supa.from('profiles').update({ newsletter_opt_in: false }).eq('id', payload.uid);
      if (error) {
        console.error('newsletter unsubscribe:', error.message);
        return res.status(500).send('<html lang="ro"><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>Eroare</h2><p>Nu am putut procesa dezabonarea. Scrie-ne la admin.examenmate@gmail.com.</p></body></html>');
      }
      return res.status(200).send('<html lang="ro"><body style="font-family:sans-serif;text-align:center;padding:60px"><h2>✅ Te-ai dezabonat</h2><p>Nu vei mai primi newsletterul ExamenMate. Emailurile despre contul tău rămân active.</p><p><a href="https://examenmate.com">Înapoi la examenmate.com</a></p></body></html>');
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // ── Acțiuni de admin ─────────────────────────────────────────────────────
    const userId = await ai.authUser(req, supa);
    await ai.requireAdmin(supa, userId);
    const { action, subject = '', markdown = '', campaignId = null } = req.body || {};

    if (!mailer.enabled() && action !== 'list') {
      return res.status(400).json({ error: 'Emailul nu e configurat. Setează EMAIL_USER și EMAIL_APP_PASSWORD în Vercel (vezi GHID_EMAIL_SI_SEO.md).' });
    }

    if (action === 'create') {
      const sj = String(subject).trim();
      const md = String(markdown).trim();
      if (sj.length < 3 || sj.length > 150) return res.status(400).json({ error: 'Subiectul trebuie să aibă 3–150 de caractere.' });
      if (md.length < 20) return res.status(400).json({ error: 'Conținutul e prea scurt.' });
      const { data, error } = await supa.from('newsletter_campaigns')
        .insert({ subject: sj, markdown: md, created_by: userId }).select('id').single();
      if (error) return res.status(500).json({ error: `Nu am putut salva campania (ai rulat supabase/email_system.sql?): ${error.message}` });
      const recs = await recipients(supa);
      return res.status(200).json({ campaignId: data.id, recipients: recs.length, adminEmail: mailer.ADMIN_EMAIL });
    }

    if (action === 'test' || action === 'send') {
      if (!campaignId) return res.status(400).json({ error: 'campaignId obligatoriu' });
      const { data: camp, error: cErr } = await supa.from('newsletter_campaigns')
        .select('id, subject, markdown').eq('id', campaignId).single();
      if (cErr || !camp) return res.status(404).json({ error: 'Campania nu există.' });

      if (action === 'test') {
        const r = await mailer.sendMail({
          to: mailer.ADMIN_EMAIL,
          subject: `[TEST] ${camp.subject}`,
          html: buildHtml(camp, userId),
        });
        if (!r.ok) return res.status(500).json({ error: r.error || r.skipped || 'Trimiterea testului a eșuat.' });
        return res.status(200).json({ ok: true, to: mailer.ADMIN_EMAIL });
      }

      // send — un lot, fără duplicate
      const recs = await recipients(supa);
      const { data: sentRows } = await supa.from('newsletter_sends')
        .select('user_id').eq('campaign_id', campaignId);
      const already = new Set((sentRows || []).map((s) => s.user_id));
      const pending = recs.filter((p) => !already.has(p.id));
      const lot = pending.slice(0, BATCH);

      let sent = 0;
      for (const p of lot) {
        const r = await mailer.sendMail({ to: p.email, subject: camp.subject, html: buildHtml(camp, p.id) });
        if (r.ok) {
          sent++;
          await supa.from('newsletter_sends').insert({ campaign_id: campaignId, user_id: p.id });
        } else if (r.skipped) {
          break; // email dezactivat global — nu are rost să continuăm
        }
        await mailer.sleep(200); // ~5/sec — sub limitele SMTP Gmail
      }
      return res.status(200).json({ sent, remaining: Math.max(0, pending.length - lot.length), total: recs.length });
    }

    if (action === 'list') {
      const { data } = await supa.from('newsletter_campaigns')
        .select('id, subject, created_at').order('created_at', { ascending: false }).limit(20);
      return res.status(200).json({ campaigns: data || [] });
    }

    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('newsletter error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
