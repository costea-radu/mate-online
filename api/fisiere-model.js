// =====================================================================
// api/fisiere-model.js — „📤 FIȘIERE MODEL" (Admin) — 15 nov. 2026
//
// Cererea: „Creează o filă nouă în Admin, «📤 Fișiere model», unde pot încărca poze,
// PDF sau Word cu exerciții-model (…) Fișierele model NU se publică nicăieri automat —
// sunt doar sursă pentru task-uri programate ulterioare. Nu modifici nimic din
// Biblioteca utilizatorilor existentă."
//
// Browserul (src/components/AdminFisiereModel.jsx) face PDF-ul cu aceeași conversie ca
// la „📤 Încarcă material" (src/lib/materialPdf.js: pozele / Word-ul → PDF; textul
// Word-ului cu formulele ca LaTeX — src/lib/mathmlTex.js; pozele transcrise de modelul
// de vedere — api/ai-public.js → transcribe) și îl urcă în bucketul privat
// personal-pdfs, în folderul adminului: <id admin>/fisiere-model/… (politicile
// existente ale bucketului; fără bucket nou). Aici: rândul din admin_model_files
// (supabase/fisiere_model.sql), textul PDF-urilor (pdf-parse, pe server), lista cu
// filtre, etichetele, ștergerea. Doar administratorii.
//
// POST /api/fisiere-model
//   { action: 'lista', clasa?, examen?, capitol?, status? } → { fisiere, capitole, setup }
//   { action: 'salveaza', path, titlu, clasa | examen (+ profil), capitol, tip,
//     examenAsociat?: { examen, subiect, exercitiu }, text?, textSursa?, sursa,
//     numeOriginal?, pagini?, octeti? } → { fisier }
//   { action: 'actualizeaza', id, ...aceleași etichete, status? } → { fisier }
//   { action: 'sterge', id } → { ok }                 (rândul + PDF-ul din bucket)
//   { action: 'url', id } → { url }                   (link semnat, 10 minute — previzualizare)
// =====================================================================
const ai = require('./_lib/ai');
const CH = require('./_lib/capitoleHarta');
const pdfContext = require('./ai-pdf-context');

const TABLE = 'admin_model_files';
const BUCKET = 'personal-pdfs';
const FOLDER = 'fisiere-model';
const SETUP_HINT = 'Tabela fișierelor model lipsește: rulează o dată supabase/fisiere_model.sql în Supabase → SQL Editor.';
const CLASE = [5, 6, 7, 8, 9, 10, 11, 12];
const EXAMENE = ['evaluare-nationala', 'bacalaureat'];
const PROFILE = ['mate-info', 'stiinte-naturii', 'tehnologic'];
const TIPURI = ['grila', 'redactare', 'mixt'];
const SURSE = ['pdf', 'docx', 'foto'];
const STARI = ['neprocesat', 'procesat'];
const TEXT_MAX = 200000;
const ROMAN = { 1: 'I', 2: 'al II-lea', 3: 'al III-lea' };
const SCURT = { 'evaluare-nationala': 'EN', bacalaureat: 'BAC' };
const LIST_COLS = 'id, titlu, file_path, bucket, sursa, nume_original, pagini, octeti, text_sursa, clasa, examen, profil, capitol, capitol_id, tip_exercitiu, examen_asociat, status, uploaded_at, uploaded_by, updated_at, processed_at, processed_by';

const lipsaTabela = (err) => !!err && /relation .* does not exist|does not exist|schema cache|could not find the table/i.test(String(err.message || err));
function eroare(status, msg) { const e = new Error(msg); e.status = status; return e; }
const curat = (v, max = 200) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

// categoria site-ului pentru o țintă (clasa-N sau examenul)
const categoriaDe = (t) => (t.examen ? t.examen : t.clasa ? `clasa-${t.clasa}` : null);

// Capitolele site-ului, ca propuneri la încărcare (aceleași ca pe harta pregătirii —
// api/_lib/capitoleHarta.js —, ca un task să poată face corespondența automată)
function capitoleSite() {
  const out = {};
  for (const g of CLASE) out[`clasa-${g}`] = CH.listaPentru(`clasa-${g}`).map((c) => c.titlu);
  for (const e of EXAMENE) out[e] = CH.listaPentru(e).map((c) => c.titlu);
  return out;
}

