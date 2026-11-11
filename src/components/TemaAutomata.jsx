// =====================================================================
// src/components/TemaAutomata.jsx — „📝 CREEAZĂ O TEMĂ ELEVULUI" (11 nov. 2026)
//
// Cererea: „în contul de părinți, asistentul AI să facă doar asta: creează o
// temă elevului, ceea ce creează automat o temă pentru nivelul elevului, sau
// subiect de examen din cele din site, fără AI".
//
// Asistentul părinților (meniul → „Asistent AI pentru părinți", /profesor-virtual,
// și widgetul plutitor) arată DOAR acest panou:
//   🧩 Temă pe nivelul lui — 3–10 exerciții interactive din clasa copilului, ca la
//      misiunea zilnică: întâi ce n-a lucrat niciodată, apoi ce i-a ieșit sub 70%;
//   📄 Subiect de examen — un test din site al examenului lui (EN / BAC).
// Alegerea o face serverul (api/homework.js → auto_create, api/_lib/temaAutomata.js),
// fără niciun model AI. Copilul găsește tema în „Contul meu → 📌 Teme" și primește
// o notificare; părintele vede mai jos cât a rezolvat (📝 Temele date).
// =====================================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';
import TemeDate from './TemeDate';

const NUMERE = [3, 5, 8, 10];

