// =====================================================================
// api/agent-cron.js — CRONUL task-urilor programate ale agentului Claude
// de exerciții. Rulează ORAR (vercel.json: 0 * * * *) și execută task-urile
// scadente la ora curentă a României (Europe/Bucharest — orele din task-uri
// sunt ora locală; conversia din UTC se face aici, cu tot cu ora de vară).
//
// Protejat ca celelalte cron-uri: header `x-vercel-cron` (pus automat de
// Vercel) sau ?secret=AI_CRON_SECRET.
//
// GET /api/agent-cron?action=run
//   • ia task-urile enabled scadente (ora + ziua potrivite, nerulate recent);
//   • le execută pe rând (max 3 per tic — restul prind ora următoare doar
//     dacă mai sunt scadente atunci; practic rar se suprapun 3+ la fix
//     aceeași oră) prin exgen.runTask: generare → postare automată SAU
//     rezultat „așteaptă aprobare" → email către admin (dacă task.notify).
// =====================================================================
const ai = require('./_lib/ai');
const exgen = require('./_lib/exgen');

// Ora/ziua CURENTĂ în România (indiferent de fusul serverului).
// `at` e opțional (implicit acum) — parametrizat pentru teste.
function bucharestNow(at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bucharest', hour12: false,
    weekday: 'short', day: '2-digit', hour: '2-digit',
  }).formatToParts(at);
  const get = (t) => parts.find((p) => p.type === t)?.value || '';
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    hour: (parseInt(get('hour'), 10) || 0) % 24, // „24" (hourCycle h24) → 0
    weekday: wd[get('weekday')] || 1,            // 1=luni … 7=duminică
    monthday: parseInt(get('day'), 10) || 1,
  };
}

function isDue(task, now) {
  if (!task.enabled) return false;
  if ((task.run_hour ?? 7) !== now.hour) return false;
  if (task.schedule_kind === 'weekly' && (task.run_weekday || 1) !== now.weekday) return false;
  if (task.schedule_kind === 'monthly' && (task.run_monthday || 1) !== now.monthday) return false;
  // gardă anti-dublare: nu rula din nou dacă a rulat în ultimele 2 ore
  if (task.last_run_at && Date.now() - new Date(task.last_run_at).getTime() < 2 * 3600 * 1000) return false;
  return true;
}

async function adminUserId(supa) {
  try {
    const { data } = await supa.from('profiles').select('id').eq('is_admin', true).limit(1).maybeSingle();
    return data?.id || null;
  } catch { return null; }
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const cronOk = req.headers['x-vercel-cron'] || (process.env.AI_CRON_SECRET && req.query.secret === process.env.AI_CRON_SECRET);
  if (!cronOk) return res.status(403).json({ error: 'Neautorizat' });

  const supa = ai.admin();
  const action = req.query.action || 'run';

  try {
    if (action === 'run') {
      const { data: tasks, error } = await supa.from('agent_tasks').select('*').eq('enabled', true);
      if (error) {
        return res.status(200).json({ ok: false, warning: `Tabelul agent_tasks lipsește — rulează supabase/agent_tasks.sql (${error.message})` });
      }
      const now = bucharestNow();
      const due = (tasks || []).filter((t) => isDue(t, now))
        .sort((a, b) => new Date(a.last_run_at || 0) - new Date(b.last_run_at || 0))
        .slice(0, 3); // buget de timp: fiecare generare durează ~30–90s (maxDuration 300s)

      const uid = await adminUserId(supa);
      const ran = [];
      for (const task of due) {
        const r = await exgen.runTask({ supa, task, triggerKind: 'cron' });
        if (uid && r.usage) await ai.logUsage(supa, uid, 'agent-task-cron', r.usage).catch(() => {});
        ran.push({
          task: task.name, status: r.run.status, title: r.run.title,
          contentId: r.run.content_id || null, error: r.run.error || null, emailed: r.emailed,
        });
      }
      return res.status(200).json({ ok: true, now, checked: (tasks || []).length, due: due.length, ran });
    }

    return res.status(400).json({ error: `Acțiune necunoscută: ${action}` });
  } catch (err) {
    console.error('agent-cron error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};

// pentru teste (test/agent-tasks.test.js) — Vercel folosește doar funcția default
module.exports.bucharestNow = bucharestNow;
module.exports.isDue = isDue;
