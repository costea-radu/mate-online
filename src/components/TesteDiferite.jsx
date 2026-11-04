// =====================================================================
// src/components/TesteDiferite.jsx — „👥 Teste diferite / elev"
// (1 nov. 2026, în „🧩 Generează exerciții/teste interactive/PDF" —
//  src/pages/ProfesorVirtual.jsx → InteractiveTab)
//
// Cererea lui Radu: „muta continutul «genereaza acum testele» din «test pe
// grupa (teste diferite)» in «genereaza exercitii/teste interactive/PDF» si pune
// un buton unde se poate introduce «nr teste diferite / elev». fa sa poata alege
// pe langa continutul examenelor si clasele 5-12; sa ia exercitiile din fisele
// cu exercitii clase 5-12 si sa poata fi selectate prin bifare «nivele» sau
// «tipuri» […] Pune sa pot folosi si varianta care schimba numerele si notatiile".
//
//   • „Nr. teste diferite / elev" — câte teste diferite se generează (unul
//     pentru fiecare elev), 1–60;
//   • conținutul: EXAMENE (Evaluare Națională, Bacalaureat) sau CLASE (a V-a –
//     a XII-a);
//   • din ce se fac testele:
//       – 🎓 subiectele PDF ale examenului — combinate exact (fără AI) sau cu
//         „🔢 numerele și notațiile schimbate" (AI, un apel pe test) —
//         src/components/CombinedPdfGenerator.jsx;
//       – 📚 fișele cu exerciții ale clasei — bifezi nivelele / tipurile, cu
//         datele păstrate (fără AI la PDF) sau schimbate (AI) —
//         src/components/FiseTestGenerator.jsx;
//       – 🧩 un test AI, în N variante (interactiv: altă ordine, altă literă
//         corectă) — src/components/VariantGenerator.jsx;
//   • (4 nov. 2026) la „🔢 Schimbă numerele și notațiile": „📝 Cu barem" (AI-ul
//     rezolvă fiecare test; baremul se tipărește separat, așezat ca baremele
//     oficiale) sau „📄 Fără barem" (doar enunțurile — mai rapid și mai ieftin);
//   • testele se salvează în „Testele și exercițiile mele" (și, opțional, se
//     publică); „👥 Folosește-le în testul interactiv pe grupă" le duce bifate în
//     „👥 Test interactiv pe grupă (teste diferite)" (src/components/GroupAssignment.jsx,
//     prin sessionStorage — src/lib/grupaPreset.js).
// =====================================================================
import { Suspense, lazy, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CATEGORIES } from '../lib/contentMeta';
import { savePreset } from '../lib/grupaPreset';
import VariantGenerator from './VariantGenerator';
import FiseTestGenerator from './FiseTestGenerator';

// motorul combinării PDF (pdf.js + pdf-lib) se încarcă doar când e nevoie de el
const CombinedPdfGenerator = lazy(() => import('./CombinedPdfGenerator'));

const EXAM_CATS = ['evaluare-nationala', 'bacalaureat'];
const MAX_TESTE = 60;
const CHEIE = 'mate_teste_diferite';  // ultimele alegeri (per browser)

const chip = (active) => ({
  padding: '7px 12px', borderRadius: 999, cursor: 'pointer', fontSize: '.82rem', fontWeight: 600,
  border: `1.5px solid ${active ? 'var(--navy)' : 'var(--border)'}`,
  background: active ? 'var(--navy)' : '#fff', color: active ? '#fff' : 'var(--navy)',
});
const seg = (on) => ({
  display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 9, cursor: 'pointer',
  border: `2px solid ${on ? 'var(--gold)' : 'var(--border)'}`, background: on ? 'rgba(232,185,49,.10)' : '#fff',
  fontSize: '.8rem', color: 'var(--navy)', flex: '1 1 240px', textAlign: 'left', lineHeight: 1.45, fontFamily: 'inherit',
});

function citeste() {
  try { return JSON.parse(window.localStorage.getItem(CHEIE) || '{}') || {}; } catch { return {}; }
}

