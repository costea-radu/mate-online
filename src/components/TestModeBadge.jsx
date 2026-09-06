// =====================================================================
// src/components/TestModeBadge.jsx — „Test pe grupă în desfășurare"
//
// Se arată în vizualizatoare (interactiv / PDF / exercițiu generat) cât timp
// elevul rezolvă un TEST PE GRUPĂ, adică atunci când vizualizatorul a fost
// deschis cu o repartizare (`?gt=…` sau `state.gtId`).
//
// Două lucruri:
//   • anunță că mesageria și Profesorul Virtual sunt oprite (blocarea
//     propriu-zisă e pe server — api/messages.js verifică
//     `group_assignment_picks.active_until`);
//   • CRONOMETRUL, când profesorul a pus o limită de timp (10 minute – 3 ore).
//     Timpul rămas vine din termenul calculat de server, deci nu se resetează
//     dacă elevul reîncarcă pagina. Când ajunge la zero, testul se închide
//     singur: se anunță serverul (`time_up`), mesageria repornește și elevul e
//     trimis înapoi la pagina temei.
// =====================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';
import { endTestMode, fmtRamas, testModeInfo, useTestCountdown, TIMEUP_EVENT } from '../lib/testMode';

// sub 5 minute cronometrul devine roșu, sub 1 minut clipește
const ALERTA_MS = 5 * 60 * 1000;
const CRITIC_MS = 60 * 1000;

export default function TestModeBadge({ compact = false }) {
  const [open, setOpen] = useState(!compact);
  const [expirat, setExpirat] = useState(false);
  const navigate = useNavigate();
  const ramas = useTestCountdown();
  const inchisRef = useRef(false);

  // ── timpul a expirat → testul se încheie singur ──────────────────────────
  const inchide = useCallback(async () => {
    if (inchisRef.current) return;
    inchisRef.current = true;
    setExpirat(true);
    const info = testModeInfo();
    // testele bine-crescute își pot trimite răspunsurile la acest semnal
    try { document.querySelectorAll('iframe').forEach((f) => f.contentWindow?.postMessage({ type: 'MATE_TIME_UP' }, '*')); } catch { /* alt domeniu */ }
    // o clipă, cât să ajungă un eventual MATE_SCORE de la test
    await new Promise((r) => setTimeout(r, 1200));
    if (info?.pickId) {
      try { await aiClient.groupAssignmentTimeUp({ pickId: info.pickId }); } catch { /* serverul expiră oricum fereastra */ }
    }
    endTestMode();
    setTimeout(() => {
      if (info?.pickId) navigate('/profil');
    }, 4000);
  }, [navigate]);

  useEffect(() => {
    const onTimeUp = () => { inchide(); };
    window.addEventListener(TIMEUP_EVENT, onTimeUp);
    return () => window.removeEventListener(TIMEUP_EVENT, onTimeUp);
  }, [inchide]);

  // ── timpul a expirat: mesaj pe tot ecranul, nu doar o insignă ────────────
  if (expirat) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(20,28,45,.82)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: '26px 28px', maxWidth: 420, textAlign: 'center' }}>
          <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>⏰</div>
          <div style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', fontSize: '1.25rem', fontWeight: 700, marginBottom: 8 }}>
            Timpul a expirat
          </div>
          <p style={{ fontSize: '.88rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            Testul s-a încheiat. Ce ai apucat să trimiți a ajuns la profesor, iar mesageria și Profesorul
            Virtual repornesc acum.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/profil')}>Contul meu →</button>
        </div>
      </div>
    );
  }

  const cuTimp = ramas != null;
  const critic = cuTimp && ramas <= CRITIC_MS;
  const alerta = cuTimp && ramas <= ALERTA_MS;
  const cronoColor = critic ? '#c62828' : alerta ? '#e65100' : 'var(--navy)';

  // ── strâns: doar o pastilă (cu timpul, dacă testul are limită) ───────────
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        title={cuTimp ? 'Timp rămas până la închiderea automată a testului' : 'Mesageria și Profesorul Virtual sunt oprite în timpul testului'}
        style={{
          border: `1px solid ${cuTimp ? cronoColor : 'rgba(198,40,40,.35)'}`,
          background: cuTimp ? '#fff' : 'rgba(198,40,40,.08)',
          color: cuTimp ? cronoColor : '#8a3b3b', borderRadius: 20, padding: '3px 10px', fontSize: '.72rem',
          fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
          animation: critic ? 'mate-crono-puls 1s steps(2, jump-none) infinite' : undefined,
        }}>
        {cuTimp ? `⏳ ${fmtRamas(ramas)}` : '🔒 Test în desfășurare'}
        <style>{'@keyframes mate-crono-puls { 50% { opacity: .45 } }'}</style>
      </button>
    );
  }

  return (
    <div style={{
      display: 'inline-flex', gap: 8, alignItems: 'center', maxWidth: '100%', flexWrap: 'wrap',
      background: 'rgba(198,40,40,.08)', border: '1px solid rgba(198,40,40,.35)',
      borderRadius: 10, padding: '6px 10px',
    }}>
      {cuTimp && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, background: '#fff',
          border: `1.5px solid ${cronoColor}`, color: cronoColor, borderRadius: 8,
          padding: '3px 9px', fontWeight: 800, fontSize: '.85rem', fontVariantNumeric: 'tabular-nums',
          animation: critic ? 'mate-crono-puls 1s steps(2, jump-none) infinite' : undefined,
        }} title="Timp rămas până la închiderea automată a testului">
          ⏳ {fmtRamas(ramas)}
        </span>
      )}
      <span style={{ fontSize: '.95rem', lineHeight: 1 }}>🔒</span>
      <span style={{ fontSize: '.76rem', color: '#8a3b3b', fontWeight: 600, lineHeight: 1.35, flex: '1 1 180px', minWidth: 0 }}>
        {cuTimp
          ? <>Test cu timp de lucru — la zero se închide singur. <strong>Mesageria și Profesorul Virtual sunt oprite.</strong></>
          : <>Test pe grupă în desfășurare — <strong>mesageria și Profesorul Virtual sunt oprite</strong> până trimiți rezultatul.</>}
      </span>
      <button type="button" onClick={() => setOpen(false)} aria-label="Ascunde"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8a3b3b', fontSize: '.8rem', lineHeight: 1 }}>✕</button>
      <style>{'@keyframes mate-crono-puls { 50% { opacity: .45 } }'}</style>
    </div>
  );
}
