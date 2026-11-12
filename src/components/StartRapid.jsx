// =====================================================================
// src/components/StartRapid.jsx — „▶ Începe un test", sus, pe paginile de examen
// (11 nov. 2026, seara)
//
// De ce: pe /evaluare-nationala și /bacalaureat secțiunile pornesc pliate — până
// la primul test erau 3 atingeri și nimic din pagină nu arăta a test. Butonul
// duce direct în primul test interactiv gratuit pe care utilizatorul nu l-a
// rezolvat (src/lib/testRapid.js), fără cont. Elevii și vizitatorii au alături
// „🎯 Testul zilei"; profesorii — generatorul de subiecte.
// =====================================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { testRapid, linkTest } from '../lib/testRapid';

export default function StartRapid({ category, profile = null, toate = null }) {
  const { user, isTeacher, isParent, loading } = useAuth();
  const [test, setTest] = useState(undefined);   // undefined = se caută · null = niciunul
  useEffect(() => {
    if (loading) return undefined;
    let viu = true;
    setTest(undefined);
    testRapid({ category, profile, userId: user?.id || null }).then((t) => { if (viu) setTest(t); });
    return () => { viu = false; };
  }, [category, profile, user?.id, loading]);

  const link = linkTest(test);
  // fără niciun test interactiv gratuit în rubrică: nu arătăm un buton care nu duce nicăieri
  if (test === null && !toate) return null;
  return (
    <div className="start-rapid">
      {link
        ? <Link to={link} className="btn btn-primary btn-lg">▶ Începe un test</Link>
        : toate ? <Link to={toate} className="btn btn-primary btn-lg">▶ Începe un test</Link> : <span className="btn btn-primary btn-lg" aria-disabled="true" style={{ opacity: 0.6 }}>▶ Începe un test</span>}
      <span className="start-rapid-txt">interactiv, cu nota pe loc{user ? '' : ' — fără cont'}</span>
      {isTeacher
        ? <Link to="/profesor-virtual?tab=exam" className="btn btn-outline">📄 Generează un subiect</Link>
        : !isParent && <Link to="/pregateste-ma" className="btn btn-outline">🎯 Testul zilei</Link>}
    </div>
  );
}
