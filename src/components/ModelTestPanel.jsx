// =====================================================================
// src/components/ModelTestPanel.jsx — „📐 Test după model" (30 oct. 2026)
//
// În formularul generatorului (src/components/InteractiveGenForm.jsx), deci
// și în „🧩 Generează exerciții/teste interactive/PDF", și în „👥 Test pe
// grupă → ⚡ Generează acum testele".
//
// Profesorul încarcă un test DE-AL LUI — PDF, Word sau poză. Textul se citește
// ca la materialul încărcat, apoi serverul îi scoate STRUCTURA
// (api/ai-generate-interactive.js → action 'model', api/_lib/modelTest.js):
// exercițiile în ordine, tipul fiecăruia (grilă / redactare), ce verifică,
// enunțul de pornire, punctajul și dificultatea. Aici se pot schimba toate:
// FORMATUL (și de sus: „Mixt / Doar grilă / Doar redactare"), EXERCIȚIILE
// (tip, competență, enunț, dificultate, ordine, ștergere, adăugare),
// NUMĂRUL lor și DIFICULTATEA (și de sus, pentru toate). La generare, AI-ul
// scrie un test NOU după această structură — alte date, aceleași tipuri.
//
// Starea stă în hook-ul formularului (useInteractiveGen → model, loadModel,
// patchModelEx, setModelCount…), ca payload-ul generării s-o ia de acolo.
// =====================================================================
import { useState } from 'react';

const MAX = 24;                         // cât duce generatorul (api/_lib/modelTest.js)
const DIFFS = ['ușor', 'mediu', 'greu']; // ca GEN_DIFFS din InteractiveGenForm (fără import circular)