export default function TemaAutomata({ compact = false, onNavigate = null }) {
  const [opt, setOpt] = useState(null);           // { students, clase, examene }
  const [error, setError] = useState(null);
  const [studentId, setStudentId] = useState(null);
  const [fel, setFel] = useState('nivel');
  const [clasa, setClasa] = useState('');
  const [examen, setExamen] = useState('');
  const [numar, setNumar] = useState(5);
  const [dueAt, setDueAt] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [rez, setRez] = useState(null);
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    let viu = true;
    aiClient.homeworkAutoOptions()
      .then((r) => { if (viu) setOpt(r); })
      .catch((e) => { if (viu) { setError(e.message); setOpt({ students: [], clase: [], examene: [] }); } });
    return () => { viu = false; };
  }, []);

  const students = opt?.students || [];
  const elev = students.find((s) => s.id === studentId) || students[0] || null;
  // la schimbarea copilului: clasa și examenul lui
  useEffect(() => {
    if (!elev) return;
    setClasa(elev.clasa || '');
    setExamen(elev.examen || 'evaluare-nationala');
  }, [elev?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function creeaza() {
    if (!elev || busy) return;
    if (fel === 'nivel' && !clasa) { setError('Alege clasa copilului.'); return; }
    setBusy(true); setError(null); setRez(null);
    try {
      const r = await aiClient.homeworkAuto({
        studentId: elev.id, fel, clasa: fel === 'nivel' ? clasa : null, examen: fel === 'examen' ? examen : null,
        numar, dueAt: dueAt ? new Date(`${dueAt}T20:00:00`).toISOString() : null, note: note.trim() || null,
      });
      setRez(r); setNote(''); setSeed((n) => n + 1);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const pad = compact ? 12 : 0;
  const card = (activ) => ({
    flex: '1 1 200px', textAlign: 'left', cursor: 'pointer', borderRadius: 12, padding: compact ? '10px 12px' : '14px 16px',
    border: `2px solid ${activ ? 'var(--gold)' : 'var(--border)'}`, background: activ ? 'rgba(232,185,49,.12)' : '#fff',
    color: 'var(--navy)', fontFamily: 'var(--font-body)',
  });
  const sel = { padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--border)', background: '#fff', fontSize: 16, color: 'var(--navy)', fontFamily: 'var(--font-body)' };
  const label = { fontSize: '.78rem', fontWeight: 700, color: 'var(--text-light)', display: 'block', marginBottom: 4 };

  if (!opt) {
    return <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: '.9rem' }}><span className="spinner" style={{ width: 18, height: 18, borderWidth: 2, display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }} />Se încarcă…</div>;
  }

  return (
    <div className="tema-automata" style={{ padding: pad, display: 'grid', gap: compact ? 12 : 16 }}>
      <div>
        <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: 0, fontSize: compact ? '1.02rem' : '1.3rem' }}>📝 Creează o temă elevului</h3>
        <p style={{ color: 'var(--text-light)', fontSize: compact ? '.8rem' : '.9rem', margin: '4px 0 0', lineHeight: 1.5 }}>
          Alegem automat, din exercițiile site-ului — <strong>fără AI</strong>: întâi ce n-a lucrat încă, apoi ce i-a ieșit sub 70%.
          Copilul primește o notificare și găsește tema în „Contul meu → 📌 Teme".
        </p>
      </div>

      {!students.length ? (
        <div style={{ background: 'var(--cream)', borderRadius: 12, padding: '14px 16px', fontSize: '.88rem', color: 'var(--navy)' }}>
          Încă nu ești asociat cu copilul tău. Trimite-i linkul de asociere — după ce îl deschide, îi poți da teme de aici.
          <div style={{ marginTop: 10 }}>
            <Link to="/profil?asociere=1" onClick={() => onNavigate?.()} className="btn btn-primary btn-sm">🔗 Asociază-te cu copilul tău</Link>
          </div>
          {error && <div style={{ marginTop: 8, color: 'var(--danger)', fontSize: '.8rem' }}>⚠️ {error}</div>}
        </div>
      ) : (
        <>
          {students.length > 1 && (
            <div>
              <span style={label}>Pentru</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {students.map((s) => (
                  <button key={s.id} type="button" aria-pressed={elev?.id === s.id} onClick={() => { setStudentId(s.id); setRez(null); }}
                    style={{ padding: '6px 14px', borderRadius: 20, fontWeight: 700, fontSize: '.84rem', cursor: 'pointer', border: `1.5px solid ${elev?.id === s.id ? 'var(--navy)' : 'var(--border)'}`, background: elev?.id === s.id ? 'var(--navy)' : '#fff', color: elev?.id === s.id ? '#fff' : 'var(--navy)' }}>
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" aria-pressed={fel === 'nivel'} onClick={() => setFel('nivel')} style={card(fel === 'nivel')}>
              <strong style={{ display: 'block', fontSize: '.95rem' }}>🧩 Temă pe nivelul lui</strong>
              <span style={{ display: 'block', fontSize: '.78rem', color: 'var(--text-light)', marginTop: 3 }}>exerciții interactive din clasa lui, corectate pe loc</span>
            </button>
            <button type="button" aria-pressed={fel === 'examen'} onClick={() => setFel('examen')} style={card(fel === 'examen')}>
              <strong style={{ display: 'block', fontSize: '.95rem' }}>📄 Subiect de examen</strong>
              <span style={{ display: 'block', fontSize: '.78rem', color: 'var(--text-light)', marginTop: 3 }}>un test din site, ca la Evaluarea Națională / BAC</span>
            </button>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {fel === 'nivel' ? (
              <>
                <label style={{ flex: '1 1 160px' }}>
                  <span style={label}>Clasa {elev?.sursaClasa === 'misiune' ? '(aleasă de el în Arenă)' : elev?.clasa ? '(după ce a lucrat)' : ''}</span>
                  <select value={clasa} onChange={(e) => setClasa(e.target.value)} style={{ ...sel, width: '100%' }}>
                    <option value="">Alege clasa…</option>
                    {(opt.clase || []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
                <label>
                  <span style={label}>Câte exerciții</span>
                  <select value={numar} onChange={(e) => setNumar(Number(e.target.value))} style={sel}>
                    {NUMERE.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <label style={{ flex: '1 1 200px' }}>
                <span style={label}>Examenul {elev?.examenAles ? '(ales de el în „Pregătește-mă")' : ''}</span>
                <select value={examen} onChange={(e) => setExamen(e.target.value)} style={{ ...sel, width: '100%' }}>
                  {(opt.examene || []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </label>
            )}
            <label>
              <span style={label}>Termen (opțional)</span>
              <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={sel} />
            </label>
          </div>

          <label>
            <span style={label}>Un mesaj pentru el (opțional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 300))} placeholder="ex. Fă-o până joi, apoi ieșim în parc 🙂"
              style={{ ...sel, width: '100%' }} />
          </label>

          {elev && !elev.premium && (
            <p style={{ fontSize: '.76rem', color: 'var(--text-muted)', margin: 0 }}>
              {elev.name.split(' ')[0]} nu are abonament: alegem doar din exercițiile gratuite.
            </p>
          )}
          {error && <div style={{ background: '#fce4ec', color: 'var(--danger)', borderRadius: 8, padding: '8px 11px', fontSize: '.84rem' }}>⚠️ {error}</div>}

          <div>
            <button type="button" onClick={creeaza} disabled={busy || !elev}
              className="btn btn-primary" style={{ fontWeight: 800, opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Se creează…' : `✨ Creează tema pentru ${elev ? elev.name.split(' ')[0] : 'copil'}`}
            </button>
          </div>

          {rez && (
            <div role="status" style={{ background: '#e8f5e9', border: '1px solid rgba(46,125,50,.35)', borderRadius: 12, padding: '12px 14px', fontSize: '.86rem', color: '#1e5e23' }}>
              <strong>✓ Tema „{rez.title}" a fost trimisă lui {String(rez.studentName || '').split(' ')[0]}.</strong>
              <ol style={{ margin: '8px 0 6px', paddingLeft: 20, color: 'var(--text)' }}>
                {(rez.items || []).map((it) => (
                  <li key={it.id} style={{ marginBottom: 2 }}>{it.title} <span style={{ color: 'var(--text-muted)', fontSize: '.76rem' }}>({it.kind === 'pdf' ? 'PDF' : 'interactiv'})</span></li>
                ))}
              </ol>
              <span style={{ fontSize: '.78rem' }}>A primit o notificare; tema e în „Contul meu → 📌 Teme". Vezi mai jos cât a rezolvat.</span>
            </div>
          )}

          <TemeDate seed={seed} faraMesagerie deschisa />
        </>
      )}
    </div>
  );
}
