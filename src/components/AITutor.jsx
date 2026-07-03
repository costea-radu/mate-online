// =====================================================================
// src/components/AITutor.jsx
// - MathText: text cu formatare + formule KaTeX (export)
// - ChatPanel: panou de chat (streaming, istoric, feedback) — reutilizabil
// - FloatingTutor (export implicit): butonul plutitor de pe tot site-ul
// =====================================================================
import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';
import ExamGenerator from './ExamGenerator';
import EinsteinIcon from './EinsteinIcon';
import { useAuth } from '../context/AuthContext';
import { ensureKatex, renderMath } from '../lib/katex';
import { fileToCompressedDataUrl } from '../lib/image';
import { speechRecognitionSupported, startDictation, recordAudio, blobToBase64, ttsSupported, speak, stopSpeaking } from '../lib/voice';

// ─── Formatare ușoară (bold, cod, paragrafe). Formulele LaTeX le lasă KaTeX. ──
function formatMessage(text = '') {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(15,43,68,.08);padding:1px 5px;border-radius:4px;font-size:.92em">$1</code>')
    .replace(/\n{2,}/g, '</p><p style="margin:.55em 0 0">')
    .replace(/\n/g, '<br/>');
}

// Text cu formule. `ready=false` în timpul streamingului (afișează brut, fără flicker);
// la final `ready=true` → randează KaTeX.
export function MathText({ text, ready = true }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '<p style="margin:0">' + formatMessage(text || '') + '</p>';
    if (ready && text) ensureKatex().then(() => { if (ref.current) renderMath(ref.current); });
  }, [text, ready]);
  return <div ref={ref} />;
}

const MODES = [
  { id: 'tutor', label: 'Învață-mă', hint: 'Explicație pas cu pas' },
  { id: 'explain', label: 'Teoria', hint: 'Explică teoria subiectului' },
  { id: 'hint', label: 'Dă-mi un indiciu', hint: 'Un singur pas, fără rezolvare' },
];

