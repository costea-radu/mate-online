// =====================================================================
// src/components/AdminFisiereModel.jsx — Admin → „📤 Fișiere model" (15 nov. 2026)
//
// Cererea: „Creează o filă nouă în Admin, «📤 Fișiere model», unde pot încărca poze,
// PDF sau Word cu exerciții-model: 1. reutilizează conversia existentă (materialPdf.js)
// (…) 2. extrage textul (formulele ca LaTeX, cu mathmlTex.js la Word; transcriere AI la
// poze) 3. la încărcare, cere: clasa (a V-a…a XII-a) sau examenul (EN / BAC + profil),
// capitolul/tema (text liber, dar propune din capitolele deja existente pe site), tipul
// de exercițiu (grilă / redactare / mixt), opțional exercițiul de examen pe care îl
// ilustrează (…) 5. listă în Admin cu filtrare (clasă/capitol/stare), redenumire
// etichete, ștergere. Fișierele model NU se publică nicăieri automat."
//
//   · conversia: src/lib/materialPdf.js (aceeași ca la „📤 Încarcă material"): PDF-ul
//     rămâne cum e, Word-ul și pozele devin PDF în browser; textul Word-ului vine cu
//     formulele ca LaTeX (mathmlTex.js), pozele se transcriu (api/ai-public.js →
//     transcribe), PDF-urile își dau textul pe server (pdf-parse);
//   · fișierul: bucketul privat personal-pdfs, folderul adminului
//     (<id>/fisiere-model/…) — nu Biblioteca utilizatorilor, nu site-ul;
//   · rândul: admin_model_files (api/fisiere-model.js, supabase/fisiere_model.sql).
// =====================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiPost, getValidSession } from '../lib/api';
import { supabase } from '../lib/supabase';
import { aiClient } from '../lib/aiClient';
import { detectMaterial, titleFromFile, prepareMaterial, transcribeBatches, fmtMb, MAX_FILE_MB, MAX_PHOTOS } from '../lib/materialPdf';

const CLASE = [5, 6, 7, 8, 9, 10, 11, 12];
const ROMAN = { 5: 'a V-a', 6: 'a VI-a', 7: 'a VII-a', 8: 'a VIII-a', 9: 'a IX-a', 10: 'a X-a', 11: 'a XI-a', 12: 'a XII-a' };
const EXAMENE = [{ id: 'evaluare-nationala', label: 'Evaluarea Națională', scurt: 'EN' }, { id: 'bacalaureat', label: 'Bacalaureat', scurt: 'BAC' }];
const PROFILE = [{ id: '', label: '— orice profil —' }, { id: 'mate-info', label: 'Mate-Info (M1)' }, { id: 'stiinte-naturii', label: 'Științele Naturii (M2)' }, { id: 'tehnologic', label: 'Tehnologic (M3)' }];
const TIPURI = [{ id: 'grila', label: 'Grilă' }, { id: 'redactare', label: 'Redactare' }, { id: 'mixt', label: 'Mixt' }];
const SURSA = { pdf: '📄 PDF', docx: '📝 Word', foto: '📷 poze' };
const SUB_ROMAN = { 1: 'I', 2: 'al II-lea', 3: 'al III-lea' };
const scurtEx = (e) => (EXAMENE.find((x) => x.id === e) || {}).scurt || e;

