// =====================================================================
// api/ai-notify.js — notificări in-app (personale + anunțuri globale)
//
// POST { userId, action }
//   action='list'         → { notifications[] }  (personale + broadcasturi, cu stare citit)
//   action='unread_count' → { count }
//   action='read'         → { ok }  (body: { id, kind } sau { all:true })
//   action='scan'         → (admin/cron) evoluție/stagnare/scădere elevi → alerte
//
// CRON: GET /api/ai-notify?action=scan  (header x-vercel-cron sau ?secret=AI_CRON_SECRET)
//
// EMAIL (nou): dacă EMAIL_USER + EMAIL_APP_PASSWORD sunt setate în Vercel,
//   scanarea zilnică trimite și:
//   • un email-rezumat fiecărui profesor/părinte cu alertele elevilor lui
//     (dezactivabil per profil prin profiles.email_alerts = false);
//   • un rezumat zilnic al platformei către ADMIN_EMAIL
//     (utilizatori noi, abonați, mesaje de contact, alertele create).
// =====================================================================
const ai = require('./_lib/ai');
const mailer = require('./_lib/mailer');

// ── Email-digest către mentori (profesori + părinți) ─────────────────────────
async function emailMentors(supa, mentorAlerts) {
  if (!mailer.enabled() || !mentorAlerts.size) return 0;
  const ids = [...mentorAlerts.keys()];

  // email_alerts poate lipsi dacă SQL-ul nu a fost rulat încă → reîncercăm fără el
  let profs = null;
  {
    const r = await supa.from('profiles').select('id, email, full_name, email_alerts').in('id', ids);
    if (r.error) {
      const r2 = await supa.from('profiles').select('id, email, full_name').in('id', ids);
      profs = r2.data;
    } else profs = r.data;
  }

  let emailed = 0;
  for (const p of profs || []) {
    if (!p.email || p.email_alerts === false) continue;
    const items = mentorAlerts.get(p.id) || [];
    if (!items.length) continue;
    const list = items.slice(0, 20).map((it) =>
      `<li style="margin:7px 0"><strong>${mailer.escapeHtml(it.title)}</strong><br><span style="color:#5a6379">${mailer.escapeHtml(it.body || '')}</span></li>`
    ).join('');
    const html = mailer.template({
      title: `Alertele elevilor tăi (${items.length})`,
      preheader: items[0]?.title || '',
      bodyHtml: `
        <p>Salut${p.full_name ? ', ' + mailer.escapeHtml(String(p.full_name).split(' ')[0]) : ''}!</p>
        <p>Profesorul Virtual a observat următoarele la elevii tăi:</p>
        <ul style="padding-left:20px">${list}</ul>
        <p style="margin-top:16px"><a href="https://examenmate.com/profil" style="display:inline-block;background:#17233f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Vezi detaliile în cont</a></p>`,
      footerNote: 'Primești aceste alerte fiindcă ai elevi asociați pe ExamenMate. Le poți opri din Contul meu → Setări.',
    });
    const r = await mailer.sendMail({ to: p.email, subject: `ExamenMate: ${items.length === 1 ? 'o alertă nouă' : items.length + ' alerte noi'} despre elevii tăi`, html });
    if (r.ok) emailed++;
    await mailer.sleep(150); // menajăm limita SMTP Gmail
  }
  return emailed;
}

