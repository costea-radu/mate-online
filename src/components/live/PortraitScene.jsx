// =====================================================================
// src/components/live/PortraitScene.jsx — CLASA cu profesorul VIU, în straturi:
//
//   1. fundalul: clasa fără profesor (fundal.jpg)
//   2. scrisul de pe tabla albă + proiecția tablei digitale (HTML/KaTeX, puse în
//      perspectivă pe colțurile din fotografie, cu „multiply" — cerneală și
//      lumină pe tablă, nu un strat lipit)
//   3. PROFESORUL, animat în WebGL (src/lib/live/portret.js) — respiră, își mută
//      greutatea, întoarce capul spre tablă/proiecție, gesticulează, vorbește
//   4. pupitrul din fața lui (prim-plan.png)
//   5. „camera": zgomot fin, vignetare, mici variații de expunere
//
// Ce face profesorul depinde de lecție: se uită spre tablă când apare un rând
// nou, spre proiecție la un enunț/video/rezultate, ascultă (zâmbind, dând din
// cap) cât elevii răspund, zâmbește la „bravo", ridică sprâncenele la întrebări.
// Până se încarcă animația (sau dacă WebGL lipsește) se vede fotografia întreagă.
//
// PE TELEFON (src/lib/live/framing.js): tabla și proiecția nu încap citibil
// deodată, așa că „camera" se mută lin între explicația de pe tablă și exercițiul
// proiectat (`focus`), iar elevul o poate muta și el (butonul sălii sau o
// glisare stânga/dreapta). Tabla primește atunci și rama ei (conturul și
// culoarea unei table), care în poză abia se vede la o scară atât de mică.
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { quadMatrix, scaleQuad } from '../../lib/live/homography';
import { actorRegion, createPortrait } from '../../lib/live/portret';
import { frameScene, BOARD_W, SCREEN_W } from '../../lib/live/framing';
import { WhiteboardInk, DigitalScreen } from './Board';

const FRAME_W = 1000;   // rama tablei, în pixeli „logici"

const PRAISE = /\b(bravo|foarte bine|excelent|perfect|felicit\w*|super)\b/i;
const GREET = /\b(bun[aă] ziua|bun[aă] seara|bine a[tț]i venit|salut\w*)\b/i;

// Lecția „regizează" profesorul: din starea playerului → indicii pentru animație
function useLessonCues(portraitRef, ready, state, board) {
  const prev = useRef({ lines: 0, item: undefined, scene: null, caption: null, lastBoard: 0 });
  useEffect(() => {
    const P = portraitRef.current;
    if (!P || !ready) return;
    const pr = prev.current;
    const now = performance.now() / 1000;
    const sc = state?.scene || null;
    const key = sc ? `${sc.type}|${sc.item ?? ''}|${sc.t0 ?? ''}|${sc.mode ?? ''}` : (state?.phase || null);
    if (key !== pr.scene) {
      pr.scene = key;
      switch (sc?.type) {
        case 'intro': case 'final': P.cue('salut'); break;
        case 'item': P.cue('ecran', { dur: 1.8 }); break;
        case 'sondaj': case 'intrebare_intelegere': P.cue('asculta', { dur: sc.dur > 0 ? sc.dur : 45 }); break;
        case 'rezultate': P.cue('vorbeste'); P.cue('ecran', { dur: 2.2 }); break;
        case 'video': P.cue('asculta', { dur: sc.dur || 60 }); P.cue('ecran', { dur: 3.5 }); break;
        case 'pauza': P.cue('asculta', { dur: sc.dur || 300 }); break;
        case 'intrebari': P.cue('asculta', { dur: 6 }); break;
        case 'explicatie': P.cue('vorbeste'); if (Math.random() < 0.5) P.cue('notite'); break;
        default: break;
      }
    }
    const lines = board ? board.blocks.reduce((n, b) => n + b.lines.length, 0) : 0;
    if ((board?.item ?? null) !== pr.item) { pr.item = board?.item ?? null; pr.lines = lines; }
    else if (lines > pr.lines) {
      pr.lines = lines;
      if (now - pr.lastBoard > 3.5 && Math.random() < 0.7) { pr.lastBoard = now; P.cue('tabla'); }
    }
    const cap = state?.caption || null;
    if (cap && cap !== pr.caption) {
      pr.caption = cap;
      if (PRAISE.test(cap)) P.cue('bravo');
      else if (GREET.test(cap)) P.cue('salut');
      else if (/\?\s*$/.test(cap)) P.cue('intrebare');
    }
  }, [portraitRef, ready, state, board]);
}

