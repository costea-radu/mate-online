// =====================================================================
// src/components/AICreditAlert.jsx — AVERTIZAREA PE PRAGURI a creditelor AI
//
// Elevul află CÂT a consumat chiar în clipa în care consumă, nu abia când se
// oprește totul. Patru trepte, tot mai apăsate, plus starea de epuizare:
//
//   50%  · verde-auriu · „ai folosit jumătate" + sfatul de a le păstra
//   75%  · chihlimbar  · „ți-a mai rămas un sfert"
//   90%  · portocaliu  · „au mai rămas foarte puține"
//   95%  · roșu        · „ești pe ultimele credite"
//   100% · roșu plin   · oprit, cu butoanele „⚡ Ia un pachet AI" / „Vezi consumul"
//
// Sfatul e același peste tot, în cuvinte simple: Profesorul Virtual costă
// credite la fiecare întrebare, deci merită păstrat pentru ce chiar nu iese
// singur. Nu e o mustrare — e informația de care are nevoie ca să-și
// împartă luna.
//
// Starea vine din src/lib/aiCredit.js, alimentată automat de fiecare răspuns
// AI (fără cereri în plus). Sub 50% componenta nu afișează nimic.
// =====================================================================
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAIBudget, subscribeAIBudget, reimprospateaza } from '../lib/aiCredit';

const nrRo = (n) => Number(n || 0).toLocaleString('ro-RO');

// culorile și cuvintele fiecărei trepte
const TREPTE = {
  50: {
    bg: 'rgba(232,185,49,.10)', border: 'rgba(232,185,49,.45)', text: '#7a611a', icon: '⚡',
    titlu: (b) => `Ai folosit jumătate din creditele AI ale lunii (${nrRo(b.creditsUsed)} din ${nrRo(b.creditsTotal)}).`,
    sfat: 'De aici încolo merită să-l chemi pe Profesorul Virtual când chiar te împotmolești — la exercițiile care îți ies singur, creditele rămân pentru mai târziu.',
  },
  75: {
    bg: 'rgba(230,126,34,.10)', border: 'rgba(230,126,34,.45)', text: '#a65a12', icon: '⚠️',
    titlu: (b) => `Ți-a mai rămas un sfert din creditele AI ale lunii — ${nrRo(b.creditsLeft)} din ${nrRo(b.creditsTotal)}.`,
    sfat: 'Folosește-l doar la nevoie: o întrebare bine pusă, la exercițiul care chiar nu iese, valorează cât cinci întrebări la întâmplare.',
  },
  90: {
    bg: 'rgba(230,126,34,.16)', border: 'rgba(230,126,34,.6)', text: '#8a4208', icon: '⚠️',
    titlu: (b) => `Au mai rămas puține credite AI: ${nrRo(b.creditsLeft)} din ${nrRo(b.creditsTotal)}.`,
    sfat: 'Păstrează-le pentru ce nu poți rezolva altfel. Materialele, testele și rezolvările din site nu consumă credite — le poți folosi oricât.',
  },
  95: {
    bg: 'rgba(198,40,40,.09)', border: 'rgba(198,40,40,.45)', text: '#8a3b3b', icon: '🔴',
    titlu: (b) => `Ești pe ultimele credite AI: ${nrRo(b.creditsLeft)} din ${nrRo(b.creditsTotal)}.`,
    sfat: 'Mai ai loc de câteva întrebări. Când se termină, Profesorul Virtual se oprește până se eliberează credite — restul platformei merge normal.',
  },
};

export default function AICreditAlert({ compact = false, style }) {
  const [b, setB] = useState(getAIBudget);
  const navigate = useNavigate();

  useEffect(() => {
    const off = subscribeAIBudget(setB);
    reimprospateaza(false);   // dacă încă nu știm nimic, aflăm o dată
    return off;
  }, []);

  if (!b || (!b.blocked && !b.step)) return null;
  if (b.topupActive && !b.blocked) return null;   // are pachet activ → nu-l batem la cap

  const spreConsum = () => navigate('/profil?topup=vezi#consum-ai');

  // ── EPUIZAT: mesajul care spune ce se întâmplă mai departe + butoane ──────
  if (b.blocked) {
    return (
      <div style={{
        background: 'rgba(198,40,40,.08)', border: '1px solid rgba(198,40,40,.45)',
        borderRadius: 12, padding: compact ? '10px 12px' : '12px 14px', ...style,
      }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <span style={{ fontSize: '1.05rem', lineHeight: 1.2 }}>🔒</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, color: '#8a3b3b', fontSize: compact ? '.84rem' : '.9rem' }}>
              Creditele AI ale lunii s-au terminat
            </div>
            <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.55 }}>
              Profesorul Virtual se oprește până se eliberează credite. <strong>Nu pierzi nimic</strong>: lecția, temele
              și progresul rămân unde sunt și reluăm de unde am rămas. Creditele se eliberează treptat, zi de zi
              (fereastra de 30 de zile alunecă), sau imediat cu un pachet suplimentar.
              {' '}Materialele, testele și rezolvările din site merg mai departe, fără credite.
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" onClick={spreConsum} style={{
                padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'var(--gold)', color: 'var(--navy-dark)', fontWeight: 700,
                fontSize: '.82rem', fontFamily: 'var(--font-body)',
              }}>⚡ Ia un pachet AI</button>
              <button type="button" onClick={spreConsum} style={{
                padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                border: '1.5px solid var(--navy)', background: 'transparent', color: 'var(--navy)',
                fontWeight: 600, fontSize: '.82rem', fontFamily: 'var(--font-body)',
              }}>Vezi consumul</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 50 / 75 / 90 / 95% ───────────────────────────────────────────────────
  const t = TREPTE[b.step] || TREPTE[50];
  return (
    <div style={{
      background: t.bg, border: `1px solid ${t.border}`, borderRadius: 12,
      padding: compact ? '8px 11px' : '10px 13px', ...style,
    }}>
      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
        <span style={{ fontSize: '.95rem', lineHeight: 1.3 }}>{t.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: t.text, fontSize: compact ? '.8rem' : '.85rem', lineHeight: 1.45 }}>
            {t.titlu(b)}
          </div>
          <div style={{ fontSize: compact ? '.76rem' : '.79rem', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.55 }}>
            {t.sfat}
          </div>
          {/* bara: cât s-a dus din creditele lunii */}
          <div style={{ height: 5, background: 'rgba(15,43,68,.12)', borderRadius: 99, overflow: 'hidden', marginTop: 7 }}>
            <div style={{ height: '100%', width: `${Math.min(100, b.pct)}%`, background: t.text, opacity: .75, borderRadius: 99, transition: 'width .4s' }} />
          </div>
          <button type="button" onClick={spreConsum} style={{
            background: 'none', border: 'none', padding: '5px 0 0', cursor: 'pointer',
            color: t.text, fontWeight: 700, fontSize: '.75rem', textDecoration: 'underline',
            fontFamily: 'var(--font-body)',
          }}>Vezi consumul și pachetele →</button>
        </div>
      </div>
    </div>
  );
}
