// =====================================================================
// api/account-cleanup.js — curățarea zilnică a conturilor inactive
//
// Fluxul (regulile pure sunt în api/_lib/inactivity.js):
//   0. REACTIVARE  → oricine s-a autentificat după avertizare (sau a devenit
//                    admin/premium) scapă de ștergere; câmpurile se golesc.
//   1. AVERTIZARE  → 12 luni fără autentificare → email „autentifică-te în
//                    30 de zile, altfel contul se șterge" + se programează
//                    ștergerea. Fără email trimis NU se programează nimic.
//   2. REAMINTIRE  → cu 7 zile înainte de termen, un ultim email.
//   3. ȘTERGERE    → termenul a expirat → rezultatele elevului se arhivează
//                    la mentorii lui, apoi contul auth este șters definitiv
//                    (CASCADE curăță profilul și restul datelor).
//   4. Rezumat pe email către admin, dacă s-a întâmplat ceva.
//
// Apelare:
//   • CRON (vercel.json): GET /api/account-cleanup?action=run
//     (autorizat prin headerul x-vercel-cron sau ?secret=AI_CRON_SECRET)
//   • Admin, manual:      POST { } cu token de admin
//   • Test fără efecte:   ...?action=run&secret=...&dry=1  → doar numără
//
// Niciodată nu se șterg: adminii și abonații premium activi.
// =====================================================================
const { applyCors, admin, authUser, requireAdmin, isCronRequest } = require('./_lib/http');
const mailer = require('./_lib/mailer');
const inact = require('./_lib/inactivity');

// Golește câmpurile de ștergere programată pentru o listă de conturi.
async function clearSchedule(supa, ids) {
  if (!ids.length) return;
  for (let i = 0; i < ids.length; i += 100) {
    await supa.from('profiles')
      .update({ deletion_warned_at: null, deletion_reminded_at: null, deletion_scheduled_at: null })
      .in('id', ids.slice(i, i + 100));
  }
}

