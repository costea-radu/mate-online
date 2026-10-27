// =====================================================================
// src/components/IncarcaMaterial.jsx — „📤 Încarcă material" (profesor / admin)
//
// Profesorul încarcă un PDF, un document Word sau poze cu o fișă / un test; din
// ele se face un PDF (src/lib/materialPdf.js — totul în browser), pe care îl
// poate vedea înainte, și se publică în Biblioteca utilizatorilor (rămâne și în
// „Testele și exercițiile mele"). Acolo se deschide în vizualizator, cu
// Profesorul Virtual alături (/pdf-viewer?lib=<id>).
//   · pozele: textul lor îl transcrie o dată modelul de vedere, la publicare
//     (api/ai-public.js → transcribe), ca profesorul virtual să citească fișa;
//   · Word: textul (cu formulele ca LaTeX) se citește din document, în browser.
// Folosit în „Asistent AI pentru profesori" (ProfesorVirtual.jsx, fila „📤 Încarcă
// material") și în /biblioteca-utilizatorilor.
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { aiClient } from '../lib/aiClient';
import { detectMaterial, titleFromFile, prepareMaterial, transcribeBatches, fmtMb, MAX_PHOTOS, MAX_FILE_MB } from '../lib/materialPdf';

export const CATEGORII_MATERIAL = [
  { id: '', label: '— alege clasa / examenul —' },
  { id: 'clasa-5', label: 'Clasa a V-a' }, { id: 'clasa-6', label: 'Clasa a VI-a' },
  { id: 'clasa-7', label: 'Clasa a VII-a' }, { id: 'clasa-8', label: 'Clasa a VIII-a' },
  { id: 'evaluare-nationala', label: 'Evaluare Națională' }, { id: 'bacalaureat', label: 'Bacalaureat' },
];
const SURSA = { pdf: '📄 PDF', docx: '📝 Word', foto: '📷 poze' };

