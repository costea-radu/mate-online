// =====================================================================
// src/components/InteractiveGenForm.jsx — FORMULARUL generatorului de
// exerciții/teste (AI), folosit în două locuri, ca să fie unul singur:
//   • „🧩 Generează exerciții/teste interactive/PDF" (src/pages/ProfesorVirtual.jsx)
//   • „👥 Test pe grupă" → „⚡ Generează acum testele"
//     (src/components/VariantGenerator.jsx, în src/components/GroupAssignment.jsx)
//
// Aici stau DOAR alegerile (ce generez, timp, oficiu, tipul itemilor,
// categorie, dificultate, materialul de la tablă/PDF/Word, capitolele,
// subiectul și modul de tratare a datelor) plus butonul de acțiune primit ca
// `children`. Ce se face cu rezultatul rămâne în pagina care îl folosește.
//
//   const g = useInteractiveGen();                    // starea alegerilor
//   <InteractiveGenForm g={g}>…butonul…</InteractiveGenForm>
//   await aiClient.generateInteractive(g.payload());  // generarea propriu-zisă
// =====================================================================
import { useRef, useState } from 'react';
import { aiClient } from '../lib/aiClient';
import CapitolePicker from './CapitolePicker';
import { fileToCompressedDataUrl } from '../lib/image';
import { capitoleForCategory } from '../lib/capitole';
import { estimeazaCredite, fmtEstimare } from '../lib/aiCost';
import { useAuth } from '../context/AuthContext';

export const GEN_CATEGORIES = [
  { id: '', label: 'Toate' },
  { id: 'clasa-5', label: 'Clasa 5' }, { id: 'clasa-6', label: 'Clasa 6' },
  { id: 'clasa-7', label: 'Clasa 7' }, { id: 'clasa-8', label: 'Clasa 8' },
  { id: 'evaluare-nationala', label: 'Evaluare Națională' },
  { id: 'bacalaureat', label: 'Bacalaureat' },
];
export const GEN_DIFFS = ['ușor', 'mediu', 'greu'];

