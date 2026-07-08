// =====================================================================
// src/components/AIExerciseAgent.jsx — Agentul Claude de exerciții (admin)
// Flux: (1) încarci un fișier-MODEL (PDF/HTML) și/sau scrii instrucțiuni
// în caseta de mesaj (stil Claude/ChatGPT) → „Generează”.
// (2) Pe exercițiul generat: „Încarcă” (publicare cu Titlu/Categorie/
// Descriere/Acces), „Modifică” (editare completă), „Șterge”.
// Poți continua conversația („fă-l mai greu”, „adaugă o etapă”...) —
// agentul regenerează pornind de la exercițiul curent.
// =====================================================================
import { useState, useEffect, useRef } from 'react';
import { aiClient } from '../lib/aiClient';
import { supabase } from '../lib/supabase';
import { renderExercise } from '../lib/exerciseRender';

const CATS = ['clasa-5', 'clasa-6', 'clasa-7', 'clasa-8', 'evaluare-nationala', 'bacalaureat'];
const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', width: '100%', marginTop: 4, boxSizing: 'border-box' };
const ta = { ...inp, fontFamily: 'inherit', resize: 'vertical' };
const lbl = { fontSize: '.82rem', color: 'var(--text-light)' };
const smallBtn = { background: '#f7f9fc', border: '1px solid var(--border)', borderRadius: 7, padding: '4px 9px', fontSize: '.78rem', cursor: 'pointer', fontWeight: 600 };

