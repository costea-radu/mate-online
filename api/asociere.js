const { createClient } = require('@supabase/supabase-js');
const { handledMethod, authUser } = require('./_lib/http');

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ─── ELEVUL ÎȘI INVITĂ PĂRINTELE (11 nov. 2026, seara) ───────────────────────
// Până acum asocierea pornea doar de la mentor (linkul cu codul lui, deschis de
// elev). Dar elevul e cel care ajunge pe site (reclame, colegi), iar abonamentul
// îl plătește părintele: elevul are nevoie de un link pe care să i-l trimită.
//   · { action: 'invita_parinte' } — elevul primește un token semnat (14 zile);
//     linkul e /asociere?elev=<token> („📲 Trimite părintelui", pe /preturi);
//   · { elevToken } — părintele (autentificat) deschide linkul → e asociat cu
//     contul copilului (mentor_students) și poate face abonamentul PENTRU el
//     (api/create-checkout.js, `pentruElev`).
// Elevul a trimis linkul de bunăvoie, deci asocierea are acordul lui; tokenul e
// semnat (nu se poate fabrica pentru alt elev) și expiră.
const INVITATIE_ZILE = 14;
async function invitatie(req, res, body) {
  const ai = require('./_lib/ai'); // signToken / verifyToken / createNotification
  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  let userId;
  try { userId = await authUser(req, supabase); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const { data: eu, error } = await supabase.from('profiles').select('id, full_name, role').eq('id', userId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!eu) return res.status(404).json({ error: 'Profil inexistent.' });

  if (body.action === 'invita_parinte') {
    if (eu.role === 'profesor' || eu.role === 'parinte') {
      return res.status(400).json({ error: 'Invitația se trimite din contul elevului.', code: 'DOAR_ELEV' });
    }
    return res.status(200).json({ token: ai.signToken({ t: 'invita', elev: userId }, INVITATIE_ZILE * 86400), zile: INVITATIE_ZILE });
  }

  const d = ai.verifyToken(String(body.elevToken || ''));
  if (!d || d.t !== 'invita' || !d.elev) {
    return res.status(400).json({ error: 'Linkul de invitație nu mai e valabil. Roagă copilul să-ți trimită unul nou.', code: 'INVITATIE_EXPIRATA' });
  }
  if (d.elev === userId) {
    return res.status(400).json({ error: 'Ai deschis propria invitație. Trimite linkul părintelui tău.', code: 'PROPRIA_INVITATIE' });
  }
  if (eu.role === 'elev') {
    return res.status(400).json({ error: 'Linkul e pentru părinte. Intră cu un cont de părinte (sau creează unul) și deschide-l din nou.', code: 'CONT_DE_ELEV' });
  }
  const { data: elev, error: elevErr } = await supabase.from('profiles').select('id, full_name, role').eq('id', d.elev).maybeSingle();
  if (elevErr) return res.status(500).json({ error: elevErr.message });
  if (!elev) return res.status(404).json({ error: 'Contul copilului nu mai există.' });

  const mentorRole = eu.role === 'profesor' ? 'profesor' : 'parinte';
  // prima intrare a părintelui, fără tip de cont ales: contul devine de părinte
  if (!eu.role) await supabase.from('profiles').update({ role: 'parinte' }).eq('id', userId);
  const { error: insertErr } = await supabase.from('mentor_students')
    .upsert({ mentor_id: userId, student_id: elev.id, mentor_role: mentorRole }, { onConflict: 'mentor_id,student_id', ignoreDuplicates: true });
  if (insertErr) return res.status(500).json({ error: insertErr.message });
  if (!elev.role) await supabase.from('profiles').update({ role: 'elev' }).eq('id', elev.id);
  try {
    await ai.createNotification(supabase, {
      recipientId: elev.id, type: 'info',
      title: `${eu.full_name || (mentorRole === 'parinte' ? 'Părintele tău' : 'Profesorul tău')} s-a asociat cu contul tău`,
      body: 'Îți poate vedea rezultatele la teste.', dedupeKey: `asociere:${userId}:${elev.id}`,
    });
  } catch { /* notificarea e opțională */ }

  return res.status(200).json({ student_id: elev.id, student_name: elev.full_name || 'Elev', mentor_role: mentorRole });
}

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;

  if (req.body && (req.body.action === 'invita_parinte' || req.body.elevToken)) return invitatie(req, res, req.body);

  const { code } = req.body || {};
  const normCode = normalizeCode(code);
  if (!normCode) return res.status(400).json({ error: 'Cod invalid.' });

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  let userId;
  try { userId = await authUser(req, supabase); }
  catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  // 1. Găsește mentorul (profesor sau părinte) după cod
  const { data: mentor, error: mentorErr } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('teacher_code', normCode)
    .maybeSingle();

  if (mentorErr) return res.status(500).json({ error: mentorErr.message });
  if (!mentor) {
    return res.status(404).json({ error: 'Codul nu corespunde niciunui cont.' });
  }
  const mentorRole = mentor.role === 'parinte' ? 'parinte' : 'profesor';
  if (mentor.role && mentor.role !== 'profesor' && mentor.role !== 'parinte') {
    return res.status(400).json({ error: 'Cod invalid.' });
  }
  if (mentor.id === userId) {
    return res.status(400).json({ error: 'Nu te poți asocia cu propriul cont.' });
  }

  // 2. Citește profilul elevului (pentru a seta role='elev' dacă lipsește)
  const { data: student, error: studentErr } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (studentErr) return res.status(500).json({ error: studentErr.message });
  if (!student) return res.status(404).json({ error: 'Profil inexistent.' });

  // 3. Asociere multiplă (un elev poate avea mai mulți profesori și părinți)
  const { error: insertErr } = await supabase
    .from('mentor_students')
    .upsert(
      { mentor_id: mentor.id, student_id: userId, mentor_role: mentorRole },
      { onConflict: 'mentor_id,student_id', ignoreDuplicates: true }
    );

  if (insertErr) return res.status(500).json({ error: insertErr.message });

  // 4. Dacă elevul nu avea rol, îl marcăm ca 'elev'
  if (!student.role) {
    await supabase.from('profiles').update({ role: 'elev' }).eq('id', userId);
  }

  return res.status(200).json({
    mentor_id: mentor.id,
    mentor_name: mentor.full_name || (mentorRole === 'parinte' ? 'Părinte' : 'Profesor'),
    mentor_role: mentorRole,
    // compat
    teacher_name: mentor.full_name || (mentorRole === 'parinte' ? 'Părinte' : 'Profesor'),
  });
};

module.exports.INVITATIE_ZILE = INVITATIE_ZILE;
