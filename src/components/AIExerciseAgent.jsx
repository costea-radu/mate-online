// =====================================================================
// src/components/AIExerciseAgent.jsx — Agentul Claude de exerciții (admin)
// (1) Încarci FIȘIERUL 1 = exercițiile-model (PDF/HTML) și, opțional,
//     FIȘIERUL 2 = modelul de FORMAT (structura/baremul dorit la rezultat).
// (2) Scrii instrucțiuni în caseta de mesaj (stil Claude) — inclusiv
//     formatul de salvare dorit („salvează ca PDF” / „interactiv”).
// (3) Pe exercițiul generat: Trimite la «Adaugă PDF» / «Adaugă Interactiv»
//     (formularele existente din Admin, precompletate), descărcare pe
//     calculator (HTML sau PDF prin tipărire), Modifică, Șterge.
// =====================================================================
import { useState, useEffect, useRef } from 'react';
import { aiClient } from '../lib/aiClient';
import { supabase } from '../lib/supabase';
import { renderExercise, renderPrintDoc } from '../lib/exerciseRender';

const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', width: '100%', marginTop: 4, boxSizing: 'border-box' };
const ta = { ...inp, fontFamily: 'inherit', resize: 'vertical' };
const lbl = { fontSize: '.82rem', color: 'var(--text-light)' };
const smallBtn = { background: '#f7f9fc', border: '1px solid var(--border)', borderRadius: 7, padding: '4px 9px', fontSize: '.78rem', cursor: 'pointer', fontWeight: 600 };

function slug(s) {
  return String(s || 'exercitiu').toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'exercitiu';
}

