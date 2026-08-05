// =====================================================================
// src/components/AITutor.jsx
// - MathText: text cu formatare + formule KaTeX (export)
// - ChatPanel: panou de chat (streaming, istoric, feedback) — reutilizabil
// - FloatingTutor (export implicit): butonul plutitor de pe tot site-ul
// =====================================================================
import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';
import ExamGenerator from './ExamGenerator';
import EinsteinIcon from './EinsteinIcon';
import { useAuth } from '../context/AuthContext';
import { askAiLabel } from '../lib/aiLabel';
import { ensureKatex, renderMath, autoMath } from '../lib/katex';
import { fileToCompressedDataUrl } from '../lib/image';
import { speechRecognitionSupported, startDictation, recordAudio, blobToBase64, ttsSupported, stopSpeaking, playAnswer, sentencesOf } from '../lib/voice';
import { extractTutorActions } from '../lib/tutorBridge';

// ─── Terminologie școlară: „factorizare" → „descompunere în factori" ─────────
const FACTORIZARE = {
  'factorizare': 'descompunere în factori', 'factorizarea': 'descompunerea în factori',
  'factorizări': 'descompuneri în factori', 'factorizarii': 'descompunerii în factori',
  'factorizării': 'descompunerii în factori', 'factorizările': 'descompunerile în factori',
  'factorizărilor': 'descompunerilor în factori',
};
export function fixTerminology(text = '') {
  return String(text).replace(/\bfactoriz(ările|ărilor|area|ării|arii|ări|are)\b/gi, (m) => {
    const rep = FACTORIZARE[m.toLowerCase()] || 'descompunere în factori';
    return m[0] === m[0].toUpperCase() ? rep[0].toUpperCase() + rep.slice(1) : rep;
  });
}

