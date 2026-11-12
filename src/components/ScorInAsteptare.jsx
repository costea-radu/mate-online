// =====================================================================
// src/components/ScorInAsteptare.jsx — după autentificare, salvează în cont
// rezultatul testului rezolvat fără cont (src/lib/scorInAsteptare.js).
// Montat o dată, în App.jsx. Serverul verifică răspunsurile (api/ai-score.js),
// deci nota salvată e cea reală, nu cea trimisă de browser.
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { aiClient } from '../lib/aiClient';
import { arenaChanged } from '../lib/arena';
import { notaDinScor } from '../lib/nota';
import { incaOIncercare, uitaScorul, eroareDefinitiva } from '../lib/scorInAsteptare';

export default function ScorInAsteptare() {
  const { user, loading } = useAuth();
  const [salvat, setSalvat] = useState(null);   // { title, score, maxScore }
  const pornit = useRef(null);

  useEffect(() => {
    if (loading || !user?.id || pornit.current === user.id) return;
    pornit.current = user.id;
    const s = incaOIncercare();
    if (!s) return;
    aiClient.scoreSubmit({ contentId: s.contentId, answers: s.answers, score: s.score, maxScore: s.maxScore, durationSec: s.durationSec })
      .then((r) => {
        uitaScorul();
        if (!r?.ok) return;
        setSalvat({ title: s.title, score: r.score, maxScore: r.maxScore });
        try { arenaChanged(r.xp); } catch { /* ignore */ }
      })
      // eroare definitivă (test fără răspunsuri de verificat, material șters) → renunțăm;
      // altfel (rețea) mai încercăm la următoarea deschidere a site-ului
      .catch((e) => { if (eroareDefinitiva(e?.message)) uitaScorul(); });
  }, [user?.id, loading]);

  useEffect(() => {
    if (!salvat) return undefined;
    const t = setTimeout(() => setSalvat(null), 12000);
    return () => clearTimeout(t);
  }, [salvat]);

  if (!salvat) return null;
  const nota = notaDinScor(salvat.score, salvat.maxScore);
  return (
    <div role="status" style={{ position: 'fixed', top: 78, left: '50%', transform: 'translateX(-50%)', zIndex: 2000, width: 'min(420px, calc(100vw - 24px))' }}>
      <div style={{ background: 'var(--navy)', color: '#fff', borderRadius: 14, padding: '12px 14px', boxShadow: '0 8px 24px rgba(0,0,0,.28)', border: '1px solid rgba(232,185,49,.5)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span aria-hidden="true" style={{ fontSize: '1.3rem' }}>✅</span>
        <div style={{ flex: 1, minWidth: 0, fontSize: '.9rem', lineHeight: 1.45 }}>
          <strong>Rezultatul tău e salvat în cont.</strong>
          <div style={{ color: 'rgba(255,255,255,.82)' }}>
            {salvat.title ? `„${salvat.title}": ` : ''}{salvat.score}/{salvat.maxScore}{nota != null ? ` — nota ${nota}` : ''}.{' '}
            <Link to="/profil?rezultate=1" onClick={() => setSalvat(null)} style={{ color: 'var(--gold)', fontWeight: 700 }}>Vezi rezultatele</Link>
          </div>
        </div>
        <button type="button" onClick={() => setSalvat(null)} aria-label="Închide" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.6)', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
      </div>
    </div>
  );
}