export default function AIExerciseAgent({ box }) {
  // Fișierele-model + conversația
  const [modelFile, setModelFile] = useState(null);   // {name, pdf|null, text|null}
  const [formatFile, setFormatFile] = useState(null); // idem — modelul de FORMAT
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState([]);
  const fileRef1 = useRef(null);
  const fileRef2 = useRef(null);

  // Exercițiul curent
  const [ex, setEx] = useState(null);
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [savedMeta, setSavedMeta] = useState(null); // metadatele rândului la re-editare
  const [savedList, setSavedList] = useState([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  async function loadSaved() {
    const { data } = await supabase
      .from('content')
      .select('id, title, category, description, is_free, created_at, interactive_data')
      .eq('content_type', 'interactive')
      .order('created_at', { ascending: false })
      .limit(60);
    setSavedList((data || []).filter((r) => r.interactive_data?.agent === 'claude'));
  }
  useEffect(() => { loadSaved(); }, []);

  // ── Fișierele-model (PDF sau HTML) ─────────────────────────────────
  async function onFile(f, setFileState, ref) {
    setError(null);
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { setError('Fișierul e prea mare (max 3 MB).'); return; }
    if (/\.pdf$/i.test(f.name)) {
      const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = reject;
        fr.readAsDataURL(f);
      });
      setFileState({ name: f.name, pdf: b64, text: null });
    } else if (/\.html?$/i.test(f.name)) {
      const raw = await f.text();
      let text = raw;
      try { text = new DOMParser().parseFromString(raw, 'text/html').body?.innerText || raw; } catch { /* raw */ }
      setFileState({ name: f.name, pdf: null, text: text.slice(0, 20000) });
    } else {
      setError('Acceptăm doar fișiere PDF sau HTML.');
    }
    if (ref?.current) ref.current.value = '';
  }

  function FileSlot({ title, hint, file, setFile, refEl, icon }) {
    return (
      <div style={{ flex: 1, minWidth: 240, border: '2px dashed var(--border)', borderRadius: 12, padding: 12 }}>
        <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>{title}</div>
        <input ref={refEl} type="file" accept=".pdf,.html,.htm" style={{ display: 'none' }}
          onChange={(e) => onFile(e.target.files?.[0], setFile, refEl)} />
        {file ? (
          <div style={{ fontSize: '.85rem', color: 'var(--navy)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {file.pdf ? '📕' : '📄'} {file.name}
            <button onClick={() => setFile(null)} style={{ ...smallBtn, color: '#c0392b', borderColor: '#f5c6cb' }}>✕ scoate</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-outline" onClick={() => refEl.current?.click()} style={{ fontSize: '.82rem' }}>{icon} Alege fișier</button>
            <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{hint}</span>
          </div>
        )}
      </div>
    );
  }

  // ── Generare / conversație ─────────────────────────────────────────
  async function generate() {
    const text = message.trim();
    if (!modelFile && !formatFile && !text && !ex) { setError('Încarcă un fișier-model sau scrie instrucțiuni.'); return; }
    setLoading(true); setError(null); setMsg(null);
    try {
      const r = await aiClient.exerciseAgent({
        instructions: text,
        model: ex ? JSON.stringify(ex) : (modelFile?.text || null),
        modelPdf: modelFile?.pdf || null,
        formatText: formatFile?.text || null,
        formatPdf: formatFile?.pdf || null,
        history: chat.slice(-8),
      });
      setEx(r.exercise); setProvider(r.provider);
      setEditing(false); setSavedId(null); setSavedMeta(null);
      const nItems = r.exercise.kind === 'etape' ? r.exercise.steps.length : r.exercise.questions.length;
      setChat((c) => [...c,
        ...(text ? [{ role: 'user', content: text }] : []),
        { role: 'assistant', content: `Am generat: „${r.exercise.title}” (${nItems} ${r.exercise.kind === 'etape' ? 'etape' : 'întrebări'}, barem ${totalOf(r.exercise)} p). Format sugerat: ${r.exercise.output === 'pdf' ? 'PDF' : 'interactiv'}. Îl poți trimite la «Adaugă PDF» / «Adaugă Interactiv», descărca sau modifica.` },
      ]);
      setMessage('');
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function totalOf(e) {
    const arr = e.kind === 'etape' ? e.steps : e.questions;
    return (arr || []).reduce((s, it) => s + (Number(it.points) || 0), 0);
  }

  // ── Editare completă ───────────────────────────────────────────────
  const items = ex ? (ex.kind === 'etape' ? ex.steps : ex.questions) || [] : [];
  const itemsKey = ex?.kind === 'etape' ? 'steps' : 'questions';
  const totalPoints = items.reduce((s, it) => s + (Number(it.points) || 0), 0);

  function patchEx(patch) { setEx((e) => ({ ...e, ...patch })); }
  function patchItem(i, patch) {
    setEx((e) => {
      const arr = [...(e[itemsKey] || [])];
      arr[i] = { ...arr[i], ...patch };
      return { ...e, [itemsKey]: arr };
    });
  }
  function addItem() {
    const blank = ex.kind === 'etape'
      ? { prompt: 'Etapă nouă — ce se cere?', answer: '', hint: '', explanation: '', points: 10 }
      : { statement: 'Întrebare nouă', options: ['', '', '', ''], answer: 0, hint: '', explanation: '', points: 10 };
    setEx((e) => ({ ...e, [itemsKey]: [...(e[itemsKey] || []), blank] }));
  }
  function delItem(i) { setEx((e) => ({ ...e, [itemsKey]: e[itemsKey].filter((_, j) => j !== i) })); }
  function moveItem(i, dir) {
    setEx((e) => {
      const arr = [...e[itemsKey]]; const j = i + dir;
      if (j < 0 || j >= arr.length) return e;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...e, [itemsKey]: arr };
    });
  }
  function discard() {
    if (!window.confirm('Ștergi exercițiul generat? (fișierele-model și conversația rămân)')) return;
    setEx(null); setEditing(false); setSavedId(null); setSavedMeta(null); setMsg(null);
  }

  // ── Trimitere către formularele existente din Admin ────────────────
  function sendToInteractive() {
    sessionStorage.setItem('agent_prefill_interactive', JSON.stringify({
      form: { title: ex.title, description: `Generat cu agentul Claude · barem ${totalPoints} p`, type: 'exercise' },
      html: renderExercise(ex),
      fileName: `${slug(ex.title)}.html`,
    }));
    window.dispatchEvent(new CustomEvent('admin:goto-tab', { detail: 'interactive' }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function sendToPdf() {
    openPrint(true); // întâi fereastra de tipărire (Salvează ca PDF), în același gest de click
    sessionStorage.setItem('agent_prefill_pdf', JSON.stringify({
      form: { title: ex.title, description: `Generat cu agentul Claude · barem ${totalPoints} p` },
    }));
    window.dispatchEvent(new CustomEvent('admin:goto-tab', { detail: 'pdf' }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Salvare pe calculator ──────────────────────────────────────────
  function downloadHtml() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([renderExercise(ex)], { type: 'text/html' }));
    a.download = `${slug(ex.title)}.html`;
    a.click(); URL.revokeObjectURL(a.href);
  }
  function openPrint(withSolutions) {
    const w = window.open('', '_blank');
    if (!w) { setError('Browserul a blocat fereastra de tipărire — permite pop-up-urile.'); return; }
    w.document.write(renderPrintDoc(ex, { solutions: withSolutions, autoPrint: true }));
    w.document.close();
  }

  // ── Actualizarea unui exercițiu deja încărcat de agent ─────────────
  async function updateSaved() {
    if (!ex || !savedId || !savedMeta) return;
    setSaving(true); setError(null); setMsg(null);
    try {
      const html = renderExercise(ex);
      const bucket = savedMeta.is_free ? 'content-files-free' : 'content-files';
      const path = `interactive/${savedMeta.category}/${Date.now()}_agent_claude.html`;
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, new Blob([html], { type: 'text/html' }), { contentType: 'text/html' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
      const { error: dbErr } = await supabase.from('content').update({
        title: ex.title, file_url: urlData?.publicUrl || path,
        interactive_data: { type: 'exercise', html: true, ai_generated: true, agent: 'claude', exercise: ex },
      }).eq('id', savedId);
      if (dbErr) throw dbErr;
      setMsg('✅ Exercițiu actualizat pe site.');
      loadSaved();
    } catch (e) { setError('Actualizare eșuată: ' + e.message); }
    finally { setSaving(false); }
  }

  function loadForEdit(row) {
    setEx(row.interactive_data.exercise);
    setSavedId(row.id); setSavedMeta({ category: row.category, is_free: !!row.is_free });
    setEditing(true); setMsg(null); setError(null);
  }

  return (
    <div style={{ ...box, marginTop: 18 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 6 }}>
        🤖 Agent Claude — Generator de exerciții
      </h3>
      <p style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 14 }}>
        Fișierul 1 = <strong>exercițiile-model</strong>; fișierul 2 (opțional) = <strong>modelul de format</strong> al rezultatului.
        Poți cere transformări: PDF → interactiv, interactiv → PDF, alte numere, alt tip.
        Formatul de salvare îl poți cere direct în mesaj („salvează ca PDF”).
        {provider && <span style={{ color: 'var(--text-muted)' }}> · model: {provider}</span>}
      </p>

      {/* 1. Fișierele-model */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <FileSlot title="1 · Exercițiile-model (PDF / HTML)" hint="de aici ia exercițiile" icon="📎" file={modelFile} setFile={setModelFile} refEl={fileRef1} />
        <FileSlot title="2 · Modelul de format — opțional" hint="de aici ia structura/baremul" icon="🗂" file={formatFile} setFile={setFormatFile} refEl={fileRef2} />
      </div>

      {/* 2. Conversația cu agentul */}
      {chat.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, maxHeight: 280, overflowY: 'auto', padding: '2px 2px' }}>
          {chat.map((m, i) => m.role === 'user' ? (
            <div key={i} style={{ alignSelf: 'flex-end', background: 'var(--navy)', color: '#fff', borderRadius: '12px 12px 2px 12px', padding: '8px 12px', fontSize: '.85rem', maxWidth: '85%', whiteSpace: 'pre-wrap' }}>{m.content}</div>
          ) : (
            <div key={i} style={{ alignSelf: 'flex-start', background: '#f7f9fc', borderRadius: '12px 12px 12px 2px', padding: '8px 12px', fontSize: '.85rem', maxWidth: '85%' }}>🤖 {m.content}</div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', background: '#fff', border: '1px solid var(--border)', borderRadius: 14, padding: 10 }}>
        <textarea value={message} rows={3}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!loading) generate(); } }}
          placeholder={ex
            ? 'Continuă să-i dai indicații… (ex: „fă-l mai greu”, „transformă-l în grilă”, „salvează ca PDF”)'
            : 'Descrie ce vrei să genereze… (ex: „test de 90 min după modelul din fișierul 1, în formatul din fișierul 2, cu alte numere, salvat ca PDF”)'}
          style={{ flex: 1, border: 'none', outline: 'none', resize: 'none', fontSize: '.9rem', fontFamily: 'inherit', lineHeight: 1.5, background: 'transparent' }} />
        <button onClick={generate} disabled={loading} title="Generează (Enter)"
          style={{ background: 'var(--gold, #e8b931)', color: 'var(--navy, #0f2b44)', border: 'none', borderRadius: 10, width: 42, height: 42, fontSize: '1.2rem', fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
          {loading ? '…' : '↑'}
        </button>
      </div>
      <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 4 }}>Enter = generează · Shift+Enter = rând nou {loading && ' · agentul lucrează (~20-40s)…'}</div>

      {error && <div style={{ marginTop: 12, padding: 12, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem' }}>⚠️ {error}</div>}
      {msg && <div style={{ marginTop: 12, padding: 12, background: 'rgba(39,174,96,.1)', color: '#1e7e34', borderRadius: 8, fontSize: '.85rem' }}>{msg}</div>}

      {/* 3. Exercițiul generat */}
      {ex && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
              {editing ? '✏️ Mod editare' : '👁 Previzualizare'} · barem {totalPoints} p · {items.length} {ex.kind === 'etape' ? 'etape' : 'întrebări'}
              {ex.output === 'pdf' && !editing && <span style={{ marginLeft: 8, fontSize: '.75rem', background: '#fff4e5', color: '#8a6d00', borderRadius: 20, padding: '2px 10px' }}>sugerat: PDF</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {editing ? (
                <button className="btn btn-primary" onClick={() => setEditing(false)}>✅ Finalizare</button>
              ) : (
                <>
                  {savedId && <button className="btn btn-primary" onClick={updateSaved} disabled={saving}>{saving ? 'Se salvează…' : '💾 Actualizează pe site'}</button>}
                  <button className="btn btn-outline" onClick={() => setEditing(true)}>✏️ Modifică</button>
                  <button className="btn btn-outline" onClick={discard} style={{ color: '#c0392b', borderColor: '#f5c6cb' }}>🗑 Șterge</button>
                </>
              )}
            </div>
          </div>

          {/* Plasare pe site + salvare pe calculator */}
          {!editing && (
            <div style={{ border: '1px solid var(--gold, #e8b931)', background: '#fffdf5', borderRadius: 12, padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)' }}>Pune pe site:</span>
              <button className="btn btn-primary" onClick={sendToInteractive} style={{ fontSize: '.85rem' }}>🧩 Trimite la «Adaugă Interactiv»</button>
              <button className="btn btn-primary" onClick={sendToPdf} style={{ fontSize: '.85rem' }}>📄 Trimite la «Adaugă PDF»</button>
              <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)', marginLeft: 8 }}>Salvează pe calculator:</span>
              <button className="btn btn-outline" onClick={downloadHtml} style={{ fontSize: '.82rem' }}>⬇️ HTML interactiv</button>
              <button className="btn btn-outline" onClick={() => openPrint(true)} style={{ fontSize: '.82rem' }}>🖨 PDF cu barem</button>
              <button className="btn btn-outline" onClick={() => openPrint(false)} style={{ fontSize: '.82rem' }}>🖨 PDF fără barem</button>
            </div>
          )}

          {editing ? (
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <label style={lbl}>Titlu
                <input value={ex.title || ''} onChange={(e) => patchEx({ title: e.target.value })} style={{ ...inp, marginBottom: 10 }} />
              </label>
              <label style={lbl}>{ex.kind === 'etape' ? 'Enunțul problemei' : 'Context general (opțional)'}
                <textarea value={ex.statement || ''} onChange={(e) => patchEx({ statement: e.target.value })} rows={3} style={{ ...ta, marginBottom: 12 }} />
              </label>

              {items.map((it, i) => (
                <div key={i} style={{ background: '#f7f9fc', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <b style={{ fontSize: '.88rem', color: 'var(--navy)' }}>{ex.kind === 'etape' ? `Etapa ${i + 1}` : `Întrebarea ${i + 1}`}</b>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <button style={smallBtn} onClick={() => moveItem(i, -1)} title="Mută sus">↑</button>
                      <button style={smallBtn} onClick={() => moveItem(i, 1)} title="Mută jos">↓</button>
                      <button style={{ ...smallBtn, color: '#c0392b', borderColor: '#f5c6cb' }} onClick={() => delItem(i)}>🗑 Șterge</button>
                    </span>
                  </div>

                  <label style={lbl}>{ex.kind === 'etape' ? 'Cerința etapei' : 'Enunț'}
                    <textarea value={ex.kind === 'etape' ? it.prompt : it.statement}
                      onChange={(e) => patchItem(i, ex.kind === 'etape' ? { prompt: e.target.value } : { statement: e.target.value })}
                      rows={2} style={ta} />
                  </label>

                  {ex.kind === 'grila' && Array.isArray(it.options) && (
                    <div style={{ marginTop: 8 }}>
                      {it.options.map((o, oi) => (
                        <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <input type="radio" name={`correct${i}`} checked={Number(it.answer) === oi}
                            onChange={() => patchItem(i, { answer: oi })} title="Marchează ca răspuns corect" />
                          <input value={o} placeholder={`Varianta ${String.fromCharCode(65 + oi)}`}
                            onChange={(e) => {
                              const options = [...it.options]; options[oi] = e.target.value;
                              patchItem(i, { options });
                            }} style={{ ...inp, marginTop: 0 }} />
                        </div>
                      ))}
                      <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>Bifează bulina din stânga variantei corecte.</div>
                    </div>
                  )}

                  {(ex.kind === 'etape' || !Array.isArray(it.options)) && (
                    <label style={lbl}>Răspuns corect
                      <input value={String(it.answer ?? '')} onChange={(e) => patchItem(i, { answer: e.target.value })} style={inp} />
                    </label>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px', gap: 8, marginTop: 8 }}>
                    <label style={lbl}>Indiciu
                      <textarea value={it.hint || ''} onChange={(e) => patchItem(i, { hint: e.target.value })} rows={2} style={ta} />
                    </label>
                    <label style={lbl}>Rezolvare / barem
                      <textarea value={it.explanation || ''} onChange={(e) => patchItem(i, { explanation: e.target.value })} rows={2} style={ta} />
                    </label>
                    <label style={lbl}>Punctaj
                      <input type="number" min="1" value={it.points || 10} onChange={(e) => patchItem(i, { points: Number(e.target.value) || 1 })} style={inp} />
                    </label>
                  </div>
                </div>
              ))}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-outline" onClick={addItem}>➕ Adaugă {ex.kind === 'etape' ? 'etapă' : 'întrebare'}</button>
                {ex.kind === 'etape' && (
                  <label style={{ ...lbl, flex: 1, minWidth: 220 }}>Răspuns final
                    <input value={ex.final_answer || ''} onChange={(e) => patchEx({ final_answer: e.target.value })} style={inp} />
                  </label>
                )}
              </div>
            </div>
          ) : (
            <iframe title="preview-exercitiu" sandbox="allow-scripts" srcDoc={renderExercise(ex)}
              style={{ width: '100%', height: 520, border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }} />
          )}
        </div>
      )}

      {/* Exerciții încărcate de agent — reeditabile */}
      {savedList.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem', marginBottom: 8 }}>Exerciții încărcate de agent (poți să le modifici oricând)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {savedList.map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f7f9fc', borderRadius: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.interactive_data?.exercise?.kind === 'etape' ? '🧮' : '☑️'} {r.title}
                  </div>
                  <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>
                    {r.category} · {r.is_free ? 'gratuit' : 'premium'} · {new Date(r.created_at).toLocaleDateString('ro-RO')}
                  </div>
                </div>
                <button style={smallBtn} onClick={() => loadForEdit(r)}>✏️ Modifică</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
