// =====================================================================
// src/components/live/PreJoin.jsx — „Ești gata să intri?" (ca la Google Meet)
// Previzualizarea camerei proprii (doar locală — nu pleacă nicăieri), microfonul,
// numele din ședință, cine predă și ce, câți colegi sunt deja înăuntru,
// dreptul de acces (abonament / bilet / plată) și „Intră pe tot ecranul".
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { initials, teacherColor } from '../../lib/live/profesori';

export default function PreJoin({ info, teacher, rigThumb = null, present = 0, access, price = null, onJoin, onPay, paying = false, error = null, waitingText = null, camOn, setCamOn, micOn, setMicOn, fullscreen, setFullscreen }) {
  const videoRef = useRef(null);
  const [camErr, setCamErr] = useState(null);

  useEffect(() => {
    let stream = null, alive = true;
    if (!camOn) return undefined;
    navigator.mediaDevices?.getUserMedia?.({ video: { width: 640, height: 360, facingMode: 'user' }, audio: false })
      .then((s) => {
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => { setCamErr('Nu am acces la cameră (sau nu există). Poți intra și fără ea.'); setCamOn(false); });
    return () => { alive = false; stream?.getTracks().forEach((t) => t.stop()); };
  }, [camOn, setCamOn]);

  const s = info?.session;
  const starts = s ? new Date(s.starts_at) : null;
  const liveNow = s?.phase === 'live';
  const color = teacherColor(teacher);
  const needPay = access === 'plata';

  return (
    <div className="lv-pre">
      <div className="lv-pre-left">
        <div className="lv-pre-video">
          {camOn ? <video ref={videoRef} autoPlay playsInline muted className="lv-mirror" /> : (
            <div className="lv-pre-off">
              <div className="lv-av-big">{initials(info?.me?.name)}</div>
              <div>Camera e oprită</div>
            </div>
          )}
          <div className="lv-pre-name-tag">{info?.me?.name || 'Tu'}</div>
          <div className="lv-pre-toggles">
            <button type="button" className={`lv-round${micOn ? '' : ' is-off'}`} onClick={() => setMicOn(!micOn)} title={micOn ? 'Oprește microfonul' : 'Pornește microfonul'} aria-label="Microfon">{micOn ? '🎤' : '🔇'}</button>
            <button type="button" className={`lv-round${camOn ? '' : ' is-off'}`} onClick={() => { setCamErr(null); setCamOn(!camOn); }} title={camOn ? 'Oprește camera' : 'Pornește camera'} aria-label="Cameră">{camOn ? '📷' : '🚫'}</button>
          </div>
        </div>
        <p className="lv-pre-privacy">🔒 Camera și microfonul tău <b>nu ajung la profesor sau la colegi</b>: camera e doar pentru tine, ca o oglindă, iar microfonul doar îți dictează întrebarea în chat (cu recunoașterea vorbirii din browser).</p>
        {camErr && <p className="lv-pre-warn">{camErr}</p>}
      </div>

      <div className="lv-pre-right">
        <h1>Ești gata să intri?</h1>
        <div className="lv-pre-teacher">
          <span className="lv-pre-tav" style={{ background: color }}>
            {rigThumb ? <img src={rigThumb} alt="" /> : initials(teacher?.name)}
          </span>
          <div>
            <div className="lv-pre-tname">{teacher?.name} <span className="lv-tag-ai">Profesor virtual · AI</span></div>
            <div className="lv-pre-sub">{s?.examLabel}{s?.subject?.title ? ` · ${s.subject.title}` : ''}</div>
          </div>
        </div>
        <div className="lv-pre-status">
          {s?.kind === 'privat' ? <>🎓 Ședință 1-la-1 — doar tu și profesorul, 60 de minute.</>
            : liveNow ? <><span className="lv-dot-live" /> {present > 0 ? `${present} ${present === 1 ? 'elev e' : 'elevi sunt'} deja în ședință` : 'Ședința e în desfășurare'}</>
            : starts ? <>⏰ Începe la {starts.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })} — sala de așteptare e deschisă{present ? ` (${present} ${present === 1 ? 'coleg' : 'colegi'} așteaptă)` : ''}</> : null}
        </div>
        {waitingText && <div className="lv-pre-wait">{waitingText}</div>}
        <div className="lv-pre-me">Numele tău în ședință: <b>{info?.me?.name}</b></div>

        {needPay ? (
          <div className="lv-pre-pay">
            <div>Ședința de grup costă <b>{price ?? 10} lei</b> — sau intri gratuit cu abonamentul ExamenMate.</div>
            <div className="lv-pre-actions">
              <button type="button" className="lv-btn-primary lv-btn-lg" onClick={onPay} disabled={paying}>{paying ? 'Se deschide plata…' : `Plătește ${price ?? 10} lei`}</button>
              <Link to="/preturi" className="lv-btn-soft">Abonament</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="lv-pre-access">
              {access === 'abonament' && '✓ Inclus în abonamentul tău'}
              {access === 'bilet' && '✓ Ai bilet la această ședință'}
              {access === 'admin' && '✓ Cont de administrator'}
              {access === 'proprietar' && '✓ Ședința ta 1-la-1'}
            </div>
            <label className="lv-pre-check">
              <input type="checkbox" checked={fullscreen} onChange={(e) => setFullscreen(e.target.checked)} /> Intră pe tot ecranul
            </label>
            <div className="lv-pre-actions">
              <button type="button" className="lv-btn-primary lv-btn-lg" onClick={onJoin} disabled={!!error && !onJoin}>Participă acum</button>
              <Link to="/meditatii" className="lv-btn-soft">Înapoi la program</Link>
            </div>
          </>
        )}
        {error && <div className="lv-pre-err">{error}</div>}
        <p className="lv-pre-ai">ⓘ Profesorul este <b>virtual (AI)</b>: vocea și imaginea sunt generate. Explică numai pe <b>baremul oficial</b> al subiectului.</p>
      </div>
    </div>
  );
}