export default function IncarcaMaterial({ onDone = null, onCancel = null }) {
  const { user, isTeacher, isAdmin } = useAuth();
  const fileRef = useRef(null);
  const [pick, setPick] = useState(null);        // { kind, files }
  const [prep, setPrep] = useState(null);        // { blob, url, pages, source, fileName, text?, pageTexts?, ocrImages? }
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [topic, setTopic] = useState('');
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(null);        // textul pasului în lucru
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);        // avertisment (ex. transcrierea pozelor n-a mers)
  const [done, setDone] = useState(null);        // { publicId, title }
  const [drag, setDrag] = useState(false);

  // PDF-ul pregătit se poate vedea într-o filă nouă — adresa locală se eliberează la schimbare
  useEffect(() => () => { if (prep?.url) URL.revokeObjectURL(prep.url); }, [prep]);

  const allowed = !!user && (isTeacher || isAdmin);
  if (!allowed) {
    return (
      <div style={box}>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '.88rem' }}>
          {user ? 'Încărcarea materialelor în Biblioteca utilizatorilor e disponibilă conturilor de profesor.' : 'Autentifică-te cu un cont de profesor ca să încarci materiale.'}
        </p>
      </div>
    );
  }

  function reset() {
    setPick(null); setPrep(null); setTitle(''); setTopic(''); setRights(false);
    setErr(null); setNote(null); setDone(null); setBusy(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function choose(list) {
    setErr(null); setNote(null); setDone(null); setPrep(null);
    const d = detectMaterial(list);
    if (d.error) { setPick(null); setErr(d.error); return; }
    setPick(d);
    if (!title.trim()) setTitle(titleFromFile(d.files[0]));
    setBusy(d.kind === 'docx' ? 'Transform documentul Word în PDF…' : d.kind === 'foto' ? 'Pun pozele într-un PDF…' : 'Verific PDF-ul…');
    try {
      const r = await prepareMaterial(d.kind, d.files, { onProgress: (t) => setBusy(t) });
      if (r.blob.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`PDF-ul rezultat are ${fmtMb(r.blob.size)} — peste ${MAX_FILE_MB} MB. Încearcă mai puține pagini sau poze.`);
      setPrep({ ...r, url: URL.createObjectURL(r.blob) });
      if (d.kind === 'docx' && !(r.text || '').trim()) setNote('Nu am găsit text în document (poate e doar imagine) — Profesorul Virtual va citi paginile din imagini.');
    } catch (e) {
      setPick(null);
      setErr(e.message || 'Fișierul nu a putut fi pregătit.');
    } finally { setBusy(null); }
  }

  async function publish() {
    if (!prep || busy) return;
    const t = title.trim();
    if (t.length < 3) { setErr('Scrie un titlu pentru material (cel puțin 3 caractere).'); return; }
    if (!rights) { setErr('Bifează confirmarea că ai dreptul să publici acest material.'); return; }
    setErr(null); setNote(null);
    let pageTexts = prep.pageTexts || null;
    let text = prep.text || '';
    // pozele: textul fișei, transcris o dată (în loturi mici — cererea rămâne sub limita serverului)
    if (prep.source === 'foto' && prep.ocrImages?.length) {
      const imgs = prep.ocrImages;
      const out = [];
      try {
        for (const lot of transcribeBatches(imgs)) {
          setBusy(`Citesc textul pozelor pentru Profesorul Virtual (${Math.min(out.length + lot.length, imgs.length)} din ${imgs.length})…`);
          const r = await aiClient.publicTranscribe({ images: lot });
          const got = Array.isArray(r.pages) ? r.pages : [];
          // câte un text pentru fiecare poză din lot — paginile rămân la locul lor
          lot.forEach((_, k) => out.push(String(got[k] || '')));
        }
        pageTexts = out.map((x) => String(x || ''));
        text = pageTexts.filter((x) => x.trim()).join('\n\n');
      } catch (e) {
        // fără text merge și așa: profesorul virtual citește paginile din imagini
        pageTexts = null; text = '';
        setNote(`Textul pozelor nu s-a putut citi acum (${e.message}). Am publicat oricum — Profesorul Virtual va citi paginile din imagini.`);
      }
    }
    setBusy('Încarc și public materialul…');
    try {
      const extra = {
        source: prep.source, fileName: prep.fileName || null, pages: prep.pages || null,
        ...(text ? { text } : {}), ...(pageTexts && pageTexts.some((x) => x.trim()) ? { pageTexts } : {}),
      };
      const r = await aiClient.uploadMaterial({ title: t, category: category || null, topic: topic.trim() || null, blob: prep.blob, extra });
      setDone({ publicId: r.publicId, title: r.title || t });
      onDone && onDone(r);
    } catch (e) {
      setErr(e.message || 'Publicarea nu a reușit.');
    } finally { setBusy(null); }
  }

  if (done) {
    return (
      <div style={{ ...box, border: '1px solid rgba(39,174,96,.45)', background: '#f3fbf5' }}>
        <div style={{ fontWeight: 700, color: '#1e7e34', marginBottom: 6 }}>✅ „{done.title}" e în Biblioteca utilizatorilor</div>
        <p style={{ margin: '0 0 12px', fontSize: '.84rem', color: 'var(--text-light)' }}>
          Se deschide cu Profesorul Virtual alături: elevii îl pot întreba despre exerciții și își pot trimite răspunsurile spre corectare.
          Îl găsești și în „Testele și exercițiile mele".
        </p>
        {note && <p style={{ margin: '0 0 10px', fontSize: '.8rem', color: '#8a6d1a' }}>⚠️ {note}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to={`/pdf-viewer?lib=${done.publicId}`} state={{ returnTo: '/biblioteca-utilizatorilor' }} className="btn btn-primary btn-sm">📄 Deschide cu Profesorul Virtual</Link>
          <button className="btn btn-outline btn-sm" onClick={reset}>➕ Încarcă alt material</button>
          {onCancel && <button className="btn btn-sm" onClick={onCancel}>Închide</button>}
        </div>
      </div>
    );
  }

  return (
    <div style={box}>
      <input ref={fileRef} type="file" multiple
        accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*"
        onChange={(e) => choose(e.target.files)} style={{ display: 'none' }} />
      {/* alegerea fișierului (clic sau tras peste) */}
      <div role="button" tabIndex={0}
        onClick={() => !busy && fileRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); fileRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) choose(e.dataTransfer.files); }}
        style={{
          border: `2px dashed ${drag ? 'var(--gold)' : '#c9d6e3'}`, background: drag ? '#fffbea' : '#f7f9fc',
          borderRadius: 12, padding: '18px 14px', textAlign: 'center', cursor: busy ? 'progress' : 'pointer',
        }}>
        <div style={{ fontSize: '1.6rem', lineHeight: 1 }}>📤</div>
        <div style={{ fontWeight: 700, color: 'var(--navy)', marginTop: 6 }}>
          {pick ? `${SURSA[pick.kind]} · ${pick.files.length === 1 ? pick.files[0].name : `${pick.files.length} poze`}` : 'Alege materialul: PDF, Word (.docx) sau poze'}
        </div>
        <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 3 }}>
          {pick ? 'Clic pentru alt fișier' : `sau trage fișierul aici · cel mult ${MAX_FILE_MB} MB · până la ${MAX_PHOTOS} de poze (câte una pe pagină)`}
        </div>
      </div>

      {busy && <div style={{ marginTop: 10, fontSize: '.84rem', color: 'var(--navy)', display: 'flex', alignItems: 'center', gap: 8 }}><span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> {busy}</div>}

      {prep && !busy && (
        <div style={{ marginTop: 10, padding: '8px 11px', borderRadius: 10, background: '#f0f9f1', border: '1px solid #cfe8d4', fontSize: '.82rem', color: '#1e5a2a', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>✓ PDF pregătit: <strong>{prep.pages ? `${prep.pages} ${prep.pages === 1 ? 'pagină' : 'pagini'}` : 'gata'}</strong> · {fmtMb(prep.blob.size)}</span>
          <a href={prep.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--navy)', fontWeight: 700 }}>👁 Vezi PDF-ul</a>
          {prep.source === 'docx' && <span style={{ color: 'var(--text-muted)', fontSize: '.74rem', flexBasis: '100%' }}>Verifică paginile: formulele făcute cu MathType pot lipsi — atunci salvează din Word ca PDF și încarcă PDF-ul.</span>}
          {prep.source === 'foto' && <span style={{ color: 'var(--text-muted)', fontSize: '.74rem', flexBasis: '100%' }}>La publicare, textul pozelor îl citește o dată Profesorul Virtual (din creditele tale AI), ca să le poată explica elevilor.</span>}
        </div>
      )}

      {pick && (
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <label style={lbl}>Titlul materialului
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="ex. Fișă de lucru — fracții, clasa a V-a" style={inp} />
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ ...lbl, flex: '1 1 200px' }}>Clasa / examenul
              <select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
                {CATEGORII_MATERIAL.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label style={{ ...lbl, flex: '2 1 240px' }}>Tema (opțional)
              <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={80} placeholder="ex. operații cu fracții" style={inp} />
            </label>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '.8rem', color: 'var(--text-light)', cursor: 'pointer' }}>
            <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Confirm că materialul e făcut de mine sau că am dreptul să-l public. Va fi vizibil în Biblioteca utilizatorilor (gratuit sau pentru abonați, după regulile bibliotecii).</span>
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-primary" disabled={!prep || !!busy} onClick={publish}>
              {busy && prep ? '⏳ Se publică…' : '📤 Publică în Biblioteca utilizatorilor'}
            </button>
            <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={reset}>Renunț</button>
            {onCancel && <button className="btn btn-sm" disabled={!!busy} onClick={onCancel}>Închide</button>}
          </div>
        </div>
      )}

      {err && <div role="alert" style={{ marginTop: 10, fontSize: '.84rem', color: '#b71c1c' }}>⚠️ {err}</div>}
      {note && !err && <div style={{ marginTop: 10, fontSize: '.8rem', color: '#8a6d1a' }}>⚠️ {note}</div>}
    </div>
  );
}

const box = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16 };
const lbl = { display: 'grid', gap: 4, fontSize: '.78rem', fontWeight: 700, color: 'var(--navy)' };
const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.92rem', fontWeight: 400, fontFamily: 'var(--font-body)', color: 'var(--text)', background: '#fff' };