// ── Rezumat zilnic către admin ───────────────────────────────────────────────
async function emailAdminSummary(supa, { scanned, created, emailed }) {
  if (!mailer.enabled()) return false;
  const dayAgo = new Date(Date.now() - 86400 * 1000).toISOString();
  const cnt = async (q) => { try { const { count } = await q; return count || 0; } catch { return 0; } };

  const [total, newUsers, premium, contacts] = await Promise.all([
    cnt(supa.from('profiles').select('*', { count: 'exact', head: true })),
    cnt(supa.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', dayAgo)),
    cnt(supa.from('profiles').select('*', { count: 'exact', head: true }).eq('subscription_status', 'active')),
    cnt(supa.from('contact_messages').select('*', { count: 'exact', head: true }).gte('created_at', dayAgo)),
  ]);

  const row = (label, val) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef1f6;color:#5a6379">${label}</td><td style="padding:8px 12px;border-bottom:1px solid #eef1f6;text-align:right;font-weight:700;color:#17233f">${val}</td></tr>`;
  const html = mailer.template({
    title: 'Rezumatul zilnic ExamenMate',
    preheader: `${newUsers} utilizatori noi · ${premium} abonați activi`,
    bodyHtml: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef1f6;border-radius:10px;border-collapse:separate;overflow:hidden">
        ${row('Utilizatori (total)', total)}
        ${row('Utilizatori noi (24h)', newUsers)}
        ${row('Abonați premium activi', premium)}
        ${row('Mesaje de contact (24h)', contacts)}
        ${row('Elevi scanați azi', scanned)}
        ${row('Alerte create (in-app)', created)}
        ${row('Emailuri trimise mentorilor', emailed)}
      </table>
      <p style="margin-top:14px"><a href="https://examenmate.com/admin" style="color:#1d4ed8">Deschide panoul de admin →</a></p>`,
  });
  const r = await mailer.sendMail({ to: mailer.ADMIN_EMAIL, subject: `📊 ExamenMate azi: +${newUsers} utilizatori, ${created} alerte`, html });
  return !!r.ok;
}

// ── Scanare progres: stagnare / evoluție / scădere → profesori ȘI părinți ──────
async function scan(supa) {
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const { data: rows } = await supa.from('ai_skill_mastery')
    .select('user_id, category, topic, mastery, attempts, last_interaction')
    .gte('last_interaction', since);
  if (!rows || !rows.length) {
    const emptyStats = { scanned: 0, created: 0, emailed: 0 };
    emptyStats.adminEmail = await emailAdminSummary(supa, emptyStats);
    return emptyStats;
  }

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  // snapshoturile anterioare
  const { data: snaps } = await supa.from('ai_mastery_snapshots')
    .select('user_id, topic, mastery').in('user_id', userIds);
  const prevMap = new Map();
  (snaps || []).forEach((s) => prevMap.set(`${s.user_id}:${s.topic}`, Number(s.mastery)));

  // cache mentori + nume per elev
  const mentorsCache = new Map();
  const nameCache = new Map();
  async function mentorsFor(uid) {
    if (!mentorsCache.has(uid)) mentorsCache.set(uid, await ai.mentorsOf(supa, uid));
    return mentorsCache.get(uid);
  }
  async function nameFor(uid) {
    if (!nameCache.has(uid)) {
      const { data: p } = await supa.from('profiles').select('full_name, email').eq('id', uid).single();
      nameCache.set(uid, p?.full_name || p?.email || 'Un elev');
    }
    return nameCache.get(uid);
  }

  let created = 0;
  const upserts = [];
  const mentorAlerts = new Map(); // mentorId → [{title, body}] pentru email-digest
  for (const r of rows) {
    const cur = Number(r.mastery);
    const prev = prevMap.get(`${r.user_id}:${r.topic}`);
    let kind = null, title = null, body = null;

    if (prev != null && prev < 0.5 && cur >= 0.7) {
      kind = 'evolution';
    } else if (prev != null && prev >= 0.6 && cur < 0.45) {
      kind = 'decline';
    } else if (cur < 0.5 && r.attempts >= 4) {
      kind = 'stagnation';
    }

    // pregătește noul snapshot indiferent de rezultat
    upserts.push({ user_id: r.user_id, topic: r.topic, category: r.category, mastery: cur, updated_at: new Date().toISOString() });

    if (!kind) continue;
    const who = await nameFor(r.user_id);
    const pct = Math.round(cur * 100);
    if (kind === 'evolution') { title = `${who} a progresat la „${r.topic}"`; body = `Stăpânire ${pct}% — evoluție bună!`; }
    else if (kind === 'decline') { title = `${who} a scăzut la „${r.topic}"`; body = `Stăpânire ${pct}% — ar putea avea nevoie de ajutor.`; }
    else { title = `${who} stagnează la „${r.topic}"`; body = `Stăpânire ${pct}% după ${r.attempts} încercări.`; }

    const mentors = await mentorsFor(r.user_id);
    for (const mId of mentors) {
      const ok = await ai.createNotification(supa, {
        recipientId: mId, type: kind, title, body,
        data: { studentId: r.user_id, topic: r.topic, category: r.category, mastery: cur, url: '/profil' },
        dedupeKey: `${kind}:${r.user_id}:${r.category || 'general'}:${r.topic}`, dedupeDays: 7,
      });
      if (ok) {
        created++;
        // email-digest doar pentru alertele NOI (nededuplicate)
        if (!mentorAlerts.has(mId)) mentorAlerts.set(mId, []);
        mentorAlerts.get(mId).push({ title, body });
      }
    }
  }

  // salvează snapshoturile noi (în loturi)
  for (let i = 0; i < upserts.length; i += 200) {
    await supa.from('ai_mastery_snapshots').upsert(upserts.slice(i, i + 200), { onConflict: 'user_id,topic' });
  }

  // Emailuri (best-effort — nu blochează scanarea dacă SMTP-ul dă eroare)
  let emailed = 0;
  try { emailed = await emailMentors(supa, mentorAlerts); }
  catch (e) { console.error('ai-notify: email mentori eșuat:', e.message); }
  let adminEmail = false;
  try { adminEmail = await emailAdminSummary(supa, { scanned: rows.length, created, emailed }); }
  catch (e) { console.error('ai-notify: rezumat admin eșuat:', e.message); }

  return { scanned: rows.length, created, emailed, adminEmail };
}

// ── Listă unificată: personale + anunțuri ─────────────────────────────────────
async function buildList(supa, userId, limit = 40) {
  const cutoff = new Date(Date.now() - 60 * 86400 * 1000).toISOString();
  const [{ data: personal }, { data: broadcasts }, { data: reads }] = await Promise.all([
    supa.from('ai_notifications').select('id, type, title, body, data, read, created_at')
      .eq('recipient_id', userId).order('created_at', { ascending: false }).limit(limit),
    supa.from('ai_broadcasts').select('id, type, title, body, data, created_at')
      .gte('created_at', cutoff).order('created_at', { ascending: false }).limit(limit),
    supa.from('ai_broadcast_reads').select('broadcast_id').eq('user_id', userId),
  ]);
  const readSet = new Set((reads || []).map((r) => r.broadcast_id));
  const items = [
    ...(personal || []).map((n) => ({ ...n, kind: 'personal' })),
    ...(broadcasts || []).map((b) => ({ ...b, kind: 'broadcast', read: readSet.has(b.id) })),
  ];
  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return items.slice(0, limit);
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const supa = ai.admin();
  try {
    if (req.method === 'GET') {
      const cronOk = req.headers['x-vercel-cron'] || (process.env.AI_CRON_SECRET && req.query.secret === process.env.AI_CRON_SECRET);
      if (req.query.action === 'scan' && cronOk) return res.status(200).json(await scan(supa));
      return res.status(403).json({ error: 'Neautorizat' });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const userId = await ai.authUser(req, supa);
    const { action = 'list', id, notificationId, kind, all } = req.body || {};
    const profile = await ai.requireUser(supa, userId);

    if (action === 'list') {
      return res.status(200).json({ notifications: await buildList(supa, userId) });
    }

    if (action === 'unread_count') {
      const cutoff = new Date(Date.now() - 60 * 86400 * 1000).toISOString();
      const [{ count: pc }, { data: broadcasts }, { data: reads }] = await Promise.all([
        supa.from('ai_notifications').select('*', { count: 'exact', head: true }).eq('recipient_id', userId).eq('read', false),
        supa.from('ai_broadcasts').select('id').gte('created_at', cutoff),
        supa.from('ai_broadcast_reads').select('broadcast_id').eq('user_id', userId),
      ]);
      const readSet = new Set((reads || []).map((r) => r.broadcast_id));
      const broadcastUnread = (broadcasts || []).filter((b) => !readSet.has(b.id)).length;
      return res.status(200).json({ count: (pc || 0) + broadcastUnread });
    }

    if (action === 'read') {
      const itemId = id || notificationId;
      if (all) {
        // Fără verificare, clientul primea ok:true iar notificările reapăreau
        // necitite la reîncărcare.
        const { error: rdErr } = await supa.from('ai_notifications')
          .update({ read: true }).eq('recipient_id', userId).eq('read', false);
        if (rdErr) {
          console.error('ai-notify: marcare citit eșuată:', rdErr);
          return res.status(500).json({ error: 'Notificările nu au putut fi marcate ca citite.' });
        }
        const cutoff = new Date(Date.now() - 60 * 86400 * 1000).toISOString();
        const { data: broadcasts } = await supa.from('ai_broadcasts').select('id').gte('created_at', cutoff);
        if (broadcasts && broadcasts.length) {
          await supa.from('ai_broadcast_reads').upsert(
            broadcasts.map((b) => ({ broadcast_id: b.id, user_id: userId })), { onConflict: 'broadcast_id,user_id' });
        }
        return res.status(200).json({ ok: true });
      }
      if (!itemId) return res.status(400).json({ error: 'id sau all:true' });
      if (kind === 'broadcast') {
        const { error } = await supa.from('ai_broadcast_reads').upsert({ broadcast_id: itemId, user_id: userId }, { onConflict: 'broadcast_id,user_id' });
        if (error) return res.status(500).json({ error: error.message });
      } else {
        const { error } = await supa.from('ai_notifications').update({ read: true }).eq('recipient_id', userId).eq('id', itemId);
        if (error) return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ ok: true });
    }

    if (action === 'scan') {
      if (!profile.is_admin) return res.status(403).json({ error: 'Doar adminul poate scana manual.' });
      return res.status(200).json(await scan(supa));
    }

    // Admin: trimite un anunț către toți (ex: update la AI sau o pagină nouă)
    if (action === 'broadcast') {
      if (!profile.is_admin) return res.status(403).json({ error: 'Doar adminul poate trimite anunțuri.' });
      const { title, body = null, url = null, type = 'update' } = req.body || {};
      if (!title || !title.trim()) return res.status(400).json({ error: 'Titlu obligatoriu' });
      const { error } = await supa.from('ai_broadcasts').insert({ type, title: title.trim(), body, data: url ? { url } : {} });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // Admin: lista anunțurilor trimise
    if (action === 'broadcast_list') {
      if (!profile.is_admin) return res.status(403).json({ error: 'Doar adminul.' });
      const { data } = await supa.from('ai_broadcasts').select('id, type, title, body, created_at')
        .order('created_at', { ascending: false }).limit(50);
      return res.status(200).json({ broadcasts: data || [] });
    }

    // Admin: șterge un anunț trimis
    if (action === 'broadcast_delete') {
      if (!profile.is_admin) return res.status(403).json({ error: 'Doar adminul.' });
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id obligatoriu' });
      const { error } = await supa.from('ai_broadcasts').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // Admin: șterge anunțul asociat unui material șters (după data.contentId)
    if (action === 'broadcast_delete_by_content') {
      if (!profile.is_admin) return res.status(403).json({ error: 'Doar adminul.' });
      const { contentId } = req.body || {};
      if (!contentId) return res.status(400).json({ error: 'contentId obligatoriu' });
      const { data: bs } = await supa.from('ai_broadcasts').select('id')
        .eq('type', 'material').filter('data->>contentId', 'eq', String(contentId));
      const ids = (bs || []).map((b) => b.id);
      if (ids.length) {
        await supa.from('ai_broadcast_reads').delete().in('broadcast_id', ids);
        await supa.from('ai_broadcasts').delete().in('id', ids);
      }
      return res.status(200).json({ ok: true, removed: ids.length });
    }
    return res.status(400).json({ error: 'action invalid' });
  } catch (err) {
    console.error('ai-notify error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
