// =====================================================================
// src/components/AITutor.jsx
// - MathText: text cu formatare + formule KaTeX (export)
// - ChatPanel: panou de chat (streaming, istoric, feedback) — reutilizabil
// - FloatingTutor (export implicit): butonul plutitor de pe tot site-ul
// =====================================================================
import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';
import { supabase } from '../lib/supabase';
import ExamGenerator from './ExamGenerator';
import EinsteinIcon from './EinsteinIcon';
import { useAuth } from '../context/AuthContext';
import { askAiLabel } from '../lib/aiLabel';
import { ensureKatex, renderMath, autoMath } from '../lib/katex';
import { fileToCompressedDataUrl } from '../lib/image';
import { speechRecognitionSupported, startDictation, recordAudio, blobToBase64, ttsSupported, stopSpeaking, playAnswer, sentencesOf } from '../lib/voice';
import { extractTutorActions } from '../lib/tutorBridge';
import { awardBadges } from '../lib/badges';
import { notaDinScor } from '../lib/nota';
import AIPoweredBy from './AIPoweredBy';

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
    // escapăm " în URL ca să nu se poată sparge atributul href (injecție de atribut)
    .replace(/\[([^\]\n]+)\]\((\/[^)\s]*)\)/g, (m, label, href) =>
      `<a href="${href.replace(/"/g, '&quot;')}" data-internal="1" style="display:inline-block;margin:2px 0;padding:2px 8px;border-radius:6px;background:rgba(232,185,49,.15);border:1px solid var(--gold);color:var(--navy);font-weight:600;text-decoration:none">🧩 ${label} →</a>`)
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

// Butoanele de mod („Învață-mă" / „Teoria" / „Dă-mi un indiciu") au fost
// eliminate — locul lor l-a luat „📝 Răspunde în chat": formularul prin care
// elevul completează răspunsurile, iar profesorul le corectează după barem.

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

// ─── „Alege un test PDF din site" (chatul de meditații) — etichete listă ─────
const PDF_SUBCAT_RO = {
  simulari: '🎯 Simulări', variante: '📋 Variante date + modele', 'teste-antrenament': '🏋 Teste de antrenament',
  'exercitii-subiecte': '📝 Exerciții pe subiecte', exercitii: '📝 Exerciții pe subiecte', capitole: '📚 Capitole',
};
const PDF_PROFILE_RO = { 'mate-info': 'Mate-Info', 'stiinte-naturii': 'Șt. Naturii', tehnologic: 'Tehnologic' };
const pickTag = (bg, color) => ({ fontSize: '.66rem', fontWeight: 700, background: bg, color, borderRadius: 12, padding: '2px 8px', whiteSpace: 'nowrap' });

// ─── Rezultatul corectării unui test/exercițiu PDF — afișat în chat ──────────
// Punctajul total + nota + punctajul PE FIECARE subpunct a), b), c) (ca în barem).
const VERDICT_UI = {
  corect: { icon: '✔', color: '#1e7e34' },
  partial: { icon: '◐', color: '#e65100' },
  gresit: { icon: '✖', color: '#c62828' },
  necompletat: { icon: '—', color: '#8a94a3' },
};
function CorrectionBlock({ r }) {
  const [openId, setOpenId] = useState(null);
  if (!r || !Array.isArray(r.items)) return null;
  const pctCol = r.pct >= 80 ? '#1e7e34' : r.pct >= 50 ? '#e65100' : '#c62828';
  return (
    <div style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ background: 'rgba(232,185,49,.14)', padding: '8px 11px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '.82rem', color: 'var(--navy)' }}>📋 Punctajul tău</strong>
        <span style={{ fontSize: '.85rem' }}>
          <strong style={{ color: pctCol }}>{r.score}/{r.maxScore}p ({r.pct}%)</strong>
          {r.nota != null && (
            <span title={r.oficiu ? 'Nota include cele 10 puncte din oficiu' : 'Nota echivalentă'}
              style={{ marginLeft: 8, fontWeight: 800, color: '#8a6d00', background: 'rgba(232,185,49,.25)', borderRadius: 12, padding: '1px 9px', fontSize: '.78rem' }}>
              nota {r.nota}
            </span>
          )}
        </span>
      </div>
      <div>
        {r.items.map((g) => {
          const v = VERDICT_UI[g.verdict] || VERDICT_UI.gresit;
          const open = openId === g.id;
          return (
            <div key={g.id} style={{ borderTop: '1px solid var(--border)' }}>
              <button onClick={() => setOpenId(open ? null : g.id)}
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: open ? '#fbfcfe' : 'transparent', border: 'none', padding: '6px 11px', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: '.78rem', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                  <span style={{ color: v.color, fontWeight: 800 }}>{v.icon}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.eticheta}</span>
                </span>
                <span style={{ fontSize: '.78rem', fontWeight: 800, color: v.color, whiteSpace: 'nowrap' }}>
                  {g.puncte}/{g.maxPuncte}p {g.explicatie ? (open ? '▴' : '▾') : ''}
                </span>
              </button>
              {open && g.explicatie && (
                <div style={{ padding: '0 11px 8px 29px', fontSize: '.78rem', color: 'var(--text-light)' }}>
                  <MathText text={g.explicatie} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {(r.necompletate || []).length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '6px 11px', fontSize: '.74rem', color: '#8a6d1a', background: '#fffdf5' }}>
          Nu ai completat: {r.necompletate.join(', ')}.
        </div>
      )}
      {r.saved?.kind === 'nesalvat' && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '6px 11px', fontSize: '.72rem', color: '#c62828' }}>
          ⚠ Punctajul nu s-a putut salva în cont ({r.saved.error || 'eroare'}).
        </div>
      )}
    </div>
  );
}