async function runCleanup(supa, { dry = false } = {}) {
  const now = new Date();
  const stats = {
    dry, emailEnabled: mailer.enabled(),
    reactivated: 0, warned: 0, warnFailed: 0, reminded: 0,
    deleted: 0, archivedFor: 0, deleteFailed: 0, skippedProtected: 0,
  };

  // ── 0) REACTIVARE ──────────────────────────────────────────────────────────
  {
    const { data: sched, error } = await supa.from('profiles')
      .select('id, last_active_at, deletion_warned_at, deletion_scheduled_at, is_admin, subscription_status')
      .not('deletion_scheduled_at', 'is', null)
      .limit(2000);
    if (error) throw new Error('Nu am putut citi conturile programate: ' + error.message);
    const toClear = (sched || []).filter((p) => inact.shouldReactivate(p) || inact.isProtected(p));
    if (!dry) await clearSchedule(supa, toClear.map((p) => p.id));
    stats.reactivated = toClear.length;
  }

  // ── 1) AVERTIZARE la 12 luni de inactivitate ───────────────────────────────
  // Fără email configurat nu avertizăm (și deci nu programăm ștergeri noi).
  if (mailer.enabled()) {
    const cutoff = inact.inactivityCutoff(now);
    const { data: cand } = await supa.from('profiles')
      .select('id, email, full_name, role, is_admin, subscription_status, last_active_at, deletion_scheduled_at')
      .is('deletion_scheduled_at', null)
      .lt('last_active_at', cutoff.toISOString())
      .order('last_active_at', { ascending: true })
      .limit(inact.WARN_BATCH);

    for (const p of cand || []) {
      if (!inact.eligibleForWarning(p, now)) { stats.skippedProtected++; continue; }
      const scheduledAt = inact.deletionDate(now);
      if (dry) { stats.warned++; continue; }

      const email = inact.buildWarningEmail(p, scheduledAt);
      const r = await mailer.sendMail({ to: p.email, subject: email.subject, html: email.html });
      if (!r.ok) { stats.warnFailed++; await mailer.sleep(150); continue; } // reîncercăm mâine

      const { error: upErr } = await supa.from('profiles').update({
        deletion_warned_at: now.toISOString(),
        deletion_reminded_at: null,
        deletion_scheduled_at: scheduledAt.toISOString(),
      }).eq('id', p.id);
      if (upErr) console.error('account-cleanup: nu am putut marca avertizarea pentru', p.id, upErr.message);
      else stats.warned++;
      await mailer.sleep(150); // menajăm limita SMTP Gmail
    }
  }

  // ── 2) REAMINTIRE cu 7 zile înainte de termen ──────────────────────────────
  if (mailer.enabled()) {
    const soon = new Date(now.getTime() + inact.REMIND_BEFORE_DAYS * inact.DAY_MS);
    const { data: cand } = await supa.from('profiles')
      .select('id, email, full_name, role, is_admin, subscription_status, last_active_at, deletion_warned_at, deletion_reminded_at, deletion_scheduled_at')
      .not('deletion_scheduled_at', 'is', null)
      .is('deletion_reminded_at', null)
      .lte('deletion_scheduled_at', soon.toISOString())
      .limit(inact.REMIND_BATCH);

    for (const p of cand || []) {
      if (!inact.dueForReminder(p, now)) continue;
      if (dry) { stats.reminded++; continue; }

      const email = inact.buildReminderEmail(p, new Date(p.deletion_scheduled_at), now);
      const r = await mailer.sendMail({ to: p.email, subject: email.subject, html: email.html });
      if (r.ok) {
        await supa.from('profiles').update({ deletion_reminded_at: now.toISOString() }).eq('id', p.id);
        stats.reminded++;
      }
      await mailer.sleep(150);
    }
  }

  // ── 3) ȘTERGERE după expirarea termenului de 30 de zile ────────────────────
  {
    const { data: cand } = await supa.from('profiles')
      .select('id, email, full_name, role, is_admin, subscription_status, last_active_at, deletion_warned_at, deletion_scheduled_at')
      .not('deletion_scheduled_at', 'is', null)
      .lte('deletion_scheduled_at', now.toISOString())
      .limit(inact.DELETE_BATCH);

    for (const p of cand || []) {
      // dublă verificare pe rândul curent: protejat sau reactivat între timp?
      if (inact.isProtected(p) || inact.shouldReactivate(p)) {
        if (!dry) await clearSchedule(supa, [p.id]);
        stats.reactivated++;
        continue;
      }
      if (!inact.dueForDeletion(p, now)) continue;
      if (dry) { stats.deleted++; continue; }

      try {
        // întâi arhivăm rezultatele pentru mentorii elevului…
        stats.archivedFor += await inact.archiveStudentData(supa, p, 'inactivity');
        // …apoi ștergem contul (CASCADE curăță profilul și datele lui)
        const { error } = await supa.auth.admin.deleteUser(p.id);
        if (error) throw new Error(error.message);
        stats.deleted++;
      } catch (e) {
        // arhiva rămâne; reîncercăm ștergerea la următoarea rulare
        console.error('account-cleanup: ștergerea a eșuat pentru', p.id, e.message);
        stats.deleteFailed++;
      }
    }
  }

  // ── 4) Rezumat către admin (best-effort) ───────────────────────────────────
  if (!dry && mailer.enabled() &&
      (stats.warned || stats.reminded || stats.deleted || stats.deleteFailed || stats.warnFailed)) {
    try {
      const email = inact.buildAdminSummaryEmail(stats);
      const r = await mailer.sendMail({ to: mailer.ADMIN_EMAIL, subject: email.subject, html: email.html });
      stats.adminEmail = !!r.ok;
    } catch (e) { console.error('account-cleanup: rezumatul admin a eșuat:', e.message); }
  }

  return stats;
}

module.exports = async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const supa = admin();
  try {
    const dry = String((req.query && req.query.dry) || (req.body && req.body.dry) || '') === '1';

    if (req.method === 'GET') {
      // CRON Vercel sau apel manual cu secretul
      const cronOk = isCronRequest(req); // x-vercel-cron(-schedule) / vercel-cron UA / Bearer CRON_SECRET / ?secret=
      if (req.query.action !== 'run') return res.status(400).json({ error: 'Folosește ?action=run' });
      if (!cronOk) return res.status(403).json({ error: 'Neautorizat' });
      return res.status(200).json(await runCleanup(supa, { dry }));
    }

    if (req.method === 'POST') {
      // rulare manuală din panoul de admin (token real, drept de admin)
      const userId = await authUser(req, supa);
      await requireAdmin(supa, userId);
      return res.status(200).json(await runCleanup(supa, { dry }));
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('account-cleanup error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
