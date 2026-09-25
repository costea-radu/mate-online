// =====================================================================
// src/components/live/ProfCamera.jsx — PROF. TUDOR la tabla din „Planul meu"
//
// În locul profesorului desenat: același Prof. Tudor ca în meditațiile live
// (fotografia din clasă, animată în WebGL — respiră, clipește, gura urmează
// vocea), într-o fereastră de cameră la colțul tablei, ca într-un apel video.
//   · `mood` îl regizează: „writing" (scrie → se uită spre tablă), „thinking"
//     (pregătește ceva → se gândește), „listening" (așteaptă răspunsul elevului
//     → ascultă, zâmbește, dă din cap), „idle";
//   · pe cameră: 🔊/🔇 sunetul, CC subtitrările, ↺ repetă ultima replică;
//   · „🔊 Pornește sunetul" apare doar dacă browserul a blocat vocea (Chrome
//     cere un clic pe pagină înainte de prima rostire).
// ProfCaptions = subtitrarea (ce SPUNE profesorul), ca în sala live.
// Eticheta „Profesor virtual · AI" rămâne mereu vizibilă (AI Act).
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import TeacherCamera from './TeacherCamera';
import { MathHtml } from './Board';
import { loadRig } from '../../lib/live/profesori';
import { prof } from '../../lib/live/vorbire';

// profesorul din „Planul meu" = profesorul meditațiilor live (id-ul intern a rămas „radu")
export const TUDOR = { id: 'radu', name: 'Prof. Tudor', gender: 'm', color: '#1f6dab' };
export const TUDOR_THUMB = '/live/radu/portret.jpg';

// starea glasului (subtitrarea, sunetul, …), pentru React
export function useProf(speaker = prof) {
  const [st, setSt] = useState(speaker.state);
  useEffect(() => speaker.subscribe(setSt), [speaker]);
  return st;
}

const HINT_KEY = 'prof_voce_hint';
const VOICE_HINTS = {
  'fara-ro': 'Browserul tău nu are o voce în limba română, așa că Prof. Tudor vorbește prin subtitrări. Pentru voce: deschide pagina în Microsoft Edge (voce naturală, gratuită) sau adaugă vocea română în Windows (Setări → Oră și limbă → Vorbire).',
  fara: 'Browserul acesta nu poate citi cu voce tare — urmărește subtitrările. Pentru voce, deschide pagina în Chrome sau Microsoft Edge.',
  'nu-porneste': 'Vocea nu pornește în acest browser, așa că Prof. Tudor vorbește prin subtitrări. Încearcă Microsoft Edge sau Chrome.',
};
VOICE_HINTS.necunoscut = VOICE_HINTS['fara-ro'];      // nicio voce instalată (vocile vin uneori târziu)

export function ProfCamera({ mood = 'idle', speaker = prof, teacher = TUDOR }) {
  const st = useProf(speaker);
  const [rig, setRig] = useState(undefined);
  const [portrait, setPortrait] = useState(null);
  const [hint, setHint] = useState(null);

  useEffect(() => {
    let alive = true;
    loadRig(teacher.id).then((r) => { if (alive) setRig(r || null); });
    return () => { alive = false; };
  }, [teacher.id]);

  // regia: unde se uită și ce face, după ce se întâmplă pe tablă
  useEffect(() => {
    const P = portrait;
    if (!P) return undefined;
    if (mood === 'writing') {
      P.cue('tabla', { dur: 1.2 });
      const t = setInterval(() => P.cue('tabla', { dur: 0.9 + Math.random() * 0.9 }), 3800);
      return () => clearInterval(t);
    }
    if (mood === 'thinking') {
      P.cue('gandeste', { dur: 2.2 });
      const t = setInterval(() => P.cue('gandeste', { dur: 1.8 }), 2600);
      return () => clearInterval(t);
    }
    if (mood === 'listening') {
      P.cue('asculta', { dur: 180 });
      return () => P.cue('vorbeste');
    }
    P.cue('vorbeste');
    return undefined;
  }, [portrait, mood]);

  // fără voce românească → spunem o dată de ce tace (ca în sala live)
  useEffect(() => {
    if (!st.sound || !VOICE_HINTS[st.voice]) { setHint(null); return undefined; }
    let seen = false;
    try { seen = sessionStorage.getItem(HINT_KEY) === st.voice; } catch { /* ignore */ }
    if (seen) return undefined;
    const t = setTimeout(() => setHint(st.voice), st.voice === 'necunoscut' ? 3500 : 1800);
    return () => clearTimeout(t);
  }, [st.sound, st.voice]);
  const closeHint = () => { try { sessionStorage.setItem(HINT_KEY, hint || ''); } catch { /* ignore */ } setHint(null); };

  const camState = useMemo(() => ({ phase: 'live', caption: st.caption }), [st.caption]);

  return (
    <div className="bd-cam" aria-label={`${teacher.name} — camera`}>
      {rig === undefined
        ? <div className="lv-cam lv-cam-tile"><div className="lv-cam-loading" /></div>
        : <TeacherCamera teacher={teacher} rig={rig} engine={speaker} variant="tile" zoom={2.15}
            showBoards={false} state={camState} onPortrait={setPortrait} />}
      <div className="bd-cam-ctl">
        <button type="button" className={`bd-cam-btn${st.sound ? '' : ' is-off'}`}
          onClick={() => speaker.setSound(!st.sound)}
          title={st.sound ? 'Oprește sunetul (subtitrările rămân)' : 'Pornește sunetul'} aria-label={st.sound ? 'Oprește sunetul' : 'Pornește sunetul'}>
          {st.sound ? '🔊' : '🔇'}
        </button>
        <button type="button" className={`bd-cam-btn${st.cc ? ' is-on' : ''}`} onClick={() => speaker.setCc(!st.cc)}
          title={st.cc ? 'Ascunde subtitrările' : 'Arată subtitrările'} aria-label="Subtitrări" aria-pressed={st.cc}>CC</button>
        {st.lastText && (
          <button type="button" className="bd-cam-btn" onClick={() => speaker.repeat()} title="Repetă ce a spus" aria-label="Repetă">↺</button>
        )}
      </div>
      {st.needsTap && st.sound && (
        <button type="button" className="bd-cam-tap" onClick={() => speaker.unlock()}>🔊 Pornește sunetul</button>
      )}
      {hint && (
        <div className="bd-cam-hint" role="status">
          <span>🔈 {VOICE_HINTS[hint]}</span>
          <button type="button" onClick={closeHint} aria-label="Închide">✕</button>
        </div>
      )}
    </div>
  );
}

// Subtitrarea: ce SPUNE profesorul acum (nu se scrie pe tablă)
export function ProfCaptions({ speaker = prof }) {
  const st = useProf(speaker);
  if (!st.cc || !st.caption) return null;
  return (
    <div className="bd-cc" aria-live="polite">
      <MathHtml tag="span" text={st.caption} />
    </div>
  );
}

// Poza rotundă a lui Prof. Tudor (în titlul paginii, pe butoane)
export function TudorAvatar({ size = 32, style = null }) {
  return (
    <img src={TUDOR_THUMB} alt="" width={size} height={size} draggable={false}
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: 'none', boxShadow: '0 0 0 2px #fff, 0 1px 4px rgba(15,43,68,.25)', ...style }} />
  );
}

export default ProfCamera;