// ─── Curățare comună (afișare + voce): terminologie, acțiuni, linkuri, $$ ────
export function preMessage(text = '') {
  let t = fixTerminology(text)
    // marcajele de acțiune nu se afișează niciodată (nici complete, nici parțiale la streaming)
    .replace(/\[\[\s*ACTIUNE[\s\S]*?\]\]/gi, '')
    .replace(/\[\[\s*ACTIUNE[^\]]*$/i, '')
    // marcajele de meditații (pornesc pași în rubrica /meditatii) — la fel, invizibile
    .replace(/\[\[\s*MEDITATII[\s\S]*?\]\]/gi, '')
    .replace(/\[\[\s*MEDITATII[^\]]*$/i, '');
  // linkurile absolute către site (inclusiv „.ro" greșit) devin RELATIVE → clicabile intern
  t = t.replace(/https?:\/\/(?:www\.)?examenmate\.(?:ro|com)(\/[^\s)"'<>\]]*)?/gi, (_, p) => p || '/');
  // delimitatorii \[...\] și \(...\) (scriși uneori de model) → $$/$, altfel apar cruzi în chat
  t = t.replace(/\\\[([\s\S]+?)\\\]/g, (_, b) => '$$' + b.replace(/\s*\n\s*/g, ' ').trim() + '$$');
  t = t.replace(/\\\(([\s\S]+?)\\\)/g, (_, b) => '$' + b.replace(/\s*\n\s*/g, ' ').trim() + '$');
  // formulele afișate $$...$$ pe UN singur rând — altfel <br/> le rupe și KaTeX nu le mai randează
  t = t.replace(/\$\$([\s\S]+?)\$\$/g, (_, b) => '$$' + b.replace(/\s*\n\s*/g, ' ').trim() + '$$');
  // reparații pentru „$" pus greșit de model ÎN INTERIORUL expresiei (ex: 10$^3$, 4(10$)^3$)
  t = t.replace(/(\w)\$(\)|\^|_)/g, '$1$2');
  // un „$" rămas fără pereche pe o linie strică randarea întregii linii → îl eliminăm
  t = t.split('\n').map((ln) => {
    const c = (ln.match(/\$/g) || []).length;
    if (c % 2 === 1) { const i = ln.lastIndexOf('$'); return ln.slice(0, i) + ln.slice(i + 1); }
    return ln;
  }).join('\n');
  return t;
}

// Un fragment de text (fără paragrafe) → HTML: escape, linkuri, bold, cod.
function inlineHtml(t = '') {
  const esc = autoMath(t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc
    // linkuri interne markdown [Titlu](/cale) → ancoră clicabilă (deschide exercițiul/materialul)
    .replace(/\[([^\]\n]+)\]\((\/[^)\s]*)\)/g,
      '<a href="$2" data-internal="1" style="display:inline-block;margin:2px 0;padding:2px 8px;border-radius:6px;background:rgba(232,185,49,.15);border:1px solid var(--gold);color:var(--navy);font-weight:600;text-decoration:none">🧩 $1 →</a>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:rgba(15,43,68,.08);padding:1px 5px;border-radius:4px;font-size:.92em">$1</code>')
    .replace(/\n/g, '<br/>');
}

// ─── Formatare ușoară (bold, cod, paragrafe). Formulele LaTeX le lasă KaTeX. ──
function formatMessage(text = '') {
  return preMessage(text).split(/\n{2,}/)
    .map((p, i) => (i ? '</p><p style="margin:.55em 0 0">' : '') + inlineHtml(p))
    .join('');
}

// Mesaj împărțit pe „propoziții" marcate <span data-s="i"> — pentru evidențierea
// părții deja citite cu voce. Folosește ACEEAȘI împărțire ca redarea vocală.
function sentencesHtml(text = '') {
  const sents = sentencesOf(preMessage(text));
  let html = '', lastP = -1;
  sents.forEach((s, i) => {
    if (s.p !== lastP) { html += (lastP === -1 ? '' : '</p><p style="margin:.55em 0 0">'); lastP = s.p; }
    else html += ' ';
    html += '<span data-s="' + i + '">' + inlineHtml(s.text) + '</span>';
  });
  return html;
}

// Text cu formule. `ready=false` în timpul streamingului (afișează brut, fără flicker);
// la final `ready=true` → randează KaTeX.
// `onInternalLink(cale)` — apelat la click pe un link intern din mesaj.
// `sentences` + `readPos` — evidențiază propozițiile deja citite cu voce.
export function MathText({ text, ready = true, onInternalLink = null, sentences = false, readPos = null }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = '<p style="margin:0">' + (sentences ? sentencesHtml(text || '') : formatMessage(text || '')) + '</p>';
    if (ready && text) ensureKatex().then(() => { if (ref.current) renderMath(ref.current); });
  }, [text, ready, sentences]);
  // indiciul vizual al părții parcurse de voce (fără re-randare KaTeX)
  useEffect(() => {
    if (!ref.current || !sentences) return;
    ref.current.querySelectorAll('[data-s]').forEach((el) => {
      const k = Number(el.getAttribute('data-s'));
      el.classList.toggle('pv-now', readPos != null && k === readPos);
      el.classList.toggle('pv-said', readPos != null && k < readPos);
    });
  }, [readPos, sentences, text, ready]);
  function onClick(e) {
    const a = e.target.closest?.('a[data-internal]');
    if (!a) return;
    e.preventDefault();
    if (onInternalLink) onInternalLink(a.getAttribute('href'));
  }
  return <div ref={ref} onClick={onClick} />;
}

const MODES = [
  { id: 'tutor', label: 'Învață-mă', hint: 'Explicație pas cu pas' },
  { id: 'explain', label: 'Teoria', hint: 'Explică teoria subiectului' },
  { id: 'hint', label: 'Dă-mi un indiciu', hint: 'Un singur pas, fără rezolvare' },
];

// ─── Marcajele [[MEDITATII:{...}]] — profesorul pornește pași din conversație ─
// Extrase din răspunsul modelului; executate de pagina /meditatii. Dacă elevul
// nu e pe /meditatii, acțiunea se pune „în așteptare" și navigăm acolo.
export function extractMeditatiiActions(text = '') {
  const out = [];
  const re = /\[\[\s*MEDITATII\s*:\s*([\s\S]*?)\]\]/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    try {
      const a = JSON.parse(m[1]);
      if (a && a.kind) out.push(a);
    } catch { /* marcaj malformat — ignorat */ }
  }
  return out;
}
export function dispatchMeditatiiAction(action, navigate, onNavigate = null) {
  if (!action) return;
  if (window.location.pathname === '/meditatii') {
    window.dispatchEvent(new CustomEvent('mate:meditatii-action', { detail: action }));
  } else {
    try { sessionStorage.setItem('med_pending_action', JSON.stringify(action)); } catch { /* ignore */ }
    if (onNavigate) onNavigate();
    navigate('/meditatii');
  }
}

