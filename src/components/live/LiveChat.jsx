// =====================================================================
// src/components/live/LiveChat.jsx — CHATUL și LISTA DE PARTICIPANȚI
// Ca la Zoom: „Către: Toată lumea" sau „Către: profesorul (privat)".
// Profesorul răspunde la întrebări; în grup, răspunsurile publice se rostesc
// în pauzele de „Întrebări", cele private rămân doar în chatul elevului.
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { MathHtml } from './Board';
import { initials, teacherColor } from '../../lib/live/profesori';
import { speechRecognitionSupported, startDictation } from '../../lib/voice';

const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

export function LiveChat({ messages, meId, teacher, privat = false, onSend, disabled = false, pendingAnswer = false, prefill = null }) {
  const [text, setText] = useState('');
  const [toTeacher, setToTeacher] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [listening, setListening] = useState(false);
  const listRef = useRef(null);
  const stickRef = useRef(true);
  const inputRef = useRef(null);
  const dictRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, pendingAnswer]);
  useEffect(() => { if (prefill) { setText(prefill.text || ''); setTimeout(() => inputRef.current?.focus(), 50); } }, [prefill]);

  async function send(e) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy || disabled) return;
    setBusy(true); setErr(null);
    try { await onSend(t, { toTeacher: privat ? false : toTeacher }); setText(''); stickRef.current = true; }
    catch (e2) { setErr(e2.message || 'Mesajul nu a plecat.'); }
    finally { setBusy(false); }
  }

  function dictate() {
    if (listening) { dictRef.current?.stop(); return; }
    setListening(true);
    dictRef.current = startDictation({
      onResult: (t, final) => { setText(t); if (final) setListening(false); },
      onError: () => setListening(false),
      onEnd: () => setListening(false),
    });
  }

  return (
    <div className="lv-chat">
      <div className="lv-chat-list" ref={listRef} onScroll={(e) => { const el = e.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
        {messages.length === 0 && (
          <div className="lv-chat-empty">
            {privat ? `Întreabă-l orice pe ${teacher?.name || 'profesor'} — îți răspunde cu voce, apoi continuă lecția.` : 'Mesajele din ședință apar aici. Întrebările pentru profesor încep, de obicei, cu „De ce…", „Cum…" sau se termină cu „?".'}
          </div>
        )}
        {messages.map((m) => {
          const isTeacher = m.role === 'profesor';
          const mine = !isTeacher && m.mine;
          return (
            <div key={m.id} className={`lv-msg${isTeacher ? ' is-teacher' : ''}${mine ? ' is-mine' : ''}${m.role === 'sistem' ? ' is-system' : ''}`}>
              <div className="lv-msg-head">
                <b style={isTeacher ? { color: teacherColor(teacher) } : null}>{mine ? 'Tu' : m.author}</b>
                {isTeacher && <span className="lv-tag-ai">Profesor · AI</span>}
                {m.private && <span className="lv-msg-private">🔒 {isTeacher ? 'doar pentru tine' : 'către profesor'}</span>}
                <span className="lv-msg-time">{hhmm(m.at)}</span>
              </div>
              <MathHtml className="lv-msg-text" text={m.text} />
            </div>
          );
        })}
        {pendingAnswer && (
          <div className="lv-msg is-teacher is-typing">
            <div className="lv-msg-head"><b style={{ color: teacherColor(teacher) }}>{teacher?.name}</b> <span className="lv-tag-ai">Profesor · AI</span></div>
            <div className="lv-typing"><span /><span /><span /></div>
          </div>
        )}
      </div>
      <form className="lv-chat-form" onSubmit={send}>
        {!privat && (
          <label className="lv-chat-to">
            Către:
            <select value={toTeacher ? 'prof' : 'toti'} onChange={(e) => setToTeacher(e.target.value === 'prof')}>
              <option value="toti">Toată lumea</option>
              <option value="prof">{teacher?.name || 'Profesorul'} (privat)</option>
            </select>
          </label>
        )}
        <div className="lv-chat-row">
          <textarea ref={inputRef} rows={1} value={text} disabled={disabled} maxLength={300}
            placeholder={privat ? 'Întreabă profesorul…' : toTeacher ? 'Mesaj privat pentru profesor…' : 'Scrie un mesaj sau o întrebare…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          {speechRecognitionSupported() && (
            <button type="button" className={`lv-icon-btn${listening ? ' is-on' : ''}`} title="Dictează întrebarea" onClick={dictate} aria-label="Dictează">🎤</button>
          )}
          <button type="submit" className="lv-send" disabled={busy || !text.trim() || disabled} aria-label="Trimite">➤</button>
        </div>
        {err && <div className="lv-chat-err">{err}</div>}
      </form>
    </div>
  );
}

export function Participants({ teacher, speaking, people, meId }) {
  const me = people.find((p) => p.id === meId);
  const others = people.filter((p) => p.id !== meId);
  const hands = others.filter((p) => p.hand).length;
  return (
    <div className="lv-people">
      <div className="lv-people-head">În sală: <b>{people.length + 1}</b>{hands ? <span> · ✋ {hands}</span> : null}</div>
      <div className="lv-person is-host">
        <span className={`lv-av${speaking ? ' is-speaking' : ''}`} style={{ background: teacherColor(teacher) }}>{initials(teacher?.name)}</span>
        <span className="lv-person-name">{teacher?.name} <span className="lv-tag-ai">Profesor · AI</span><small>gazdă</small></span>
        <span className="lv-person-icons">{speaking ? '🔊' : '🎙️'}</span>
      </div>
      {me && (
        <div className="lv-person is-me">
          <span className="lv-av" style={{ background: '#5f6368' }}>{initials(me.name)}</span>
          <span className="lv-person-name">{me.name} <small>(tu)</small></span>
          <span className="lv-person-icons">{me.hand ? '✋' : ''}{me.cam ? '📷' : ''}{me.mic ? '🎤' : '🔇'}</span>
        </div>
      )}
      {others.map((p) => (
        <div key={p.id} className="lv-person">
          <span className="lv-av" style={{ background: colorOf(p.id) }}>{initials(p.name)}</span>
          <span className="lv-person-name">{p.name}</span>
          <span className="lv-person-icons">{p.hand ? '✋' : ''}{p.mic ? '🎤' : '🔇'}</span>
        </div>
      ))}
      {!others.length && <div className="lv-people-empty">Deocamdată ești singur(ă) cu profesorul. Colegii apar aici când intră.</div>}
    </div>
  );
}

// culoare stabilă pentru un elev (din id)
const PALETTE = ['#1a73e8', '#188038', '#c5221f', '#e37400', '#9334e6', '#12859f', '#b06000', '#d01884', '#3c4043', '#0b8043'];
export function colorOf(id) {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
