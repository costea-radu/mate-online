// =====================================================================
// src/components/ExamGenerator.jsx — generator de subiecte de examen (PDF)
// Reutilizat în pagina „Profesor Virtual" și în widgetul plutitor.
// prop compact=true → stil mic (widget). prop canManage=true (profesor) →
// permite EDITAREA subiectului și PUBLICAREA în „Biblioteca utilizatorilor".
// =====================================================================
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';
import { printExam } from '../lib/examPrint';
import { supabase } from '../lib/supabase';
import { authHeaders } from '../lib/api';
import { combineExamPdfs, fetchPdfSources, stratifyBySubcategory, probeExamPdf } from '../lib/pdfCombine';
import CapitolePicker from './CapitolePicker';
import { capitoleForExamType } from '../lib/capitole';

// separarea STRICTĂ a categoriilor: fiecare tip de examen combină doar propriile subiecte
// (exportat: rubrica Simulări din /meditatii îl folosește la „Alege PDF din baza de date")
export const EXAM_SOURCES = {
  'evaluare-nationala': { category: 'evaluare-nationala', profile: null },
  'bac-tehnologic': { category: 'bacalaureat', profile: 'tehnologic' },
  'bac-stiinte': { category: 'bacalaureat', profile: 'stiinte-naturii' },
  'bac-mate-info': { category: 'bacalaureat', profile: 'mate-info' },
};

export const EXAM_TYPES = [
  { id: 'evaluare-nationala', label: 'Evaluare Națională', desc: 'Matematică · clasa a VIII-a' },
  { id: 'bac-tehnologic', label: 'BAC · Tehnologic', desc: 'M_tehnologic' },
  { id: 'bac-stiinte', label: 'BAC · Științele Naturii', desc: 'M_științele-naturii' },
  { id: 'bac-mate-info', label: 'BAC · Mate-Info', desc: 'M_mate-info' },
];

