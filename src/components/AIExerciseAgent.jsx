// =====================================================================
// src/components/AIExerciseAgent.jsx — Agentul Claude de exerciții (admin)
// Generează exerciții GRILĂ sau CU ETAPE (indicii + barem + punctaj),
// după modelul materialelor din site (RAG) sau după un model dat/editat.
// Flux: Generează → Previzualizare → ✏️ Modificare (editare completă) →
//       ✅ Finalizare → 💾 Încarcă pe site (sau 🔄 Generează asemănător).
// Exercițiile salvate păstrează JSON-ul structurat în interactive_data,
// deci pot fi reîncărcate și modificate oricând.
// =====================================================================
import { useState, useEffect } from 'react';
import { aiClient } from '../lib/aiClient';
import { supabase } from '../lib/supabase';
import { renderExercise } from '../lib/exerciseRender';

const CATS = ['clasa-5', 'clasa-6', 'clasa-7', 'clasa-8', 'evaluare-nationala', 'bacalaureat'];
const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', width: '100%', marginTop: 4, boxSizing: 'border-box' };
const ta = { ...inp, fontFamily: 'inherit', resize: 'vertical' };
const lbl = { fontSize: '.82rem', color: 'var(--text-light)' };
const smallBtn = { background: '#f7f9fc', border: '1px solid var(--border)', borderRadius: 7, padding: '4px 9px', fontSize: '.78rem', cursor: 'pointer', fontWeight: 600 };

