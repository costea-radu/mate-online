// =====================================================================
// src/components/live/PrepWait.jsx — „Prof. Tudor își pregătește lecția"
//
// În locul vechiului „(1–3 minute)": etapele reale ale pregătirii (citește
// subiectul și baremul → scrie explicațiile, pe bucăți → întrebările pentru
// exerciții → vocea începutului lecției), cât a trecut și cât durează de obicei
// (din lecțiile scrise până acum — api/live.js → prepEta), plus „🔔 Anunță-mă
// când e gata": sunet, titlul tabului, notificarea de sistem și — cu permisiunea
// dată — notificarea Web Push, care vine și cu pagina închisă.
// Apare pe ecranul de intrare (PreJoin, luminos) și peste sală (is-dark).
// =====================================================================
import { useEffect, useState } from 'react';
import { clock } from '../../lib/live/clock';
import { notifySupport } from '../../lib/live/notify';

const fmt = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// etapa curentă a pregătirii, din starea lecției (lessonView pe server)
export function prepStage(lesson, { privat = false } = {}) {
  if (!lesson) return { step: 0, pct: 2 };
  const w = lesson.write || null;
  if (lesson.status === 'nou' || (lesson.status === 'eroare' && !lesson.title)) {
    if (!lesson.pdf && !w) return { step: 0, pct: 4 };
    if (w?.phase === 'pasi') return { step: 2, pct: 72 };
    if (w?.phase === 'completare') return { step: 1, pct: 66, note: 'completează exercițiile rămase' };
    const part = w && w.total ? Math.min(1, w.done / w.total) : 0;
    return { step: 1, pct: 8 + Math.round(part * 58), note: w && w.total ? `${w.done} din ${w.total} părți` : null };
  }
  if (lesson.phase === 'pasi') return { step: 2, pct: 74, note: 'întrebările pentru pașii din barem' };
  if (lesson.phase === 'itemi') return { step: 1, pct: 60, note: 'exercițiile care lipseau' };
  if (lesson.status === 'script' || lesson.status === 'audio') {
    const h = privat && lesson.head && lesson.head.total ? lesson.head : null;
    const done = h ? h.done : lesson.done || 0;
    const total = h ? h.total : lesson.total || 0;
    const part = total ? Math.min(1, done / total) : 0;
    return { step: 3, pct: 78 + Math.round(part * 21), note: total ? `${Math.round(part * 100)}%` : null };
  }
  if (lesson.status === 'gata' || lesson.playable) return { step: 4, pct: 100 };
  return { step: 1, pct: 10 };
}

const STEPS = (privat) => [
  { ico: '📄', label: 'Citește subiectul și baremul oficial' },
  { ico: '✍️', label: 'Scrie explicațiile pe barem, exercițiu cu exercițiu' },
  { ico: '❓', label: 'Pregătește întrebările pentru fiecare exercițiu' },
  { ico: '🎙️', label: privat ? 'Înregistrează vocea pentru începutul lecției' : 'Înregistrează vocea lecției' },
  { ico: '✅', label: 'Gata — poți intra' },
];