export default function PortraitScene({ rig, engine, board = null, screen = null, state = null, overlays = true, zoom = 1, thinking = false, chatCount = 0, onPortrait = null,
  focus = null, inset = null, onLayout = null, onSwipe = null }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const portraitRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    setReady(false);
    if (!rig.atlas || !canvasRef.current) return undefined;
    const plate = new Image();
    const plateOk = new Promise((res) => { plate.onload = res; plate.onerror = res; plate.src = rig.plate; });
    Promise.all([
      createPortrait({ canvas: canvasRef.current, rig, mouth: () => (engine ? engine.mouth() : { open: 0, shape: 0.5, speaking: false }) }),
      plateOk,
    ]).then(([p]) => {
      if (!alive) { p.destroy(); return; }
      portraitRef.current = p;
      // un cadru desenat înainte de a ascunde fotografia (trecerea nu se vede)
      requestAnimationFrame(() => requestAnimationFrame(() => { if (alive) setReady(true); }));
    }).catch((e) => { console.warn('portret:', e); });
    return () => { alive = false; portraitRef.current?.destroy(); portraitRef.current = null; };
  }, [rig, engine]);

  useLessonCues(portraitRef, ready, state, board);
  // pagina care îl regizează (Planul meu) primește animația când e gata
  const onPortraitRef = useRef(onPortrait);
  useEffect(() => { onPortraitRef.current = onPortrait; }, [onPortrait]);
  useEffect(() => {
    onPortraitRef.current?.(ready ? portraitRef.current : null);
    return () => { if (ready) onPortraitRef.current?.(null); };
  }, [ready]);
  // răspunsul la o întrebare e în lucru → profesorul „se gândește" (privirea în sus, într-o parte)
  useEffect(() => { if (ready && thinking) portraitRef.current?.cue('gandeste', { dur: 1.8 }); }, [ready, thinking]);
  // un mesaj nou în chat → uneori aruncă o privire spre laptopul de pe pupitru
  const lastChat = useRef(null);
  useEffect(() => {
    if (!ready) return;
    if (lastChat.current != null && chatCount > lastChat.current) portraitRef.current?.cue('chat');
    lastChat.current = chatCount;
  }, [ready, chatCount]);

  // încadrarea (src/lib/live/framing.js): „camera" din rig (tabla + profesorul, ca o
  // cameră îndreptată spre catedră) acoperă containerul; pe un ecran lat tabla și
  // proiecția rămân întregi; cu zoom > 1 (fereastra mică, PiP) camera se apropie de
  // profesor; pe telefon se oprește pe tabla (explicația) sau pe proiecție (exercițiul)
  const f = frameScene(rig, size, { zoom, focus, inset });
  const { sc, ox, oy, dw, dh } = f;
  const narrow = size.w > 0 && f.narrow;
  const sx = sc, sy = sc;
  const R = rig.atlas ? actorRegion(rig) : null;
  const boardH = rig.board ? Math.round(BOARD_W * (rig.boardAspect ? 1 / rig.boardAspect : 0.56)) : 0;
  const screenH = rig.screen ? Math.round(SCREEN_W * (rig.screenAspect ? 1 / rig.screenAspect : 0.5625)) : 0;
  const frameH = rig.boardFrame ? Math.round(FRAME_W * (rig.boardFrameAspect ? 1 / rig.boardFrameAspect : 0.35)) : 0;
  const proj = rig.screenMode === 'proiectie';

  // sala află dacă ecranul e „îngust" (atunci arată butonul explicație ↔ exercițiu)
  const onLayoutRef = useRef(onLayout);
  useEffect(() => { onLayoutRef.current = onLayout; }, [onLayout]);
  useEffect(() => { onLayoutRef.current?.({ narrow }); }, [narrow]);
  // camera se mută lin doar când își schimbă ținta (nu la redimensionarea ferestrei)
  // (ținta = zona + ce acoperă sala peste scenă: cardul cu întrebarea, butonul camerei)
  const [panning, setPanning] = useState(false);
  const target = `${f.focus || ''}|${inset ? [inset.top, inset.right, inset.bottom, inset.left].join(',') : ''}`;
  const lastTarget = useRef(target);
  useEffect(() => {
    if (lastTarget.current === target) return undefined;
    lastTarget.current = target;
    setPanning(true);
    const t = setTimeout(() => setPanning(false), 750);
    return () => clearTimeout(t);
  }, [target]);
  // glisarea stânga/dreapta mută camera (pe telefon)
  const touch = useRef(null);
  const onTouchStart = (e) => { const t = e.touches?.[0]; touch.current = t ? { x: t.clientX, y: t.clientY, at: Date.now() } : null; };
  const onTouchEnd = (e) => {
    const s = touch.current; touch.current = null;
    const t = e.changedTouches?.[0];
    if (!s || !t || !narrow || !onSwipe) return;
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4 && Date.now() - s.at < 900) onSwipe(dx < 0 ? 'ecran' : 'tabla');
  };

  return (
    <div className={`lv-scene${ready ? ' is-ready' : ''}${narrow ? ' is-narrow' : ''}${panning ? ' is-panning' : ''}`} ref={wrapRef}
      onTouchStart={onSwipe ? onTouchStart : undefined} onTouchEnd={onSwipe ? onTouchEnd : undefined}>
      <div className="lv-scene-inner" style={{ left: ox, top: oy, width: dw, height: dh }}>
        {rig.plate && <img className="lv-scene-plate" src={rig.plate} alt="" draggable={false} />}
        <img className="lv-scene-photo" src={rig.photo} alt="" draggable={false} />
        {/* rama tablei (conturul și culoarea ei) — pe telefon, unde rama din poză abia se vede */}
        {narrow && rig.boardFrame && dw > 0 && (
          <div className="lv-scene-rama" aria-hidden="true" style={{ width: FRAME_W, height: frameH, transform: quadMatrix(FRAME_W, frameH, scaleQuad(rig.boardFrame, dw, dh)) }}>
            <div className="lv-scene-rama-tray" />
          </div>
        )}
        {overlays && rig.board && board && dw > 0 && (
          <div className="lv-scene-board" style={{ width: BOARD_W, height: boardH, transform: quadMatrix(BOARD_W, boardH, scaleQuad(rig.board, dw, dh)) }}>
            <WhiteboardInk board={board} />
          </div>
        )}
        {overlays && rig.screen && screen && dw > 0 && (
          <div className={`lv-scene-screen${proj ? ' is-proj' : ''}`} style={{ width: SCREEN_W, height: screenH, transform: quadMatrix(SCREEN_W, screenH, scaleQuad(rig.screen, dw, dh)) }}>
            <DigitalScreen {...screen} />
          </div>
        )}
        {R && (
          <canvas ref={canvasRef} className="lv-scene-actor" aria-hidden="true"
            style={{ left: R.x * sx, top: R.y * sy, width: R.w * sx, height: R.h * sy }} />
        )}
        {rig.fg && (
          <img className="lv-scene-fg" src={rig.fg.src} alt="" draggable={false}
            style={{ left: rig.fg.x * sx, top: rig.fg.y * sy, width: rig.fg.w * sx, height: rig.fg.h * sy }} />
        )}
        <div className="lv-scene-grain" />
      </div>
    </div>
  );
}