// eticheta exercițiului de examen: „EN Subiectul I exercițiul 3"
export function etichetaExamen(ea) {
  if (!ea || !ea.examen || !ea.subiect) return '';
  return `${scurtEx(ea.examen)} Subiectul ${SUB_ROMAN[ea.subiect]}${ea.exercitiu ? ` exercițiul ${ea.exercitiu}` : ''}`;
}
const tintaText = (f) => (f.examen ? `${scurtEx(f.examen)}${f.profil ? ` · ${(PROFILE.find((p) => p.id === f.profil) || {}).label || f.profil}` : ''}` : f.clasa ? `Clasa ${ROMAN[f.clasa]}` : '—');
const categoria = (t) => (t.tip === 'examen' ? t.examen : `clasa-${t.clasa}`);
const ziua = (iso) => { try { return new Date(iso).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };

const FORM0 = { titlu: '', tip: 'clasa', clasa: '6', examen: 'evaluare-nationala', profil: '', capitol: '', tipEx: 'mixt', eaExamen: '', eaSubiect: '1', eaExercitiu: '' };

// formularul etichetelor (la încărcare și la editare)
function Etichete({ f, set, capitole, s, idCap }) {
  const lista = capitole[categoria(f)] || [];
  const ea = f.eaExamen ? { examen: f.eaExamen, subiect: Number(f.eaSubiect), exercitiu: f.eaExercitiu ? Number(f.eaExercitiu) : null } : null;
  return (
    <>
      <div style={s.formGroup}>
        <label style={s.label}>Titlu (etichetă)</label>
        <input style={s.input} value={f.titlu} onChange={(e) => set({ titlu: e.target.value })} placeholder="ex. Numere întregi — exerciții model" />
      </div>
      <div style={s.formRow}>
        <div style={s.formGroup}>
          <label style={s.label}>Pentru</label>
          <div className="afm-seg" role="radiogroup" aria-label="Clasă sau examen">
            <button type="button" className={f.tip === 'clasa' ? 'on' : ''} onClick={() => set({ tip: 'clasa' })}>Clasă</button>
            <button type="button" className={f.tip === 'examen' ? 'on' : ''} onClick={() => set({ tip: 'examen' })}>Examen</button>
          </div>
        </div>
        {f.tip === 'clasa' ? (
          <div style={s.formGroup}>
            <label style={s.label}>Clasa</label>
            <select style={s.select} value={f.clasa} onChange={(e) => set({ clasa: e.target.value })}>
              {CLASE.map((g) => <option key={g} value={g}>Clasa {ROMAN[g]}</option>)}
            </select>
          </div>
        ) : (
          <div style={s.formGroup}>
            <label style={s.label}>Examenul</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select style={{ ...s.select, flex: '1 1 140px' }} value={f.examen} onChange={(e) => set({ examen: e.target.value })}>
                {EXAMENE.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              {f.examen === 'bacalaureat' && (
                <select style={{ ...s.select, flex: '1 1 160px' }} value={f.profil} onChange={(e) => set({ profil: e.target.value })} aria-label="Profilul de BAC">
                  {PROFILE.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              )}
            </div>
          </div>
        )}
      </div>
      <div style={s.formRow}>
        <div style={s.formGroup}>
          <label style={s.label}>Capitolul / tema</label>
          <input style={s.input} value={f.capitol} onChange={(e) => set({ capitol: e.target.value })} list={idCap} placeholder="scrie sau alege din capitolele site-ului" />
          <datalist id={idCap}>{lista.map((c) => <option key={c} value={c} />)}</datalist>
          {lista.length > 0 && (
            <div className="afm-sug" aria-label="Capitolele site-ului">
              {lista.slice(0, 18).map((c) => (
                <button type="button" key={c} className={f.capitol === c ? 'on' : ''} onClick={() => set({ capitol: c })}>{c}</button>
              ))}
            </div>
          )}
        </div>
        <div style={s.formGroup}>
          <label style={s.label}>Tipul exercițiilor</label>
          <div className="afm-seg" role="radiogroup" aria-label="Tipul exercițiilor">
            {TIPURI.map((t) => <button key={t.id} type="button" className={f.tipEx === t.id ? 'on' : ''} onClick={() => set({ tipEx: t.id })}>{t.label}</button>)}
          </div>
        </div>
      </div>
      <div style={s.formGroup}>
        <label style={s.label}>Exercițiul de examen pe care îl ilustrează (opțional)</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select style={{ ...s.select, flex: '1 1 150px', width: 'auto' }} value={f.eaExamen} onChange={(e) => set({ eaExamen: e.target.value })} aria-label="Examenul">
            <option value="">— niciunul —</option>
            {EXAMENE.map((x) => <option key={x.id} value={x.id}>{x.scurt}</option>)}
          </select>
          {f.eaExamen && (
            <>
              <select style={{ ...s.select, flex: '1 1 150px', width: 'auto' }} value={f.eaSubiect} onChange={(e) => set({ eaSubiect: e.target.value })} aria-label="Subiectul">
                {[1, 2, 3].map((k) => <option key={k} value={k}>Subiectul {SUB_ROMAN[k]}</option>)}
              </select>
              <select style={{ ...s.select, flex: '1 1 150px', width: 'auto' }} value={f.eaExercitiu} onChange={(e) => set({ eaExercitiu: e.target.value })} aria-label="Exercițiul">
                <option value="">— tot subiectul —</option>
                {[1, 2, 3, 4, 5, 6].map((k) => <option key={k} value={k}>exercițiul {k}</option>)}
              </select>
            </>
          )}
          {ea && <span className="afm-ea">🎯 {etichetaExamen(ea)}</span>}
        </div>
      </div>
    </>
  );
}

// formular → corpul cererii
function corp(f) {
  return {
    titlu: f.titlu.trim(),
    clasa: f.tip === 'clasa' ? Number(f.clasa) : null,
    examen: f.tip === 'examen' ? f.examen : null,
    profil: f.tip === 'examen' && f.examen === 'bacalaureat' ? (f.profil || null) : null,
    capitol: f.capitol.trim(),
    tip: f.tipEx,
    examenAsociat: f.eaExamen ? { examen: f.eaExamen, subiect: Number(f.eaSubiect), exercitiu: f.eaExercitiu ? Number(f.eaExercitiu) : null } : null,
  };
}
// rândul salvat → formular
function dinRand(r) {
  const ea = r.examen_asociat || null;
  return {
    titlu: r.titlu || '', tip: r.examen ? 'examen' : 'clasa', clasa: String(r.clasa || 6), examen: r.examen || 'evaluare-nationala', profil: r.profil || '',
    capitol: r.capitol || '', tipEx: r.tip_exercitiu || 'mixt',
    eaExamen: (ea && ea.examen) || '', eaSubiect: String((ea && ea.subiect) || 1), eaExercitiu: ea && ea.exercitiu ? String(ea.exercitiu) : '',
  };
}

// ─── încărcarea ──────────────────────────────────────────────────────────────
function Incarca({ s, capitole, onSalvat }) {
  const fileRef = useRef(null);
  const [pick, setPick] = useState(null);       // { kind, files }
  const [f, setF] = useState(FORM0);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [drag, setDrag] = useState(false);
  const set = (p) => setF((x) => ({ ...x, ...p }));

  function alege(list) {
    setMsg(null);
    const d = detectMaterial(list);
    if (d.error) { setPick(null); setMsg({ type: 'error', text: d.error }); return; }
    setPick(d);
    if (!f.titlu.trim()) set({ titlu: titleFromFile(d.files[0]) });
  }
  function reset() { setPick(null); setF((x) => ({ ...FORM0, tip: x.tip, clasa: x.clasa, examen: x.examen, profil: x.profil })); if (fileRef.current) fileRef.current.value = ''; }

  async function salveaza() {
    if (!pick || busy) return;
    const b = corp(f);
    if (b.titlu.length < 2) { setMsg({ type: 'error', text: 'Scrie un titlu (o etichetă) pentru fișier.' }); return; }
    if (!b.capitol) { setMsg({ type: 'error', text: 'Alege sau scrie capitolul / tema.' }); return; }
    setMsg(null);
    let path = null;
    try {
      setBusy(pick.kind === 'docx' ? 'Transform documentul Word în PDF…' : pick.kind === 'foto' ? 'Pun pozele într-un PDF…' : 'Verific PDF-ul…');
      const prep = await prepareMaterial(pick.kind, pick.files, { onProgress: (t) => setBusy(t) });
      if (prep.blob.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`PDF-ul rezultat are ${fmtMb(prep.blob.size)} — peste ${MAX_FILE_MB} MB.`);
      let text = prep.text || '';
      let nota = null;
      if (prep.source === 'foto' && prep.ocrImages?.length) {
        const out = [];
        try {
          for (const lot of transcribeBatches(prep.ocrImages)) {
            setBusy(`Transcriu pozele (${Math.min(out.length + lot.length, prep.ocrImages.length)} din ${prep.ocrImages.length})…`);
            const r = await aiClient.publicTranscribe({ images: lot });
            const got = Array.isArray(r.pages) ? r.pages : [];
            lot.forEach((_, k) => out.push(String(got[k] || '')));
          }
          text = out.filter((x) => x.trim()).join('\n\n');
        } catch (e) { nota = `Textul pozelor nu s-a putut transcrie acum (${e.message}) — fișierul s-a salvat fără text.`; }
      }
      setBusy('Încarc fișierul…');
      const session = await getValidSession();
      const uid = session?.user?.id;
      if (!uid) throw new Error('Sesiune expirată — reautentifică-te.');
      path = `${uid}/fisiere-model/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;
      const { error } = await supabase.storage.from('personal-pdfs').upload(path, prep.blob, { contentType: 'application/pdf', upsert: false });
      if (error) { path = null; throw new Error(`Încărcarea a eșuat (${error.message}).`); }
      setBusy(pick.kind === 'pdf' ? 'Salvez și extrag textul PDF-ului…' : 'Salvez…');
      const r = await apiPost('/api/fisiere-model', {
        action: 'salveaza', path, ...b, text, sursa: prep.source, numeOriginal: prep.fileName || null, pagini: prep.pages || null, octeti: prep.blob.size,
      });
      path = null;
      setMsg({ type: 'success', text: `✅ „${r.fisier.titlu}" e salvat${r.fisier.text_sursa === 'fara' ? ' (fără text — PDF scanat?)' : ''}. Nu se publică nicăieri.${nota ? ` ⚠️ ${nota}` : ''}` });
      reset();
      onSalvat && onSalvat(r.fisier);
    } catch (e) {
      if (path) supabase.storage.from('personal-pdfs').remove([path]).catch(() => {});
      setMsg({ type: 'error', text: e.message || 'Fișierul nu s-a putut salva.' });
    } finally { setBusy(null); }
  }

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>📤 Încarcă un fișier model</div>
      <div style={s.infoBox}>
        Poze, PDF sau Word cu exerciții-model, din care task-urile programate vor genera exerciții noi.
        <b> Nu se publică nicăieri</b> — nici pe site, nici în Biblioteca utilizatorilor.
      </div>
      {msg && <div style={s.alert(msg.type)}>{msg.text}</div>}
      <div
        style={s.uploadZone(drag)}
        onClick={() => !busy && fileRef.current && fileRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) alege(e.dataTransfer.files); }}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current && fileRef.current.click(); } }}
      >
        <div style={{ fontSize: '2rem', marginBottom: 6 }}>{pick ? (pick.kind === 'foto' ? '📷' : pick.kind === 'docx' ? '📝' : '📄') : '📤'}</div>
        {pick ? (
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem' }}>
            {SURSA[pick.kind]}: {pick.files.length === 1 ? pick.files[0].name : `${pick.files.length} poze`}
            <div style={{ fontWeight: 400, color: '#8e95a3', fontSize: '.78rem', marginTop: 2 }}>apasă ca să alegi alt fișier</div>
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '.9rem' }}>Trage aici un PDF, un Word (.docx) sau poze — ori apasă ca să alegi</div>
            <div style={{ color: '#8e95a3', fontSize: '.78rem', marginTop: 4 }}>cel mult {MAX_FILE_MB} MB; până la {MAX_PHOTOS} poze (câte o pagină fiecare)</div>
          </>
        )}
        <input ref={fileRef} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*" multiple hidden onChange={(e) => alege(e.target.files)} />
      </div>
      {pick && (
        <div style={{ marginTop: 18 }}>
          <Etichete f={f} set={set} capitole={capitole} s={s} idCap="afm-cap-nou" />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" style={{ ...s.btnPrimary, opacity: busy ? 0.6 : 1 }} disabled={!!busy} onClick={salveaza}>📤 Salvează fișierul model</button>
            <button type="button" style={s.btnSecondary} disabled={!!busy} onClick={reset}>Renunță</button>
            {busy && <span style={{ fontSize: '.84rem', color: 'var(--text-muted)' }}>⏳ {busy}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── un fișier din listă ─────────────────────────────────────────────────────
function Rand({ r, s, capitole, onSchimbat, onSters }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(() => dinRand(r));
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  async function cere(cheie, body) {
    setBusy(cheie); setErr(null);
    try { return await apiPost('/api/fisiere-model', body); }
    catch (e) { setErr(e.message || 'Eroare.'); return null; }
    finally { setBusy(null); }
  }
  async function salveaza() {
    const x = await cere('edit', { action: 'actualizeaza', id: r.id, ...corp(f) });
    if (x && x.fisier) { onSchimbat(x.fisier); setEdit(false); }
  }
  async function stare() {
    const x = await cere('stare', { action: 'actualizeaza', id: r.id, status: r.status === 'procesat' ? 'neprocesat' : 'procesat' });
    if (x && x.fisier) onSchimbat(x.fisier);
  }
  async function deschide() {
    // fereastra se deschide acum (în clic), adresa vine după
    const w = window.open('about:blank', '_blank');
    const x = await cere('url', { action: 'url', id: r.id });
    if (x && x.url && w) w.location.href = x.url; else if (w) w.close();
  }
  async function sterge() {
    if (!window.confirm(`Ștergi fișierul model „${r.titlu}"? (și PDF-ul lui)`)) return;
    const x = await cere('sterge', { action: 'sterge', id: r.id });
    if (x && x.ok) onSters(r.id);
  }
  const ea = etichetaExamen(r.examen_asociat);
  return (
    <div className={`afm-rand${r.status === 'procesat' ? ' gata' : ''}`}>
      {!edit ? (
        <>
          <div className="afm-r1">
            <b>{r.titlu || 'Fișier model'}</b>
            <span className={`afm-pill ${r.status === 'procesat' ? 'p-gata' : 'p-nou'}`}>{r.status === 'procesat' ? '✓ procesat' : '● neprocesat'}</span>
          </div>
          <div className="afm-r2">
            <span>🎯 {tintaText(r)}</span>
            <span>📚 {r.capitol || '—'}{r.capitol_id ? '' : r.capitol ? ' (capitol nou)' : ''}</span>
            <span>✏️ {(TIPURI.find((t) => t.id === r.tip_exercitiu) || {}).label || r.tip_exercitiu}</span>
            {ea && <span>🧾 {ea}</span>}
          </div>
          <div className="afm-r3">
            {SURSA[r.sursa] || r.sursa}{r.nume_original ? ` · ${r.nume_original}` : ''}{r.pagini ? ` · ${r.pagini} ${r.pagini === 1 ? 'pagină' : 'pagini'}` : ''}
            {' · '}{r.text_sursa === 'fara' ? 'fără text' : `text: ${r.text_sursa === 'word' ? 'din Word (LaTeX)' : r.text_sursa === 'transcriere' ? 'transcris din poze' : 'din PDF'}`}
            {' · '}{ziua(r.uploaded_at)}{r.processed_at ? ` · procesat ${ziua(r.processed_at)}${r.processed_by ? ` (${r.processed_by})` : ''}` : ''}
          </div>
          <div className="afm-act">
            <button type="button" style={s.btnSecondary} disabled={!!busy} onClick={deschide}>👁 PDF</button>
            <button type="button" style={s.btnSecondary} disabled={!!busy} onClick={() => { setF(dinRand(r)); setEdit(true); }}>✏️ Etichete</button>
            <button type="button" style={s.btnSecondary} disabled={!!busy} onClick={stare} title="Starea o schimbă de obicei task-ul care folosește fișierul">
              {r.status === 'procesat' ? '↺ Neprocesat' : '✓ Procesat'}
            </button>
            <button type="button" style={s.btnDanger} disabled={!!busy} onClick={sterge}>🗑 Șterge</button>
            {busy && <span className="afm-lucru">…</span>}
          </div>
        </>
      ) : (
        <>
          <Etichete f={f} set={set} capitole={capitole} s={s} idCap={`afm-cap-${r.id}`} />
          <div className="afm-act">
            <button type="button" style={s.btnPrimary} disabled={!!busy} onClick={salveaza}>{busy === 'edit' ? 'Salvez…' : '✓ Salvează etichetele'}</button>
            <button type="button" style={s.btnSecondary} disabled={!!busy} onClick={() => setEdit(false)}>Renunță</button>
          </div>
        </>
      )}
      {err && <div style={{ ...s.alert('error'), marginTop: 8, marginBottom: 0 }}>{err}</div>}
    </div>
  );
}

// ─── fila ────────────────────────────────────────────────────────────────────
export default function AdminFisiereModel({ s }) {
  const [st, setSt] = useState({ loading: true, setup: true, hint: null, fisiere: [], capitole: {}, err: null });
  const [filtru, setFiltru] = useState({ tinta: '', capitol: '', status: '' });
  const load = useCallback(async () => {
    setSt((x) => ({ ...x, loading: true, err: null }));
    try {
      const r = await apiPost('/api/fisiere-model', { action: 'lista' });
      setSt({ loading: false, setup: r.setup !== false, hint: r.hint || null, fisiere: r.fisiere || [], capitole: r.capitole || {}, err: null });
    } catch (e) { setSt((x) => ({ ...x, loading: false, err: e.message || 'Lista nu s-a putut încărca.' })); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const vazute = useMemo(() => st.fisiere.filter((r) => {
    if (filtru.tinta) {
      if (filtru.tinta.startsWith('clasa-') ? String(r.clasa) !== filtru.tinta.slice(6) : r.examen !== filtru.tinta) return false;
    }
    if (filtru.status && r.status !== filtru.status) return false;
    if (filtru.capitol && !String(r.capitol || '').toLowerCase().includes(filtru.capitol.toLowerCase())) return false;
    return true;
  }), [st.fisiere, filtru]);
  const nr = { total: st.fisiere.length, neprocesat: st.fisiere.filter((r) => r.status !== 'procesat').length };

  return (
    <div className="afm">
      <style>{CSS}</style>
      {!st.setup && <div style={s.alert('error')}>⚙ {st.hint}</div>}
      {st.setup && <Incarca s={s} capitole={st.capitole} onSalvat={(r) => setSt((x) => ({ ...x, fisiere: [r, ...x.fisiere] }))} />}
      <div style={s.card}>
        <div style={{ ...s.cardTitle, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span>📂 Fișierele model</span>
          <span style={{ fontSize: '.82rem', fontFamily: 'var(--font-body)', color: '#8e95a3' }}>{nr.total} · {nr.neprocesat} neprocesate</span>
        </div>
        <div className="afm-filtre">
          <select style={s.select} value={filtru.tinta} onChange={(e) => setFiltru((x) => ({ ...x, tinta: e.target.value }))} aria-label="Filtrează după clasă sau examen">
            <option value="">Toate clasele și examenele</option>
            {CLASE.map((g) => <option key={g} value={`clasa-${g}`}>Clasa {ROMAN[g]}</option>)}
            {EXAMENE.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
          <input style={s.input} value={filtru.capitol} onChange={(e) => setFiltru((x) => ({ ...x, capitol: e.target.value }))} placeholder="capitolul conține…" aria-label="Filtrează după capitol" />
          <select style={s.select} value={filtru.status} onChange={(e) => setFiltru((x) => ({ ...x, status: e.target.value }))} aria-label="Filtrează după stare">
            <option value="">Orice stare</option>
            <option value="neprocesat">Neprocesate</option>
            <option value="procesat">Procesate</option>
          </select>
        </div>
        {st.err && <div style={s.alert('error')}>{st.err} <button type="button" style={s.btnSecondary} onClick={load}>Reîncearcă</button></div>}
        {st.loading ? <div style={{ padding: 20, color: '#8e95a3' }}>Se încarcă…</div>
          : !vazute.length ? <div style={{ padding: '14px 4px', color: '#8e95a3', fontSize: '.88rem' }}>{st.fisiere.length ? 'Niciun fișier la filtrele alese.' : 'Încă niciun fișier model.'}</div>
            : vazute.map((r) => (
              <Rand key={r.id} r={r} s={s} capitole={st.capitole}
                onSchimbat={(n) => setSt((x) => ({ ...x, fisiere: x.fisiere.map((y) => (y.id === n.id ? n : y)) }))}
                onSters={(id) => setSt((x) => ({ ...x, fisiere: x.fisiere.filter((y) => y.id !== id) }))} />
            ))}
      </div>
    </div>
  );
}

const CSS = `
.afm-seg{display:inline-flex;border:1.5px solid #dde1e8;border-radius:8px;overflow:hidden;background:#fafbfc;flex-wrap:wrap}
.afm-seg button{border:none;background:none;padding:9px 14px;font-weight:700;font-size:.86rem;color:var(--navy);cursor:pointer;font-family:var(--font-body)}
.afm-seg button.on{background:var(--navy);color:#fff}
.afm-sug{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.afm-sug button{border:1px solid #dde1e8;background:#fff;border-radius:99px;padding:3px 10px;font-size:.74rem;font-weight:600;color:var(--navy);cursor:pointer;font-family:var(--font-body)}
.afm-sug button.on{background:var(--gold);border-color:var(--gold);color:var(--navy-dark)}
.afm-ea{font-size:.82rem;font-weight:700;color:#6a1b9a;background:#f3e5f5;border-radius:99px;padding:4px 11px}
.afm-filtre{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px}
.afm-rand{border:1.5px solid #eef0f4;border-radius:10px;padding:12px 14px;margin-bottom:10px;display:grid;gap:6px;background:#fff}
.afm-rand.gata{background:#fafbfc}
.afm-r1{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.afm-r1 b{color:var(--navy);font-size:.95rem}
.afm-pill{font-size:.72rem;font-weight:700;border-radius:99px;padding:2px 9px}
.p-nou{background:#fff3e0;color:#e65100}
.p-gata{background:#e8f5e9;color:#2e7d32}
.afm-r2{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:.82rem;color:#5a6170;font-weight:600}
.afm-r3{font-size:.76rem;color:#8e95a3}
.afm-act{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px}
.afm-lucru{font-size:.8rem;color:#8e95a3}
@media (max-width:700px){.afm-filtre{grid-template-columns:1fr}}
`;