// exercițiul de examen ilustrat → { examen, subiect, exercitiu, eticheta } | null
function examenAsociat(src) {
  if (!src || typeof src !== 'object') return null;
  const examen = EXAMENE.includes(src.examen) ? src.examen : null;
  const subiect = [1, 2, 3].includes(Number(src.subiect)) ? Number(src.subiect) : null;
  const ex = Number(src.exercitiu);
  const exercitiu = Number.isInteger(ex) && ex >= 1 && ex <= 9 ? ex : null;
  if (!examen || !subiect) return null;
  const eticheta = `${SCURT[examen]} Subiectul ${ROMAN[subiect]}${exercitiu ? ` exercițiul ${exercitiu}` : ''}`;
  return { examen, subiect, exercitiu, eticheta };
}

// Etichetele trimise din Admin → coloanele tabelei (validate). `partial`: doar ce s-a trimis.
function etichete(src, { partial = false } = {}) {
  const out = {};
  const are = (k) => Object.prototype.hasOwnProperty.call(src, k);
  if (!partial || are('titlu')) out.titlu = curat(src.titlu, 200);
  if (!partial || are('clasa') || are('examen')) {
    const clasa = src.clasa == null || src.clasa === '' ? null : Number(src.clasa);
    const examen = src.examen ? String(src.examen) : null;
    if (examen && !EXAMENE.includes(examen)) throw eroare(400, 'Examen necunoscut.');
    if (clasa != null && !CLASE.includes(clasa)) throw eroare(400, 'Alege o clasă între a V-a și a XII-a.');
    if (clasa == null && !examen) throw eroare(400, 'Alege clasa sau examenul.');
    if (clasa != null && examen) throw eroare(400, 'Alege fie clasa, fie examenul (nu amândouă).');
    out.clasa = examen ? null : clasa;
    out.examen = examen;
    const profil = src.profil ? String(src.profil) : null;
    if (profil && !PROFILE.includes(profil)) throw eroare(400, 'Profil de BAC necunoscut.');
    out.profil = examen === 'bacalaureat' ? profil : null;
  }
  if (!partial || are('capitol')) out.capitol = curat(src.capitol, 160);
  if (!partial || are('tip')) {
    const tip = String(src.tip || 'mixt');
    if (!TIPURI.includes(tip)) throw eroare(400, 'Tipul exercițiilor: grilă, redactare sau mixt.');
    out.tip_exercitiu = tip;
  }
  if (!partial || are('examenAsociat')) out.examen_asociat = examenAsociat(src.examenAsociat);
  if (partial && are('status')) {
    if (!STARI.includes(src.status)) throw eroare(400, 'Stare necunoscută.');
    out.status = src.status;
    out.processed_at = src.status === 'procesat' ? new Date().toISOString() : null;
    out.processed_by = src.status === 'procesat' ? 'admin' : null;
  }
  return out;
}
// capitolul recunoscut (id-ul din capitoleHarta), după capitol + țintă
function cuCapitolId(row) {
  const cat = categoriaDe(row);
  const c = cat && row.capitol ? CH.capitolDin(row.capitol, cat) : null;
  return { ...row, capitol_id: c ? c.id : null };
}