export default function TesteDiferite() {
  const navigate = useNavigate();
  const [init] = useState(citeste);   // ultimele alegeri, citite o singură dată
  const [n, setN] = useState(() => Math.max(1, Math.min(MAX_TESTE, parseInt(init.n, 10) || 10)));
  const [category, setCategory] = useState(() => (typeof init.category === 'string' ? init.category : ''));
  const [sursa, setSursa] = useState(() => init.sursa || null);   // 'subiecte' | 'fise' | 'variante'
  const [dataMode, setDataMode] = useState('keep');
  const [publish, setPublish] = useState(() => init.publish !== false);
  // „🔢 Schimbă numerele": cu barem (AI-ul rezolvă testul) sau fără (doar enunțurile)
  const [barem, setBarem] = useState(() => init.barem !== false);
  const [gata, setGata] = useState(null);       // { items, format, category }
  const [eroare, setEroare] = useState(null);

  const esteExamen = EXAM_CATS.includes(category);
  const esteClasa = /^clasa-/.test(category || '');
  // sursa implicită pentru conținutul ales
  const sursaEf = !category ? null
    : sursa === 'variante' ? 'variante'
      : esteExamen ? 'subiecte' : 'fise';

  useEffect(() => {
    try { window.localStorage.setItem(CHEIE, JSON.stringify({ n, category, sursa, publish, barem })); } catch { /* fără storage */ }
  }, [n, category, sursa, publish, barem]);

  function alegeContinut(c) {
    if (c === category) return;
    setCategory(c); setGata(null); setEroare(null);
    if (sursa !== 'variante') setSursa(null);
  }
  const onDone = (items, info = {}) => {
    setGata({ items, format: info.format || 'interactive', category: info.category ?? category });
  };
  const onError = (e) => setEroare(e?.message || null);

  function folosesteInGrupa() {
    if (!gata?.items?.length) return;
    // fără storage: profesorul le bifează din „🧩 Testele generate de mine"
    savePreset(gata);
    navigate('/profesor-virtual?tab=grupa');
  }

  const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };
  const lbl = { fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)', margin: '14px 0 6px' };
  const sub = { fontSize: '.72rem', fontWeight: 700, color: 'var(--text-muted)', margin: '0 0 5px', letterSpacing: '.03em' };

  return (
    <div style={card}>
      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 4 }}>👥 Teste diferite / elev</h3>
      <p style={{ fontSize: '.82rem', color: 'var(--text-muted)', margin: '0 0 10px', lineHeight: 1.55 }}>
        Generezi deodată câte un test <strong>diferit pentru fiecare elev</strong> — din subiectele de examen ale site-ului,
        din fișele cu exerciții ale claselor 5–12 sau dintr-un test AI dat în variante. Testele se salvează în „Testele și
        exercițiile mele", se tipăresc toate deodată și le poți trimite cu <strong>„👥 Test interactiv pe grupă"</strong>.
      </p>

      {/* Nr. teste diferite / elev */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 10, border: '2px solid var(--gold)', background: 'rgba(232,185,49,.10)' }}>
        <span style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '.9rem' }}>Nr. teste diferite / elev</span>
        <input type="number" min={1} max={MAX_TESTE} value={n}
          onChange={(e) => setN(Math.max(1, Math.min(MAX_TESTE, parseInt(e.target.value, 10) || 1)))}
          aria-label="Numărul de teste diferite (unul pentru fiecare elev)"
          style={{ width: 84, border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px', fontSize: '.95rem', fontWeight: 700 }} />
        <span style={{ fontSize: '.76rem', color: 'var(--text-muted)' }}>câte teste diferite generez — unul pentru fiecare elev (1–{MAX_TESTE})</span>
      </label>

      {/* Conținutul: examenele sau clasele 5–12 */}
      <div style={lbl}>1. Conținutul testelor</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <div style={sub}>EXAMENE</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CATEGORIES.filter((c) => EXAM_CATS.includes(c.value)).map((c) => (
              <button key={c.value} type="button" style={chip(category === c.value)} onClick={() => alegeContinut(c.value)}>{c.label}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={sub}>CLASE</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CATEGORIES.filter((c) => c.value.startsWith('clasa-')).map((c) => (
              <button key={c.value} type="button" style={chip(category === c.value)} onClick={() => alegeContinut(c.value)}>{c.label}</button>
            ))}
          </div>
        </div>
      </div>

      {category && (
        <>
          <div style={lbl}>2. Din ce se fac testele</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {esteExamen && (
              <button type="button" style={seg(sursaEf === 'subiecte')} onClick={() => { setSursa('subiecte'); setGata(null); }}>
                <span style={{ fontSize: '1.1rem' }}>🎓</span>
                <span><strong>Subiectele de examen ale site-ului</strong><br />
                  <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>variante date, modele, simulări — bifezi exercițiile fiecărui subiect (PDF)</span></span>
              </button>
            )}
            {esteClasa && (
              <button type="button" style={seg(sursaEf === 'fise')} onClick={() => { setSursa('fise'); setGata(null); }}>
                <span style={{ fontSize: '1.1rem' }}>📚</span>
                <span><strong>Fișele cu exerciții ale clasei</strong><br />
                  <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>bifezi nivelele sau tipurile de exerciții, cum sunt scrise în fișe (PDF sau interactiv)</span></span>
              </button>
            )}
            <button type="button" style={seg(sursaEf === 'variante')} onClick={() => { setSursa('variante'); setGata(null); }}>
              <span style={{ fontSize: '1.1rem' }}>🧩</span>
              <span><strong>Un test AI, în {n} {n === 1 ? 'variantă' : 'variante'}</strong><br />
                <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>interactiv: aceleași probleme, altă ordine și altă literă corectă la grilă</span></span>
            </button>
          </div>

          {sursaEf !== 'variante' && (
            <>
              <div style={lbl}>3. Datele problemelor</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <label style={seg(dataMode === 'keep')}>
                  <input type="radio" name="td-date" checked={dataMode === 'keep'} onChange={() => { setDataMode('keep'); setGata(null); }} style={{ marginTop: 3 }} />
                  <span><strong>📋 Păstrează datele</strong> — exercițiile exact ca în original<br />
                    <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{sursaEf === 'subiecte' ? 'decupate din PDF-uri, fără AI și fără cost' : 'în PDF: fără AI și fără cost'}</span></span>
                </label>
                <label style={seg(dataMode === 'modify')}>
                  <input type="radio" name="td-date" checked={dataMode === 'modify'} onChange={() => { setDataMode('modify'); setGata(null); }} style={{ marginTop: 3 }} />
                  <span><strong>🔢 Schimbă numerele și notațiile</strong> — ca la generatorul de examene<br />
                    <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>AI-ul rescrie fiecare test cu alte numere — un apel AI pe test; alegi mai jos dacă are barem</span></span>
                </label>
              </div>
              {/* „📝 Cu barem" / „📄 Fără barem" — doar la numerele schimbate */}
              {dataMode === 'modify' && (
                <div role="radiogroup" aria-label="Baremul testelor cu numerele schimbate" style={{
                  marginTop: 8, padding: '10px 12px', borderRadius: 10, background: '#f7f9fc',
                  border: '1px solid var(--border)', borderLeft: '4px solid var(--gold)',
                }}>
                  <div style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--navy)', marginBottom: 7 }}>📝 Baremul testelor cu numerele schimbate</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" role="radio" aria-checked={barem} style={seg(barem)} onClick={() => { setBarem(true); setGata(null); }}>
                      <span style={{ fontSize: '1.05rem' }}>📝</span>
                      <span><strong>Cu barem</strong><br />
                        <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>AI-ul rezolvă fiecare test; baremul se tipărește separat, așezat ca baremele oficiale (tabel la grile)</span></span>
                    </button>
                    <button type="button" role="radio" aria-checked={!barem} style={seg(!barem)} onClick={() => { setBarem(false); setGata(null); }}>
                      <span style={{ fontSize: '1.05rem' }}>📄</span>
                      <span><strong>Fără barem</strong><br />
                        <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>doar testele, cu alte numere — mai rapid și mai ieftin (AI-ul nu mai scrie rezolvările)</span></span>
                    </button>
                  </div>
                  {sursaEf === 'fise' && (
                    <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
                      Contează la testele PDF; la cele interactive, explicațiile rămân (elevul le vede după „✓ Corectează").
                    </div>
                  )}
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: '.8rem', color: 'var(--navy)', cursor: 'pointer' }}>
                <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
                🏛️ Publică testele și în „Biblioteca utilizatorilor"
                <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>(oricum se salvează în „Testele și exercițiile mele")</span>
              </label>
            </>
          )}

          {sursaEf === 'subiecte' && (
            <Suspense fallback={<div style={{ padding: 14, textAlign: 'center' }}><div className="spinner" /></div>}>
              <CombinedPdfGenerator poolSize={n} category={category} onCategory={setCategory}
                dataMode={dataMode} barem={barem} publish={publish} onDone={onDone} onError={onError} />
            </Suspense>
          )}
          {sursaEf === 'fise' && (
            <FiseTestGenerator n={n} category={category} dataMode={dataMode} barem={barem} publish={publish} onDone={onDone} onError={onError} />
          )}
          {sursaEf === 'variante' && (
            <VariantGenerator poolSize={n} category={category} onDone={onDone} onError={onError} />
          )}
        </>
      )}
      {!category && (
        <div style={{ marginTop: 10, fontSize: '.8rem', color: 'var(--text-muted)' }}>Alege examenul sau clasa ca să vezi de unde se pot lua exercițiile.</div>
      )}

      {eroare && !gata && <div style={{ marginTop: 10, fontSize: '.8rem', color: '#b71c1c' }}>⚠️ {eroare}</div>}

      {/* Testele generate → testul interactiv pe grupă */}
      {gata?.items?.length > 0 && (
        <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', borderRadius: 12, background: 'var(--navy)', color: '#fff' }}>
          <button type="button" className="btn btn-primary" onClick={folosesteInGrupa}>👥 Folosește-le în testul interactiv pe grupă</button>
          <span style={{ flex: '1 1 220px', fontSize: '.82rem' }}>
            <strong>{gata.items.length} {gata.items.length === 1 ? 'test gata' : 'teste gata'}</strong> ({gata.format === 'pdf' ? 'PDF' : 'interactive'}) — fiecare elev al grupei primește altul, dintr-un singur link.
          </span>
        </div>
      )}
    </div>
  );
}