export default function AIExerciseAgent({ box }) {
  // Modelul (fișier) + conversația
  const [modelFile, setModelFile] = useState(null); // {name, pdf(base64)|null, text|null}
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState([]); // {role:'user'|'assistant', content}
  const fileRef = useRef(null);

  // Exercițiul curent
  const [ex, setEx] = useState(null);
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState(null);

  // Publicare
  const [publishOpen, setPublishOpen] = useState(false);
  const [pub, setPub] = useState({ title: '', category: 'clasa-5', description: '', isFree: false });
  const [savedId, setSavedId] = useState(null);
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

  // ── Fișierul-model (PDF sau HTML) ──────────────────────────────────
  async function onFile(f) {
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
      setModelFile({ name: f.name, pdf: b64, text: null });
    } else if (/\.html?$/i.test(f.name)) {
      const raw = await f.text();
      let text = raw;
      try { text = new DOMParser().parseFromString(raw, 'text/html').body?.innerText || raw; } catch { /* raw */ }
      setModelFile({ name: f.name, pdf: null, text: text.slice(0, 15000) });
    } else {
      setError('Acceptăm doar fișiere PDF sau HTML ca model.');
    }
  }

  // ── Generare / conversație ─────────────────────────────────────────
  async function generate() {
    const text = message.trim();
    if (!modelFile && !text && !ex) { setError('Încarcă un fișier-model sau scrie instrucțiuni.'); return; }
    setLoading(true); setError(null); setMsg(null);
    try {
      const r = await aiClient.exerciseAgent({
        instructions: text,
        // dacă există deja un exercițiu, el devine modelul (iterație);
        // altfel modelul e textul din fișierul HTML
        model: ex ? JSON.stringify(ex) : (modelFile?.text || null),
        modelPdf: modelFile?.pdf || null,
        history: chat.slice(-6),
      });
      setEx(r.exercise); setProvider(r.provider);
      setEditing(false); setPublishOpen(false); setSavedId(null);
      setPub((p) => ({ ...p, title: r.exercise.title, description: '' }));
      setChat((c) => [...c,
        ...(text ? [{ role: 'user', content: text }] : []),
        { role: 'assistant', content: `Am generat: „${r.exercise.title}” (${r.exercise.kind === 'etape' ? r.exercise.steps.length + ' etape' : r.exercise.questions.length + ' întrebări'}, barem ${totalOf(r.exercise)} p). Îl poți Încărca, Modifica sau continua să-mi dai indicații.` },
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
    if (!window.confirm('Ștergi exercițiul generat? (fișierul-model și conversația rămân)')) return;
    setEx(null); setEditing(false); setPublishOpen(false); setSavedId(null); setMsg(null);
  }

  // ── Publicare în baza de date ──────────────────────────────────────
  async function confirmUpload() {
    if (!ex) return;
    if (!pub.title.trim()) { setError('Pune un titlu.'); return; }
    setSaving(true); setError(null); setMsg(null);
    try {
      const exFinal = { ...ex, title: pub.title.trim() };
      const html = renderExercise(exFinal);
      const bucket = pub.isFree ? 'content-files-free' : 'content-files';
      const path = `interactive/${pub.category}/${Date.now()}_agent_claude.html`;
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, new Blob([html], { type: 'text/html' }), { contentType: 'text/html' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
      const row = {
        title: pub.title.trim(),
        description: pub.description.trim() || `Generat cu agentul Claude · barem ${totalPoints} p`,
        category: pub.category, content_type: 'interactive', is_free: pub.isFree,
        file_url: urlData?.publicUrl || path,
        interactive_data: { type: 'exercise', html: true, ai_generated: true, agent: 'claude', exercise: exFinal },
      };
      let dbErr;
      if (savedId) ({ error: dbErr } = await supabase.from('content').update(row).eq('id', savedId));
      else ({ error: dbErr } = await supabase.from('content').insert(row));
      if (dbErr) throw dbErr;
      setMsg(savedId ? '✅ Exercițiu actualizat pe site.' : '✅ Încărcat pe site! Apare în categoria aleasă și se indexează automat.');
      setPublishOpen(false); setEx(exFinal);
      loadSaved();
    } catch (e) { setError('Încărcare eșuată: ' + e.message); }
    finally { setSaving(false); }
  }

  function loadForEdit(row) {
    setEx(row.interactive_data.exercise);
    setSavedId(row.id); setEditing(true); setPublishOpen(false); setMsg(null); setError(null);
    setPub({ title: row.title, category: row.category, description: row.description || '', isFree: !!row.is_free });
  }

  return (
    <div style={{ ...box, marginTop: 18 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 6 }}>
        🤖 Agent Claude — Generator de exerciții
      </h3>
      <p style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 14 }}>
        Încarcă un <strong>exercițiu-model</strong> (PDF sau HTML) și scrie-i agentului ce vrei să genereze.
        Apoi: <strong>Încarcă</strong> pe site, <strong>Modifică</strong> integral sau <strong>Șterge</strong>.
        {provider && <span style={{ color: 'var(--text-muted)' }}> · model: {provider}</span>}
      </p>

      {/* 1. Fișierul-model */}
      <div style={{ border: '2px dashed var(--border)', borderRadius: 12, padding: 14, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <input ref={fileRef} type="file" accept=".pdf,.html,.htm" style={{ display: 'none' }}
          onChange={(e) => onFile(e.target.files?.[0])} />
        <button className="btn btn-outline" onClick={() => fileRef.current?.click()}>
          📎 {modelFile ? 'Schimbă fișierul-model' : 'Încarcă fișier-model (PDF / HTML)'}
        </button>
        {modelFile ? (
          <span style={{ fontSize: '.85rem', color: 'var(--navy)', fontWeight: 600 }}>
            {modelFile.pdf ? '📕' : '📄'} {modelFile.name}
            <button onClick={() => { setModelFile(null); if (fileRef.current) fileRef.current.value = ''; }}
              style={{ ...smallBtn, marginLeft: 8, color: '#c0392b', borderColor: '#f5c6cb' }}>✕ scoate</button>
          </span>
        ) : (
          <span style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>Agentul va genera un exercițiu asemănător modelului (max 3 MB).</span>
        )}
      </div>

      {/* 2. Conversația cu agentul */}
      {chat.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10, maxHeight: 260, overflowY: 'auto', padding: '2px 2px' }}>
          {chat.map((m, i) => m.role === 'user' ? (
            <div key={i} style={{ alignSelf: 'flex-end', background: 'var(--navy)', color: '#fff', borderRadius: '12px 12px 2px 12px', padding: '8px 12px', fontSize: '.85rem', maxWidth: '85%', whiteSpace: 'pre-wrap' }}>{m.content}</div>
          ) : (
            <div key={i} style={{ alignSelf: 'flex-start', background: '#f7f9fc', borderRadius: '12px 12px 12px 2px', padding: '8px 12px', fontSize: '.85rem', maxWidth: '85%' }}>🤖 {m.content}</div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', background: '#fff', border: '1px solid var(--border)', borderRadius: 14, padding: 10 }}>
        <textarea value={message} rows={2}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!loading) generate(); } }}
          placeholder={ex
            ? 'Dă-i indicații agentului… (ex: „fă-l mai greu”, „adaugă o etapă cu verificare”, „transformă-l în grilă”)'
            : 'Descrie exercițiul dorit… (ex: „5 grile cu fracții, clasa a 6-a, barem 20 p” sau doar „generează după model”)'}
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
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {editing ? (
                <button className="btn btn-primary" onClick={() => setEditing(false)}>✅ Finalizare</button>
              ) : (
                <>
                  <button className="btn btn-primary" onClick={() => { setPublishOpen((v) => !v); setMsg(null); }}>
                    💾 {savedId ? 'Actualizează' : 'Încarcă'}
                  </button>
                  <button className="btn btn-outline" onClick={() => setEditing(true)}>✏️ Modifică</button>
                  <button className="btn btn-outline" onClick={discard} style={{ color: '#c0392b', borderColor: '#f5c6cb' }}>🗑 Șterge</button>
                </>
              )}
            </div>
          </div>

          {/* Formularul de publicare (Titlu / Categorie / Descriere / Acces) */}
          {publishOpen && !editing && (
            <div style={{ border: '1px solid var(--gold, #e8b931)', background: '#fffdf5', borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 8, fontSize: '.92rem' }}>Încărcare în baza de date</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginBottom: 10 }}>
                <label style={lbl}>Titlu
                  <input value={pub.title} onChange={(e) => setPub((p) => ({ ...p, title: e.target.value }))} style={inp} />
                </label>
                <label style={lbl}>Categorie
                  <select value={pub.category} onChange={(e) => setPub((p) => ({ ...p, category: e.target.value }))} style={inp}>
                    {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label style={lbl}>Acces
                  <select value={pub.isFree ? 'free' : 'premium'} onChange={(e) => setPub((p) => ({ ...p, isFree: e.target.value === 'free' }))} style={inp}>
                    <option value="premium">Premium</option>
                    <option value="free">Gratuit</option>
                  </select>
                </label>
              </div>
              <label style={lbl}>Descriere
                <textarea value={pub.description} rows={2} onChange={(e) => setPub((p) => ({ ...p, description: e.target.value }))}
                  placeholder={`Generat cu agentul Claude · barem ${totalPoints} p`} style={{ ...ta, marginBottom: 10 }} />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={confirmUpload} disabled={saving}>
                  {saving ? 'Se încarcă…' : savedId ? '✅ Confirmă actualizarea' : '✅ Confirmă încărcarea pe site'}
                </button>
                <button className="btn btn-outline" onClick={() => setPublishOpen(false)}>Renunță</button>
              </div>
            </div>
          )}

          {editing ? (
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
              <label style={lbl}>Titlu
                <input value={ex.title || ''} onChange={(e) => { patchEx({ title: e.target.value }); setPub((p) => ({ ...p, title: e.target.value })); }} style={{ ...inp, marginBottom: 10 }} />
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
