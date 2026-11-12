// =====================================================================
// src/components/ExercitiuRapid.jsx — „Încearcă acum": un exercițiu-grilă pe care
// vizitatorul îl rezolvă chiar din Home, cu răspunsul pe loc (11 nov. 2026).
//
// De ce: vizitatorul vede în 5 secunde ce face site-ul (alegi un răspuns → afli
// pe loc dacă e bun și de ce), fără cont și fără să citească nimic. După 3
// exerciții: „▶ Fă un test întreg" (primul test interactiv gratuit de Evaluare
// Națională, src/lib/testRapid.js).
// Fără AI și fără bază de date: exercițiile sunt aici, în cod.
// =====================================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { testRapid, linkTest } from '../lib/testRapid';
import { track } from '../lib/analytics';

// q = întrebarea · opt = variantele · ok = indexul celei corecte · de = de ce
export const EXERCITII = [
  { q: 'Cât face 2³ · 2² ?', opt: ['12', '16', '32', '64'], ok: 2, de: 'La înmulțire, exponenții se adună: 2³ · 2² = 2⁵ = 32.' },
  { q: 'Soluția ecuației 3x − 5 = 16 este:', opt: ['x = 7', 'x = 5', 'x = 8', 'x = 6'], ok: 0, de: '3x = 16 + 5 = 21, deci x = 21 : 3 = 7.' },
  { q: '20% din 150 este:', opt: ['15', '30', '20', '35'], ok: 1, de: '20% înseamnă o cincime: 150 : 5 = 30.' },
  { q: 'Un triunghi are două unghiuri de 50° și 60°. Al treilea are:', opt: ['60°', '80°', '90°', '70°'], ok: 3, de: 'Suma unghiurilor unui triunghi e 180°: 180° − 50° − 60° = 70°.' },
  { q: '√144 − √49 =', opt: ['5', '7', '12', '95'], ok: 0, de: '√144 = 12 și √49 = 7, deci 12 − 7 = 5.' },
  { q: 'Media aritmetică a numerelor 6, 8 și 10 este:', opt: ['7', '9', '8', '24'], ok: 2, de: '(6 + 8 + 10) : 3 = 24 : 3 = 8.' },
  { q: 'Aria unui pătrat cu latura de 6 cm este:', opt: ['12 cm²', '24 cm²', '36 cm²', '48 cm²'], ok: 2, de: 'Aria pătratului = latura · latura = 6 · 6 = 36 cm².' },
];
const CATE = 3;   // câte exerciții într-o tură
const LITERE = ['a', 'b', 'c', 'd'];

// primul exercițiu al zilei: altul în fiecare zi, același pentru toți
export function primulDeAzi(acum = new Date(), n = EXERCITII.length) {
  const zi = Math.floor((Date.UTC(acum.getFullYear(), acum.getMonth(), acum.getDate()) - Date.UTC(acum.getFullYear(), 0, 0)) / 86400000);
  return ((zi % n) + n) % n;
}

export default function ExercitiuRapid() {
  const [start] = useState(() => primulDeAzi());
  const [pas, setPas] = useState(0);          // al câtelea exercițiu din tură (0…CATE-1)
  const [ales, setAles] = useState(null);     // varianta aleasă la exercițiul curent
  const [bune, setBune] = useState(0);
  const [gata, setGata] = useState(false);
  const [test, setTest] = useState(null);     // primul test interactiv gratuit de EN
  useEffect(() => {
    let viu = true;
    testRapid({ category: 'evaluare-nationala' }).then((t) => { if (viu) setTest(t); });
    return () => { viu = false; };
  }, []);

  const ex = EXERCITII[(start + pas) % EXERCITII.length];
  const raspuns = ales !== null;
  const corect = raspuns && ales === ex.ok;
  const spreTest = linkTest(test) || '/evaluare-nationala?tab=interactive';

  function alege(i) {
    if (raspuns) return;
    setAles(i);
    if (i === ex.ok) setBune((b) => b + 1);
    if (pas === 0) track('mini_exercitiu', { corect: i === ex.ok ? 1 : 0 });
  }
  function urmatorul() {
    if (pas + 1 >= CATE) { setGata(true); return; }
    setPas((p) => p + 1);
    setAles(null);
  }

  if (gata) {
    return (
      <div className="exr" aria-live="polite">
        <div className="exr-sus">Ai terminat tura</div>
        <p className="exr-q">{bune === CATE ? '🎉 ' : ''}{bune} din {CATE} corecte.</p>
        <p className="exr-de">Un test întreg are 18 exerciții ca acestea și îți dă nota la sfârșit.</p>
        <div className="exr-act">
          <Link to={spreTest} className="btn btn-primary" onClick={() => track('mini_exercitiu_test', {})}>▶ Fă un test întreg</Link>
          <Link to="/inregistrare" className="btn btn-outline">Creează cont gratuit</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="exr">
      <div className="exr-sus">
        <span>Încearcă acum</span>
        <span className="exr-pas" aria-label={`Exercițiul ${pas + 1} din ${CATE}`}>{pas + 1}/{CATE}</span>
      </div>
      <p className="exr-q" id="exr-q">{ex.q}</p>
      <div className="exr-opt" role="group" aria-labelledby="exr-q">
        {ex.opt.map((o, i) => {
          const stare = !raspuns ? '' : i === ex.ok ? ' bun' : i === ales ? ' gresit' : ' stins';
          return (
            <button key={o} type="button" className={`exr-o${stare}`} onClick={() => alege(i)} disabled={raspuns} aria-pressed={ales === i}>
              <b>{LITERE[i]})</b> {o}
            </button>
          );
        })}
      </div>
      <div className="exr-rez" aria-live="polite">
        {raspuns && (
          <>
            <p className={`exr-verdict${corect ? ' bun' : ' gresit'}`}>{corect ? '✓ Corect!' : `✗ Răspunsul corect: ${LITERE[ex.ok]}) ${ex.opt[ex.ok]}`}</p>
            <p className="exr-de">{ex.de}</p>
            <div className="exr-act">
              <button type="button" className="btn btn-primary" onClick={urmatorul}>{pas + 1 >= CATE ? 'Vezi rezultatul' : 'Următorul exercițiu'}</button>
              <Link to={spreTest} className="exr-link" onClick={() => track('mini_exercitiu_test', {})}>sau fă un test întreg</Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
