// =====================================================================
// api/agent-tasks.js — TASK-URILE PROGRAMATE ale agentului Claude de
// exerciții (doar admin). Echivalentul „Create scheduled task" din
// Claude.ai, cu RUBRICA site-ului (clasă / tip de examen) pe post de
// context: agentul lucrează în rubrica aleasă și poate posta automat.
//
// Body: { userId, action, ... }
//   list                        → { tasks: [...] }
//   create  {task}              → { task }
//   update  {id, patch}         → { task }
//   toggle  {id, enabled}       → { ok }
//   delete  {id}                → { ok }
//   run_now {id}                → { run }   (execută imediat, ~30–90s)
//   runs    {taskId}            → { runs: [...] }  (fără HTML-ul mare)
//   run_result {runId}          → { result }        (pentru previzualizare)
//   post_run   {runId}          → { contentId }     (aprobă și postează)
//   delete_run {runId}          → { ok }
//
// Programarea EFECTIVĂ o face cronul orar Vercel → api/agent-cron.js.
// Tabelele: supabase/agent_tasks.sql. Generarea/postarea: api/_lib/exgen.js.
// =====================================================================
const ai = require('./_lib/ai');
const claude = require('./_lib/claude');
const exgen = require('./_lib/exgen');

const clampInt = (v, min, max, dflt) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

