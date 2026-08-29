// =====================================================================
// src/components/ArenaIndicator.jsx — cârligul de revenire din Navbar:
// „🔥 6 · ⭐ 2.450" → duce în /arena. Se reîmprospătează singur după fiecare
// exercițiu rezolvat (evenimentul 'em:arena' emis de arenaChanged).
// =====================================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { arenaState, onArenaChange } from '../lib/arena';

export default function ArenaIndicator({ compact = false, onClick = null }) {
  const { user } = useAuth();
  const [s, setS] = useState(null);

  useEffect(() => {
    if (!user) { setS(null); return undefined; }
    let viu = true;
    const load = (force = false) => arenaState({ force }).then((r) => { if (viu) setS(r); }).catch(() => {});
    load();
    const off = onArenaChange(() => load(true));
    return () => { viu = false; off(); };
  }, [user]);

  // Cât timp starea nu s-a încărcat arătăm oricum poarta spre Arena: altfel,
  // pe desktop nu ar exista niciun link vizibil către ea.
  if (!user) return null;
  const xp = s?.stats?.totalXp || 0;
  const streak = s?.stats?.streak || 0;

  return (
    <Link
      to="/arena"
      onClick={onClick || undefined}
      title={s ? `Arena: nivel ${s.nivel?.level} · ${xp} XP${streak ? ` · serie de ${streak} zile` : ''}` : 'Arena matematică'}
      aria-label="Arena matematică"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: compact ? '6px 0' : '4px 10px',
        borderRadius: 999,
        border: compact ? 'none' : '1px solid rgba(232,185,49,0.35)',
        background: compact ? 'none' : 'rgba(232,185,49,0.12)',
        color: 'var(--gold)', fontWeight: 700, fontSize: '0.8rem',
        textDecoration: 'none', whiteSpace: 'nowrap',
      }}
    >
      <span>⚔️</span>
      {streak > 0 && <span title="serie de zile">🔥{streak}</span>}
      {s && <span title="XP total">⭐{xp}</span>}
    </Link>
  );
}