export default function ExamGenerator({ compact = false, canManage = false }) {
  const [examType, setExamType] = useState('evaluare-nationala');
  const [exam, setExam] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [upsell, setUpsell] = useState(false);
  const [editing, setEditing] = useState(false);
  const [publishMsg, setPublishMsg] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [chapters, setChapters] = useState([]); // capitolele alese (id-uri din programa clasei/examenului)
  const [dataMode, setDataMode] = useState('keep');
  const chapterOptions = capitoleForExamType(examType);
  // la schimbarea tipului de examen, capitolele alese rămân doar dacă există și în noua programă
  const pickExamType = (id) => { setExamType(id); setChapters((c) => c.filter((x) => capitoleForExamType(id).some((o) => o.id === x))); };
  const chapterTitles = () => chapters.map((id) => chapterOptions.find((o) => o.id === id)?.title).filter(Boolean);
  const [combining, setCombining] = useState(false);
  const [combineMsg, setCombineMsg] = useState(null);
  const [combineReport, setCombineReport] = useState(null);

  async function gen() {
    setLoading(true); setError(null); setUpsell(false); setExam(null); setEditing(false); setPublishMsg(null); setCombineMsg(null); setCombineReport(null);
    try {
      const res = await aiClient.generateExam({ examType, instructions, dataMode, chapters: chapterTitles() });
      setExam(res.exam);
      if (Array.isArray(res.combinedFrom) && res.combinedFrom.length) {
        setCombineMsg('✅ Itemii au fost combinați din: ' + res.combinedFrom.join('; ') + '.');
      }
      try { await aiClient.saveLibraryItem({ kind: 'exam', title: res.exam.title, category: examType, payload: { exam: res.exam } }); } catch { /* ignore */ }
    } catch (e) { setError(e.message); if (e.premium) setUpsell(true); }
    finally { setLoading(false); }
  }

  // ── COMBINARE EXACTĂ (vectorială): exercițiile sunt decupate din PDF-urile
  //    reale ale categoriei (antrenament / variante date / simulări) și
  //    recompuse fără AI — redactare identică, zero greșeli. ──
  async function getUrlFor(row) {
    if (row.is_free) return row.file_url;
    const res = await fetch('/api/get-file-url', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ contentId: row.id }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'URL indisponibil');
    return d.url;
  }
  async function combineExact() {
    setCombining(true); setError(null); setUpsell(false); setCombineReport(null);
    setCombineMsg('Caut subiectele-sursă ale categoriei…');
    try {
      const cfgS = EXAM_SOURCES[examType];
      // ordonat + limită mare: interogarea veche lua un eșantion NESORTAT de 60
      // de rânduri, în care Variantele Date lipseau des → combina doar Simulări
      let q = supabase.from('content').select('id, title, file_url, is_free, subcategory')
        .eq('content_type', 'pdf').eq('category', cfgS.category)
        .order('created_at', { ascending: false }).limit(300);
      if (cfgS.profile) q = q.eq('profile', cfgS.profile);
      const { data } = await q;
      const rows = (data || []).filter((r) => (r.subcategory || '') !== 'bareme');
      if (rows.length < 2) throw new Error('Categoria are prea puține subiecte PDF (minim 2 dintre: simulări, variante date + modele, exerciții pe subiecte, capitole).');
      // stratificat: câte un subiect din FIECARE subcategorie (Simulări, Variante
      // Date + Modele, Exerciții pe Subiecte…), cu verificarea structurii: dacă un
      // PDF nu poate fi folosit (scanat / fără structură), se ia URMĂTORUL din
      // aceeași subcategorie — mixul e garantat, nu mai rămân doar Simulările.
      const sources = await fetchPdfSources(stratifyBySubcategory(rows), getUrlFor, { max: 5, onProgress: setCombineMsg, ordered: true, probe: probeExamPdf });
      if (sources.length < 2) throw new Error('Nu am putut descărca suficiente subiecte-sursă cu structură de examen.');
      const r = await combineExamPdfs(sources, { onProgress: setCombineMsg });
      const blob = new Blob([r.bytes.buffer ? r.bytes : new Uint8Array(r.bytes)], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `subiect_combinat_${examType}.pdf`; a.click(); URL.revokeObjectURL(a.href);
      // salvăm și în „Testele și exercițiile mele”. PDF-ul merge în Storage
      // (bucket privat), nu ca base64 în tabel — API-ul Supabase respingea
      // cererile JSON mari (eroare 413), de aceea subiectele „nu se salvau”.
      let saved = '';
      try {
        await aiClient.savePdfLibraryItem({
          title: `Subiect combinat · ${EXAM_TYPES.find((t) => t.id === examType)?.label || examType}`,
          category: examType, blob, sources: r.sources,
        });
        saved = ' Salvat și în „Testele și exercițiile mele”.';
      } catch (e) { saved = ' (Nu s-a putut salva în „Testele și exercițiile mele”: ' + (e?.message || 'eroare') + ')'; }
      setCombineMsg('✅ Subiect nou descărcat — exerciții combinate din: ' + r.sources.join('; ') + '. Redactare identică cu originalele (fără AI).' + saved);
      setCombineReport(r.report);
    } catch (e) { setError(e.message); setCombineMsg(null); }
    finally { setCombining(false); }
  }

  function patchItem(si, ii, patch) {
    setExam((ex) => { const c = structuredClone(ex); c.subjects[si].items[ii] = { ...c.subjects[si].items[ii], ...patch }; return c; });
  }
  function patchOption(si, ii, oi, val) {
    setExam((ex) => { const c = structuredClone(ex); c.subjects[si].items[ii].options[oi] = val; return c; });
  }
  function patchPart(si, ii, pi, patch) {
    setExam((ex) => { const c = structuredClone(ex); c.subjects[si].items[ii].parts[pi] = { ...c.subjects[si].items[ii].parts[pi], ...patch }; return c; });
  }
  function addItem(si) {
    setExam((ex) => { const c = structuredClone(ex); const items = c.subjects[si].items; items.push({ number: String(items.length + 1), statement: 'Enunț nou', options: ['', '', '', ''], answer: 'a', solution: '' }); return c; });
  }
  function delItem(si, ii) {
    setExam((ex) => { const c = structuredClone(ex); c.subjects[si].items.splice(ii, 1); return c; });
  }

  async function publish() {
    if (!exam) return;
    setPublishing(true); setPublishMsg(null);
    try {
      const r = await aiClient.publicPublish({ kind: 'exam', title: exam.title, category: examType, topic: null, payload: { exam } });
      setPublishMsg('✅ Publicat ca „' + (r?.title || exam.title) + '" în „Biblioteca utilizatorilor".');
    } catch (e) { setPublishMsg('Eroare: ' + e.message); }
    finally { setPublishing(false); }
  }

  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg, 14px)', padding: compact ? 12 : 20, marginBottom: compact ? 12 : 18 };
  const ta = { width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', fontSize: '.82rem', fontFamily: 'var(--font-body)', marginTop: 3, resize: 'vertical' };
  const totalItems = exam ? (exam.subjects || []).reduce((a, s) => a + (s.items?.length || 0), 0) : 0;

  return (
    <div>
      <div style={card}>
        <p style={{ color: 'var(--text-light)', fontSize: compact ? '.82rem' : '.9rem', marginBottom: 12 }}>
          Generează un <strong>model de subiect</strong> după structura oficială, în format PDF. Construit din exercițiile de pe site — material de pregătire, nu subiect oficial.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(auto-fit,minmax(180px,1fr))', gap: 8, marginBottom: 14 }}>
          {EXAM_TYPES.map((t) => (
            <button key={t.id} onClick={() => pickExamType(t.id)}
              style={{ textAlign: 'left', padding: compact ? '8px 10px' : '12px 14px', borderRadius: 10, cursor: 'pointer', border: '2px solid', borderColor: examType === t.id ? 'var(--gold)' : 'var(--border)', background: examType === t.id ? 'rgba(232,185,49,.1)' : '#fff' }}>
              <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: compact ? '.8rem' : '.92rem' }}>{t.label}</div>
              <div style={{ fontSize: compact ? '.68rem' : '.76rem', color: 'var(--text-muted)' }}>{t.desc}</div>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, fontSize: compact ? '.78rem' : '.85rem', color: 'var(--text-light)' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
            <input type="radio" checked={dataMode === 'keep'} onChange={() => setDataMode('keep')} style={{ marginTop: 3 }} />
            <span><strong>Păstrează datele problemelor</strong> — combinare exactă, fără AI, cu mix garantat din Simulări + Variante Date + Modele + celelalte subiecte ale categoriei (redactare identică, zero greșeli)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
            <input type="radio" checked={dataMode === 'modify'} onChange={() => setDataMode('modify')} style={{ marginTop: 3 }} />
            <span><strong>Modifică numerele și notațiile</strong> — cu AI (verifică problemele — poate greși!)</span>
          </label>
        </div>
        {dataMode === 'modify' && (
          <div style={{ marginBottom: 4 }}>
            <CapitolePicker
              options={chapterOptions} selected={chapters} onChange={setChapters}
              extraText={instructions} onExtraText={setInstructions}
              label="Doar din anumite capitole (opțional) — gol = toată programa"
              extraLabel="Alt capitol (dacă lipsește din listă) sau alte indicații pentru AI (opțional)"
              extraPlaceholder="ex: pune accent pe geometrie; Subiectul III mai ușor; capitolul „Ecuații cu modul”…"
              hint="Subiectul păstrează structura oficială (subiecte, punctaje), dar itemii vin DOAR din capitolele alese. Selecția de capitole funcționează la generarea cu AI; „combinarea exactă” de mai sus folosește subiectele întregi ale site-ului."
            />
          </div>
        )}
        {dataMode === 'keep' ? (
          <button className="btn btn-primary" onClick={combineExact} disabled={combining} style={compact ? { width: '100%' } : undefined}>
            {combining ? 'Combin subiectele…' : '📎 Combină exact din subiectele site-ului (PDF)'}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={gen} disabled={loading} style={compact ? { width: '100%' } : undefined}>
            {loading ? 'Se generează... (~30s)' : '✨ Generează subiectul (AI)'}
          </button>
        )}
        {combineMsg && <div style={{ marginTop: 10, fontSize: '.85rem', color: combineMsg.startsWith('✅') ? '#1e7e34' : 'var(--text-muted)' }}>{combineMsg}</div>}
        {combineReport && (
          <details style={{ marginTop: 6, fontSize: '.78rem', color: 'var(--text-muted)' }}>
            <summary>Vezi de unde vine fiecare exercițiu</summary>
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{combineReport.join('\n')}</div>
          </details>
        )}
      </div>

      {error && <div style={{ ...card, background: '#fdecea', color: '#b71c1c', borderColor: '#f5c6cb' }}>⚠️ {error}</div>}
      {upsell && (
        <div style={{ ...card, background: '#fff4e5', borderColor: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--navy)', fontWeight: 600, fontSize: '.85rem' }}>🔒 Generatorul de subiecte face parte din abonament.</span>
          <Link to="/preturi" className="btn btn-primary btn-sm">Abonează-te →</Link>
        </div>
      )}

      {exam && (
        <div style={card}>
          <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 4, fontSize: compact ? '1rem' : undefined }}>{exam.title}</h3>
          <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
            {exam.durationMin} min · {exam.totalPoints} puncte ({exam.oficiu} oficiu) · {(exam.subjects || []).length} subiecte · {totalItems} itemi
          </div>

          {canManage && editing && (
            <div style={{ marginBottom: 16, maxHeight: 420, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
              {(exam.subjects || []).map((s, si) => (
                <div key={si} style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.85rem', marginBottom: 6 }}>{s.label}</div>
                  {(s.items || []).map((it, ii) => (
                    <div key={ii} style={{ padding: 8, background: '#f7f9fc', borderRadius: 8, marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <span style={{ fontSize: '.72rem', color: 'var(--text-muted)', fontWeight: 700 }}>Item {it.number}</span>
                        <button onClick={() => delItem(si, ii)} style={{ background: 'none', border: '1px solid #f5c6cb', color: '#c0392b', borderRadius: 6, padding: '1px 7px', fontSize: '.72rem', cursor: 'pointer' }}>🗑</button>
                      </div>
                      <label style={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>Enunț
                        <textarea rows={2} value={it.statement || ''} onChange={(e) => patchItem(si, ii, { statement: e.target.value })} style={ta} />
                      </label>
                      {Array.isArray(it.options) && it.options.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          {it.options.map((o, oi) => (
                            <input key={oi} value={o} onChange={(e) => patchOption(si, ii, oi, e.target.value)} placeholder={`Varianta ${String.fromCharCode(97 + oi)})`} style={{ ...ta, marginTop: 2 }} />
                          ))}
                          <input value={it.answer || ''} onChange={(e) => patchItem(si, ii, { answer: e.target.value })} placeholder="Răspuns corect (litera: a/b/c/d)" style={{ ...ta, marginTop: 2 }} />
                        </div>
                      )}
                      {Array.isArray(it.parts) && it.parts.length > 0 ? (
                        it.parts.map((p, pi) => (
                          <div key={pi} style={{ marginTop: 4 }}>
                            <textarea rows={1} value={p.text || ''} onChange={(e) => patchPart(si, ii, pi, { text: e.target.value })} placeholder={`Cerința ${p.label})`} style={ta} />
                            <textarea rows={2} value={p.solution || ''} onChange={(e) => patchPart(si, ii, pi, { solution: e.target.value })} placeholder={`Rezolvare ${p.label})`} style={ta} />
                          </div>
                        ))
                      ) : (!it.options && (
                        <textarea rows={2} value={it.solution || ''} onChange={(e) => patchItem(si, ii, { solution: e.target.value })} placeholder="Rezolvare / răspuns" style={ta} />
                      ))}
                    </div>
                  ))}
                  <button className="btn btn-sm btn-outline" onClick={() => addItem(si)}>➕ Adaugă item la {s.label}</button>
                </div>
              ))}
            </div>
          )}

          {!compact && !editing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {(exam.subjects || []).map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', background: '#f7f9fc', borderRadius: 8, fontSize: '.85rem' }}>
                  <strong style={{ color: 'var(--navy)' }}>{s.label}</strong>
                  <span style={{ color: 'var(--text-muted)' }}>{s.items?.length || 0} itemi · {s.points} puncte</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={() => printExam(exam, { withSolutions: false })}>📄 Varianta elev (PDF)</button>
            <button className="btn btn-outline btn-sm" onClick={() => printExam(exam, { withSolutions: true })}>📝 Barem (PDF)</button>
            {canManage && <button className="btn btn-outline btn-sm" onClick={() => setEditing((e) => !e)}>{editing ? '✓ Gata editarea' : '✏️ Editează'}</button>}
            {canManage && <button className="btn btn-outline btn-sm" onClick={publish} disabled={publishing}>{publishing ? 'Se publică...' : '🏛️ Publică'}</button>}
            <button className="btn btn-outline btn-sm" onClick={gen} disabled={loading}>🔄 Alt subiect</button>
          </div>
          {publishMsg && <div style={{ marginTop: 8, fontSize: '.82rem', color: publishMsg.startsWith('✅') ? '#1e7e34' : '#b71c1c' }}>{publishMsg}</div>}
          <p style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 10 }}>
            {canManage ? 'Poți edita enunțurile și răspunsurile, apoi salva ca PDF sau publica pentru toți elevii. ' : ''}Se deschide într-o filă nouă; apasă „Printează / Salvează ca PDF".
          </p>
        </div>
      )}
    </div>
  );
}