export function ChatPanel({ context = {}, compact = false, initialMode = 'tutor', onNavigate = null }) {
  const { user, isPremium } = useAuth();
  const [mode, setMode] = useState(initialMode);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [convId, setConvId] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [attached, setAttached] = useState(null);        // enunț extras din fotografie (editabil)
  const [editingAttach, setEditingAttach] = useState(false);
  const [visionLoading, setVisionLoading] = useState(false);
  const fileRef = useRef(null);
  const scrollRef = useRef(null);
  const [autoRead, setAutoRead] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingIdx, setSpeakingIdx] = useState(null);
  const [upsell, setUpsell] = useState(false);
  const dictationRef = useRef(null);
  const recorderRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streaming]);

  const patchLast = useCallback((patch) => {
    setMessages((msgs) => {
      if (!msgs.length) return msgs;
      const copy = [...msgs];
      const last = copy.length - 1;
      copy[last] = typeof patch === 'function' ? patch(copy[last]) : { ...copy[last], ...patch };
      return copy;
    });
  }, []);

  async function send(text) {
    const msg = (text ?? input).trim();
    if (!msg || streaming) return;
    setError(null); setInput(''); setShowHistory(false);
    setMessages((m) => [...m, { role: 'user', content: msg }, { role: 'assistant', content: '', streaming: true }]);
    setStreaming(true);
    try {
      let acc = '';
      await aiClient.chatStream(
        { message: msg, mode, conversationId: convId, context: attached ? { ...context, exerciseText: attached } : context },
        {
          onMeta: ({ conversationId, sources, primaryMaterial }) => { setConvId(conversationId); patchLast({ sources, primaryMaterial }); },
          onDelta: (delta) => { acc += delta; patchLast((m) => ({ ...m, content: m.content + delta })); },
          onDone: ({ messageId }) => { patchLast({ streaming: false, id: messageId }); if (autoRead && acc.trim()) speak(acc, {}); },
        }
      );
    } catch (e) {
      setError(e.message);
      if (e.premium) { setUpsell(true); patchLast({ content: e.message, isError: true, streaming: false }); }
      else patchLast({ content: '⚠️ ' + e.message, isError: true, streaming: false });
    } finally {
      setStreaming(false);
    }
  }

  function newConversation() {
    setMessages([]); setConvId(null); setError(null); setShowHistory(false);
  }

  async function openHistory() {
    if (!showHistory) setHistory(await aiClient.listConversations(25));
    setShowHistory((s) => !s);
  }

  async function loadConversation(id) {
    setShowHistory(false);
    const msgs = await aiClient.getMessages(id);
    setMessages(msgs.map((m) => ({ role: m.role, content: m.content, id: m.id, sources: m.metadata?.sources, primaryMaterial: m.metadata?.primaryMaterial })));
    setConvId(id);
  }

  async function sendFeedback(messageId, value) {
    patchLast((m) => m); // no-op to keep lint calm
    setMessages((msgs) => msgs.map((m) => (m.id === messageId ? { ...m, feedback: value } : m)));
    try { await aiClient.feedback({ messageId, value }); } catch { /* silențios */ }
  }

  async function onPickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-selectarea aceluiași fișier
    if (!file) return;
    setVisionLoading(true); setError(null);
    try {
      const dataUrl = await fileToCompressedDataUrl(file, { maxDim: 1280, quality: 0.7 });
      const { problemText } = await aiClient.visionExtract({ imageBase64: dataUrl });
      setAttached(problemText || '');
      setEditingAttach(true); // arătăm textul ca să-l poată corecta dacă e nevoie
    } catch (err) {
      setError('Nu am putut citi imaginea: ' + err.message);
    } finally {
      setVisionLoading(false);
    }
  }

  async function toggleMic() {
    if (listening) {
      dictationRef.current?.stop?.();
      dictationRef.current = null;
      if (recorderRef.current) {
        try {
          const blob = await recorderRef.current.stop();
          recorderRef.current = null;
          const dataUrl = await blobToBase64(blob);
          const { text } = await aiClient.transcribe({ audioBase64: dataUrl, mime: blob.type });
          if (text) setInput((v) => (v ? v + ' ' : '') + text);
        } catch (err) { setError('Nu am putut transcrie: ' + err.message); }
      }
      setListening(false);
      return;
    }
    setError(null);
    if (speechRecognitionSupported()) {
      setListening(true);
      dictationRef.current = startDictation({
        onResult: (text) => setInput(text),
        onError: (err) => { setError(err.message); setListening(false); },
        onEnd: () => setListening(false),
      });
    } else {
      try { recorderRef.current = await recordAudio(); setListening(true); }
      catch (err) { setError('Nu am acces la microfon: ' + err.message); }
    }
  }

  if (!user) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>🎓</div>
        <p style={{ color: 'var(--text-light)', marginBottom: 16 }}>Autentifică-te ca să discuți cu Profesorul Virtual.</p>
        <Link to="/autentificare" className="btn btn-primary">Autentificare</Link>
      </div>
    );
  }

  const starters = context.exerciseText
    ? ['Cum încep acest exercițiu?', 'Explică-mi teoria de care am nevoie', 'Verifică-mi gândirea']
    : ['Explică-mi fracțiile', 'Dă-mi un exemplu cu ecuații', 'Cum calculez aria unui triunghi?'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>
      {/* Bară: conversație nouă + istoric */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border)', gap: 8 }}>
        <button onClick={newConversation} style={miniBtn}>＋ Conversație nouă</button>
        <div style={{ display: 'flex', gap: 6 }}>
          {ttsSupported() && (
            <button onClick={() => { const n = !autoRead; setAutoRead(n); if (!n) stopSpeaking(); }}
              title="Citește răspunsurile cu voce tare"
              style={{ ...miniBtn, ...(autoRead ? { background: 'var(--gold)', color: 'var(--navy)', borderColor: 'var(--gold)' } : {}) }}>
              🔊 {autoRead ? 'Auto' : 'Voce'}
            </button>
          )}
          <button onClick={openHistory} style={miniBtn}>🕘 Istoric</button>
        </div>
      </div>

      {/* Selector mod */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {MODES.map((m) => (
          <button key={m.id} title={m.hint} onClick={() => setMode(m.id)}
            style={{
              border: '1px solid', borderColor: mode === m.id ? 'var(--gold)' : 'var(--border)',
              background: mode === m.id ? 'var(--gold)' : 'transparent',
              color: mode === m.id ? 'var(--navy)' : 'var(--text-light)',
              borderRadius: 20, padding: '5px 12px', fontSize: '.8rem', fontWeight: 600,
            }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Banner abonament pentru utilizatorii fără abonament */}
      {user && !isPremium && (
        <div style={{ padding: '8px 12px', background: upsell ? '#fff4e5' : 'rgba(232,185,49,.10)', borderBottom: '1px solid var(--border)', fontSize: '.78rem', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>{upsell ? '🔒 Ai folosit încercarea gratuită.' : '✨ Încercare gratuită: 1 acțiune cu AI-ul.'}</span>
          <Link to="/preturi" style={{ color: 'var(--navy)', fontWeight: 700, whiteSpace: 'nowrap', background: 'var(--gold)', borderRadius: 6, padding: '4px 10px' }}>Abonează-te →</Link>
        </div>
      )}

      {/* Listă istoric (overlay) */}
      {showHistory && (
        <div style={{ position: 'absolute', top: 86, left: 0, right: 0, bottom: 0, background: '#fff', zIndex: 5, overflowY: 'auto', padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <strong style={{ color: 'var(--navy)', fontSize: '.9rem' }}>Conversațiile tale</strong>
            <button onClick={() => setShowHistory(false)} style={miniBtn}>✕ Închide</button>
          </div>
          {history.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '.85rem' }}>Încă nu ai conversații salvate.</p>}
          {history.map((c) => (
            <button key={c.id} onClick={() => loadConversation(c.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', border: '1px solid var(--border)', background: '#f7f9fc', borderRadius: 8, padding: '9px 11px', marginBottom: 6, fontSize: '.85rem', color: 'var(--navy)' }}>
              {c.title || 'Conversație'}
              <span style={{ display: 'block', fontSize: '.72rem', color: 'var(--text-muted)' }}>{new Date(c.updated_at).toLocaleString('ro-RO')}</span>
            </button>
          ))}
        </div>
      )}

      {/* Mesaje */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 14, minHeight: compact ? 200 : 320, background: '#f7f9fc' }}>
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '.9rem' }}>
            <p style={{ marginBottom: 12 }}>Salut! Sunt profesorul tău virtual. Întreabă-mă orice despre matematică 👇</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {starters.map((s) => (
                <button key={s} onClick={() => send(s)}
                  style={{ textAlign: 'left', border: '1px solid var(--border)', background: '#fff', borderRadius: 8, padding: '8px 10px', fontSize: '.85rem', color: 'var(--navy)' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
            <div style={{
              maxWidth: '88%', padding: '9px 13px', borderRadius: 14,
              background: m.role === 'user' ? 'var(--navy)' : (m.isError ? '#fdecea' : '#fff'),
              color: m.role === 'user' ? '#fff' : (m.isError ? '#b71c1c' : 'var(--text)'),
              border: m.role === 'user' ? 'none' : '1px solid var(--border)',
              fontSize: '.9rem', lineHeight: 1.55,
            }}>
              {m.role === 'assistant' && m.primaryMaterial && m.primaryMaterial.url && (
                <Link to={m.primaryMaterial.url} onClick={() => { if (onNavigate) onNavigate(); }}
                  style={{ display: 'block', marginBottom: 8, padding: '7px 10px', borderRadius: 8, background: 'rgba(232,185,49,.12)', border: '1px solid var(--gold)', color: 'var(--navy)', fontSize: '.8rem', fontWeight: 600, textDecoration: 'none' }}>
                  📎 Material pe site: {m.primaryMaterial.title} →
                </Link>
              )}
              {m.role === 'assistant'
                ? <MathText text={m.content || (m.streaming ? '▍' : '')} ready={!m.streaming} />
                : <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}

              {m.sources && m.sources.length > 0 && !m.streaming && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: '.72rem', color: 'var(--text-muted)' }}>📚 {m.sources.length} materiale folosite</summary>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: '.72rem', color: 'var(--text-muted)' }}>
                    {m.sources.map((s, j) => <li key={j}>{s.title || s.type}{s.topic ? ` · ${s.topic}` : ''}</li>)}
                  </ul>
                </details>
              )}
            </div>

            {/* Acțiuni: citește cu voce + feedback */}
            {m.role === 'assistant' && !m.streaming && !m.isError && (
              <div style={{ display: 'flex', gap: 6, marginTop: 4, paddingLeft: 4, alignItems: 'center' }}>
                {ttsSupported() && (
                  <button title="Citește cu voce tare" style={fbBtn}
                    onClick={() => { if (speakingIdx === i) { stopSpeaking(); setSpeakingIdx(null); } else { setSpeakingIdx(i); speak(m.content, { onEnd: () => setSpeakingIdx(null) }); } }}>
                    {speakingIdx === i ? '⏹️' : '🔊'}
                  </button>
                )}
                {m.id && (
                  <>
                    <button onClick={() => sendFeedback(m.id, 1)} title="Răspuns util" style={{ ...fbBtn, opacity: m.feedback === 1 ? 1 : 0.5 }}>👍</button>
                    <button onClick={() => sendFeedback(m.id, -1)} title="Răspuns greșit/neclar" style={{ ...fbBtn, opacity: m.feedback === -1 ? 1 : 0.5 }}>👎</button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Exercițiu atașat din fotografie */}
      {attached !== null && (
        <div style={{ borderTop: '1px solid var(--border)', background: '#fffdf5', padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: '.78rem', color: 'var(--navy)' }}>📎 Exercițiu din fotografie</strong>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setEditingAttach((s) => !s)} style={miniBtn}>{editingAttach ? '✓ Gata' : '✎ Editează'}</button>
              <button onClick={() => { setAttached(null); setEditingAttach(false); }} style={miniBtn}>✕ Șterge</button>
            </div>
          </div>
          {editingAttach
            ? <textarea value={attached} onChange={(e) => setAttached(e.target.value)} rows={3}
                placeholder="Verifică textul citit și corectează dacă e nevoie..."
                style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: '.85rem', fontFamily: 'var(--font-body)', resize: 'vertical' }} />
            : <div style={{ fontSize: '.85rem', color: 'var(--text)' }}><MathText text={attached} /></div>}
          {!editingAttach && attached.trim() && (
            <button onClick={() => send('Ajută-mă cu acest exercițiu.')} disabled={streaming}
              style={{ marginTop: 8, background: 'var(--gold)', color: 'var(--navy)', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: '.82rem', fontWeight: 700, opacity: streaming ? 0.5 : 1 }}>
              Întreabă profesorul despre el →
            </button>
          )}
        </div>
      )}

      {/* Input */}
      <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)', background: '#fff' }}>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPickPhoto} style={{ display: 'none' }} />
        <button onClick={() => fileRef.current?.click()} disabled={visionLoading} title="Fotografiază un exercițiu"
          style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '0 12px', fontSize: '1.1rem', cursor: visionLoading ? 'default' : 'pointer', opacity: visionLoading ? 0.5 : 1 }}>
          {visionLoading ? '…' : '📷'}
        </button>
        <button onClick={toggleMic} title="Întreabă cu vocea"
          style={{ background: listening ? 'var(--gold)' : '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '0 12px', fontSize: '1.1rem', cursor: 'pointer' }}>
          {listening ? '⏺️' : '🎤'}
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Scrie întrebarea ta..."
          style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: '.9rem', fontFamily: 'var(--font-body)' }}
        />
        <button onClick={() => send()} disabled={streaming || !input.trim()}
          style={{
            background: 'var(--gold)', color: 'var(--navy)', border: 'none', borderRadius: 10,
            padding: '0 16px', fontWeight: 700, fontSize: '1.1rem',
            opacity: streaming || !input.trim() ? 0.5 : 1, cursor: streaming ? 'default' : 'pointer',
          }}>
          {streaming ? '…' : '➤'}
        </button>
      </div>
    </div>
  );
}

const miniBtn = { background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', fontSize: '.76rem', color: 'var(--text-light)', fontWeight: 600 };
const fbBtn = { background: 'none', border: 'none', fontSize: '.95rem', cursor: 'pointer', padding: '2px 4px' };

// ─── Widget plutitor (montat global) ─────────────────────────────────────────
export default function FloatingTutor() {
  const [open, setOpen] = useState(false);
  const [widgetTab, setWidgetTab] = useState('chat');
  const { pathname } = useLocation();
  const [pos, setPos] = useState(null); // colțul stânga-sus al butonului
  const drag = useRef({ active: false, moved: false, dx: 0, dy: 0 });
  const BTN = 60;

  useEffect(() => {
    if (!pos) setPos({ x: window.innerWidth - BTN - 22, y: window.innerHeight - BTN - 22 });
    const onResize = () => setPos((p) => (p ? { x: Math.min(p.x, window.innerWidth - BTN - 8), y: Math.min(p.y, window.innerHeight - BTN - 8) } : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []); // eslint-disable-line

  function onPointerDown(e) {
    if (!pos) return;
    drag.current = { active: true, moved: false, dx: e.clientX - pos.x, dy: e.clientY - pos.y, sx: e.clientX, sy: e.clientY };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  }
  function onPointerMove(e) {
    if (!drag.current.active) return;
    if (Math.abs(e.clientX - drag.current.sx) > 4 || Math.abs(e.clientY - drag.current.sy) > 4) drag.current.moved = true;
    setPos({
      x: Math.max(8, Math.min(e.clientX - drag.current.dx, window.innerWidth - BTN - 8)),
      y: Math.max(8, Math.min(e.clientY - drag.current.dy, window.innerHeight - BTN - 8)),
    });
  }
  function onPointerUp() {
    const moved = drag.current.moved;
    drag.current.active = false;
    if (!moved) setOpen((o) => !o); // apăsare simplă (nu tragere) → deschide/închide
  }

  if (pathname === '/admin') return null;
  if (!pos) return null;

  const popupW = Math.min(400, window.innerWidth - 32);
  const popupH = Math.min(640, window.innerHeight - 130);
  const bottomHalf = pos.y > window.innerHeight / 2;
  const labelLeft = pos.x < 150; // dacă butonul e lipit de stânga, punem eticheta în dreapta
  const popupStyle = {
    position: 'fixed', zIndex: 1000, width: popupW, height: popupH,
    left: Math.max(8, Math.min(pos.x + BTN - popupW, window.innerWidth - popupW - 8)),
    ...(bottomHalf ? { bottom: window.innerHeight - pos.y + 12 } : { top: pos.y + BTN + 12 }),
    background: '#fff', borderRadius: 16, boxShadow: 'var(--shadow-lg, 0 12px 40px rgba(0,0,0,.25))',
    display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid var(--border)',
  };
  const tabBtn = (active) => ({
    flex: 1, padding: '8px 6px', fontSize: '.78rem', fontWeight: 700, cursor: 'pointer',
    border: 'none', borderBottom: `2px solid ${active ? 'var(--gold)' : 'transparent'}`,
    background: 'transparent', color: active ? 'var(--navy)' : 'var(--text-muted)',
  });

  return (
    <>
      <style>{`@keyframes pvGlow{0%,100%{box-shadow:0 0 0 0 rgba(232,185,49,.55),0 6px 18px rgba(0,0,0,.28)}50%{box-shadow:0 0 0 12px rgba(232,185,49,0),0 6px 18px rgba(0,0,0,.28)}}`}</style>

      {/* Eticheta „Prof. Virtual" lângă buton (când e închis) */}
      {!open && (
        <div onClick={() => setOpen(true)}
          style={{
            position: 'fixed', zIndex: 1000, top: pos.y + 16, cursor: 'pointer',
            ...(labelLeft ? { left: pos.x + BTN + 8 } : { left: pos.x - 122 }),
            background: 'var(--navy)', color: '#fff', fontWeight: 700, fontSize: '.76rem',
            padding: '6px 10px', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,.2)',
            whiteSpace: 'nowrap', pointerEvents: 'auto',
          }}>
          Prof. Virtual
        </div>
      )}

      {/* Butonul plutitor (draggable + strălucire) */}
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label="Profesor Virtual"
        style={{
          position: 'fixed', left: pos.x, top: pos.y, zIndex: 1001,
          width: BTN, height: BTN, borderRadius: '50%', border: 'none',
          background: 'linear-gradient(135deg, var(--gold), var(--gold-light, #f4d06f))',
          fontSize: '1.7rem', cursor: 'grab', touchAction: 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: open ? 'none' : 'pvGlow 2s ease-in-out infinite',
        }}
      >
        {open ? '✕' : <EinsteinIcon size={36} />}
      </button>

      {open && (
        <div style={popupStyle}>
          <div style={{ background: 'var(--navy)', color: '#fff', padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: '.95rem', display:'flex', alignItems:'center', gap:6 }}><EinsteinIcon size={22} /> Prof. Virtual</div>
            <Link to="/profesor-virtual" onClick={() => setOpen(false)}
              style={{ fontSize: '.72rem', color: 'var(--gold)', border: '1px solid rgba(232,185,49,.4)', borderRadius: 6, padding: '4px 8px' }}>
              Deschide complet ↗
            </Link>
          </div>

          {/* Taburi */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: '#fafbfc' }}>
            <button style={tabBtn(widgetTab === 'chat')} onClick={() => setWidgetTab('chat')}>💬 Întreabă profesorul</button>
            <button style={tabBtn(widgetTab === 'exam')} onClick={() => setWidgetTab('exam')}>📄 Generează subiect examen</button>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: widgetTab === 'exam' ? 'auto' : 'hidden' }}>
            {widgetTab === 'chat'
              ? <ChatPanel compact onNavigate={() => setOpen(false)} />
              : <div style={{ padding: 12 }}><ExamGenerator compact /></div>}
          </div>
        </div>
      )}
    </>
  );
}