// ─── Starea alegerilor din formular ─────────────────────────────────────────
// Toate câmpurile sunt expuse ca { valoare, setValoare }, ca formularul de mai
// jos să rămână identic cu cel din pagina generatorului.
export function useInteractiveGen(init = {}) {
  const [category, setCategory] = useState(init.category ?? '');
  const [topic, setTopic] = useState(init.topic ?? '');
  const [chapters, setChapters] = useState([]);      // capitolele alese din programă (id-uri)
  const [difficulty, setDifficulty] = useState(init.difficulty ?? 'mediu');
  // rezultatul generării: interactiv (viewerul intern) sau DIRECT PDF
  const [output, setOutput] = useState(init.output ?? 'interactive'); // 'interactive' | 'pdf'
  const [itemKind, setItemKind] = useState(init.kind ?? 'exercitiu'); // 'exercitiu' | 'test'
  const [itemCount, setItemCount] = useState(init.count ?? 10);       // itemii testului (4–24)
  const [qtype, setQtype] = useState(init.qtype ?? 'mixt');           // 'mixt' | 'grila' | 'redactare'
  // timpul de lucru și punctele din oficiu — apar pe test (cronometru la
  // varianta interactivă, antet la PDF) și calibrează generarea
  const [durationMin, setDurationMin] = useState(init.durationMin ?? 30);
  const [oficiu, setOficiu] = useState(init.oficiu ?? 10);
  // MATERIALUL profesorului: poză de la tablă / fișă de lucru / PDF / Word.
  // sources: [{ id, kind:'foto'|'pdf'|'word', name, text, thumb? }]
  const [sources, setSources] = useState([]);
  const [srcBusy, setSrcBusy] = useState(null);   // eticheta acțiunii în curs
  const [srcError, setSrcError] = useState(null);
  const [srcOpen, setSrcOpen] = useState(null);   // id-ul sursei cu textul deschis
  const [dataMode, setDataMode] = useState(init.dataMode ?? 'modify');
  const camRef = useRef(null);
  const imgRef = useRef(null);
  const docRef = useRef(null);
  const [chapterExtra, setChapterExtra] = useState('');  // alt capitol, scris liber
  const chapterOptions = capitoleForCategory(category);
  // la schimbarea categoriei păstrăm doar capitolele care există și în noua listă
  const pickCategory = (c) => { setCategory(c); setChapters((sel) => sel.filter((id) => capitoleForCategory(c).some((o) => o.id === id))); };
  // capitolele trimise serverului: cele bifate din listă + capitolul scris
  // liber (intră în aceeași restricție obligatorie de conținut)
  const chapterTitles = () => {
    const out = chapters.map((id) => chapterOptions.find((o) => o.id === id)?.title).filter(Boolean);
    const extra = chapterExtra.trim().split(/\r?\n/)[0].replace(/\s+/g, ' ').trim().slice(0, 140);
    if (extra) out.push(extra);
    return out;
  };
  // Câmpul „Subiect + instrucțiuni" poate fi lung — pentru titluri și metadate
  // (bibliotecă, teme, publicare) folosim doar prima linie, scurtă.
  const topicShort = (topic || '').split(/\r?\n/)[0].replace(/\s+/g, ' ').trim().slice(0, 120) || null;

  // ── MATERIALUL PROFESORULUI (poză / PDF / Word) ─────────────────────────
  // Textul extras din fiecare fișier devine sursa de conținut a testului:
  // poza tablei sau a fișei de lucru → api/ai-vision; PDF → api/ai-correct
  // (pdf_text); Word (.docx) → api/ai-correct (docx_text).
  const sourceText = () => sources
    .map((sc) => `--- ${sc.name} ---\n${sc.text}`)
    .join('\n\n').slice(0, 14000);

  async function addSource(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // permite re-selectarea aceluiași fișier
    if (!files.length) return;
    setSrcError(null);
    for (const file of files) {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
      const isWord = /\.docx?$/i.test(file.name || '') || /wordprocessingml|msword/.test(file.type || '');
      setSrcBusy(isPdf ? 'Citesc PDF-ul…' : isWord ? 'Citesc fișierul Word…' : 'Citesc poza…');
      try {
        let text = '', thumb = null, sKind = 'foto';
        if (isPdf || isWord) {
          if (file.size > 3.5 * 1024 * 1024) throw new Error(`„${file.name}" e prea mare (max ~3,5 MB).`);
          const fileBase64 = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(String(fr.result));
            fr.onerror = () => reject(new Error('Fișierul nu a putut fi citit.'));
            fr.readAsDataURL(file);
          });
          sKind = isPdf ? 'pdf' : 'word';
          const r = isPdf ? await aiClient.correctPdfText({ fileBase64 }) : await aiClient.correctDocxText({ fileBase64 });
          text = r.text || '';
        } else {
          const dataUrl = await fileToCompressedDataUrl(file, { maxDim: 1600, quality: 0.78 });
          try { thumb = await fileToCompressedDataUrl(file, { maxDim: 120, quality: 0.6 }); } catch { thumb = null; }
          const r = await aiClient.visionExtract({
            imageBase64: dataUrl,
            note: 'Transcrie TOT ce se vede în imagine (exerciții și/sau teorie predată: definiții, formule, exemple rezolvate), cu formulele în LaTeX. Nu rezolva nimic.',
          });
          text = r.problemText || '';
        }
        if (!text.trim() || /^Nu am putut citi/i.test(text.trim())) {
          throw new Error(`Nu am găsit text în „${file.name}". Fotografiază mai de aproape sau încarcă alt fișier.`);
        }
        setSources((list) => [...list, {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          kind: sKind, name: file.name || (sKind === 'foto' ? 'Poză' : 'Fișier'), text: text.trim(), thumb,
        }]);
      } catch (err) {
        setSrcError(err.message);
        if (err.premium && init.onPremium) init.onPremium(err);
        break;
      } finally { setSrcBusy(null); }
    }
  }
  function patchSource(id, text) { setSources((l) => l.map((sc) => (sc.id === id ? { ...sc, text } : sc))); }
  function delSource(id) { setSources((l) => l.filter((sc) => sc.id !== id)); setSrcOpen((o) => (o === id ? null : o)); }

  // timpul de lucru / punctele din oficiu care însoțesc testul
  const quizMeta = () => ({ durationMin, oficiu });
  // ce se trimite la api/ai-generate-interactive
  const payload = (over = {}) => ({
    category: category || null, topic, difficulty, dataMode, chapters: chapterTitles(),
    kind: itemKind, count: itemKind === 'test' ? itemCount : null, qtype,
    durationMin, oficiu, sourceText: sourceText(), ...over,
  });

  return {
    category, setCategory, pickCategory, topic, setTopic, chapters, setChapters,
    difficulty, setDifficulty, output, setOutput, itemKind, setItemKind,
    itemCount, setItemCount, qtype, setQtype, durationMin, setDurationMin,
    oficiu, setOficiu, sources, setSources, srcBusy, srcError, setSrcError,
    srcOpen, setSrcOpen, dataMode, setDataMode, camRef, imgRef, docRef,
    chapterExtra, setChapterExtra, chapterOptions, chapterTitles, topicShort,
    sourceText, addSource, patchSource, delSource, quizMeta, payload,
  };
}