export default function AIExerciseAgent({ box }) {
  const [kind, setKind] = useState('grila');
  const [category, setCategory] = useState('clasa-5');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('mediu');
  const [count, setCount] = useState(5);
  const [isFree, setIsFree] = useState(false);
  const [modelText, setModelText] = useState('');

  const [ex, setEx] = useState(null);        // exercițiul curent (JSON structurat)
  const [editing, setEditing] = useState(false);
  const [savedId, setSavedId] = useState(null); // id-ul rândului din content (la re-editare)
  const [savedList, setSavedList] = useState([]);
  const [provider, setProvider] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);

  async function loadSaved() {
    const { data } = await supabase
      .from('content')
      .select('id, title, category, is_free, created_at, interactive_data')
      .eq('content_type', 'interactive')
      .order('created_at', { ascending: false })
      .limit(60);
    setSavedList((data || []).filter((r) => r.interactive_data?.agent === 'claude'));
  }
  useEffect(() => { loadSaved(); }, []);

  async function generate(action = 'generate', model = null) {
    setLoading(true); setError(null); setMsg(null);
    try {
      const r = await aiClient.exerciseAgent({
        action, kind, category, topic, difficulty, count,
        model: model || (modelText.trim() ? modelText.trim() : null),
      });
      setEx(r.exercise); setProvider(r.provider); setEditing(false); setSavedId(null);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
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

  // ── Încărcare pe site (sau actualizare) ────────────────────────────
  async function save() {
    if (!ex) return;
    setSaving(true); setError(null); setMsg(null);
    try {
      const html = renderExercise(ex);
      const bucket = isFree ? 'content-files-free' : 'content-files';
      const path = `interactive/${category}/${Date.now()}_agent_claude.html`;
      const { error: upErr } = await supabase.storage.from(bucket).upload(path, new Blob([html], { type: 'text/html' }), { contentType: 'text/html' });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
      const row = {
        title: ex.title,
        description: `Generat cu agentul Claude · ${topic || category} · barem ${totalPoints} p`,
        category, content_type: 'interactive', is_free: isFree,
        file_url: urlData?.publicUrl || path,
        interactive_data: { type: 'exercise', html: true, ai_generated: true, agent: 'claude', exercise: ex },
      };
      let dbErr;
      if (savedId) ({ error: dbErr } = await supabase.from('content').update(row).eq('id', savedId));
      else ({ error: dbErr } = await supabase.from('content').insert(row));
      if (dbErr) throw dbErr;
      setMsg(savedId ? '✅ Exercițiu actualizat pe site.' : '✅ Încărcat pe site! Apare în categoria lui și se indexează automat pentru Profesorul Virtual.');
      loadSaved();
    } catch (e) { setError('Încărcare eșuată: ' + e.message); }
    finally { setSaving(false); }
  }

  function loadForEdit(row) {
    setEx(row.interactive_data.exercise);
    setKind(row.interactive_data.exercise.kind || 'grila');
    setCategory(row.category); setIsFree(!!row.is_free);
    setSavedId(row.id); setEditing(true); setMsg(null); setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div style={{ ...box, marginTop: 18 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 6 }}>
        🤖 Agent Claude — Generator de exerciții
      </h3>
      <p style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 14 }}>
        Generează exerciții <strong>grilă</strong> sau <strong>cu etape de rezolvare</strong> (indicii, barem, punctaj),
        învățând din materialele site-ului. După generare le poți <strong>modifica integral</strong>, genera unele
        <strong> asemănătoare</strong> și le poți <strong>încărca pe site</strong>.
        {provider && <span style={{ color: 'var(--text-muted)' }}> · model: {provider}</span>}
      </p>

      {/* Configurare */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 10 }}>
        <label style={lbl}>Tip exercițiu
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={inp}>
            <option value="grila">Grilă</option>
            <option value="etape">Cu etape de rezolvare</option>
          </select>
        </label>
        <label style={lbl}>Categorie
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={inp}>
            {CATS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={lbl}>Subiect
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="ex: ecuații, arii" style={inp} />
        </label>
        <label style={lbl}>Dificultate
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} style={inp}>
            {['ușor', 'mediu', 'greu'].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label style={lbl}>{kind === 'etape' ? 'Nr. etape' : 'Nr. întrebări'}
          <input type="number" min="1" max="10" value={count} onChange={(e) => setCount(e.target.value)} style={inp} />
        </label>
        <label style={lbl}>Acces
          <select value={isFree ? 'free' : 'premium'} onChange={(e) => setIsFree(e.target.value === 'free')} style={inp}>
            <option value="premium">Premium</option>
            <option value="free">Gratuit</option>
          </select>
        </label>
      </div>
      <label style={lbl}>Exercițiu-model (opțional — agentul generează unul asemănător)
        <textarea value={modelText} onChange={(e) => setModelText(e.target.value)} rows={2}
          placeholder="Lipește aici un exercițiu-model (enunț / etape / barem)..." style={{ ...ta, marginBottom: 10 }} />
      </label>

      <button className="btn btn-primary" onClick={() => generate('generate')} disabled={loading}>
        {loading ? 'Agentul lucrează… (~20-40s)' : '✨ Generează exercițiu'}
      </button>

      {error && <div style={{ marginTop: 12, padding: 12, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem' }}>⚠️ {error}</div>}
      {msg && <div style={{ marginTop: 12, padding: 12, background: 'rgba(39,174,96,.1)', color: '#1e7e34', borderRadius: 8, fontSize: '.85rem' }}>{msg}</div>}

      {/* Rezultat */}
      {ex && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
              {editing ? '✏️ Mod editare' : '👁 Previzualizare'} · barem {totalPoints} p · {items.length} {ex.kind === 'etape' ? 'etape' : 'întrebări'}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {!editing && <button className="btn btn-outline" onClick={() => setEditing(true)}>✏️ Modificare</button>}
              {editing && <button className="btn btn-primary" onClick={() => setEditing(false)}>✅ Finalizare</button>}
              <button className="btn btn-outline" onClick={() => generate('similar', ex)} disabled={loading}>🔄 Generează asemănător</button>
              <button className="btn btn-primary" onClick={save} disabled={saving || editing}>
                {saving ? 'Se încarcă…' : savedId ? '💾 Actualizează pe site' : '💾 Încarcă pe site'}
              </button>
            </div>
          </div>

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
                    <label style={lbl}>Rezolvare / barem (afișată după verificare)
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
