// =====================================================================
// src/components/AIPoweredBy.jsx — mențiunea publică a modelelor AI.
// Textele vin DOAR din src/lib/aiModels.js → AI_STACK (un singur loc de
// actualizat când se schimbă un model). Toate variantele duc la /faq#ai,
// unde e explicația completă (cine ce model folosește și ce date primește).
//
// Variante:
//   inline     — o linie discretă „Bazat pe OpenAI GPT-4o mini · …" (Prețuri, Despre noi)
//   chips      — etichetă + „pastile" cu numele modelelor (hero Profesor Virtual, Home)
//   footer     — două rânduri pe fundal închis: clienți (OpenAI) / unelte interne (Anthropic)
//   disclaimer — text minuscul sub câmpul de chat: modelele + „AI-ul poate greși"
//
// Props: variant, showIntern (menționează și Claude; implicit doar la footer),
//        center (aliniere centrată, pentru Home), style (suprascrieri).
// =====================================================================
import { Link } from 'react-router-dom';
import { AI_STACK, AI_STACK_SCURT } from '../lib/aiModels';

const FAQ_LINK = '/faq#ai';

export default function AIPoweredBy({ variant = 'inline', showIntern, center = false, style = {} }) {
  const { clienti, intern } = AI_STACK;
  const withIntern = showIntern ?? variant === 'footer';

  if (variant === 'footer') {
    // Pe navy-dark: textul moștenește culoarea footerului (alb 60%).
    return (
      <div style={{ fontSize: '0.8rem', lineHeight: 1.7, marginTop: 14, maxWidth: 340, ...style }}>
        <div style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 700, fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          Tehnologie AI
        </div>
        <div>
          Pentru utilizatori: <strong style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>{clienti.furnizor}</strong> — {clienti.modele.join(', ')}
        </div>
        {withIntern && (
          <div>
            Unelte interne: <strong style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>{intern.furnizor}</strong> — {intern.modele.join(', ')}
          </div>
        )}
        <Link to={FAQ_LINK} style={{ color: 'var(--gold)', fontSize: '0.78rem', fontWeight: 600 }}>
          Cum folosim AI-ul →
        </Link>
      </div>
    );
  }

  if (variant === 'chips') {
    const chip = (bg, border, color) => ({
      display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: '0.74rem', fontWeight: 700,
      background: bg, border: `1px solid ${border}`, color, whiteSpace: 'nowrap',
    });
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        justifyContent: center ? 'center' : 'flex-start', ...style,
      }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>⚡ Bazat pe {clienti.furnizor}:</span>
        {clienti.modele.map((m) => (
          <span key={m} style={chip('rgba(232,185,49,.12)', 'rgba(232,185,49,.5)', 'var(--navy)')}>{m}</span>
        ))}
        {withIntern && (
          <>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, marginLeft: 4 }}>· unelte interne {intern.furnizor}:</span>
            {intern.modele.map((m) => (
              <span key={m} style={chip('#f3e5f5', '#d7b8e8', '#5b2c83')}>{m}</span>
            ))}
          </>
        )}
        <Link to={FAQ_LINK} style={{ fontSize: '0.76rem', color: 'var(--navy)', fontWeight: 600, textDecoration: 'underline', marginLeft: 2 }}>
          detalii
        </Link>
      </div>
    );
  }

  if (variant === 'disclaimer') {
    // Sub câmpul de scris din chat: o singură linie, minusculă, ca să nu
    // împingă câmpul în afara ecranului pe panourile compacte (mobil).
    return (
      <div style={{
        fontSize: '0.66rem', color: 'var(--text-muted)', lineHeight: 1.35, padding: '0 12px 6px',
        background: '#fff', flexShrink: 0, textAlign: 'center', ...style,
      }}>
        Răspunsuri generate cu {AI_STACK_SCURT}. AI-ul poate greși — verifică rezultatele importante.{' '}
        <Link to={FAQ_LINK} style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>Detalii</Link>
      </div>
    );
  }

  // inline (implicit)
  return (
    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', ...style }}>
      ⚡ Bazat pe {AI_STACK_SCURT}
      {withIntern ? ` · unelte interne: ${intern.furnizor} ${intern.modele.join(', ')}` : ''}
      {' '}· <Link to={FAQ_LINK} style={{ color: 'var(--navy)', fontWeight: 600 }}>detalii</Link>
    </span>
  );
}