async function citeste(supa, id) {
  const { data, error } = await supa.from(TABLE).select(LIST_COLS).eq('id', id).maybeSingle();
  if (error) throw lipsaTabela(error) ? eroare(503, SETUP_HINT) : eroare(500, error.message);
  if (!data) throw eroare(404, 'Fișierul model nu a fost găsit.');
  return data;
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    await ai.requireAdmin(supa, userId);
    const body = req.body || {};
    const action = String(body.action || 'lista');

    if (action === 'lista') {
      let q = supa.from(TABLE).select(LIST_COLS).order('uploaded_at', { ascending: false }).limit(500);
      if (body.clasa) q = q.eq('clasa', Number(body.clasa));
      if (body.examen) q = q.eq('examen', String(body.examen));
      if (body.status && STARI.includes(body.status)) q = q.eq('status', body.status);
      const { data, error } = await q;
      if (error) {
        if (lipsaTabela(error)) return res.status(200).json({ setup: false, hint: SETUP_HINT, fisiere: [], capitole: capitoleSite() });
        throw eroare(500, error.message);
      }
      let fisiere = data || [];
      const cap = curat(body.capitol, 160).toLowerCase();
      if (cap) fisiere = fisiere.filter((f) => String(f.capitol || '').toLowerCase().includes(cap));
      return res.status(200).json({ setup: true, fisiere, capitole: capitoleSite() });
    }

    if (action === 'salveaza') {
      // PDF-ul e deja în folderul adminului (încărcat din browser) — doar acolo
      const path = String(body.path || '');
      if (!path.startsWith(`${userId}/${FOLDER}/`) || !/\.pdf$/i.test(path) || path.includes('..')) {
        return res.status(400).json({ error: 'Fișierul încărcat nu a fost găsit în folderul fișierelor model.' });
      }
      const sursa = SURSE.includes(body.sursa) ? body.sursa : 'pdf';
      let text = String(body.text || '').slice(0, TEXT_MAX);
      let textSursa = text ? (sursa === 'docx' ? 'word' : sursa === 'foto' ? 'transcriere' : 'pdf') : null;
      if (!text.trim()) {
        // PDF-urile (și ce n-a adus text din browser): textul, pe server
        try {
          const { data: blob, error } = await supa.storage.from(BUCKET).download(path);
          if (error || !blob) throw new Error(error ? error.message : 'fișier lipsă');
          const r = await pdfContext.pdfBufferText(Buffer.from(await blob.arrayBuffer()), TEXT_MAX);
          text = r.full ? r.full.slice(0, TEXT_MAX) : '';
          textSursa = text ? 'pdf' : 'fara';
        } catch (e) {
          if (/not found|lipsă/i.test(String(e.message))) return res.status(400).json({ error: 'Fișierul încărcat nu a fost găsit în bucket.' });
          textSursa = 'fara';
        }
      }
      const row = cuCapitolId({
        ...etichete(body),
        file_path: path, bucket: BUCKET, sursa,
        nume_original: curat(body.numeOriginal, 200) || null,
        pagini: Number.isInteger(Number(body.pagini)) ? Number(body.pagini) : null,
        octeti: Number.isInteger(Number(body.octeti)) ? Number(body.octeti) : null,
        text, text_sursa: textSursa || 'fara',
        status: 'neprocesat', uploaded_by: userId,
      });
      if (!row.titlu) row.titlu = row.nume_original || 'Fișier model';
      const { data, error } = await supa.from(TABLE).insert(row).select(LIST_COLS).single();
      if (error) {
        if (lipsaTabela(error)) return res.status(503).json({ error: SETUP_HINT });
        throw eroare(500, `Fișierul model nu s-a putut salva (${error.message}).`);
      }
      return res.status(200).json({ fisier: data });
    }

    if (action === 'actualizeaza') {
      const cur = await citeste(supa, String(body.id || ''));
      const patch = etichete(body, { partial: true });
      const next = cuCapitolId({ ...cur, ...patch });
      if (!next.titlu) throw eroare(400, 'Titlul nu poate fi gol.');
      const { data, error } = await supa.from(TABLE)
        .update({ ...patch, capitol_id: next.capitol_id, updated_at: new Date().toISOString() })
        .eq('id', cur.id).select(LIST_COLS).single();
      if (error) throw eroare(500, error.message);
      return res.status(200).json({ fisier: data });
    }

    if (action === 'sterge') {
      const cur = await citeste(supa, String(body.id || ''));
      const { error } = await supa.from(TABLE).delete().eq('id', cur.id);
      if (error) throw eroare(500, error.message);
      try { await supa.storage.from(cur.bucket || BUCKET).remove([cur.file_path]); } catch { /* rămâne un fișier orfan, fără rând */ }
      return res.status(200).json({ ok: true });
    }

    if (action === 'url') {
      const cur = await citeste(supa, String(body.id || ''));
      const { data, error } = await supa.storage.from(cur.bucket || BUCKET).createSignedUrl(cur.file_path, 600);
      if (error || !data) throw eroare(404, 'PDF-ul nu mai există în bucket.');
      return res.status(200).json({ url: data.signedUrl });
    }

    if (action === 'text') {
      const { data, error } = await supa.from(TABLE).select('id, text').eq('id', String(body.id || '')).maybeSingle();
      if (error) throw lipsaTabela(error) ? eroare(503, SETUP_HINT) : eroare(500, error.message);
      if (!data) throw eroare(404, 'Fișierul model nu a fost găsit.');
      return res.status(200).json({ text: data.text || '' });
    }

    return res.status(400).json({ error: 'Acțiune necunoscută.' });
  } catch (err) {
    if (!err.status || err.status >= 500) console.error('fisiere-model error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};

module.exports.etichete = etichete;
module.exports.examenAsociat = examenAsociat;
module.exports.capitoleSite = capitoleSite;
module.exports.FOLDER = FOLDER;
