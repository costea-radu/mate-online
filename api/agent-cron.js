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
//   • ia task-urile enabled scadente (ora + ziua potrivite, nerulate de la
//     ora programată încoace) — cu FEREASTRĂ DE RECUPERARE de 6 ore: un task
//     care nu a apucat să ruleze fix la ora lui (mai mult de 3 scadente în
//     același tic, un tic ratat de Vercel, o funcție întreruptă la
//     maxDuration) mai e încercat la fiecare tic orar, până la 6 ore după
//     ora programată. Înainte, ratarea orei = task-ul NU mai rula deloc în
//     ziua aceea („nu a publicat la ora programată”).
//   • le execută pe rând (max 3 per tic, cu buget de timp ~220s — restul
//     rămân scadente și îi prinde ticul următor) prin exgen.runTask:
//     generare → postare automată SAU rezultat „așteaptă aprobare" → email
//     către admin (dacă task.notify).
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

// Fereastra de RECUPERARE: câte ore după ora programată mai încercăm un task
// care nu a apucat să ruleze (tic aglomerat / ratat / întrerupt la maxDuration).
const CATCHUP_HOURS = 6;

// Momentul programat cel mai RECENT (ms UTC, începutul orei) din ultimele
// CATCHUP_HOURS ore care se potrivește programului task-ului; null dacă nu e.
function dueAt(task, at = new Date()) {
  const topOfHour = Math.floor(at.getTime() / 3600000) * 3600000;
  for (let h = 0; h < CATCHUP_HOURS; h++) {
    const t = new Date(topOfHour - h * 3600000);
    const ro = bucharestNow(t);
    if ((task.run_hour ?? 7) !== ro.hour) continue;
    if (task.schedule_kind === 'weekly' && (task.run_weekday || 1) !== ro.weekday) continue;
    if (task.schedule_kind === 'monthly' && (task.run_monthday || 1) !== ro.monthday) continue;
    return t.getTime();
  }
  return null;
}

function isDue(task, at = new Date()) {
  if (!task.enabled) return false;
  const sched = dueAt(task, at);
  if (sched == null) return false;
  // task-ul e „făcut” dacă a rulat DE LA ora programată încoace — sau cu până
  // la 2 ore ÎNAINTE de ea (ex. „▶️ Rulează acum” chiar înaintea orei; vechea
  // gardă anti-dublare, cu aceeași semantică)
  if (task.last_run_at && new Date(task.last_run_at).getTime() >= sched - 2 * 3600 * 1000) return false;
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
      const at = new Date();
      const now = bucharestNow(at);
      const due = (tasks || []).filter((t) => isDue(t, at))
        .sort((a, b) => new Date(a.last_run_at || 0) - new Date(b.last_run_at || 0))
        .slice(0, 3); // per tic; restul rămân scadente (fereastra de recuperare) și îi ia ticul următor

      const uid = await adminUserId(supa);
      const started = Date.now();
      const ran = [];
      const postponed = [];
      for (const task of due) {
        // buget de timp: generările lungi (Opus/Sonnet + continuări) pot
        // apropia maxDuration (800s în vercel.json) — ce nu încape acum
        // rămâne scadent pentru ticul următor (fereastra de recuperare),
        // în loc să fie pierdut la întreruperea funcției
        const budgetMs = Math.max(120, (Number(process.env.FUNCTION_MAX_SECONDS) || 800) - 80) * 1000;
        if (Date.now() - started > budgetMs) { postponed.push(task.name); continue; }
        const r = await exgen.runTask({ supa, task, triggerKind: 'cron' });
        if (uid && r.usage) await ai.logUsage(supa, uid, 'agent-task-cron', r.usage).catch(() => {});
        ran.push({
          task: task.name, status: r.run.status, title: r.run.title,
          contentId: r.run.content_id || null, error: r.run.error || null, emailed: r.emailed,
        });
      }
      return res.status(200).json({ ok: true, now, checked: (tasks || []).length, due: due.length, ran, postponed });
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
module.exports.dueAt = dueAt;
module.exports.CATCHUP_HOURS = CATCHUP_HOURS;
