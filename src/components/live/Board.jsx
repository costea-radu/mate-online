// =====================================================================
// src/components/live/Board.jsx — TABLA ALBĂ și TABLA DIGITALĂ din sala live
//
// Tabla albă: ce SCRIE profesorul, rând cu rând, în ritmul vocii (fiecare
// rând se „desenează" de la stânga la dreapta cât timp profesorul spune fraza).
// Când rezolvarea e lungă, scrisul se face mai mic (ca să rămână TOȚI pașii la
// vedere); abia apoi tabla „urcă". La alt item, tabla se șterge.
//
// Tabla digitală: ce ARATĂ profesorul — enunțul itemului (cu variantele),
// rezultatele întrebărilor, videoclipuri de matematică, pauza cu cronometrul,
// titlul ședinței la început și rezumatul la final.
// =====================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { ensureKatex, renderMath } from '../../lib/katex';
import { fmtClock } from '../../lib/live/timeline';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function mdLite(s) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br/>');
}

// Un fragment de text cu formule ($...$), randat o singură dată cu KaTeX
export function MathHtml({ text, className = '', tag: Tag = 'div', style = null }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = mdLite(text);
    let alive = true;
    ensureKatex().then(() => { if (alive && ref.current === el) renderMath(el); });
    return () => { alive = false; };
  }, [text]);
  return <Tag ref={ref} className={className} style={style} />;
}

// Un rând scris cu markerul: se dezvăluie de la stânga la dreapta (frac 0..1)
function InkLine({ text, frac }) {
  const f = Math.max(0, Math.min(1, frac));
  return (
    <div className={`lv-ink${f >= 1 ? ' is-done' : ''}`} style={{ clipPath: `inset(-30% ${((1 - f) * 100).toFixed(1)}% -30% -2%)` }}>
      <MathHtml text={text} className="lv-ink-in" />
    </div>
  );
}

const MODE_ICON = { barem: '📏', intuitiv: '💡', greseli: '⚠️', alta_metoda: '🔀', raspuns: '💬' };

// cât de mic poate deveni scrisul pe tabla plină (față de mărimea obișnuită)
const FIT_MIN = 0.7;