// Curăță/validează câmpurile unui task venite din formularul de admin.
// (partial=true la update: doar câmpurile prezente în patch)
function cleanTask(input = {}, partial = false) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  const put = (k, v) => { out[k] = v; };

  if (!partial || has('name')) {
    const name = String(input.name || '').trim().slice(0, 120);
    if (!name) throw Object.assign(new Error('Dă-i task-ului un nume.'), { status: 400 });
    put('name', name);
  }
  if (!partial || has('schedule_kind')) put('schedule_kind', ['daily', 'weekly', 'monthly'].includes(input.schedule_kind) ? input.schedule_kind : 'weekly');
  if (!partial || has('run_hour')) put('run_hour', clampInt(input.run_hour, 0, 23, 7));
  if (!partial || has('run_weekday')) put('run_weekday', clampInt(input.run_weekday, 1, 7, 1));
  if (!partial || has('run_monthday')) put('run_monthday', clampInt(input.run_monthday, 1, 28, 1));
  if (!partial || has('category')) {
    const category = String(input.category || '').trim();
    if (!category) throw Object.assign(new Error('Alege rubrica (categoria) în care lucrează task-ul.'), { status: 400 });
    put('category', category.slice(0, 80));
  }
  if (!partial || has('subcategory')) put('subcategory', input.subcategory ? String(input.subcategory).slice(0, 120) : null);
  if (!partial || has('profile')) put('profile', input.profile ? String(input.profile).slice(0, 80) : null);
  if (!partial || has('ctype')) put('ctype', input.ctype === 'pdf' ? 'pdf' : 'interactive');
  if (!partial || has('result_kind')) put('result_kind', ['auto', 'interactive', 'exam'].includes(input.result_kind) ? input.result_kind : 'auto');
  if (!partial || has('data_mode')) put('data_mode', input.data_mode === 'keep' ? 'keep' : 'modify');
  if (!partial || has('instructions')) put('instructions', input.instructions ? String(input.instructions).slice(0, 3000) : null);
  if (!partial || has('ai_model')) {
    // doar ID-uri din lista permisă (claude.MODELS); altceva → null (implicitul)
    const m = String(input.ai_model || '').trim();
    put('ai_model', claude.MODELS.some((x) => x.id === m) ? m : null);
  }
  if (!partial || has('auto_post')) put('auto_post', !!input.auto_post);
  if (!partial || has('is_free')) put('is_free', !!input.is_free);
  if (!partial || has('post_type')) put('post_type', input.post_type === 'exercise' ? 'exercise' : 'test');
  if (!partial || has('notify')) put('notify', input.notify !== false);
  return out;
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    await ai.requireAdmin(supa, userId);

    const { action = 'list' } = req.body || {};

    if (action === 'list') {
      const { data, error } = await supa.from('agent_tasks').select('*').order('created_at', { ascending: false });
      if (error) {
        return res.status(200).json({ tasks: [], warning: `Tabelul agent_tasks lipsește — rulează supabase/agent_tasks.sql în Supabase → SQL Editor (${error.message})` });
      }
      return res.status(200).json({ tasks: data || [] });
    }

    if (action === 'create') {
      const task = cleanTask(req.body.task || {});
      const { data, error } = await supa.from('agent_tasks').insert(task).select('*').single();
      if (error) throw new Error(`Nu am putut salva task-ul: ${error.message}`);
      return res.status(200).json({ task: data });
    }

    if (action === 'update') {
      const id = req.body.id;
      if (!id) return res.status(400).json({ error: 'Lipsește id-ul task-ului.' });
      const patch = cleanTask(req.body.patch || {}, true);
      const { data, error } = await supa.from('agent_tasks').update(patch).eq('id', id).select('*').single();
      if (error) throw new Error(`Actualizarea a eșuat: ${error.message}`);
      return res.status(200).json({ task: data });
    }

    if (action === 'toggle') {
      const id = req.body.id;
      if (!id) return res.status(400).json({ error: 'Lipsește id-ul task-ului.' });
      const { error } = await supa.from('agent_tasks').update({ enabled: !!req.body.enabled }).eq('id', id);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    if (action === 'delete') {
      const id = req.body.id;
      if (!id) return res.status(400).json({ error: 'Lipsește id-ul task-ului.' });
      const { error } = await supa.from('agent_tasks').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    if (action === 'run_now') {
      const id = req.body.id;
      if (!id) return res.status(400).json({ error: 'Lipsește id-ul task-ului.' });
      const { data: task, error } = await supa.from('agent_tasks').select('*').eq('id', id).single();
      if (error || !task) return res.status(404).json({ error: 'Task-ul nu a fost găsit.' });
      const r = await exgen.runTask({ supa, task, triggerKind: 'manual' });
      if (r.usage) await ai.logUsage(supa, userId, 'agent-task-manual', r.usage);
      return res.status(200).json({
        run: {
          id: r.runId, status: r.run.status, title: r.run.title, provider: r.run.provider,
          content_id: r.run.content_id, error: r.run.error, emailed: r.emailed,
        },
      });
    }

    if (action === 'runs') {
      const taskId = req.body.taskId;
      if (!taskId) return res.status(400).json({ error: 'Lipsește taskId.' });
      const { data, error } = await supa.from('agent_task_runs')
        .select('id, created_at, trigger_kind, status, title, provider, content_id, error, combined_from')
        .eq('task_id', taskId).order('created_at', { ascending: false }).limit(25);
      if (error) throw new Error(error.message);
      return res.status(200).json({ runs: data || [] });
    }

    if (action === 'run_result') {
      const runId = req.body.runId;
      if (!runId) return res.status(400).json({ error: 'Lipsește runId.' });
      const { data, error } = await supa.from('agent_task_runs').select('id, status, title, result').eq('id', runId).single();
      if (error || !data) return res.status(404).json({ error: 'Rularea nu a fost găsită.' });
      return res.status(200).json({ result: data.result || null, status: data.status, title: data.title });
    }

    if (action === 'post_run') {
      const runId = req.body.runId;
      if (!runId) return res.status(400).json({ error: 'Lipsește runId.' });
      const r = await exgen.postRun({ supa, runId });
      return res.status(200).json({ contentId: r.contentId, fileUrl: r.fileUrl });
    }

    if (action === 'delete_run') {
      const runId = req.body.runId;
      if (!runId) return res.status(400).json({ error: 'Lipsește runId.' });
      const { error } = await supa.from('agent_task_runs').delete().eq('id', runId);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: `Acțiune necunoscută: ${action}` });
  } catch (err) {
    console.error('agent-tasks error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
