// =====================================================================
// src/components/live/PollCard.jsx — ÎNTREBĂRILE profesorului (ca Zoom Polls)
//   · grilă: patru variante a)–d);
//   · de completat: un câmp pentru rezultat (acceptă „1/2", „0,5", „√2"...);
//   · în grup: cronometru, răspunsul se poate schimba până expiră timpul,
//     corectitudinea se vede la „Rezultate", pentru toată clasa odată;
//   · la 1-la-1: fără cronometru, verdictul vine imediat, apoi „Mai departe".
// Plus cardul „Ai înțeles?" de după explicație (doar 1-la-1).
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { MathHtml, Countdown } from './Board';

export function PollCard({ poll, teacherName, total = 0, left = 0, mine = null, answeredCount = 0, onSubmit, privat = false, verdict = null, onNext }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const inputRef = useRef(null);
  useEffect(() => { setValue(''); setErr(null); }, [poll?.id]);
  useEffect(() => { if (poll?.type === 'completare' && !mine) setTimeout(() => inputRef.current?.focus(), 120); }, [poll?.id, poll?.type, mine]);
  if (!poll) return null;
  const closed = !privat && left <= 0;

  async function send(ans) {
    const a = String(ans ?? '').trim();
    if (!a || busy || closed) return;
    setBusy(true); setErr(null);
    try { await onSubmit(a); }
    catch (e) { setErr(e.message || 'Nu s-a putut trimite.'); }
    finally { setBusy(false); }
  }

  return (
    <div className={`lv-poll${privat ? ' is-private' : ''}`} role="dialog" aria-label="Întrebarea profesorului">
      <div className="lv-poll-head">
        <span className="lv-poll-kicker">📝 {teacherName} întreabă</span>
        {!privat && <Countdown total={total} left={left} />}
      </div>
      <MathHtml className="lv-poll-q" text={poll.question} />
      {poll.type === 'grila' ? (
        <div className="lv-poll-opts">
          {(poll.options || []).map((o, i) => {
            const k = 'abcd'[i];
            const chosen = mine?.answer === k;
            const good = verdict && verdict.answer === k;
            const bad = verdict && chosen && !verdict.correct;
            return (
              <button key={k} type="button" disabled={busy || closed || (privat && !!verdict)}
                className={`lv-poll-opt${chosen ? ' is-chosen' : ''}${good ? ' is-good' : ''}${bad ? ' is-bad' : ''}`}
                onClick={() => send(k)}>
                <span className="lv-poll-k">{k})</span> <MathHtml tag="span" text={o} />
              </button>
            );
          })}
        </div>
      ) : (
        <form className="lv-poll-fill" onSubmit={(e) => { e.preventDefault(); send(value); }}>
          <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} disabled={busy || closed || (privat && !!verdict)}
            placeholder={mine ? `Ai răspuns: ${mine.answer} — poți schimba` : 'Scrie rezultatul (ex. 12, 1/2, 2√3)'} inputMode="text" autoComplete="off" />
          <button type="submit" className="lv-btn-primary" disabled={busy || closed || !value.trim() || (privat && !!verdict)}>Trimite</button>
        </form>
      )}
      {err && <div className="lv-poll-err">{err}</div>}
      {!privat && (
        <div className="lv-poll-foot">
          {closed ? 'Timpul a expirat — urmează rezultatele.' : mine ? `✓ Ai răspuns ${poll.type === 'grila' ? mine.answer + ')' : mine.answer}. Poți schimba până expiră timpul.` : 'Alege răspunsul înainte să expire timpul.'}
          {answeredCount > 0 && <span className="lv-poll-count"> · {answeredCount} {answeredCount === 1 ? 'coleg a răspuns' : 'colegi au răspuns'}</span>}
        </div>
      )}
      {privat && verdict && (
        <div className={`lv-poll-verdict ${verdict.correct ? 'is-good' : 'is-bad'}`}>
          {verdict.correct ? '✅ Corect! Bravo.' : <>❌ Nu chiar. Răspunsul corect: <MathHtml tag="b" text={poll.type === 'grila' ? `${verdict.answer})` : `$${String(verdict.answer).replace(/\$/g, '')}$`} /></>}
          <button type="button" className="lv-btn-primary" onClick={onNext}>Mai departe →</button>
        </div>
      )}
    </div>
  );
}

// „Ai înțeles?" — după explicația pe barem (1-la-1)
export function UnderstandCard({ teacherName, altLeft, onYes, onAgain, onAsk }) {
  return (
    <div className="lv-poll is-private lv-check" role="dialog" aria-label="Ai înțeles?">
      <div className="lv-poll-head"><span className="lv-poll-kicker">🙋 {teacherName}: Ai înțeles?</span></div>
      <div className="lv-check-actions">
        <button type="button" className="lv-btn-primary" onClick={onYes}>✅ Da, mai departe</button>
        {altLeft > 0 && <button type="button" className="lv-btn-soft" onClick={onAgain}>🔁 Explică altfel</button>}
        <button type="button" className="lv-btn-soft" onClick={onAsk}>✋ Am o întrebare</button>
      </div>
    </div>
  );
}