// Tabla albă propriu-zisă
export function WhiteboardInk({ board, compact = false }) {
  const scrollRef = useRef(null);
  const innerRef = useRef(null);
  const [fit, setFit] = useState(1);
  const fitRef = useRef(1);
  const count = board ? board.blocks.reduce((n, b) => n + b.lines.length, 0) : 0;
  // alt item → tabla curată, scrisul la mărimea obișnuită
  useEffect(() => { fitRef.current = 1; setFit(1); }, [board?.item]);
  // tabla se umple → scrisul se micșorează (până la FIT_MIN), ca toată rezolvarea să rămână la vedere
  useEffect(() => {
    const el = scrollRef.current, inner = innerRef.current;
    if (!el || !inner || typeof ResizeObserver === 'undefined') return undefined;
    const check = () => {
      if (el.scrollHeight <= el.clientHeight + 2 || fitRef.current <= FIT_MIN) return;
      const next = Math.max(FIT_MIN, Math.round(fitRef.current * 0.93 * 100) / 100);
      if (next < fitRef.current) { fitRef.current = next; setFit(next); }
    };
    const ro = new ResizeObserver(check);
    ro.observe(inner);
    check();
    return () => ro.disconnect();
  }, [board?.item, board == null]);
  // tabla „urcă" singură când s-a umplut de tot (ca un profesor care scrie mai jos)
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [count, board?.item, fit]);
  const [wipe, setWipe] = useState(false);
  const lastItem = useRef(null);
  useEffect(() => {
    if (board?.item == null) return;
    if (lastItem.current != null && lastItem.current !== board.item) {
      setWipe(true);
      const t = setTimeout(() => setWipe(false), 700);
      lastItem.current = board.item;
      return () => clearTimeout(t);
    }
    lastItem.current = board.item;
  }, [board?.item]);

  if (!board) return <div className={`lv-wb-ink${compact ? ' is-compact' : ''}`} />;
  return (
    <div className={`lv-wb-ink${compact ? ' is-compact' : ''}${wipe ? ' is-wiping' : ''}`} ref={scrollRef}>
      <div ref={innerRef} className="lv-wb-fit" style={fit < 1 ? { fontSize: `${fit}em` } : undefined}>
        <div className="lv-wb-title">{board.title}</div>
        {board.blocks.map((b, bi) => (
          <div key={b.key} className={`lv-wb-block mode-${b.mode}`}>
            {bi > 0 && b.lines.length > 0 && <div className="lv-wb-sep"><span>{MODE_ICON[b.mode] || '✎'} {b.label}</span></div>}
            {b.lines.map((l) => <InkLine key={l.key} text={l.text} frac={l.frac} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

// Rezultatele unei întrebări (bare pe variante, ca la Zoom Polls)
export function PollBars({ poll, results, mine = null, reveal = true }) {
  if (!poll) return null;
  const total = results?.total || 0;
  if (poll.type === 'grila') {
    return (
      <div className="lv-bars">
        {(poll.options || []).map((o, i) => {
          const k = 'abcd'[i];
          const pct = results?.pct?.[k] || 0;
          const ok = reveal && poll.answer === k;
          return (
            <div key={k} className={`lv-bar${ok ? ' is-ok' : ''}${mine === k ? ' is-mine' : ''}`}>
              <span className="lv-bar-k">{k})</span>
              <MathHtml tag="span" className="lv-bar-t" text={o} />
              <span className="lv-bar-track"><span className="lv-bar-fill" style={{ width: `${pct}%` }} /></span>
              <span className="lv-bar-pct">{pct}%</span>
            </div>
          );
        })}
        <div className="lv-bars-foot">{total ? `${total} ${total === 1 ? 'răspuns' : 'răspunsuri'} · ${results.correctPct}% corecte` : 'Niciun răspuns încă'}</div>
      </div>
    );
  }
  return (
    <div className="lv-bars">
      {reveal && <div className="lv-bars-answer">Răspunsul corect: <MathHtml tag="b" text={`$${String(poll.answer || '').replace(/\$/g, '')}$`} /></div>}
      <div className="lv-bars-foot">{total ? `${total} ${total === 1 ? 'răspuns' : 'răspunsuri'} · ${results.correctPct}% corecte` : 'Niciun răspuns încă'}</div>
    </div>
  );
}

// Video pe tabla digitală: YouTube (sincronizat cu clasa) sau MP4
function ScreenVideo({ video, offset }) {
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/.exec(String(video?.url || ''));
  const start = Math.max(0, Math.floor((video?.start || 0) + offset));
  if (yt) {
    return (
      <iframe className="lv-screen-video" title="video" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen
        src={`https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&start=${start}&rel=0&modestbranding=1&playsinline=1`} />
    );
  }
  return <video className="lv-screen-video" src={video.url} autoPlay playsInline controls={false} ref={(el) => { if (el && Math.abs(el.currentTime - start) > 2) { try { el.currentTime = start; } catch { /* ignore */ } } }} />;
}

// Tabla digitală
export function DigitalScreen({ state, results, myAnswers, title, examLabel, teacherName, covered }) {
  const sc = state?.scene;
  const head = state?.head;
  if (!state || state.phase === 'asteptare') {
    return (
      <div className="lv-screen lv-screen-title">
        <div className="lv-screen-kicker">{examLabel}</div>
        <div className="lv-screen-big">{title}</div>
        {state?.startsIn != null && <div className="lv-screen-count">Începem în <b>{fmtClock(state.startsIn)}</b></div>}
        <div className="lv-screen-note">Explicat pe baremul oficial · {teacherName}</div>
      </div>
    );
  }
  if (state.phase === 'final' || sc?.type === 'final') {
    return (
      <div className="lv-screen lv-screen-title">
        <div className="lv-screen-kicker">Ședința se încheie</div>
        <div className="lv-screen-big">Mulțumim! 👏</div>
        {covered && <div className="lv-screen-note">Am lucrat {covered.covered} din {covered.total} itemi, pe barem.</div>}
      </div>
    );
  }
  if (sc?.type === 'intro') {
    return (
      <div className="lv-screen lv-screen-title">
        <div className="lv-screen-kicker">{examLabel}</div>
        <div className="lv-screen-big">{title}</div>
        <div className="lv-screen-note">Rezolvare pe baremul oficial · încercați întâi singuri · întrebările în chat</div>
      </div>
    );
  }
  if (sc?.type === 'pauza') {
    return (
      <div className="lv-screen lv-screen-title">
        <div className="lv-screen-kicker">☕ Pauză</div>
        <div className="lv-screen-big lv-mono">{fmtClock(state.remaining || 0)}</div>
        <div className="lv-screen-note">Revenim imediat. Între timp, notează ce ți s-a părut greu.</div>
      </div>
    );
  }
  if (sc?.type === 'intrebari') {
    return (
      <div className="lv-screen lv-screen-title">
        <div className="lv-screen-kicker">✋ Întrebări și răspunsuri</div>
        {state.answering
          ? <MathHtml className="lv-screen-answer" text={state.answering.text} />
          : <div className="lv-screen-big lv-screen-mid">Scrieți în chat ce nu a fost clar</div>}
        <div className="lv-screen-note">Profesorul răspunde pe rând · {fmtClock(state.remaining || 0)}</div>
      </div>
    );
  }
  if (sc?.type === 'video' && sc.video) {
    return <div className="lv-screen lv-screen-media"><ScreenVideo video={sc.video} offset={state.offset || 0} /></div>;
  }
  if (sc?.type === 'rezultate' && sc.poll) {
    return (
      <div className="lv-screen">
        <div className="lv-screen-kicker">📊 Rezultatele — {sc.title}</div>
        <MathHtml className="lv-screen-q" text={sc.poll.question} />
        <PollBars poll={sc.poll} results={results[sc.poll.id]} mine={myAnswers[sc.poll.id]?.answer} />
      </div>
    );
  }
  // enunțul itemului curent. La „Arătați că…", cât încearcă elevii se vede cerința
  // reformulată („Calculați…", fără rezultat); de la explicație încolo, cea din subiect.
  if (head) {
    const trying = !!head.statementTry && (sc?.type === 'item' || sc?.type === 'sondaj');
    const original = !!head.statementTry && !trying;
    return (
      <div className="lv-screen">
        <div className="lv-screen-kicker">{head.title}{head.points ? ` · ${head.points} puncte` : ''}{original ? ' · cerința din subiect' : ''}</div>
        <MathHtml className="lv-screen-statement" text={trying ? head.statementTry : head.statement} />
        {head.options && (
          <div className="lv-screen-opts">
            {head.options.map((o, i) => (
              <div key={i} className="lv-screen-opt"><b>{'abcd'[i]})</b> <MathHtml tag="span" text={o} /></div>
            ))}
          </div>
        )}
      </div>
    );
  }
  return <div className="lv-screen lv-screen-title"><div className="lv-screen-big">{title}</div></div>;
}

// Numărătoarea inversă a întrebării (inelul din colț)
export function Countdown({ total, left }) {
  const f = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const r = 15, c = 2 * Math.PI * r;
  return (
    <svg className="lv-ring" viewBox="0 0 36 36" aria-label={`${Math.ceil(left)} secunde`}>
      <circle cx="18" cy="18" r={r} className="lv-ring-bg" />
      <circle cx="18" cy="18" r={r} className="lv-ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - f)} />
      <text x="18" y="22" textAnchor="middle">{Math.max(0, Math.ceil(left))}</text>
    </svg>
  );
}

export function useStableResults(initial = {}) {
  const [results, setResults] = useState(initial);
  return useMemo(() => ({ results, setOne: (id, r) => setResults((p) => ({ ...p, [id]: r })) }), [results]);
}