// Mesajele automate deja trimise (id-urile lor) — la nivel de MODUL, nu de
// componentă: widgetul plutitor remontează ChatPanel la fiecare deschidere,
// iar un ref din componentă „uita" că mesajul a fost trimis și îl retrimitea
// într-o conversație nouă („Nu înțeleg acest exercițiu…" de două ori).
const consumedAutoPrompts = new Set();

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

  // ── Oprește / Regenerează / Reîncearcă ────────────────────────────────────
  // abortRef: cererea de streaming în curs (butonul „Oprește" o întrerupe);
  // lastSentRef: ultimul mesaj trimis — pentru „Regenerează" și „Reîncearcă";
  // uidRef + messagesRef: fiecare mesaj primește un id local (uid), iar
  // fragmentele streamului se scriu ÎN mesajul lui, nu „în ultimul mesaj" —
  // altfel un mesaj coach sau o corectare sosite în timpul streamului primeau
  // textul răspunsului, iar bula reală rămânea blocată pe „streaming".
  const abortRef = useRef(null);
  const lastSentRef = useRef(null);
  const uidRef = useRef(0);
  const messagesRef = useRef([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

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

  // la închiderea panoului, vocea tace și cererea de streaming în curs se
  // întrerupe (răspunsul complet rămâne salvat pe server — apare în Istoric)
  useEffect(() => () => {
    try { playerRef.current?.stop?.(); } catch { /* ignore */ }
    stopSpeaking();
    try { abortRef.current?.abort(); } catch { /* ignore */ }
  }, []);
  const [upsell, setUpsell] = useState(false);
  const dictationRef = useRef(null);
  const recorderRef = useRef(null);

  // ── „ALEGE UN TEST PDF DIN SITE" (chatul de meditații): elevul alege un
  //    test din baza de date → se deschide în vizualizator cu ACEEAȘI
  //    conversație alături, unde „Răspunde în chat" îl corectează după barem.
  const [pdfPick, setPdfPick] = useState(null);      // null | { loading, rows, error }
  const [pdfPickFilter, setPdfPickFilter] = useState('');

  // ── FORMULARUL DE RĂSPUNS („Răspunde în chat" → „Corectează") ─────────────
  // Sursa: testul PDF deschis (cu baremul lui, dacă există) SAU poza / PDF-ul
  // încărcat de elev în chat. Formularul NU pornește automat.
  const [form, setForm] = useState(null);            // { items, hasBarem, total, oficiu, title, src }
  const [formAnswers, setFormAnswers] = useState({});
  const [formImages, setFormImages] = useState([]);  // poze cu rezolvarea scrisă de mână (data URL), max 3 — Etapa 2
  const formImgRef = useRef(null);
  const [formLoading, setFormLoading] = useState(false);
  const [grading, setGrading] = useState(false);
  const formStartRef = useRef(null);

  // textul testului „citibil" din PDF-ul deschis (nu mesajul de avertizare)
  const pdfTextOk = !!(context.pdf && context.pdfReadable !== false && (context.exerciseText || '').trim().length > 80);
  const attachedOk = !!(attached && attached.trim().length > 15);
  const canAnswer = attachedOk || pdfTextOk;
  const answerHasBarem = pdfTextOk && !!context.baremText;

  // Sursa corectării: testul PDF deschis (cu baremul lui oficial) are
  // prioritate; poza / PDF-ul încărcat de elev se folosește în rest
  // (acolo fără barem — completează doar răspunsuri).
  function answerSource() {
    if (pdfTextOk) {
      return {
        testText: context.exerciseText || '', baremText: context.baremText || '',
        title: context.title || 'Testul deschis', contentId: context.contentId || null, category: context.category || null,
      };
    }
    return { testText: attached, baremText: '', title: 'Exercițiul din poza/PDF-ul tău', contentId: null, category: context.category || null };
  }

  async function openAnswerForm() {
    if (formLoading || form) return;
    setFormLoading(true); setError(null);
    try {
      const src = answerSource();
      // testul din platformă: serverul recitește textul + baremul după contentId
      const r = await aiClient.correctForm({ testText: src.testText, baremText: src.baremText, title: src.title, category: src.category, contentId: src.contentId });
      setForm({ ...r, src });
      setFormAnswers({}); setFormImages([]);
      formStartRef.current = Date.now();
    } catch (e) {
      setError(e.message);
      if (e.premium) setUpsell(true);
    } finally { setFormLoading(false); }
  }

  async function submitCorrection() {
    if (!form || grading) return;
    const answered = Object.values(formAnswers).filter((v) => String(v || '').trim()).length;
    if (!answered && !formImages.length) { setError('Completează măcar un răspuns (sau adaugă o poză cu rezolvarea) înainte de „Corectează".'); return; }
    setGrading(true); setError(null);
    try {
      const durationSec = Math.round((Date.now() - (formStartRef.current || Date.now())) / 1000);
      const r = await aiClient.correctGrade({
        conversationId: convId,
        context: { pdf: !!context.pdf, contentId: form.src.contentId, category: form.src.category, title: form.src.title, meditatii: !!context.meditatii },
        // testText contează doar la poza/PDF-ul propriu; la testele din
        // platformă serverul îl recitește după contentId (baremul la fel)
        testText: form.src.contentId ? '' : form.src.testText, title: form.title || form.src.title,
        items: form.items, answers: formAnswers, durationSec,
        meditatii: !!context.meditatii,
        token: form.token || null, // formularul semnat de server
        images: formImages,        // rezolvarea scrisă de mână (poze) — modelul o citește (Etapa 2)
      });
      if (r.conversationId) setConvId(r.conversationId);
      // corectarea apare în chat: mesajul elevului + verdictul profesorului
      const extra = [];
      if (context.meditatii) {
        // rezultatul alimentează meditatorul: remediere / plan / recomandări din site
        const sug = [];
        if ((r.mistakeIds || []).length) sug.push({ kind: 'remediere', mistakeId: r.mistakeIds[0], label: '🔁 Încă 10 exerciții ca acelea greșite' });
        sug.push({ kind: 'chat', text: 'Fă-mi un plan de învățare pornind de la rezultatul corectării de mai sus.', label: '🗺️ Fă-mi plan de învățare după acest rezultat' });
        sug.push({ kind: 'chat', text: 'Recomandă-mi exerciții de pe site pentru cerințele la care am greșit la corectarea de mai sus.', label: '🧩 Recomandă-mi exerciții de pe site' });
        extra.push({
          role: 'assistant', coach: true, suggestions: sug,
          content: 'Cum mergem mai departe cu ce am văzut la corectare?',
        });
      }
      setMessages((m) => [
        ...m,
        { role: 'user', content: `📝 Am completat răspunsurile la „${r.saved?.kind === 'upload' ? form.title || 'exercițiul meu' : form.src.title}" — corectează-le.` },
        { role: 'assistant', content: r.feedback || 'Am corectat lucrarea ta — vezi punctajul mai jos.', id: r.messageId || undefined, correction: r },
        ...extra,
      ]);
      setForm(null); setFormAnswers({}); setFormImages([]);
      formStartRef.current = Date.now(); // pregătește o eventuală reîncercare
      // insigne, ca la testele interactive (doar când punctajul s-a salvat)
      if (user && r.saved && r.saved.kind !== 'nesalvat') {
        awardBadges(user.id, { score: r.score, maxScore: r.maxScore, attempts: r.attempts || 1, category: form.src.category })
          .catch(() => {});
      }
    } catch (e) {
      setError(e.message);
      if (e.premium) setUpsell(true);
    } finally { setGrading(false); }
  }

  // Poze cu rezolvarea scrisă de mână, atașate formularului (max 3, comprimate)
  async function onPickFormImages(e) {
    const files = Array.from(e.target.files || []).slice(0, 3 - formImages.length);
    e.target.value = '';
    if (!files.length) return;
    setError(null);
    try {
      const urls = [];
      for (const f of files) urls.push(await fileToCompressedDataUrl(f, { maxDim: 1600, quality: 0.78 }));
      setFormImages((imgs) => [...imgs, ...urls].slice(0, 3));
    } catch (err) { setError('Nu am putut citi poza: ' + err.message); }
  }

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

  // modifică EXACT mesajul cu uid-ul dat (nu „ultimul" — vezi abortRef mai sus)
  const patchMsg = useCallback((uid, patch) => {
    setMessages((msgs) => {
      const i = msgs.findIndex((m) => m.uid === uid);
      if (i === -1) return msgs;
      const copy = [...msgs];
      copy[i] = typeof patch === 'function' ? patch(copy[i]) : { ...copy[i], ...patch };
      return copy;
    });
  }, []);

  // ultimul mesaj „coach" (trimis automat de platformă) — intră în contextul
  // conversației, ca modelul să continue natural când elevul răspunde „da"/„hai"
  const coachNoteRef = useRef(null);

  // curățarea textului final: acțiuni scoase, „.ro" → „.com", terminologie
  function cleanReply(raw) {
    const { text: cleanText0, actions } = extractTutorActions(raw);
    const medActions = extractMeditatiiActions(raw);
    const text = fixTerminology(preMessage(cleanText0).replace(/https?:\/\/(?:www\.)?examenmate\.ro/gi, 'https://examenmate.com'));
    return { text, actions, medActions };
  }

  // send(text, { modeOverride, regenerate })
  //  regenerate=true → „Regenerează": NU adaugă din nou bula elevului, scoate
  //  răspunsul anterior și cere altul (serverul nu re-salvează întrebarea).
  async function send(text, { modeOverride = null, regenerate = false } = {}) {
    const msg = (text ?? input).trim();
    if (!msg || streaming) return;
    const userUid = ++uidRef.current; // id-urile locale ale celor două bule
    const uid = ++uidRef.current;     // (întrebare, răspuns)
    lastSentRef.current = { text: msg, modeOverride };
    setError(null); setInput(''); setShowHistory(false);
    setMessages((m) => {
      const base = [...m];
      if (regenerate) {
        // scoatem răspunsul anterior (ultimul mesaj al profesorului, dacă nu e „coach")
        if (base.length && base[base.length - 1].role === 'assistant' && !base[base.length - 1].coach) base.pop();
      } else {
        base.push({ role: 'user', content: msg, uid: userUid });
      }
      base.push({ role: 'assistant', content: '', streaming: true, uid });
      return base;
    });
    setStreaming(true);
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortRef.current = controller;
    let acc = '';
    try {
      const baseCtx = attached ? { ...context, exerciseText: attached } : context;
      const sendCtx = coachNoteRef.current ? { ...baseCtx, coachNote: coachNoteRef.current } : baseCtx;
      await aiClient.chatStream(
        { message: msg, mode: modeOverride || mode, conversationId: convId, context: sendCtx, regenerate },
        {
          signal: controller ? controller.signal : null,
          onMeta: ({ conversationId, sources, primaryMaterial }) => { setConvId(conversationId); patchMsg(uid, { sources, primaryMaterial }); },
          onDelta: (delta) => { acc += delta; patchMsg(uid, (m) => ({ ...m, content: m.content + delta })); },
          onDone: ({ messageId }) => {
            // extrage acțiunile [[ACTIUNE:...]] / [[MEDITATII:...]] și curăță textul afișat
            const { text: cleanText, actions, medActions } = cleanReply(acc);
            patchMsg(uid, { streaming: false, id: messageId, content: cleanText });
            if (onAction && actions.length) actions.slice(0, 2).forEach((a) => { try { onAction(a); } catch { /* noop */ } });
            if (medActions.length) setTimeout(() => dispatchMeditatiiAction(medActions[0], navigate, onNavigate), 600);
            if (autoRead && cleanText.trim()) {
              // indexul REAL al bulei (pot fi mesaje coach/corectări inserate între timp)
              const idx = messagesRef.current.findIndex((mm) => mm.uid === uid);
              if (idx >= 0) startListen(idx, cleanText); // cu bară + evidențiere
            }
          },
        }
      );
    } catch (e) {
      const aborted = (e && e.name === 'AbortError') || (controller && controller.signal.aborted);
      if (aborted) {
        // „Oprește": păstrăm ce a apucat să scrie; nu e eroare
        const { text: partial } = cleanReply(acc);
        patchMsg(uid, { streaming: false, stopped: true, content: partial.trim() ? partial : '⏹ Răspuns oprit.' });
      } else if (e.premium) {
        setUpsell(true);
        patchMsg(uid, { content: e.message, isError: true, streaming: false, retryable: false });
      } else {
        // eroarea se vede ÎN bulă (cu „Reîncearcă") — nu o dublăm în banda de erori
        patchMsg(uid, { content: '⚠️ ' + (e.message || 'Eroare la generarea răspunsului.'), isError: true, streaming: false, retryable: true });
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setStreaming(false);
    }
  }

  // „Oprește" — întrerupe răspunsul în curs (textul scris până atunci rămâne)
  function stopGenerating() {
    try { abortRef.current?.abort(); } catch { /* noop */ }
  }

  // „Regenerează" — alt răspuns la ultima întrebare (răspunsul vechi dispare din chat)
  function regenerateLast() {
    const last = lastSentRef.current;
    if (!last || streaming) return;
    send(last.text, { modeOverride: last.modeOverride, regenerate: true });
  }

  // „Reîncearcă" — după o eroare: scoatem bula de eroare + întrebarea și retrimitem
  function retryLast() {
    const last = lastSentRef.current;
    if (!last || streaming) return;
    setMessages((m) => {
      const copy = [...m];
      if (copy.length && copy[copy.length - 1].isError) copy.pop();
      if (copy.length && copy[copy.length - 1].role === 'user') copy.pop();
      return copy;
    });
    // trimitem după ce starea s-a curățat (send adaugă din nou întrebarea)
    setTimeout(() => send(last.text, { modeOverride: last.modeOverride }), 0);
  }

  function newConversation() {
    stopGenerating(); // o cerere în curs nu mai scrie în conversația nouă
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

  // Mesaj trimis automat (butonul „Întreabă profesorul virtual" din exercițiu).
  // Depinde și de `streaming`: dacă sosește în timpul unui răspuns, îl trimitem
  // imediat ce răspunsul se termină (înainte se pierdea). Id-urile consumate
  // sunt la nivel de modul — remontarea widgetului nu retrimite același mesaj.
  useEffect(() => {
    if (!autoPrompt || !autoPrompt.text || !autoPrompt.id || consumedAutoPrompts.has(autoPrompt.id)) return;
    if (streaming) return;
    consumedAutoPrompts.add(autoPrompt.id);
    send(autoPrompt.text, { modeOverride: autoPrompt.mode || null });
  }, [autoPrompt, streaming]); // eslint-disable-line

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
    stopGenerating(); // un stream în curs nu mai scrie peste conversația încărcată
    stopPlayback();
    const msgs = await aiClient.getMessages(id);
    setMessages(msgs.map((m) => ({ role: m.role, content: m.content, id: m.id, sources: m.metadata?.sources, primaryMaterial: m.metadata?.primaryMaterial, uid: ++uidRef.current })));
    setConvId(id);
    lastSentRef.current = null; // „Regenerează" pornește doar după un mesaj trimis de aici
  }

  // Lista testelor PDF din baza de date — STRICT pe NIVELUL elevului, luat
  // din profilul lui de meditații (EN / BAC cu profilul lui / clasa lui), nu
  // toate nivelurile. Contextul e doar rezervă, dacă profilul nu poate fi citit.
  async function togglePdfPicker() {
    if (pdfPick) { setPdfPick(null); setPdfPickFilter(''); return; }
    setPdfPick({ loading: true, rows: [] });
    try {
      let cat = null, prof = null, label = '';
      try {
        const stt = await aiClient.meditatii({ action: 'state' });
        const p = stt?.profile;
        if (p?.examTarget === 'evaluare-nationala') { cat = 'evaluare-nationala'; label = 'Evaluarea Națională'; }
        else if (p?.examTarget === 'bac-mate-info') { cat = 'bacalaureat'; prof = 'mate-info'; label = 'BAC Mate-Info'; }
        else if (p?.examTarget === 'bac-stiinte') { cat = 'bacalaureat'; prof = 'stiinte-naturii'; label = 'BAC Științele Naturii'; }
        else if (p?.examTarget === 'bac-tehnologic') { cat = 'bacalaureat'; prof = 'tehnologic'; label = 'BAC Tehnologic'; }
        else if (p?.grade) { cat = `clasa-${p.grade}`; label = `clasa a ${p.grade}-a`; }
      } catch { /* profilul nu a putut fi citit — cădem pe contextul paginii */ }
      if (!cat && context.category) {
        cat = context.category;
        label = cat === 'evaluare-nationala' ? 'Evaluarea Națională' : cat === 'bacalaureat' ? 'Bacalaureat'
          : cat.startsWith('clasa-') ? `clasa a ${cat.replace('clasa-', '')}-a` : cat;
      }
      if (!cat) throw new Error('Nu îți cunosc încă nivelul — alege întâi clasa și examenul în rubrica Meditații.');
      let q = supabase.from('content')
        .select('id, title, subcategory, profile, is_free, category')
        .eq('content_type', 'pdf').eq('category', cat)
        .order('sort_order', { ascending: true }).order('created_at', { ascending: false })
        .limit(400);
      if (prof) q = q.eq('profile', prof);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      // baremele nu se dau ca „test de rezolvat" — le aduce viewerul, lângă test
      const rows = (data || []).filter((r) => (r.subcategory || '') !== 'bareme');
      setPdfPick({ loading: false, rows, label, error: rows.length ? null : `Nu am găsit încă teste PDF pentru ${label || 'nivelul tău'}.` });
    } catch (e) { setPdfPick({ loading: false, rows: [], error: e.message }); }
  }
  function openPickedPdf(id) {
    setPdfPick(null); setPdfPickFilter('');
    openInternal(`/pdf-viewer?id=${id}`); // păstrează conversația (openTutor + tutorConvId)
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
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
        // PDF încărcat de elev (temă, fișă, variantă) → textul lui devine
        // exercițiul atașat: se poate discuta ȘI corecta („Răspunde în chat")
        if (file.size > 3.5 * 1024 * 1024) throw new Error('PDF-ul e prea mare (max ~3.5 MB). Fotografiază exercițiul în loc.');
        const fileBase64 = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result));
          fr.onerror = () => reject(new Error('Fișierul nu a putut fi citit.'));
          fr.readAsDataURL(file);
        });
        const { text } = await aiClient.correctPdfText({ fileBase64 });
        setAttached(text || '');
        setEditingAttach(false); // textul e de obicei lung — îl arătăm doar, se poate edita din buton
      } else {
        const dataUrl = await fileToCompressedDataUrl(file, { maxDim: 1280, quality: 0.7 });
        const { problemText } = await aiClient.visionExtract({ imageBase64: dataUrl });
        setAttached(problemText || '');
        setEditingAttach(true); // arătăm textul ca să-l poată corecta dacă e nevoie
      }
    } catch (err) {
      setError('Nu am putut citi fișierul: ' + err.message);
      if (err.premium) setUpsell(true);
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

      {/* „Alege un test PDF din site" NU mai are bandă separată aici: butonul
          stă în LISTA de butoane a meditatorului (mesajul de întâmpinare,
          ultimul — după „🧩 Test din site"), cu kind 'pdf_site'; el deschide
          lista de teste PDF (filtrată pe nivelul elevului) chiar în chat. */}

      {/* „Răspunde în chat" (doar pentru elevi, când există un test PDF deschis
          sau o poză / un PDF încărcat): deschide formularul de răspunsuri.
          NU pornește automat — doar la apăsarea butonului. */}
      {!isMentor && canAnswer && !form && (
        <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', alignItems: 'center', flexWrap: 'wrap', background: '#fffdf5' }}>
          <button onClick={openAnswerForm} disabled={formLoading || streaming}
            style={{
              background: 'var(--gold)', color: 'var(--navy)', border: 'none', borderRadius: 20,
              padding: '7px 15px', fontSize: '.84rem', fontWeight: 800, cursor: formLoading ? 'default' : 'pointer',
              opacity: formLoading ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
            {formLoading ? '⏳ Pregătesc formularul…' : '📝 Răspunde în chat'}
          </button>
          <span style={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>
            {answerHasBarem ? 'Completezi răspunsurile, eu le corectez după barem, pe fiecare subpunct.' : 'Completezi răspunsurile, eu le corectez și îți dau punctajul.'}
          </span>
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

      {/* Lista testelor PDF din site (overlay) — „Alege un test PDF din site" */}
      {pdfPick && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: '#fff', zIndex: 6, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
            <strong style={{ color: 'var(--navy)', fontSize: '.9rem' }}>
              📄 Teste PDF din site{pdfPick.label ? ` · ${pdfPick.label}` : ''}
            </strong>
            <button onClick={() => { setPdfPick(null); setPdfPickFilter(''); }} style={miniBtn}>✕ Închide</button>
          </div>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
            <input value={pdfPickFilter} onChange={(e) => setPdfPickFilter(e.target.value)} placeholder="Caută după titlu…"
              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 16, fontFamily: 'var(--font-body)', boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', padding: 12 }}>
            {pdfPick.loading && <p style={{ color: 'var(--text-muted)', fontSize: '.85rem' }}>Caut testele PDF din baza de date…</p>}
            {pdfPick.error && <p style={{ color: '#8a6d1a', fontSize: '.85rem' }}>{pdfPick.error}</p>}
            {!pdfPick.loading && (pdfPick.rows || [])
              .filter((r) => !pdfPickFilter.trim() || (r.title || '').toLowerCase().includes(pdfPickFilter.trim().toLowerCase()))
              .map((r) => (
                <button key={r.id} onClick={() => openPickedPdf(r.id)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: '1px solid var(--border)', background: '#f7f9fc', borderRadius: 8, padding: '9px 11px', marginBottom: 6, fontSize: '.85rem', color: 'var(--navy)', fontWeight: 600, cursor: 'pointer' }}>
                  <span style={{ flex: 1 }}>📄 {r.title}</span>
                  <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {r.subcategory && PDF_SUBCAT_RO[r.subcategory] && (
                      <span style={pickTag('rgba(15,43,68,.08)', 'var(--navy)')}>{PDF_SUBCAT_RO[r.subcategory]}</span>
                    )}
                    {r.profile && PDF_PROFILE_RO[r.profile] && (
                      <span style={pickTag('rgba(232,185,49,.18)', '#8a6d1a')}>{PDF_PROFILE_RO[r.profile]}</span>
                    )}
                    <span style={pickTag(r.is_free ? '#e8f5e9' : '#fff3e0', r.is_free ? '#2e7d32' : '#e65100')}>{r.is_free ? 'Gratuit' : 'Premium'}</span>
                  </span>
                </button>
              ))}
          </div>
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

              {/* Rezultatul corectării: punctaj total + punctaj pe fiecare subpunct */}
              {m.correction && <CorrectionBlock r={m.correction} />}

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
                    <button key={k}
                      onClick={() => (s.kind === 'chat' ? send(s.text)
                        : s.kind === 'pdf_site' ? togglePdfPicker() // lista testelor PDF, chiar în chat
                        : dispatchMeditatiiAction(s, navigate, onNavigate))}
                      style={{ textAlign: 'left', border: '1px solid var(--gold)', background: 'rgba(232,185,49,.12)', borderRadius: 8, padding: '8px 10px', fontSize: '.85rem', color: 'var(--navy)', fontWeight: 600, cursor: 'pointer' }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Eroare la generare: „Reîncearcă" retrimite aceeași întrebare */}
            {m.role === 'assistant' && m.isError && m.retryable && i === messages.length - 1 && lastSentRef.current && (
              <div style={{ display: 'flex', gap: 6, marginTop: 4, paddingLeft: 4 }}>
                <button onClick={retryLast} disabled={streaming} style={listenBtn} title="Trimite din nou ultima întrebare">↻ Reîncearcă</button>
              </div>
            )}

            {/* Acțiuni: „Ascultă răspunsul" (play/pauză) + feedback + „Regenerează" */}
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
                {/* „Regenerează": doar pe ULTIMUL răspuns la un mesaj trimis din acest panou
                    (și pe răspunsurile oprite cu „Oprește") */}
                {!m.coach && !m.correction && i === messages.length - 1 && lastSentRef.current && (
                  <button onClick={regenerateLast} disabled={streaming} title="Cere alt răspuns la aceeași întrebare"
                    style={{ ...miniBtn, cursor: 'pointer' }}>
                    ↻ Regenerează
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* FORMULARUL DE RĂSPUNS: câte un câmp pentru fiecare exercițiu și
          subpunct a), b), c) — cu punctele din barem. Butonul „Corectează"
          trimite testul + baremul + răspunsurile la corectare. */}
      {form && (
        <div style={{ borderTop: '2px solid var(--gold)', background: '#fffdf5', display: 'flex', flexDirection: 'column', maxHeight: '58%', minHeight: 160 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ minWidth: 0 }}>
              <strong style={{ fontSize: '.82rem', color: 'var(--navy)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                📝 Răspunsurile tale · {form.title || form.src.title}
              </strong>
              <span style={{ fontSize: '.7rem', color: form.hasBarem ? '#1e7e34' : 'var(--text-muted)', fontWeight: 600 }}>
                {form.hasBarem ? `📋 punctat după barem — ${form.total}p${form.oficiu ? ` + ${form.oficiu}p din oficiu` : ''}` : 'fără barem — completezi doar răspunsurile'}
              </span>
            </div>
            <button onClick={() => { setForm(null); setFormAnswers({}); }} style={miniBtn}>✕ Renunț</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '10px 12px' }}>
            <p style={{ fontSize: '.74rem', color: 'var(--text-muted)', margin: '0 0 10px' }}>
              Scrie răspunsul tău (sau pașii rezolvării) la fiecare cerință. Lasă gol ce nu ai rezolvat — îți spun eu ce lipsește.
            </p>
            {form.items.map((it) => (
              <div key={it.id} style={{ marginBottom: 12, background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 11px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <strong style={{ fontSize: '.8rem', color: 'var(--navy)' }}>{it.eticheta}</strong>
                  {!it.subpuncte?.length && it.puncte != null && (
                    <span style={{ fontSize: '.7rem', fontWeight: 700, color: '#8a6d00', whiteSpace: 'nowrap' }}>{it.puncte}p</span>
                  )}
                </div>
                {it.cerinta && (
                  <div style={{ fontSize: '.78rem', color: 'var(--text-light)', margin: '3px 0 6px' }}>
                    <MathText text={it.cerinta} />
                  </div>
                )}
                {it.subpuncte?.length ? (
                  it.subpuncte.map((s) => (
                    <div key={s.id} style={{ margin: '7px 0 0 6px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--navy)' }}>{s.eticheta}</span>
                        {s.puncte != null && <span style={{ fontSize: '.7rem', fontWeight: 700, color: '#8a6d00', whiteSpace: 'nowrap' }}>{s.puncte}p</span>}
                      </div>
                      {s.cerinta && (
                        <div style={{ fontSize: '.76rem', color: 'var(--text-light)', margin: '2px 0 4px' }}>
                          <MathText text={s.cerinta} />
                        </div>
                      )}
                      <textarea
                        value={formAnswers[s.id] || ''}
                        onChange={(e) => setFormAnswers((a) => ({ ...a, [s.id]: e.target.value }))}
                        rows={2} placeholder="Răspunsul / rezolvarea ta…"
                        style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px', fontSize: 16, fontFamily: 'var(--font-body)', resize: 'vertical', background: '#fbfcfe' }}
                      />
                    </div>
                  ))
                ) : (
                  <textarea
                    value={formAnswers[it.id] || ''}
                    onChange={(e) => setFormAnswers((a) => ({ ...a, [it.id]: e.target.value }))}
                    rows={2} placeholder="Răspunsul / rezolvarea ta…"
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px', fontSize: 16, fontFamily: 'var(--font-body)', resize: 'vertical', background: '#fbfcfe' }}
                  />
                )}
              </div>
            ))}
          </div>
          {/* Pozele cu rezolvarea scrisă de mână (Etapa 2): modelul le citește și punctează pașii din ele */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 12px', borderTop: '1px dashed var(--border)', flexShrink: 0, background: '#fffdf5' }}>
            <input ref={formImgRef} type="file" accept="image/*" multiple onChange={onPickFormImages} style={{ display: 'none' }} />
            <button onClick={() => formImgRef.current?.click()} disabled={grading || formImages.length >= 3} style={miniBtn} title="Fotografiază rezolvarea de pe caiet — profesorul o citește și o punctează">
              📷 Poze cu rezolvarea {formImages.length ? `(${formImages.length}/3)` : ''}
            </button>
            {formImages.map((u, k) => (
              <span key={k} style={{ position: 'relative', display: 'inline-block' }}>
                <img src={u} alt={`rezolvare ${k + 1}`} style={{ height: 44, width: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                <button onClick={() => setFormImages((imgs) => imgs.filter((_, j) => j !== k))} aria-label="Șterge poza"
                  style={{ position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#b71c1c', color: '#fff', fontSize: 11, lineHeight: '18px', padding: 0, cursor: 'pointer' }}>✕</button>
              </span>
            ))}
            {!formImages.length && <span style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>opțional — pașii scriși pe caiet se punctează și ei</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 12px', borderTop: '1px solid var(--border)', flexShrink: 0, background: '#fff' }}>
            <button onClick={submitCorrection} disabled={grading}
              style={{
                background: 'var(--gold)', color: 'var(--navy)', border: 'none', borderRadius: 10,
                padding: '9px 18px', fontSize: '.88rem', fontWeight: 800, cursor: grading ? 'default' : 'pointer', opacity: grading ? 0.6 : 1,
              }}>
              {grading ? '⏳ Corectez…' : '✅ Corectează'}
            </button>
            <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>
              {Object.values(formAnswers).filter((v) => String(v || '').trim()).length} răspunsuri completate
              {grading ? ' · acord punctajul pe fiecare subpunct…' : ''}
            </span>
          </div>
        </div>
      )}

      {/* Exercițiu atașat din fotografie */}
      {attached !== null && !form && (
        <div style={{ borderTop: '1px solid var(--border)', background: '#fffdf5', padding: '10px 12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: '.78rem', color: 'var(--navy)' }}>📎 Exercițiul tău (poză / PDF)</strong>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setEditingAttach((s) => !s)} style={miniBtn}>{editingAttach ? '✓ Gata' : '✎ Editează'}</button>
              <button onClick={() => { setAttached(null); setEditingAttach(false); }} style={miniBtn}>✕ Șterge</button>
            </div>
          </div>
          {editingAttach
            ? <textarea value={attached} onChange={(e) => setAttached(e.target.value)} rows={3}
                placeholder="Verifică textul citit și corectează dacă e nevoie..."
                style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 16, fontFamily: 'var(--font-body)', resize: 'vertical' }} />
            : <div style={{ fontSize: '.85rem', color: 'var(--text)', maxHeight: 120, overflowY: 'auto' }}>
                <MathText text={attached.length > 900 ? attached.slice(0, 900) + '…' : attached} />
              </div>}
          {!editingAttach && attached.trim() && (
            <button onClick={() => send('Ajută-mă cu acest exercițiu.')} disabled={streaming}
              style={{ marginTop: 8, background: 'var(--gold)', color: 'var(--navy)', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: '.82rem', fontWeight: 700, opacity: streaming ? 0.5 : 1 }}>
              {askAiLabel({ isTeacher, isParent })} despre el →
            </button>
          )}
        </div>
      )}

      {/* Erori din afara conversației (poză/PDF necitit, microfon, formular):
          până acum erau setate dar NU afișate nicăieri — elevul nu afla de ce
          nu s-a întâmplat nimic. Se închid cu ✕ sau la următoarea acțiune. */}
      {error && (
        <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px', borderTop: '1px solid #f5c6c2', background: '#fdecea', color: '#b71c1c', fontSize: '.8rem', lineHeight: 1.4, flexShrink: 0 }}>
          <span style={{ flex: 1 }}>⚠️ {error}</span>
          <button onClick={() => setError(null)} aria-label="Închide eroarea" style={{ ...miniBtn, color: '#b71c1c', borderColor: '#f5c6c2', padding: '2px 8px' }}>✕</button>
        </div>
      )}

      {/* Input — rămâne mereu vizibil, chiar și pe panouri mici */}
      <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)', background: '#fff', flexShrink: 0 }}>
        <input ref={fileRef} type="file" accept="image/*,application/pdf" onChange={onPickPhoto} style={{ display: 'none' }} />
        <button onClick={() => fileRef.current?.click()} disabled={visionLoading} title="Fotografiază un exercițiu sau încarcă un PDF"
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
        {streaming ? (
          // în timpul răspunsului, săgeata devine „Oprește" (întrerupe streamul,
          // textul scris până atunci rămâne în chat)
          <button onClick={stopGenerating} title="Oprește răspunsul" aria-label="Oprește răspunsul"
            style={{
              background: '#fff', color: '#b71c1c', border: '1px solid #f5c6c2', borderRadius: 10,
              padding: '0 14px', fontWeight: 800, fontSize: '.85rem', cursor: 'pointer', whiteSpace: 'nowrap',
            }}>
            ■ Oprește
          </button>
        ) : (
          <button onClick={() => send()} disabled={!input.trim()} title="Trimite" aria-label="Trimite întrebarea"
            style={{
              background: 'var(--gold)', color: 'var(--navy)', border: 'none', borderRadius: 10,
              padding: '0 16px', fontWeight: 700, fontSize: '1.1rem',
              opacity: !input.trim() ? 0.5 : 1, cursor: 'pointer',
            }}>
            ➤
          </button>
        )}
      </div>
      {/* Modelele AI + „AI-ul poate greși" — o linie minusculă sub câmpul de scris
          (textele vin din src/lib/aiModels.js → AI_STACK) */}
      <AIPoweredBy variant="disclaimer" />
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

      {/* Butonul plutitor (draggable + strălucire) — ASCUNS cât timp panoul
          andocat al Meditatorului e deschis: rondela „✕" se suprapunea peste
          săgeata de trimitere a chatului (panoul are propriul ✕ în antet). */}
      {!(open && medMode) && (
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
      )}

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