// ─── Formularul propriu-zis ────────────────────────────────────────────────
// showOutput=false ascunde alegerea „Interactiv / PDF" (la testul pe grupă
// formatul e ales deja, la pasul 2). `children` = butonul de generare.
export default function InteractiveGenForm({ g, showOutput = true, cardStyle = null, costExtra = null, children }) {
  const { isAdmin } = useAuth();
  const {
    category, pickCategory, topic, setTopic, chapters, setChapters,
    difficulty, setDifficulty, output, setOutput, itemKind, setItemKind,
    itemCount, setItemCount, qtype, setQtype, durationMin, setDurationMin,
    oficiu, setOficiu, sources, srcBusy, srcError, srcOpen, setSrcOpen,
    dataMode, setDataMode, camRef, imgRef, docRef, chapterExtra, setChapterExtra,
    chapterOptions, addSource, patchSource, delSource,
  } = g;
  const CATEGORIES = GEN_CATEGORIES;
  const DIFFS = GEN_DIFFS;

  const card = cardStyle || { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };
  const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', fontFamily: 'var(--font-body)' };
  // buton „segmentat" (alegeri: interactiv/PDF, exercițiu/test)
  const seg = (active) => ({
    padding: '8px 14px', fontSize: '.85rem', fontWeight: 700, cursor: 'pointer',
    border: `2px solid ${active ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 10,
    background: active ? 'rgba(232,185,49,.12)' : '#fff', color: 'var(--navy)',
  });

  return (
    <div style={card}>
      {/* Ce generăm: EXERCIȚIU sau TEST · rezultat INTERACTIV sau PDF direct */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>Ce generez</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={seg(itemKind === 'exercitiu')} onClick={() => setItemKind('exercitiu')}>🧠 Exercițiu</button>
            <button style={seg(itemKind === 'test')} onClick={() => setItemKind('test')}>📋 Test</button>
            {itemKind === 'test' && (
              <label style={{ fontSize: '.82rem', color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
                Itemi:
                <select value={itemCount} onChange={(e) => setItemCount(Number(e.target.value))} style={{ ...inp, padding: '7px 9px' }}>
                  {Array.from({ length: 21 }, (_, i) => i + 4).map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
          </div>
          {/* Timpul de lucru și punctele din oficiu — apar pe test
              (cronometru la interactiv, antet la PDF) și calibrează AI-ul */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <label style={{ fontSize: '.82rem', color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
              ⏱ Timp:
              <select value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} style={{ ...inp, padding: '7px 9px' }}>
                {[5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 90, 120, 150, 180].map((n) => (
                  <option key={n} value={n}>{n} min</option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: '.82rem', color: 'var(--text-light)', display: 'flex', alignItems: 'center', gap: 6 }}>
              🎁 Puncte din oficiu:
              <select value={oficiu} onChange={(e) => setOficiu(Number(e.target.value))} style={{ ...inp, padding: '7px 9px' }}>
                {[0, 5, 10, 15, 20].map((n) => <option key={n} value={n}>{n === 0 ? 'fără' : `${n} p`}</option>)}
              </select>
            </label>
          </div>
          <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: 4, maxWidth: 330 }}>
            Timpul calibrează dificultatea și pornește cronometrul pe varianta interactivă; ambele apar în antetul PDF-ului. Punctajul: {oficiu ? `${oficiu} p din oficiu + ${100 - oficiu} p pe itemi` : '100 p împărțiți pe itemi'}.
          </div>
        </div>
        {showOutput && (
          <div>
            <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>Rezultatul</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={seg(output === 'interactive')} onClick={() => setOutput('interactive')} title="Se deschide în viewerul interactiv, cu corectare și scor">🧩 Interactiv</button>
              <button style={seg(output === 'pdf')} onClick={() => setOutput('pdf')} title="Document tipăribil, ca la «Generează subiect examen»: variantă elev + variantă cu barem">📄 PDF</button>
            </div>
          </div>
        )}
        <div>
          <div style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>Itemii (tipul problemelor)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={seg(qtype === 'mixt')} onClick={() => setQtype('mixt')} title="Amestec: majoritatea grilă + câteva cu răspuns liber">🔀 Mixt</button>
            <button style={seg(qtype === 'grila')} onClick={() => setQtype('grila')} title="Toate problemele cu 4 variante de răspuns (a, b, c, d)">🔘 Doar grilă</button>
            <button style={seg(qtype === 'redactare')} onClick={() => setQtype('redactare')} title="Toate problemele cu redactarea răspunsului (fără variante) — rezolvarea model apare la barem">✍️ Cu redactarea răspunsului</button>
          </div>
        </div>
      </div>
      {showOutput && output === 'pdf' && (
        <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: -8, marginBottom: 12 }}>
          📄 La rezultat PDF primești documentul tipăribil (ca la „Generează subiect examen"): <strong>varianta elev</strong> și <strong>varianta cu barem</strong> — fereastra de tipărire → „Salvează ca PDF". {itemKind === 'test' ? 'Testul' : 'Exercițiul'} rămâne salvat și în „Testele și exercițiile mele".
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 14 }}>
        <label style={{ fontSize: '.85rem', color: 'var(--text-light)' }}>Categorie
          <select value={category} onChange={(e) => pickCategory(e.target.value)} style={{ ...inp, width: '100%', marginTop: 4 }}>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label style={{ fontSize: '.85rem', color: 'var(--text-light)' }}>Dificultate
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} style={{ ...inp, width: '100%', marginTop: 4 }}>
            {DIFFS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
      </div>
      {/* MATERIALUL PROFESORULUI — înaintea capitolelor: poză de la tablă /
          fișă de lucru / PDF / Word. Când există, testul se compune DIN EL
          (exercițiile sau teoria din material), nu din baza de date. */}
      <div style={{ border: '2px dashed var(--gold)', borderRadius: 12, padding: 14, marginBottom: 12, background: 'rgba(232,185,49,.06)' }}>
        <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>
          📷 Conținutul testului dintr-o poză sau dintr-un fișier (opțional)
        </div>
        <p style={{ fontSize: '.78rem', color: 'var(--text-light)', margin: '0 0 10px', lineHeight: 1.5 }}>
          Fă poză la ce ai predat — tabla, pagina din manual sau fișa de lucru — ori încarcă fișa
          (PDF sau Word), iar AI-ul compune testul din exercițiile sau din teoria de acolo.
          <strong> Așa poți da un test de 10 minute creat pe loc, în clasă, exact pe lecția de azi.</strong>
          <br />Fără nimic încărcat aici, conținutul vine din capitolele alese mai jos.
        </p>
        <input ref={camRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={addSource} />
        <input ref={imgRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={addSource} />
        <input ref={docRef} type="file" accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple style={{ display: 'none' }} onChange={addSource} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={() => camRef.current?.click()} disabled={!!srcBusy}>📷 Fă poză</button>
          <button className="btn btn-outline btn-sm" onClick={() => imgRef.current?.click()} disabled={!!srcBusy}>🖼 Încarcă poză</button>
          <button className="btn btn-outline btn-sm" onClick={() => docRef.current?.click()} disabled={!!srcBusy}>📄 Încarcă PDF / Word</button>
          {srcBusy && <span style={{ fontSize: '.8rem', color: 'var(--text-muted)', alignSelf: 'center' }}>{srcBusy}</span>}
        </div>
        {srcError && <div style={{ marginTop: 8, fontSize: '.8rem', color: '#b71c1c' }}>⚠️ {srcError}</div>}
        {sources.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sources.map((sc) => (
              <div key={sc.id} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {sc.thumb
                    ? <img src={sc.thumb} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6 }} />
                    : <span style={{ fontSize: '1.1rem' }}>{sc.kind === 'pdf' ? '📄' : '📝'}</span>}
                  <span style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--navy)', flex: 1, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sc.name}</span>
                  <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>{sc.text.length} caractere</span>
                  <button className="btn btn-sm btn-outline" onClick={() => setSrcOpen((o) => (o === sc.id ? null : sc.id))}>
                    {srcOpen === sc.id ? '▲ Ascunde' : '👁 Vezi / corectează'}
                  </button>
                  <button onClick={() => delSource(sc.id)} title="Scoate materialul"
                    style={{ background: 'none', border: '1px solid #f5c6cb', color: '#c0392b', borderRadius: 6, padding: '2px 8px', fontSize: '.75rem', cursor: 'pointer' }}>✕</button>
                </div>
                {srcOpen === sc.id && (
                  <>
                    <textarea value={sc.text} onChange={(e) => patchSource(sc.id, e.target.value)} rows={8}
                      style={{ ...inp, width: '100%', marginTop: 8, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', fontSize: '.82rem' }} />
                    <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>
                      Textul citit din material — corectează aici ce s-a citit greșit (formule, cifre) înainte de generare.
                    </div>
                  </>
                )}
              </div>
            ))}
            <div style={{ fontSize: '.75rem', color: '#1e7e34', fontWeight: 600 }}>
              ✅ {sources.length === 1 ? 'Materialul încărcat va fi' : `Cele ${sources.length} materiale încărcate vor fi`} sursa {itemKind === 'test' ? 'testului' : 'exercițiului'}. Capitolele de mai jos rămân opționale — restrâng suplimentar ce se ia din material.
            </div>
          </div>
        )}
      </div>

      {/* Capitolele programei (rolldown cu selecție multiplă) + câmpul liber
          „alt capitol” (ca la pregătirea pentru lucrare a elevului):
          întrebările vin DOAR din capitolele alese/scrise. */}
      <CapitolePicker
        options={chapterOptions} selected={chapters} onChange={setChapters}
        extraText={chapterExtra} onExtraText={setChapterExtra}
        label="Din anumite capitole (opțional) — gol = potrivit categoriei"
        extraLabel="Alt capitol, dacă lipsește din listă (opțional) — scrie-l aici"
        extraPlaceholder='ex: „Ecuații cu modul” · „Media aritmetică ponderată” · „Probleme cu procente și dobânzi”'
        hint='Capitolul scris liber intră în aceeași restricție de conținut ca cele bifate. Alte indicații pentru AI (număr de întrebări, stil, restricții) se scriu în „Subiect + instrucțiuni” de mai jos.'
      />
      {/* Subiect + instrucțiuni: prompt amplu pentru AI — temă, număr de
          întrebări, tipuri de itemi, restricții etc. (nu doar un cuvânt-cheie). */}
      <label style={{ display: 'block', fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 14 }}>Subiect + instrucțiuni pentru AI (opțional)
        <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={3}
          placeholder={'ex: ecuații de gradul I cu o necunoscută; 6 întrebări, de la ușor la greu; doar numere naturale; ultima întrebare să fie o problemă cu text, în stilul Evaluării Naționale'}
          style={{ ...inp, width: '100%', marginTop: 4, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }} />
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, fontSize: '.85rem', color: 'var(--text-light)' }}>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
          <input type="radio" checked={dataMode === 'keep'} onChange={() => setDataMode('keep')} style={{ marginTop: 3 }} />
          <span><strong>Păstrează datele problemelor</strong> — preia exercițiile din subiectele site-ului fără să schimbe valorile</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
          <input type="radio" checked={dataMode === 'modify'} onChange={() => setDataMode('modify')} style={{ marginTop: 3 }} />
          <span><strong>Modifică numerele și notațiile</strong> (verifică problemele — poate greși!)</span>
        </label>
      </div>
      {children}

      {/* CÂT COSTĂ — estimarea, chiar sub buton, ca profesorul să știe înainte
          să apese. Cifra se calibrează singură după fiecare generare, din
          costul real întors de server (src/lib/aiCost.js). */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', marginTop: 8, fontSize: '.78rem', color: 'var(--text-muted)' }}>
        <span
          title={'Estimare, nu preț fix: costul depinde de câți itemi ceri și de cât text scrie AI-ul. Cifra se ajustează singură după fiecare generare, din consumul real al contului tău. Îl vezi oricând în „Contul meu" → „⚡ Consum AI".'}
          style={{ fontWeight: 700, color: 'var(--navy)', background: 'rgba(232,185,49,.18)', border: '1px solid var(--gold)', borderRadius: 20, padding: '2px 9px', cursor: 'help' }}>
          ⚡ costă ~{fmtEstimare(estimeazaCredite({ kind: itemKind, count: itemCount, qtype }))}
        </span>
        {costExtra}
        {isAdmin && <span>— contul tău de admin nu consumă din credite</span>}
      </div>

      {sources.length > 0 && (
        <div style={{ fontSize: '.76rem', color: 'var(--text-light)', marginTop: 6 }}>
          📷 Conținutul vine din materialul încărcat ({sources.map((sc) => sc.name).join(', ')}).
        </div>
      )}
    </div>
  );
}
