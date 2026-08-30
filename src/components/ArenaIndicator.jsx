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
  const provocari = s?.dueluri?.provocari || 0;   // provocări la care n-am răspuns
  const deJucat = s?.dueluri?.deJucat || 0;       // dueluri acceptate, nejucate

  return (
    <Link
      to="/arena"
      onClick={onClick || undefined}
      title={provocari > 0
        ? `${provocari} ${provocari === 1 ? 'provocare nouă la duel' : 'provocări noi la duel'}`
        : s ? `Arena: nivel ${s.nivel?.level} · ${xp} XP${streak ? ` · serie de ${streak} zile` : ''}` : 'Arena matematică'}
      aria-label="Arena matematică"
      style={{
        position: 'relative',
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
      {/* provocare nouă la duel — bulina roșie, ca la mesagerie */}
      {(provocari > 0 || deJucat > 0) && (
        <span style={{
          position: 'absolute', top: -6, right: -6, minWidth: 17, height: 17,
          borderRadius: 999, background: provocari > 0 ? '#ff4d4f' : 'var(--navy-light, #183d5e)',
          color: '#fff', fontSize: '0.68rem', fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
          border: '2px solid var(--navy, #0f2b44)',
        }}>
          {provocari > 0 ? provocari : deJucat}
        </span>
      )}
    </Link>
  );
}
