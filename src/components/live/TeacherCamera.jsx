// =====================================================================
// src/components/live/TeacherCamera.jsx — „CAMERA" profesorului virtual
//
// Cu portret (public/live/<id>/rig.json): fotografia profesorului în clasă,
// animată în browser (respiră, clipește, mișcă ușor capul, gura urmează vocea),
// cu tabla albă și tabla digitală puse în perspectivă peste cele din poză
// (PortraitScene, încărcat la cerere).
// Fără portret: ca într-un Zoom cu camera oprită — inițialele profesorului,
// cu inelul care pulsează în ritmul vocii.
// Eticheta „Profesor virtual · AI" rămâne mereu vizibilă.
// =====================================================================
import { lazy, Suspense, useEffect, useRef } from 'react';
import { initials, teacherColor } from '../../lib/live/profesori';

const PortraitScene = lazy(() => import('./PortraitScene'));

// inelul de vorbire (fără React la fiecare cadru: scriem direct o variabilă CSS)
function useVoiceLevel(engine, ref) {
  useEffect(() => {
    let raf = 0, lvl = 0;
    const loop = () => {
      const m = engine ? engine.mouth() : { open: 0, speaking: false };
      lvl = lvl * 0.6 + (m.speaking ? Math.max(0.15, m.open) : 0) * 0.4;
      if (ref.current) {
        ref.current.style.setProperty('--lvl', lvl.toFixed(3));
        ref.current.classList.toggle('is-speaking', lvl > 0.06);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine, ref]);
}

export default function TeacherCamera({ teacher, rig = null, engine, variant = 'big', board = null, screen = null, state = null, showBoards = true, label = true, thinking = false, chatCount = 0 }) {
  const ref = useRef(null);
  useVoiceLevel(engine, ref);
  const color = teacherColor(teacher);
  return (
    <div ref={ref} className={`lv-cam lv-cam-${variant}${rig ? ' has-portrait' : ' is-off'}`} style={{ '--tc': color }}>
      {rig ? (
        <Suspense fallback={<div className="lv-cam-loading" />}>
          <PortraitScene rig={rig} engine={engine} board={board} screen={screen} overlays={showBoards}
            state={state || screen?.state || null} zoom={variant === 'pip' ? 2.6 : 1} thinking={thinking} chatCount={chatCount} />
        </Suspense>
      ) : (
        <div className="lv-cam-off">
          <div className="lv-cam-avatar" style={{ background: color }}>
            <span>{initials(teacher?.name)}</span>
          </div>
        </div>
      )}
      {label && (
        <div className="lv-cam-label">
          <span className="lv-cam-mic" aria-hidden="true">🎙️</span>
          <span className="lv-cam-name">{teacher?.name}</span>
          <span className="lv-tag-ai">Profesor virtual · AI</span>
        </div>
      )}
    </div>
  );
}