// Props noi pentru integrarea cu exercițiile interactive:
//  onAction(actiune)        — execută o acțiune AI în exercițiu (fill/choose/tf/add)
//  initialConversationId    — reia o conversație existentă (chat → exercițiu)
//  autoPrompt {id, text, mode?} — mesaj trimis automat (butonul din exercițiu)
export function ChatPanel({ context = {}, compact = false, initialMode = 'tutor', onNavigate = null, onAction = null, initialConversationId = null, autoPrompt = null, coachInject = null }) {
  const { user, isPremium, isTeacher, isParent } = useAuth();
  const navigate = useNavigate();
  const isMentor = isTeacher || isParent;
  const [mode, setMode] = useState(isMentor ? 'exams' : initialMode);
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
  // ── Conversație vocală: „🎤 întreabă cu vocea" + „▶ Ascultă răspunsul" ──
  // Glasul vine de pe server (identic pe desktop și pe telefon), cu revenire
  // automată la sinteza din browser. Bara de progres e clicabilă (derulare).
  const [voiceState, setVoiceState] = useState({ idx: null, frac: 0, sent: 0, total: 0, paused: false });
  const playerRef = useRef(null);

  function stopPlayback() {
    try { playerRef.current?.stop?.(); } catch { /* ignore */ }
    playerRef.current = null;
    stopSpeaking();
    setVoiceState({ idx: null, frac: 0, sent: 0, total: 0, paused: false });
  }

  function startListen(msgIdx, content) {
    stopPlayback();
    let ctl = null;
    ctl = playAnswer(preMessage(content), {
      onProgress: ({ frac, sent, total }) =>
        setVoiceState((v) => (v.idx === msgIdx ? { ...v, frac, sent, total } : v)),
      onEnd: () => { if (playerRef.current === ctl) stopPlayback(); },
    });
    if (!ctl) return;
    playerRef.current = ctl;
    setVoiceState({ idx: msgIdx, frac: 0, sent: 0, total: 0, paused: false });
  }

  function toggleListen(msgIdx, content) {
    const ctl = playerRef.current;
    if (ctl && voiceState.idx === msgIdx) {
      if (!ctl.paused) { ctl.pause(); setVoiceState((v) => ({ ...v, paused: true })); }
      else { ctl.resume(); setVoiceState((v) => ({ ...v, paused: false })); }
      return;
    }
    startListen(msgIdx, content);
  }

  function seekListen(frac, msgIdx, content) {
    const ctl = playerRef.current;
    if (ctl && voiceState.idx === msgIdx) { ctl.seek(frac); setVoiceState((v) => ({ ...v, paused: false })); }
    else startListen(msgIdx, content);
  }

  // la închiderea panoului, vocea tace
  useEffect(() => () => { try { playerRef.current?.stop?.(); } catch { /* ignore */ } stopSpeaking(); }, []);
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

  // ultimul mesaj „coach" (trimis automat de platformă) — intră în contextul
  // conversației, ca modelul să continue natural când elevul răspunde „da"/„hai"
  const coachNoteRef = useRef(null);

  async function send(text, { modeOverride = null } = {}) {
    const msg = (text ?? input).trim();
    if (!msg || streaming) return;
    const asstIdx = messages.length + 1; // indexul mesajului de răspuns (pentru redarea vocală auto)
    setError(null); setInput(''); setShowHistory(false);
    setMessages((m) => [...m, { role: 'user', content: msg }, { role: 'assistant', content: '', streaming: true }]);
    setStreaming(true);
    try {
      let acc = '';
      const baseCtx = attached ? { ...context, exerciseText: attached } : context;
      const sendCtx = coachNoteRef.current ? { ...baseCtx, coachNote: coachNoteRef.current } : baseCtx;
      await aiClient.chatStream(
        { message: msg, mode: modeOverride || mode, conversationId: convId, context: sendCtx },
        {
          onMeta: ({ conversationId, sources, primaryMaterial }) => { setConvId(conversationId); patchLast({ sources, primaryMaterial }); },
          onDelta: (delta) => { acc += delta; patchLast((m) => ({ ...m, content: m.content + delta })); },
          onDone: ({ messageId }) => {
            // extrage acțiunile [[ACTIUNE:...]] și curăță textul afișat
            const { text: cleanText0, actions } = extractTutorActions(acc);
            // marcajele [[MEDITATII:...]] — profesorul pornește un pas de meditație
            const medActions = extractMeditatiiActions(acc);
            // adresa oficială e examenmate.com — corectăm eventualul „.ro" halucinat;
            // terminologie: „factorizare" → „descompunere în factori" (și pentru voce)
            const cleanText = fixTerminology(preMessage(cleanText0).replace(/https?:\/\/(?:www\.)?examenmate\.ro/gi, 'https://examenmate.com'));
            patchLast({ streaming: false, id: messageId, content: cleanText });
            if (onAction && actions.length) actions.slice(0, 2).forEach((a) => { try { onAction(a); } catch { /* noop */ } });
            if (medActions.length) setTimeout(() => dispatchMeditatiiAction(medActions[0], navigate, onNavigate), 600);
            if (autoRead && cleanText.trim()) startListen(asstIdx, cleanText); // cu bară + evidențiere
          },
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
    stopPlayback();
  }

  // Reia conversația începută în altă parte (ex: chat plutitor → exercițiu)
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!initialConversationId || resumedRef.current) return;
    resumedRef.current = true;
    loadConversation(initialConversationId).catch(() => {});
  }, [initialConversationId]); // eslint-disable-line

  // Mesaj trimis automat (butonul „Întreabă profesorul virtual" din exercițiu)
  const autoRef = useRef(null);
  useEffect(() => {
    if (!autoPrompt || !autoPrompt.text || autoPrompt.id === autoRef.current) return;
    if (streaming) return;
    autoRef.current = autoPrompt.id;
    send(autoPrompt.text, { modeOverride: autoPrompt.mode || null });
  }, [autoPrompt]); // eslint-disable-line

  // Mesaj automat al PROFESORULUI (coach de meditații): apare ca mesaj al lui,
  // cu BUTOANE de pași („Recapitulare", „Exerciții"...). Nu se salvează în
  // istoric — e ghidajul de interfață; modelul îl primește prin coachNote.
  const coachIdRef = useRef(null);
  useEffect(() => {
    if (!coachInject || !coachInject.message || coachInject.id === coachIdRef.current) return;
    coachIdRef.current = coachInject.id;
    coachNoteRef.current = coachInject.message;
    setMessages((m) => [...m, { role: 'assistant', content: coachInject.message, coach: true, suggestions: coachInject.suggestions || [] }]);
  }, [coachInject]); // eslint-disable-line

  // Click pe un link intern din mesaj: exercițiile se deschid CU conversația curentă,
  // iar paginile de categorie se deschid direct pe tabul „Teste interactive".
  function openInternal(href) {
    if (!href) return;
    href = href.replace(/^https?:\/\/(?:www\.)?examenmate\.(?:ro|com)/i, '') || '/';
    if (onNavigate) onNavigate();
    if (href.startsWith('/exercitiu') || href.startsWith('/pdf-viewer')) {
      navigate(href, { state: { openTutor: true, tutorConvId: convId } });
    } else if (/^\/(evaluare-nationala|bacalaureat|clase)/.test(href)) {
      navigate(href, { state: { returnTab: 'interactive' } });
    } else {
      navigate(href);
    }
  }

  async function openHistory() {
    if (!showHistory) setHistory(await aiClient.listConversations(25));
    setShowHistory((s) => !s);
  }

  async function loadConversation(id) {
    setShowHistory(false);
    stopPlayback();
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

  const starters = context.interactive
    ? ['Dă-mi un indiciu la pasul curent', 'Explică-mi metoda pentru acest exercițiu', 'Verifică-mi pașii de până acum', 'Nu înțeleg unde am greșit']
    : context.pdf
    ? ['Explică-mi exercițiul 1', 'De unde încep la subiectul II?', 'Ce formule îmi trebuie aici?', 'Fă-mi un rezumat al cerințelor']
    : context.exerciseText
    ? ['Cum încep acest exercițiu?', 'Explică-mi teoria de care am nevoie', 'Verifică-mi gândirea']
    : ['Explică-mi fracțiile', 'Dă-mi un exemplu cu ecuații', 'Fă-mi un plan de învățare pentru capitolul meu'];

  // Pentru profesor/părinte: butoane care NAVIGHEAZĂ (nu trimit mesaj).
  // NU se afișează când e deschis un test PDF (acolo întrebările sunt despre
  // test, nu despre navigarea în site) — se arată sugestiile despre PDF.
  const showMentorActions = isMentor && !context.pdf;
  const mentorActions = [
    { label: 'Unde găsesc subiecte de examen?', to: '/', anchor: 'examene' },
    { label: 'Unde găsesc statistici despre elevi?', to: '/profil' },
    { label: 'Generează subiect examen sau exercițiu interactiv', to: '/profesor-virtual' },
  ];
  function goTo(to, anchor) {
    if (onNavigate) onNavigate();
    navigate(to);
    if (anchor) setTimeout(() => { document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 350);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>
      {/* evidențierea părții citite cu voce din răspuns */}
      <style>{`.pv-said{background:rgba(232,185,49,.16);border-radius:3px}.pv-now{background:rgba(232,185,49,.42);border-radius:3px}`}</style>
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

      {/* Selector mod (doar pentru elevi; în meditații dispare — profesorul
          alege singur cum explică, elevul doar scrie) */}
      {!isMentor && !context?.meditatii && (
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
      )}

      {/* Banner abonament pentru utilizatorii fără abonament */}
      {user && !isPremium && (
        <div style={{ padding: '8px 12px', background: upsell ? '#fff4e5' : 'rgba(232,185,49,.10)', borderBottom: '1px solid var(--border)', fontSize: '.78rem', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>{upsell ? '🔒 Ai folosit cele 2 încercări gratuite.' : '✨ Încercare gratuită: 2 acțiuni cu AI-ul.'}</span>
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
      {/* minHeight 0 în modul compact: altfel, pe panouri mici (mobil),
          zona de mesaje împinge câmpul de scris în afara ecranului */}
      {/* overscrollBehavior contain: derularea din chat nu se mai „scurge" în pagină */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', padding: 14, minHeight: compact ? 0 : 320, background: '#f7f9fc' }}>
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '.9rem' }}>
            <p style={{ marginBottom: 12 }}>{isMentor ? 'Salut! Sunt Asistentul tău. Alege mai jos sau întreabă-mă orice 👇' : 'Salut! Sunt profesorul tău virtual. Întreabă-mă orice despre matematică 👇'}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {showMentorActions
                ? mentorActions.map((a) => (
                    <button key={a.label} onClick={() => goTo(a.to, a.anchor)}
                      style={{ textAlign: 'left', border: '1px solid var(--border)', background: '#fff', borderRadius: 8, padding: '8px 10px', fontSize: '.85rem', color: 'var(--navy)' }}>
                      {a.label}
                    </button>
                  ))
                : starters.map((s) => (
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
                <a href={m.primaryMaterial.url}
                  onClick={(e) => { e.preventDefault(); openInternal(m.primaryMaterial.url); }}
                  style={{ display: 'block', marginBottom: 8, padding: '7px 10px', borderRadius: 8, background: 'rgba(232,185,49,.12)', border: '1px solid var(--gold)', color: 'var(--navy)', fontSize: '.8rem', fontWeight: 600, textDecoration: 'none', cursor: 'pointer' }}>
                  📎 Material pe site: {m.primaryMaterial.title} →
                </a>
              )}
              {m.role === 'assistant'
                ? <MathText text={m.content || (m.streaming ? '▍' : '')} ready={!m.streaming} onInternalLink={openInternal}
                    sentences readPos={voiceState.idx === i ? voiceState.sent : null} />
                : <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}

              {m.sources && m.sources.length > 0 && !m.streaming && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: 'pointer', fontSize: '.72rem', color: 'var(--text-muted)' }}>📚 {m.sources.length} materiale folosite</summary>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: '.72rem', color: 'var(--text-muted)' }}>
                    {m.sources.map((s, j) => <li key={j}>{s.title || s.type}{s.topic ? ` · ${s.topic}` : ''}</li>)}
                  </ul>
                </details>
              )}

              {/* Butoanele de pași propuși de profesor (mesajele „coach") */}
              {m.coach && m.suggestions?.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                  {m.suggestions.map((s, k) => (
                    <button key={k} onClick={() => dispatchMeditatiiAction(s, navigate, onNavigate)}
                      style={{ textAlign: 'left', border: '1px solid var(--gold)', background: 'rgba(232,185,49,.12)', borderRadius: 8, padding: '8px 10px', fontSize: '.85rem', color: 'var(--navy)', fontWeight: 600, cursor: 'pointer' }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Acțiuni: „Ascultă răspunsul" (play/pauză) + feedback */}
            {m.role === 'assistant' && !m.streaming && !m.isError && (
              <div style={{ display: 'flex', gap: 6, marginTop: 4, paddingLeft: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                {ttsSupported() && (
                  <button
                    title={voiceState.idx === i && !voiceState.paused ? 'Pune pauză' : 'Ascultă explicația cu voce tare'}
                    onClick={() => toggleListen(i, m.content)}
                    style={{
                      ...listenBtn,
                      ...(voiceState.idx === i && !voiceState.paused
                        ? { background: 'var(--gold)', color: 'var(--navy)', borderColor: 'var(--gold)' }
                        : {}),
                    }}>
                    {voiceState.idx === i
                      ? (voiceState.paused ? '▶ Continuă' : '❚❚ Pauză')
                      : '▶ Ascultă răspunsul'}
                  </button>
                )}
                {/* Bara de derulare a răspunsului vocal (click = salt) */}
                {voiceState.idx === i && voiceState.total > 1 && (
                  <div
                    title="Derulează răspunsul vocal"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      seekListen((e.clientX - r.left) / r.width, i, m.content);
                    }}
                    style={{ width: 150, height: 9, borderRadius: 6, background: 'rgba(15,43,68,.15)', cursor: 'pointer', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', background: 'var(--gold)', transition: 'width .25s',
                      width: `${Math.round(Math.min(1, voiceState.frac) * 100)}%`,
                    }} />
                  </div>
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
                style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 16, fontFamily: 'var(--font-body)', resize: 'vertical' }} />
            : <div style={{ fontSize: '.85rem', color: 'var(--text)' }}><MathText text={attached} /></div>}
          {!editingAttach && attached.trim() && (
            <button onClick={() => send('Ajută-mă cu acest exercițiu.')} disabled={streaming}
              style={{ marginTop: 8, background: 'var(--gold)', color: 'var(--navy)', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: '.82rem', fontWeight: 700, opacity: streaming ? 0.5 : 1 }}>
              {askAiLabel({ isTeacher, isParent })} despre el →
            </button>
          )}
        </div>
      )}

      {/* Input — rămâne mereu vizibil, chiar și pe panouri mici */}
      <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)', background: '#fff', flexShrink: 0 }}>
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
          style={{ flex: 1, minWidth: 0, border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px', fontSize: 16, fontFamily: 'var(--font-body)' }}
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

// ─── Butonul plutitor al Profesorului Virtual — MUTABIL (tragi de el) ────────
// Folosit lângă exercițiile interactive și PDF-uri. Apăsare scurtă = deschide;
// ținut apăsat și tras = îl muți unde nu îți acoperă exercițiul.
export function TutorFab({ onOpen, label = 'Întreabă-mă orice 👇' }) {
  const BTN = 58;
  const [pos, setPos] = useState(null); // colțul stânga-sus al butonului
  const drag = useRef({ active: false, moved: false, dx: 0, dy: 0, sx: 0, sy: 0 });

  useEffect(() => {
    setPos({ x: window.innerWidth - BTN - 24, y: window.innerHeight - BTN - 20 });
    const onResize = () => setPos((p) => (p
      ? { x: Math.max(8, Math.min(p.x, window.innerWidth - BTN - 8)), y: Math.max(8, Math.min(p.y, window.innerHeight - BTN - 8)) }
      : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function down(e) {
    if (!pos) return;
    drag.current = { active: true, moved: false, dx: e.clientX - pos.x, dy: e.clientY - pos.y, sx: e.clientX, sy: e.clientY };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  }
  function move(e) {
    if (!drag.current.active) return;
    if (Math.abs(e.clientX - drag.current.sx) > 4 || Math.abs(e.clientY - drag.current.sy) > 4) drag.current.moved = true;
    setPos({
      x: Math.max(8, Math.min(e.clientX - drag.current.dx, window.innerWidth - BTN - 8)),
      y: Math.max(8, Math.min(e.clientY - drag.current.dy, window.innerHeight - BTN - 8)),
    });
  }
  function up() {
    const moved = drag.current.moved;
    drag.current.active = false;
    if (!moved && onOpen) onOpen(); // apăsare simplă (nu tragere) → deschide
  }

  if (!pos) return null;
  const labelLeft = pos.x < 150; // lipit de stânga → eticheta se întinde spre dreapta

  return (
    <>
      <style>{`@keyframes fabGlow{0%,100%{box-shadow:0 0 0 0 rgba(232,185,49,.55),0 6px 18px rgba(0,0,0,.28)}50%{box-shadow:0 0 0 12px rgba(232,185,49,0),0 6px 18px rgba(0,0,0,.28)}}`}</style>
      {label && (
        <div
          onClick={() => onOpen && onOpen()}
          style={{
            position: 'fixed', zIndex: 1500, cursor: 'pointer',
            top: Math.max(8, pos.y - 38),
            ...(labelLeft ? { left: pos.x } : { left: pos.x + BTN, transform: 'translateX(-100%)' }),
            background: 'var(--navy)', color: '#fff', fontWeight: 700, fontSize: '.76rem',
            padding: '6px 11px', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,.25)', whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
      )}
      <button
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        aria-label="Profesorul Virtual — apasă pentru ajutor, trage ca să mă muți"
        title="Apasă pentru ajutor · ține apăsat și trage ca să mă muți"
        style={{
          position: 'fixed', left: pos.x, top: pos.y, zIndex: 1501,
          width: BTN, height: BTN, borderRadius: '50%', border: 'none',
          cursor: 'grab', touchAction: 'none',
          background: 'linear-gradient(135deg, var(--gold), #f4d06f)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'fabGlow 2s ease-in-out infinite',
        }}
      >
        <EinsteinIcon size={34} />
      </button>
    </>
  );
}

const miniBtn = { background: 'none', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', fontSize: '.76rem', color: 'var(--text-light)', fontWeight: 600 };
const fbBtn = { background: 'none', border: 'none', fontSize: '.95rem', cursor: 'pointer', padding: '2px 4px' };
const listenBtn = { display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: '1px solid var(--gold)', color: 'var(--navy)', borderRadius: 16, padding: '3px 11px', fontSize: '.75rem', fontWeight: 700, cursor: 'pointer' };

// ─── Widget plutitor (montat global) ─────────────────────────────────────────
export default function FloatingTutor() {
  const [open, setOpen] = useState(false);
  const [widgetTab, setWidgetTab] = useState('chat');
  const { pathname } = useLocation();
  const { isTeacher, isParent } = useAuth();
  const isMentorAcc = isTeacher || isParent;
  const onMeditatii = pathname === '/meditatii';
  // profesor/părinte → „Asistent AI"; elev pe /meditatii → „Meditatorul tău"; altfel „Prof. Virtual"
  const widgetLabel = isMentorAcc ? 'Asistent AI' : onMeditatii ? 'Meditatorul tău' : 'Prof. Virtual';

  // Pagina de meditații trimite contextul + mesajul automat („Nu înțeleg
  // exercițiul...") + mesajele COACH (bun venit, aprecieri, pasul următor)
  // către ACEST widget — o singură conversație, un singur buton. Widgetul se
  // DESCHIDE SINGUR ori de câte ori profesorul are ceva de comunicat.
  const [medChat, setMedChat] = useState(null); // { context, autoPrompt, coach }
  useEffect(() => {
    function onMedChat(e) {
      setMedChat((prev) => ({
        context: e.detail?.context || prev?.context || { meditatii: true },
        autoPrompt: e.detail?.autoPrompt || null,
        coach: e.detail?.coach || null,
      }));
      setWidgetTab('chat');
      setOpen(true);
    }
    window.addEventListener('mate:meditatii-chat', onMedChat);
    return () => window.removeEventListener('mate:meditatii-chat', onMedChat);
  }, []);
  const chatContext = medChat?.context || (onMeditatii && !isMentorAcc ? { meditatii: true } : undefined);
  // „Meditatorul tău": pe /meditatii widgetul e PANOU LATERAL ANDOCAT, mai mare
  // (accentul cade pe conversație — el dă de lucru), iar pagina se strânge lângă el.
  const medMode = onMeditatii && !isMentorAcc;
  useEffect(() => {
    const isOpen = medMode && open;
    window.__medChatOpen = isOpen; // starea globală — pagina o citește și la montare
    window.dispatchEvent(new CustomEvent('mate:meditatii-chat-state', { detail: { open: isOpen } }));
    return () => {
      window.__medChatOpen = false;
      window.dispatchEvent(new CustomEvent('mate:meditatii-chat-state', { detail: { open: false } }));
    };
  }, [open, medMode]);
  // pagina poate cere închiderea widgetului (ex. la reset / formularul de înscriere)
  useEffect(() => {
    function onClose() { setOpen(false); setMedChat(null); }
    window.addEventListener('mate:meditatii-close', onClose);
    return () => window.removeEventListener('mate:meditatii-close', onClose);
  }, []);
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
  const popupStyle = medMode
    ? {
        // panou lateral andocat, mare — pagina de meditații se strânge lângă el
        position: 'fixed', zIndex: 1000, right: 10, top: 74, bottom: 10,
        width: 'min(460px, 94vw)',
        background: '#fff', borderRadius: 16, boxShadow: 'var(--shadow-lg, 0 12px 40px rgba(0,0,0,.25))',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid var(--border)',
      }
    : {
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

      {/* Eticheta widgetului lângă buton (când e închis) — după rol */}
      {!open && (
        <div onClick={() => setOpen(true)}
          style={{
            position: 'fixed', zIndex: 1000, top: pos.y + 16, cursor: 'pointer',
            ...(labelLeft ? { left: pos.x + BTN + 8 } : { left: pos.x - 122 }),
            background: 'var(--navy)', color: '#fff', fontWeight: 700, fontSize: '.76rem',
            padding: '6px 10px', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,.2)',
            whiteSpace: 'nowrap', pointerEvents: 'auto',
          }}>
          {widgetLabel}
        </div>
      )}

      {/* Butonul plutitor (draggable + strălucire) */}
      <button
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        aria-label={widgetLabel}
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
            <div style={{ fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: '.95rem', display:'flex', alignItems:'center', gap:6 }}><EinsteinIcon size={22} /> {widgetLabel}</div>
            {medMode ? (
              <button onClick={() => setOpen(false)}
                style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: '.8rem', fontWeight: 600 }}>
                ✕
              </button>
            ) : (
              <Link to="/profesor-virtual" onClick={() => setOpen(false)}
                style={{ fontSize: '.72rem', color: 'var(--gold)', border: '1px solid rgba(232,185,49,.4)', borderRadius: 6, padding: '4px 8px' }}>
                Deschide complet ↗
              </Link>
            )}
          </div>

          {/* Taburi (ascunse în modul „Meditatorul tău" — acolo e doar conversația) */}
          {!medMode && (
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: '#fafbfc' }}>
              <button style={tabBtn(widgetTab === 'chat')} onClick={() => setWidgetTab('chat')}>💬 {askAiLabel({ isTeacher, isParent })}</button>
              {isMentorAcc
                ? <button style={tabBtn(widgetTab === 'exam')} onClick={() => setWidgetTab('exam')}>📄 Generează subiect examen</button>
                : <button style={{ ...tabBtn(widgetTab === 'meditatii'), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }} onClick={() => setWidgetTab('meditatii')}><EinsteinIcon size={15} /> Meditații cu Prof. Virtual</button>}
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, overflowY: (widgetTab === 'chat' || medMode) ? 'hidden' : 'auto' }}>
            {(widgetTab === 'chat' || medMode) && <ChatPanel compact context={chatContext || {}} autoPrompt={medChat?.autoPrompt || null} coachInject={medChat?.coach || null} onNavigate={() => setOpen(false)} />}
            {!medMode && widgetTab === 'exam' && <div style={{ padding: 12 }}><ExamGenerator compact /></div>}
            {!medMode && widgetTab === 'meditatii' && (
              <div style={{ padding: 16 }}>
                <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '.95rem', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 7 }}><EinsteinIcon size={22} /> Meditații cu Profesorul Virtual</div>
                <p style={{ fontSize: '.83rem', color: 'var(--text-light)', lineHeight: 1.55, marginBottom: 10 }}>
                  Meditatorul tău personal: îți face <strong>testul inițial</strong>, îți construiește <strong>planul de învățare</strong>,
                  îți explică <strong>teoria</strong>, îți dă <strong>exerciții și teme</strong> pe nivelul tău, îți analizează
                  <strong> greșelile</strong> și revine cu <strong>recapitulări</strong> ca să nu uiți materia.
                </p>
                <ul style={{ fontSize: '.8rem', color: 'var(--text)', lineHeight: 1.7, margin: '0 0 12px', paddingLeft: 18 }}>
                  <li>Plan personalizat cu obiective săptămânale</li>
                  <li>Teme corectate, notate și explicate</li>
                  <li>„Încă 10 exerciții la fel" unde greșești</li>
                  <li>Recapitulări după 1 zi · 7 zile · 30 de zile</li>
                  <li>Simulări de examen + nota estimată</li>
                </ul>
                <Link to="/meditatii" onClick={() => setOpen(false)} className="btn btn-primary" style={{ width: '100%', textAlign: 'center' }}>
                  Deschide meditațiile →
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