export default function ModelTestPanel({ g }) {
  const {
    model, modelBusy, modelError, modelRef, modelCamRef, loadModel, clearModel,
    patchModel, patchModelEx, delModelEx, moveModelEx, setModelCount, addModelEx, effQtype,
  } = g;
  const [deschis, setDeschis] = useState(null);   // exercițiul cu enunțul deschis

  const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', fontSize: '.82rem', fontFamily: 'var(--font-body)', background: '#fff' };
  const mini = (on) => ({
    padding: '3px 8px', fontSize: '.72rem', fontWeight: 700, cursor: 'pointer', borderRadius: 7, whiteSpace: 'nowrap',
    border: `1.5px solid ${on ? 'var(--gold)' : 'var(--border)'}`, background: on ? 'rgba(232,185,49,.14)' : '#fff', color: 'var(--navy)',
  });
  const iconBtn = { background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 7px', fontSize: '.74rem', cursor: 'pointer', color: 'var(--navy)' };

  const n = model ? model.exercises.length : 0;
  const nGrila = model ? model.exercises.filter((x) => x.type === 'grila').length : 0;

  return (
    <div style={{ border: '2px dashed var(--navy-light, #1a4d80)', borderRadius: 12, padding: 14, marginBottom: 12, background: 'rgba(26,77,128,.04)' }}>
      <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>
        📐 Test după un model al tău (opțional)
      </div>
      <p style={{ fontSize: '.78rem', color: 'var(--text-light)', margin: '0 0 10px', lineHeight: 1.5 }}>
        Încarcă un test de-al tău — <strong>PDF, Word sau o poză</strong>. Citim din el <strong>formatul, exercițiile,
        numărul și dificultatea</strong>; le schimbi aici cum vrei, iar AI-ul scrie un <strong>test nou după același model</strong>
        {' '}— aceleași tipuri de exerciții, în aceeași ordine, cu alte date.
      </p>
      <input ref={modelRef} type="file" style={{ display: 'none' }} onChange={loadModel}
        accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*" />
      <input ref={modelCamRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={loadModel} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className={model ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm'}
          onClick={() => modelRef.current?.click()} disabled={!!modelBusy}>
          {model ? '🔄 Alt model' : '📐 Încarcă modelul (PDF, Word, poză)'}
        </button>
        {!model && (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => modelCamRef.current?.click()} disabled={!!modelBusy}>📷 Fă poză la model</button>
        )}
        {model && (
          <button type="button" onClick={clearModel} disabled={!!modelBusy}
            style={{ background: 'none', border: '1px solid #f5c6cb', color: '#c0392b', borderRadius: 8, padding: '5px 10px', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer' }}>
            ✕ Renunță la model
          </button>
        )}
        {modelBusy && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '.8rem', color: 'var(--text-muted)' }}>
            <span className="spinner" style={{ width: 14, height: 14 }} /> {modelBusy}
          </span>
        )}
      </div>
      {modelError && <div style={{ marginTop: 8, fontSize: '.8rem', color: '#b71c1c' }}>⚠️ {modelError}</div>}

      {model && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
            <label style={{ fontSize: '.78rem', color: 'var(--text-light)', flex: '1 1 220px' }}>Titlul testului nou
              <input value={model.title} onChange={(e) => patchModel({ title: e.target.value.slice(0, 120) })}
                style={{ ...inp, width: '100%', marginTop: 3, boxSizing: 'border-box' }} />
            </label>
            {/* NUMĂRUL de exerciții: în plus → copii ale exercițiilor modelului, pe rând */}
            <div style={{ fontSize: '.78rem', color: 'var(--text-light)' }}>
              Număr de exerciții
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <button type="button" style={iconBtn} onClick={() => setModelCount(n - 1)} disabled={n <= 1} aria-label="Un exercițiu mai puțin">−</button>
                <input type="number" min={1} max={MAX} value={n} aria-label="Numărul de exerciții"
                  onChange={(e) => setModelCount(e.target.value)} style={{ ...inp, width: 58, textAlign: 'center' }} />
                <button type="button" style={iconBtn} onClick={() => setModelCount(n + 1)} disabled={n >= MAX} aria-label="Un exercițiu în plus">+</button>
              </div>
            </div>
          </div>
          <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginBottom: 8 }}>
            Din „{model.source?.name || 'model'}" · {n} {n === 1 ? 'exercițiu' : 'exerciții'} ({nGrila} grilă, {n - nGrila} cu redactare) ·
            format: <strong>{effQtype === 'grila' ? 'doar grilă' : effQtype === 'redactare' ? 'doar redactare' : 'mixt'}</strong>.
            {' '}Formatul („Itemii") și dificultatea de mai sus se aplică tuturor; aici le schimbi pe fiecare exercițiu.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 420, overflowY: 'auto', paddingRight: 2 }}>
            {model.exercises.map((x, i) => (
              <div key={x.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '7px 9px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: '.8rem', color: 'var(--navy)', minWidth: 30 }}>Ex. {i + 1}</strong>
                  <span style={{ display: 'inline-flex', gap: 4 }} role="group" aria-label={`Tipul exercițiului ${i + 1}`}>
                    <button type="button" style={mini(x.type === 'grila')} onClick={() => patchModelEx(x.id, { type: 'grila' })}>🔘 Grilă</button>
                    <button type="button" style={mini(x.type === 'redactare')} onClick={() => patchModelEx(x.id, { type: 'redactare' })}>✍️ Redactare</button>
                  </span>
                  <input value={x.topic} placeholder="ce verifică (ex: ecuații de gradul I)" aria-label={`Ce verifică exercițiul ${i + 1}`}
                    onChange={(e) => patchModelEx(x.id, { topic: e.target.value.slice(0, 140) })}
                    style={{ ...inp, flex: '1 1 160px', minWidth: 120 }} />
                  <select value={x.difficulty} onChange={(e) => patchModelEx(x.id, { difficulty: e.target.value })}
                    aria-label={`Dificultatea exercițiului ${i + 1}`} style={{ ...inp, padding: '5px 6px' }}>
                    {DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <span style={{ display: 'inline-flex', gap: 3, marginLeft: 'auto' }}>
                    <button type="button" style={iconBtn} onClick={() => setDeschis((d) => (d === x.id ? null : x.id))}
                      title="Enunțul din model — AI-ul îl folosește doar ca reper (nu îl copiază)">{deschis === x.id ? '▲ enunț' : '▼ enunț'}</button>
                    <button type="button" style={iconBtn} onClick={() => moveModelEx(x.id, -1)} disabled={i === 0} aria-label="Mută mai sus">↑</button>
                    <button type="button" style={iconBtn} onClick={() => moveModelEx(x.id, 1)} disabled={i === n - 1} aria-label="Mută mai jos">↓</button>
                    <button type="button" onClick={() => delModelEx(x.id)} disabled={n <= 1} aria-label={`Șterge exercițiul ${i + 1}`}
                      style={{ ...iconBtn, borderColor: '#f5c6cb', color: '#c0392b' }}>🗑</button>
                  </span>
                </div>
                {deschis === x.id && (
                  <textarea value={x.statement} rows={3} placeholder="Enunțul de pornire (opțional) — formulele în LaTeX, între $...$"
                    onChange={(e) => patchModelEx(x.id, { statement: e.target.value.slice(0, 1200) })}
                    style={{ ...inp, width: '100%', marginTop: 6, resize: 'vertical', boxSizing: 'border-box' }} />
                )}
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-outline btn-sm" style={{ marginTop: 8 }} onClick={addModelEx} disabled={n >= MAX}>
            ➕ Adaugă un exercițiu
          </button>
          <div style={{ fontSize: '.74rem', color: '#1e7e34', fontWeight: 600, marginTop: 8 }}>
            ✅ Testul nou va avea exact aceste {n} {n === 1 ? 'exercițiu' : 'exerciții'}, în această ordine, cu alte date. Timpul, punctele din oficiu și rezultatul (interactiv / PDF) se aleg mai sus.
          </div>
        </div>
      )}
    </div>
  );
}