export default function PrepWait({ lesson, eta = null, privat = false, teacherName = 'Profesorul', dark = false, ready = false,
  notify = null, onNotify = null, notifyBusy = false, waitedFrom = null }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const support = notifySupport();
  const st = ready ? { step: 4, pct: 100 } : prepStage(lesson, { privat });
  const pasi = lesson?.phase === 'pasi' && lesson?.status !== 'nou';     // lecție veche: doar întrebările (~1 minut)
  // de când se pregătește: începutul scrisului (server), dacă e de acum (o lecție scrisă demult,
  // care doar își face vocea acum, se socotește de când așteaptă elevul)
  const sa = lesson?.startedAt ? Date.parse(lesson.startedAt) : null;
  const started = sa && clock.now() - sa < 20 * 60000 ? sa : (waitedFrom || null);
  const elapsed = started ? (clock.now() - started) / 1000 : 0;
  // estimarea: de obicei (din lecțiile scrise până acum) — la lecțiile vechi doar întrebările, ~1 min
  const typical = pasi ? 70 : eta?.sec || 300;
  const left = Math.max(0, typical - elapsed);
  const timePct = started ? Math.min(92, (elapsed / Math.max(30, typical)) * 100) : 0;
  const pct = ready ? 100 : Math.max(st.pct, Math.min(st.pct + 12, timePct));
  const steps = STEPS(privat);
  const on = !!notify?.on;

  let estimate;
  if (ready) estimate = 'Lecția e gata!';
  else if (pasi) estimate = 'durează cam un minut, o singură dată pe subiect';
  else if (!started) estimate = eta?.label ? `de obicei ${eta.label}` : 'câteva minute';
  else if (left > 45) estimate = `încă ~${Math.max(1, Math.round(left / 60))} min · de obicei ${eta?.label || 'câteva minute'}`;
  else if (elapsed < typical * 1.6) estimate = 'aproape gata…';
  else estimate = 'durează mai mult decât de obicei — mai e puțin';

  return (
    <div className={`lv-prep${dark ? ' is-dark' : ''}${ready ? ' is-ready' : ''}`} role="status" aria-live="polite">
      <div className="lv-prep-head">
        {!ready && <span className="lv-prep-spin" aria-hidden="true" />}
        <span className="lv-prep-title">{ready ? `✅ ${teacherName} e gata!` : pasi ? `${teacherName} pregătește întrebările pentru pașii din barem` : `${teacherName} își pregătește lecția`}</span>
      </div>
      <div className="lv-prep-time">
        {started && !ready ? <b>⏱ {fmt(elapsed)}</b> : null}
        <span>{estimate}</span>
      </div>
      <div className="lv-prep-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
      {!pasi && (
        <ol className="lv-prep-steps">
          {steps.map((s, i) => {
            const cls = i < st.step || ready ? 'is-done' : i === st.step ? 'is-now' : '';
            return (
              <li key={s.label} className={cls}>
                <span className="lv-prep-ico" aria-hidden="true">{i < st.step || ready ? '✓' : s.ico}</span>
                <span>{s.label}{i === st.step && st.note && !ready ? <small> · {st.note}</small> : null}</span>
              </li>
            );
          })}
        </ol>
      )}
      {!ready && onNotify && (
        <div className="lv-prep-notify">
          {on ? (
            <>
              <div className="lv-prep-on">🔔 Te anunțăm când e gata: cu un sunet{support.system && notify.permission === 'granted' ? ' și o notificare' : ''}.</div>
              <div className="lv-prep-hint">
                {notify.push
                  ? 'Poți face altceva între timp — și poți închide pagina: notificarea vine oricum, iar un clic pe ea te aduce aici.'
                  : 'Poți face altceva între timp: lasă doar pagina deschisă (poate sta în fundal, într-un alt tab).'}
                {support.ios && !support.standalone ? ' Pe iPhone, notificările merg din aplicația ExamenMate pusă pe ecranul principal (Partajează → Adaugă pe ecranul principal).' : ''}
                {support.system && notify.permission === 'denied' ? ' Notificările sunt blocate pentru site în setările browserului — rămân sunetul și titlul tabului.' : ''}
              </div>
              <button type="button" className="lv-prep-off" onClick={() => onNotify(false)} disabled={notifyBusy}>Nu mai anunța</button>
            </>
          ) : (
            <>
              <button type="button" className="lv-prep-btn" onClick={() => onNotify(true)} disabled={notifyBusy}>
                {notifyBusy ? 'Un moment…' : '🔔 Anunță-mă când e gata'}
              </button>
              <div className="lv-prep-hint">Nu trebuie să stai cu ochii aici: te anunțăm cu un sunet{support.system ? ' și o notificare' : ''} — poți face altceva între timp.</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
