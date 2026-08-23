// =====================================================================
// src/pages/Meditatii.jsx — „Meditații cu Profesorul Virtual"
// Meditații reale cu un profesor AI cu memorie pedagogică:
//   înscriere (clasă + examen) → test inițial adaptiv → plan personalizat
//   → teorie → exerciții → analiza greșelilor → remediere („încă 10 la fel")
//   → teme → repetiție inteligentă (1 zi / 7 / 30) → simulări → predicție.
// Materialele din site au prioritate; generarea intervine în completare.
// =====================================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { aiClient } from '../lib/aiClient';
import { supabase } from '../lib/supabase';
import { MathText, preMessage } from '../components/AITutor';
import EinsteinIcon from '../components/EinsteinIcon';
import ExamGenerator from '../components/ExamGenerator';
import { openPrintDocument } from '../lib/examPrint';
import { playAnswer, stopSpeaking, ttsSupported } from '../lib/voice';
import CapitolePicker from '../components/CapitolePicker';
import { capitoleForCategory } from '../lib/capitole';

// Chatul meditațiilor trăiește în widgetul plutitor „Prof. Virtual" (un singur
// buton, o singură conversație): pagina îi trimite contextul, mesajele automate
// („Nu înțeleg...") și mesajele COACH (bun venit, aprecieri, pasul următor) —
// widgetul se deschide singur ori de câte ori profesorul are ceva de spus.
function openMeditatorChat(context, autoPrompt = null, coach = null) {
  window.dispatchEvent(new CustomEvent('mate:meditatii-chat', { detail: { context, autoPrompt, coach } }));
}

// Plasă de siguranță pe client pentru LaTeX-ul corupt din seturile mai vechi
// (backslash dublu → „rând nou" + comanda ca text: „frac32", „sqrt13").
const LATEX_CMDS_RE = 'frac|sqrt|cdot|pi|alpha|beta|gamma|delta|theta|angle|triangle|overline|vec|times|div|leq?|geq?|neq?|pm|infty|sin|cos|tan|log|ln|lim|sum|int|in|text|mathbb|widehat|circ|perp|parallel|approx';
function fixLatexClient(s) {
  if (typeof s !== 'string' || !s) return s;
  let t = s.replace(new RegExp('\\\\{2,}(?=(?:' + LATEX_CMDS_RE + ')(?![a-zA-Z]))', 'g'), '\\');
  const cmdRe = new RegExp('(^|[^\\\\a-zA-Z])(' + LATEX_CMDS_RE + ')(?=[\\s{_^\\d(])', 'g');
  t = t.replace(/\$([^$]+)\$/g, (m, inner) => '$' + inner.replace(cmdRe, '$1\\$2') + '$');
  return t;
}

const card = { background: '#fff', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 18 };
const inp = { border: '1px solid var(--border)', borderRadius: 8, padding: '9px 11px', fontSize: '.9rem', fontFamily: 'var(--font-body)' };
const chip = (bg, color) => ({ display: 'inline-flex', alignItems: 'center', gap: 5, background: bg, color, borderRadius: 20, padding: '4px 12px', fontSize: '.78rem', fontWeight: 700 });

const ERROR_LABELS = {
  calcul: '🔢 Greșeală de calcul', formula: '📐 Formulă aplicată greșit',
  concept: '💭 Confuzie între concepte', regula: '📏 Regulă uitată',
  neatentie: '👀 Neatenție', necunoscut: '❓ De analizat',
};
const STATUS_LABELS = {
  de_parcurs: { label: 'De parcurs', bg: '#eef1f6', color: '#5a6675' },
  teorie: { label: 'Teoria citită', bg: 'rgba(232,185,49,.15)', color: '#8a6d1a' },
  in_lucru: { label: 'În lucru', bg: 'rgba(52,152,219,.12)', color: '#1f6dab' },
  finalizat: { label: '✓ Finalizat', bg: 'rgba(39,174,96,.12)', color: '#1e7e34' },
};
const EXAM_LABELS = {
  'evaluare-nationala': 'Evaluarea Națională',
  'bac-mate-info': 'BAC Mate-Info', 'bac-stiinte': 'BAC Științele Naturii', 'bac-tehnologic': 'BAC Tehnologic',
};
// Pregătirea pentru lucrare/test (focus) — tipurile de teste de la școală
const FOCUS_KIND_LABELS = {
  lucrare: '📝 Lucrare / test din capitole',
  lectii: '📒 Test din lecții',
  'test-initial': '🧭 Test inițial (materia anului trecut)',
};
const roDate = (iso) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('ro-RO', { day: 'numeric', month: 'long' }) : '');
const niceTopic = (t) => String(t || '').replace(/_/g, ' ').trim();
// Starea unei teme pentru UI: de rezolvat / FINALIZATĂ / finalizată INCOMPLET
// („🏁 Finalizează tema" fără toate problemele — status „incompleta" sau, pe
// instalările fără migrarea SQL, feedback.complete=false). O temă incompletă
// nu e „nefăcută": nu blochează alte teme și se poate relua oricând.
const hwState = (h) => (!h || h.status === 'data' ? 'pending'
  : (h.incomplete || h.status === 'incompleta' || h.feedback?.complete === false) ? 'incomplete' : 'complete');
const HW_STATE_RANK = { pending: 0, incomplete: 1, complete: 2 };
const fmtMin = (sec) => {
  const m = Math.round((sec || 0) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}min`;
};

// Completează id-urile lipsă ale unei acțiuni de meditație (venită din chat —
// marcaj [[MEDITATII:...]] sau buton coach) folosind starea curentă.
function resolveAction(a, st) {
  if (!a || !a.kind || !st) return null;
  const out = { ...a };
  if (out.kind === 'recapitulare' && !out.reviewId) {
    const r = st.dueReviews?.[0]; if (!r) return null;
    out.reviewId = r.id; out.chapterTitle = r.chapterTitle;
  }
  if (out.kind === 'tema' && !out.homeworkId) {
    const h = (st.homework || []).find((x) => x.status === 'data'); if (!h) return null;
    out.homeworkId = h.id;
  }
  if (out.kind === 'remediere' && !out.mistakeId) {
    const m = st.openMistakes?.[0]; if (!m) return null;
    out.mistakeId = m.id;
  }
  if (out.kind === 'exercitii' || out.kind === 'lectie') {
    const exists = out.chapterId && (st.plan?.chapters || []).some((c) => c.id === out.chapterId);
    if (!exists) out.chapterId = st.nextChapter?.id || null;
    if (!out.chapterId) return null;
  }
  return out;
}

// lecția (markdown simplu) → HTML pentru documentul tipăribil
function lessonHtml(title, text) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = esc(text)
    .replace(/^## (.+)$/gm, '<h2 style="font-size:17px;color:#0f2b44;border-bottom:1px solid #ddd;padding-bottom:4px;margin:20px 0 8px">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:15px;color:#0f2b44;margin:14px 0 6px">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^[-•] (.+)$/gm, '<div style="margin:3px 0 3px 18px">• $1</div>')
    .split(/\n{2,}/).map((p) => `<p style="margin:.5em 0;line-height:1.65">${p.replace(/\n/g, '<br/>')}</p>`).join('');
  return `<h1 class="exam-title">${esc(title)}</h1><div class="exam-sub">Lecție pregătită de Profesorul Virtual · ExamenMate</div><div class="rules">Meditații cu Profesorul Virtual</div>${body}`;
}

// ─── Rulează un set de întrebări (evaluare/exerciții/temă/recapitulare/simulare)
// homework=true (temă): la sfârșit stă butonul „🏁 Finalizează tema" — închide
// tema și FĂRĂ toate problemele rezolvate (se înregistrează ca temă completă
// sau INCOMPLETĂ); „✕ Las-o pe mai târziu" păstrează răspunsurile (ciornă), iar
// initialAnswers readuce răspunsurile salvate la RELUARE.
function QuizRunner({ title, subtitle, questions, submitLabel = '✓ Trimite spre corectare', onSubmit, onClose, onAskTeacher,
  homework = false, initialAnswers = null, onSaveDraft = null }) {
  const [answers, setAnswers] = useState(() => questions.map((_, i) => (initialAnswers && initialAnswers[i] != null ? initialAnswers[i] : null)));
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState(null);
  const startRef = useRef(Date.now());

  const answered = answers.filter((a) => a !== null && String(a).trim() !== '').length;
  const left = questions.length - answered;
  const allAnswered = left === 0;

  async function submit() {
    // tema se poate finaliza și neterminată (cerință) — dar confirmăm, ca
    // elevul să știe că se înregistrează ca INCOMPLETĂ și că o poate relua
    if (homework && !allAnswered) {
      const ok = window.confirm(
        `Mai ai ${left} ${left === 1 ? 'problemă nerezolvată' : 'probleme nerezolvate'}.\n\n` +
        `Finalizezi tema așa cum e? Se înregistrează ca TEMĂ INCOMPLETĂ (${answered}/${questions.length} rezolvate) — o poți relua oricând din rubrica Teme, iar o temă neterminată nu te împiedică să primești altele.`
      );
      if (!ok) return;
    }
    setLoading(true); setError(null);
    try {
      const durationSec = Math.round((Date.now() - startRef.current) / 1000);
      const r = await onSubmit(answers, durationSec);
      setResult(r);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  // „Las-o pe mai târziu": răspunsurile date rămân salvate (ciornă), tema
  // rămâne de rezolvat și se reia de unde a rămas
  async function closeForLater() {
    if (homework && onSaveDraft && answered > 0) {
      setSavingDraft(true);
      try { await onSaveDraft(answers); } catch { /* best-effort */ }
      finally { setSavingDraft(false); }
      onClose(false, true);
      return;
    }
    onClose(false, false);
  }

  return (
    <div>
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.05rem' }}>{title}</div>
          {subtitle && <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!result && <span style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>{answered}/{questions.length} completate</span>}
          {result
            ? <button className="btn btn-outline btn-sm" onClick={() => onClose(true)}>✕ Închide</button>
            : homework
              ? <button className="btn btn-outline btn-sm" onClick={closeForLater} disabled={loading || savingDraft} title="Închide fără corectare — răspunsurile date rămân salvate, tema rămâne de rezolvat și o reiei de unde ai rămas">{savingDraft ? '💾 Salvez…' : '✕ Las-o pe mai târziu'}</button>
              : <button className="btn btn-outline btn-sm" onClick={() => onClose(false)}>✕ Renunț</button>}
        </div>
      </div>

      {result && (
        <div style={{ ...card, background: result.pct >= 70 ? 'rgba(39,174,96,.08)' : 'rgba(232,185,49,.1)', borderColor: result.pct >= 70 ? 'rgba(39,174,96,.35)' : 'var(--gold)' }}>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--navy)', marginBottom: 6 }}>
            {result.pct >= 90 ? '🎉' : result.pct >= 70 ? '👏' : result.pct >= 50 ? '💪' : '🤝'} Rezultat: {result.score}/{result.maxScore} ({result.pct}%)
            {result.grade != null && <span> · Nota {result.grade}</span>}
          </div>
          {homework && result.complete != null && (
            <div style={{ marginBottom: 6 }}>
              {result.complete
                ? <span style={chip('rgba(39,174,96,.14)', '#1e7e34')}>🏁 Temă finalizată · toate problemele rezolvate</span>
                : <span style={chip('rgba(230,126,34,.14)', '#b9590f')}>◐ Temă incompletă · {result.answered}/{result.total} probleme rezolvate</span>}
            </div>
          )}
          {result.feedback && <div style={{ fontSize: '.92rem', color: 'var(--text)', marginBottom: 4 }}>{result.feedback}</div>}
          {result.nextStep && <div style={{ fontSize: '.88rem', color: 'var(--text)' }}>👉 {result.nextStep.label}</div>}
          {result.chapterDone && <div style={{ fontSize: '.88rem', color: '#1e7e34', fontWeight: 700, marginTop: 4 }}>🏁 Capitol finalizat! L-am programat pentru recapitulare (după 1 zi, 7 zile și 30 de zile).</div>}
          {result.reviewAdvanced && !result.reviewAdvanced.retry && <div style={{ fontSize: '.88rem', color: '#1e7e34', marginTop: 4 }}>🔁 Recapitulare reușită{result.reviewAdvanced.done ? ' — capitolul e bine fixat!' : ' — următoarea vine mai târziu.'}</div>}
          {result.reviewAdvanced?.retry && <div style={{ fontSize: '.88rem', color: '#8a6d1a', marginTop: 4 }}>🔁 Mai reluăm o dată capitolul — recapitularea revine mâine.</div>}
          {result.levelChange && (
            <div style={{ fontSize: '.88rem', color: 'var(--navy)', marginTop: 4, fontWeight: 600 }}>
              🎚 Nivelul tău: <strong>{result.levelChange.to === 'incepator' ? 'începător' : result.levelChange.to}</strong> (recalculat după ultimele seturi)
            </div>
          )}
          {result.itemsReviewed > 0 && <div style={{ fontSize: '.85rem', color: 'var(--text-muted)', marginTop: 4 }}>🔁 {result.itemsReviewed} {result.itemsReviewed === 1 ? 'exercițiu reluat a intrat' : 'exerciții reluate au intrat'} în repetiția inteligentă.</div>}
          {result.streakDays > 1 && <div style={{ fontSize: '.85rem', color: 'var(--text-muted)', marginTop: 4 }}>🔥 Serie de studiu: {result.streakDays} zile consecutive!</div>}
          {result.levelInfo && <div style={{ fontSize: '.9rem', marginTop: 6 }}>{result.levelInfo}</div>}
        </div>
      )}

      {error && <div style={{ ...card, background: '#fdecea', color: '#b71c1c', borderColor: '#f5c6cb' }}>⚠️ {error}</div>}

      {questions.map((q, i) => {
        const r = result?.results?.[i];
        return (
          <div key={i} style={{ ...card, borderColor: r ? (r.correct ? 'rgba(39,174,96,.4)' : r.skipped ? 'rgba(230,126,34,.45)' : 'rgba(231,76,60,.35)') : 'var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: '1rem', color: 'var(--navy)', lineHeight: 1.6, flex: 1 }}>
                <strong>{i + 1}.</strong> <MathText text={fixLatexClient(q.statement)} />
                {/* exercițiu RELUAT din repetiția inteligentă (Etapa 3, 5.3) */}
                {q.repeated && <span title="Exercițiu la care ai greșit — îl reluăm ca să-l fixezi" style={{ marginLeft: 6, fontSize: '.7rem', fontWeight: 700, color: '#8a6d1a', background: 'rgba(232,185,49,.16)', borderRadius: 12, padding: '2px 8px', whiteSpace: 'nowrap' }}>🔁 reluat</span>}
              </div>
              {r && <span style={{ fontSize: '1.2rem' }} title={r.skipped ? 'Nerezolvată' : r.correct ? 'Corect' : 'Greșit'}>{r.correct ? '✅' : r.skipped ? '⏳' : '❌'}</span>}
            </div>

            {q.options ? (
              <div>
                {q.options.map((o, oi) => {
                  const chosen = answers[i] === oi;
                  const isCorrect = r && Number(r.answer) === oi;
                  return (
                    <label key={oi} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, marginBottom: 6, cursor: result ? 'default' : 'pointer',
                      border: `1px solid ${isCorrect ? 'rgba(39,174,96,.5)' : chosen && r && !r.correct ? 'rgba(231,76,60,.45)' : 'var(--border)'}`,
                      background: isCorrect ? 'rgba(39,174,96,.08)' : chosen ? 'rgba(232,185,49,.12)' : '#fff',
                    }}>
                      <input type="radio" disabled={!!result} checked={chosen} onChange={() => setAnswers((a) => a.map((v, k) => (k === i ? oi : v)))} />
                      <strong style={{ color: 'var(--navy)' }}>{String.fromCharCode(65 + oi)})</strong>
                      <span style={{ flex: 1 }}><MathText text={fixLatexClient(o)} /></span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <input value={answers[i] ?? ''} disabled={!!result}
                onChange={(e) => setAnswers((a) => a.map((v, k) => (k === i ? e.target.value : v)))}
                placeholder="Răspunsul tău" style={{ ...inp, width: '100%' }} />
            )}

            {/* problemă NEREZOLVATĂ la o temă finalizată incomplet: rămâne de
                făcut la reluare — răspunsul corect nu se dezvăluie */}
            {r && r.skipped && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(230,126,34,.07)', borderRadius: 10, fontSize: '.86rem', color: '#b9590f', fontWeight: 600 }}>
                ⏳ Nerezolvată — te așteaptă când reiei tema (din rubrica Teme, oricând).
              </div>
            )}
            {r && !r.correct && !r.skipped && (
              <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(231,76,60,.06)', borderRadius: 10, fontSize: '.88rem' }}>
                {r.errorType && <div style={{ fontWeight: 700, color: '#c0392b', marginBottom: 4 }}>{ERROR_LABELS[r.errorType] || ''}</div>}
                {r.analysis && <div style={{ marginBottom: 6 }}><MathText text={fixLatexClient(r.analysis)} /></div>}
                <div style={{ color: 'var(--text)' }}><strong>Răspunsul corect:</strong> <MathText text={fixLatexClient(q.options ? q.options[r.answer] : String(r.answer))} /></div>
              </div>
            )}
            {r && r.explanation && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--navy)', fontSize: '.86rem' }}>Vezi rezolvarea pas cu pas</summary>
                <div style={{ marginTop: 6, fontSize: '.9rem', lineHeight: 1.6 }}><MathText text={fixLatexClient(r.explanation)} /></div>
              </details>
            )}
            {onAskTeacher && !result && (
              <button onClick={() => onAskTeacher(q, i)} style={{ marginTop: 10, background: 'none', border: '1px dashed var(--gold)', color: 'var(--gold-dim)', borderRadius: 8, padding: '5px 11px', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <EinsteinIcon size={16} /> Nu înțeleg — întreabă profesorul
              </button>
            )}
          </div>
        );
      })}

      {!result ? (
        <div>
          {homework ? (
            // SFÂRȘITUL TEMEI: „🏁 Finalizează tema" — merge și cu probleme
            // nerezolvate (temă incompletă, reluabilă oricând)
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-lg" onClick={submit} disabled={loading || savingDraft}
                title={allAnswered ? 'Trimit tema spre corectare și notare' : 'Închid tema acum — se înregistrează ca temă incompletă, o pot relua oricând'}>
                {loading ? '⏳ Profesorul corectează...' : allAnswered ? '🏁 Finalizează tema — trimite spre corectare' : `🏁 Finalizează tema (${answered}/${questions.length} rezolvate)`}
              </button>
              <button className="btn btn-outline" onClick={closeForLater} disabled={loading || savingDraft}
                title="Răspunsurile date rămân salvate; tema rămâne de rezolvat și o reiei de unde ai rămas">
                {savingDraft ? '💾 Salvez…' : '💾 Las-o pe mai târziu'}
              </button>
            </div>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={submit} disabled={loading || answered === 0}>
              {loading ? '⏳ Profesorul corectează...' : submitLabel}
            </button>
          )}
          {homework && !loading && (
            <div style={{ marginTop: 8, fontSize: '.82rem', color: 'var(--text-muted)' }}>
              {allAnswered
                ? 'Ai rezolvat toate problemele — la finalizare o corectez, o notez și îți explic greșelile.'
                : <>Mai ai <strong>{left}</strong> {left === 1 ? 'problemă nerezolvată' : 'probleme nerezolvate'}. Poți finaliza tema și așa — se înregistrează ca <strong>temă incompletă</strong> și o reiei oricând de unde ai rămas; o temă neterminată nu te împiedică să primești altele.</>}
            </div>
          )}
          {loading && <div style={{ marginTop: 8, fontSize: '.82rem', color: 'var(--text-muted)' }}>Corectez și analizez fiecare greșeală (motivul ei) — durează câteva secunde…</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => onClose(true)}>✓ Am înțeles — continuăm</button>
          {(result.mistakeIds || []).length > 0 && result.onRemediate && (
            <button className="btn btn-outline" onClick={() => result.onRemediate(result.mistakeIds[0])}>🔁 Încă 10 exerciții ca acelea greșite</button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Feedback instant cât timp profesorul „lucrează" (generările durează) ────
const BUSY_MSGS = {
  setup: 'Pregătesc testul tău inițial — aleg întrebări potrivite clasei tale… (~30s)',
  lesson: 'Pregătesc lecția: adun materialele din site și scriu explicația… (~20s)',
  exercises: 'Generez exercițiile după modelul din site… (~30s)',
  remediation: 'Pregătesc cele 10 exerciții de același fel… (~30s)',
  review: 'Pregătesc recapitularea — 5 întrebări scurte… (~20s)',
  simulare: 'Construiesc simularea, cu punctele tale slabe incluse… (~40s)',
  homework: 'Pregătesc tema…',
  style: 'Țin minte preferința ta…',
};
function BusyOverlay({ label }) {
  return (
    <div style={{
      position: 'fixed', top: 78, left: '50%', transform: 'translateX(-50%)', zIndex: 1300,
      background: 'var(--navy)', color: '#fff', borderRadius: 14, padding: '12px 18px',
      boxShadow: '0 10px 30px rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', gap: 12,
      maxWidth: 'min(92vw, 500px)',
    }}>
      <style>{'@keyframes medspin{to{transform:rotate(360deg)}}'}</style>
      <span style={{ width: 20, height: 20, border: '3px solid rgba(255,255,255,.25)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'medspin .9s linear infinite', flexShrink: 0 }} />
      <div style={{ fontSize: '.88rem', fontWeight: 600 }}>{BUSY_MSGS[label] || 'Profesorul lucrează…'}</div>
    </div>
  );
}

// ─── Pregătirea pentru LUCRARE/TEST (focus): tip + capitole + dată limită ────
// Formular refolosit în două locuri: la înscriere (SetupWizard, embedded=true,
// cu lista de capitole calculată local din clasă) și după înscriere (fereastra
// „🎯 Pregătire pentru lucrare/test", cu lista venită de pe server —
// st.focusOptions — care include și capitolele din site / planul elevului).
function FocusFields({ grade, options = null, value, onChange }) {
  const f = value;
  const patch = (p) => onChange({ ...f, ...p });
  // lista locală (la înscriere): programa clasei + materia anului trecut
  const localOptions = (() => {
    const cur = capitoleForCategory(`clasa-${grade}`);
    const prev = grade > 5 ? capitoleForCategory(`clasa-${grade - 1}`).map((c) => ({ ...c, group: `Clasa ${grade - 1} (anul trecut)` })) : [];
    return [...cur, ...prev];
  })();
  const opts = options && options.length ? options : localOptions;
  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div>
      <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>Ce fel de test ai?</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {Object.entries(FOCUS_KIND_LABELS).map(([val, label]) => (
          (val !== 'test-initial' || grade > 5) && (
            <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', border: `1px solid ${f.kind === val ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 10, cursor: 'pointer', background: f.kind === val ? 'rgba(232,185,49,.1)' : '#fff', fontSize: '.88rem' }}>
              <input type="radio" checked={f.kind === val} onChange={() => patch({ kind: val })} /> {label}
              {val === 'test-initial' && <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>— fără capitole alese = toată clasa a {grade - 1}-a</span>}
              {val === 'lucrare' && <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>— fără capitole alese = toată clasa</span>}
            </label>
          )
        ))}
      </div>
      <CapitolePicker
        options={opts} selected={f.chapterIds} onChange={(ids) => patch({ chapterIds: ids })}
        extraText={f.custom} onExtraText={(t) => patch({ custom: t })}
        label="Capitolele testului (din listă) — gol = toată materia tipului ales"
        extraLabel="Alt capitol (dacă lipsește din listă), lecțiile testului sau alte indicații (opțional)"
        extraPlaceholder="ex: „Ecuații cu modul” · „lecțiile: media aritmetică, procente” · „doamna pune accent pe probleme cu text”"
        max={24}
      />
      <label style={{ display: 'block', fontSize: '.82rem', color: 'var(--text-light)', marginBottom: 4 }}>
        Data testului (până când recapitulăm) — opțional
        <input type="date" value={f.deadline || ''} min={minDate} onChange={(e) => patch({ deadline: e.target.value })}
          style={{ display: 'block', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 11px', fontSize: '.9rem', marginTop: 4, fontFamily: 'inherit' }} />
      </label>
      <div style={{ fontSize: '.74rem', color: 'var(--text-muted)' }}>
        Planul de recapitulare pune capitolele testului primele, îți calculează ritmul ca să termini până la dată
        și îți dă un „test de verificare” doar din capitolele alese.
      </div>
    </div>
  );
}

const EMPTY_FOCUS = { kind: 'lucrare', chapterIds: [], custom: '', deadline: '' };

// Fereastra „🎯 Pregătire pentru lucrare/test” (după înscriere)
function FocusModal({ st, saving, error, onSave, onClear, onClose }) {
  const [f, setF] = useState(() => (st.focus ? {
    kind: st.focus.kind || 'lucrare',
    chapterIds: (st.focus.chapters || []).map((c) => c.id).filter((id) => !id.startsWith('custom-')),
    custom: st.focus.custom || '', deadline: st.focus.deadline || '',
  } : EMPTY_FOCUS));
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(9,30,48,.55)', zIndex: 1400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 18, width: 'min(680px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <b style={{ color: 'var(--navy)' }}>🎯 Pregătire pentru lucrare / test</b>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 7, padding: '4px 9px', cursor: 'pointer', fontSize: '.8rem' }}>✕ Închide</button>
        </div>
        <p style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 12 }}>
          Ai un test sau o lucrare la școală? Alege capitolele și data — recapitularea se organizează după ele.
          Pentru <strong>examenul final</strong> (Evaluarea Națională / BAC) nu e nevoie de nimic aici: planul rămâne toată materia, ca până acum.
        </p>
        <FocusFields grade={st.profile?.grade || 8} options={st.focusOptions} value={f} onChange={setF} />
        {error && <div style={{ padding: 10, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem', margin: '10px 0' }}>⚠️ {error}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="btn btn-primary" disabled={saving} onClick={() => onSave(f)}>
            {saving ? 'Se salvează…' : st.focus ? '💾 Actualizează pregătirea' : '🎯 Pornește pregătirea'}
          </button>
          {st.focus && (
            <button className="btn btn-outline" disabled={saving} onClick={onClear} style={{ color: '#c0392b', borderColor: '#f5c6cb' }}>
              ✕ Renunță la pregătire (revin la planul întreg)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Înscrierea: clasa + examenul (+ opțional lucrarea pentru care se pregătește)
function SetupWizard({ onStart, starting, error }) {
  const [grade, setGrade] = useState(8);
  const [exam, setExam] = useState('');
  const [withFocus, setWithFocus] = useState(false);  // are un test/o lucrare în curând
  const [focus, setFocus] = useState(EMPTY_FOCUS);
  const examOptions = grade >= 9
    ? [['', 'Fără examen (materia clasei)'], ['bac-mate-info', 'Bacalaureat Mate-Info'], ['bac-stiinte', 'Bacalaureat Științele Naturii'], ['bac-tehnologic', 'Bacalaureat Tehnologic']]
    : grade >= 7
    ? [['', 'Fără examen (materia clasei)'], ['evaluare-nationala', 'Evaluarea Națională']]
    : [['', 'Materia clasei']];
  useEffect(() => { setExam(grade === 8 ? 'evaluare-nationala' : ''); setFocus((f) => ({ ...f, chapterIds: [] })); }, [grade]);

  return (
    <div style={{ ...card, maxWidth: 640 }}>
      <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', marginBottom: 6 }}>Hai să ne cunoaștem! 👋</h3>
      <p style={{ fontSize: '.9rem', color: 'var(--text-light)', marginBottom: 16 }}>
        Spune-mi în ce clasă ești și pentru ce te pregătești. Îți dau apoi un <strong>scurt test inițial</strong> ca să văd
        exact ce știi și unde te pot ajuta — apoi îți construiesc <strong>planul tău de învățare</strong>.
      </p>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>Clasa</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[5, 6, 7, 8, 9, 10, 11, 12].map((g) => (
            <button key={g} onClick={() => setGrade(g)} style={{
              width: 46, height: 46, borderRadius: 12, fontWeight: 800, fontSize: '1rem', cursor: 'pointer',
              border: `2px solid ${grade === g ? 'var(--gold)' : 'var(--border)'}`,
              background: grade === g ? 'var(--gold)' : '#fff', color: 'var(--navy)',
            }}>{g}</button>
          ))}
        </div>
      </div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>Mă pregătesc pentru</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {examOptions.map(([val, label]) => (
            <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: `1px solid ${exam === val ? 'var(--gold)' : 'var(--border)'}`, borderRadius: 10, cursor: 'pointer', background: exam === val ? 'rgba(232,185,49,.1)' : '#fff', fontSize: '.9rem' }}>
              <input type="radio" checked={exam === val} onChange={() => setExam(val)} /> {label}
            </label>
          ))}
        </div>
      </div>
      {/* Opțional: are un TEST / o LUCRARE în curând → pregătirea țintită
          (capitole + dată limită); pentru examenul final NU e nevoie — planul
          rămâne toată materia, ca până acum. */}
      <div style={{ border: '1px dashed var(--border)', borderRadius: 12, padding: '10px 14px', marginBottom: 16, background: withFocus ? '#fbfcfe' : '#fff' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '.9rem', fontWeight: 700, color: 'var(--navy)' }}>
          <input type="checkbox" checked={withFocus} onChange={(e) => setWithFocus(e.target.checked)} />
          🎯 Am un test / o lucrare în curând (opțional)
        </label>
        {withFocus && (
          <div style={{ marginTop: 10 }}>
            <FocusFields grade={grade} value={focus} onChange={setFocus} />
          </div>
        )}
        {!withFocus && (
          <div style={{ fontSize: '.74rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Bifează dacă vrei să te pregătesc pentru o lucrare sau un test anume (din anumite capitole, până la o dată).
            Poți porni pregătirea și mai târziu, din pagina meditațiilor. Pentru examenul final nu e nevoie — îl acoperă planul întreg.
          </div>
        )}
      </div>
      {error && <div style={{ padding: 10, background: '#fdecea', color: '#b71c1c', borderRadius: 8, fontSize: '.85rem', marginBottom: 10 }}>⚠️ {error}</div>}
      <button className="btn btn-primary btn-lg" disabled={starting} onClick={() => onStart({ grade, examTarget: exam || null, focus: withFocus ? focus : null })}>
        {starting ? 'Pregătesc testul inițial... (~30s)' : '🚀 Începe cu testul inițial'}
      </button>
      <p style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 10 }}>
        Testul are ~12 întrebări, de la ușor la greu. Dacă ți-ai ales capitolele unui test, întrebările vin din ele; altfel acoperă și materia anilor anteriori, ca să găsesc eventualele lacune. Nu e o notă, e busola noastră. 🧭
      </p>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export default function Meditatii() {
  const { user, loading, isPremium, isTeacher, isParent } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [st, setSt] = useState(null);          // starea de pe server
  const [stError, setStError] = useState(null);
  const [tab, setTab] = useState(searchParams.get('tab') || 'azi');
  const [quiz, setQuiz] = useState(null);      // { kind, sessionId|homeworkId, title, subtitle, questions }
  const [lessonView, setLessonView] = useState(null); // { chapter, lesson, materials }
  const [busy, setBusy] = useState(null);      // eticheta acțiunii în curs
  const [actionError, setActionError] = useState(null);
  const runSuggestionRef = useRef(null);       // legătura listener-e → runSuggestion
  // widgetul „Meditatorul tău" e andocat lateral → pagina se strânge lângă el
  // DOAR cât timp e deschis; la închidere revine pe toată lățimea.
  const [chatDocked, setChatDocked] = useState(() => (typeof window !== 'undefined' ? !!window.__medChatOpen : false));
  useEffect(() => {
    function onChatState(e) { setChatDocked(!!e.detail?.open); }
    window.addEventListener('mate:meditatii-chat-state', onChatState);
    return () => window.removeEventListener('mate:meditatii-chat-state', onChatState);
  }, []);
  // la înscriere/reset (fără profil) widgetul vechi se închide — conversația
  // lui ar fi despre planul șters, iar formularul are nevoie de toată pagina
  useEffect(() => {
    if (st?.needsSetup) window.dispatchEvent(new CustomEvent('mate:meditatii-close'));
  }, [st?.needsSetup]);

  const refresh = useCallback(async () => {
    try { setSt(await aiClient.meditatii({ action: 'state' })); setStError(null); }
    catch (e) { setStError(e.message); }
  }, []);
  useEffect(() => { if (user) refresh(); }, [user, refresh]);

  const category = st?.profile
    ? (st.profile.examTarget === 'evaluare-nationala' ? 'evaluare-nationala'
      : st.profile.examTarget ? 'bacalaureat' : `clasa-${st.profile.grade}`)
    : null;

  // „Nu înțeleg" / „Continuă în conversație" → widgetul plutitor (Meditatorul tău)
  function askTeacher(q) {
    const ctx = { meditatii: true, category, ...(q?.statement ? { exerciseText: q.statement } : {}) };
    openMeditatorChat(ctx, q
      ? { id: Date.now(), text: 'Nu înțeleg acest exercițiu. Dă-mi un indiciu, fără să-mi spui răspunsul.', mode: 'hint' }
      : { id: Date.now(), text: 'Salut! Ce facem azi la meditație?', mode: 'tutor' });
  }

  // ── PROFESORUL COMUNICĂ PRIN WIDGET (se deschide singur) ──────────────────
  // 1) La sosire: mesajul de bun venit (briefingul) + pașii propuși ca butoane.
  const welcomedRef = useRef(false);
  useEffect(() => {
    if (welcomedRef.current || !st || !st.premium || st.needsSetup || !st.briefing?.message) return;
    welcomedRef.current = true;
    openMeditatorChat({ meditatii: true, category }, null, {
      id: 'welcome-' + Date.now(), message: st.briefing.message, suggestions: st.briefing.suggestions || [],
    });
    // eslint-disable-next-line
  }, [st]);

  // 2) După evenimente (set terminat, temă notată): apreciere + pasul următor,
  //    scrise de coach (gpt-4o-mini pe server — economie de tokeni).
  async function coachAfter(event) {
    try {
      const c = await aiClient.meditatii({ action: 'coach', event });
      if (c?.message) {
        openMeditatorChat({ meditatii: true, category }, null, {
          id: 'coach-' + Date.now(), message: c.message, suggestions: c.suggestions || [],
        });
      }
    } catch { /* coach e opțional — tăcut */ }
  }

  // 3) Profesorul pornește pași DIN conversație ([[MEDITATII:...]]) sau prin
  //    butoanele coach — pagina execută; id-urile lipsă se completează din stare.
  const stRef = useRef(st);
  useEffect(() => { stRef.current = st; }, [st]);
  useEffect(() => {
    function onAction(e) {
      const a = resolveAction(e.detail, stRef.current);
      if (a) runSuggestionRef.current?.(a);
    }
    window.addEventListener('mate:meditatii-action', onAction);
    return () => window.removeEventListener('mate:meditatii-action', onAction);
    // eslint-disable-next-line
  }, []);
  // acțiune „în așteptare" venită de pe altă pagină (marcaj emis în alt loc)
  useEffect(() => {
    if (!st || !st.premium || st.needsSetup) return;
    try {
      const raw = sessionStorage.getItem('med_pending_action');
      if (raw) {
        sessionStorage.removeItem('med_pending_action');
        const a = resolveAction(JSON.parse(raw), st);
        if (a) setTimeout(() => runSuggestionRef.current?.(a), 400);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line
  }, [st]);

  async function run(label, fn) {
    setBusy(label); setActionError(null);
    try { await fn(); }
    catch (e) { setActionError(e.message); }
    finally { setBusy(null); }
  }

  // ── acțiunile principale ──
  const startSetup = ({ grade, examTarget, focus = null }) => run('setup', async () => {
    // focus = pregătirea pentru lucrare/test aleasă la înscriere (opțional):
    // testul inițial se dă din capitolele ei, iar planul le pune primele
    const r = await aiClient.meditatii({ action: 'setup', grade, examTarget, focus });
    setQuiz({
      kind: 'evaluare', sessionId: r.sessionId, questions: r.questions,
      title: '🧭 Testul inițial', subtitle: 'Fără stres: îl folosesc doar ca să-ți construiesc planul potrivit ție.',
    });
  });

  // ── pregătirea pentru lucrare/test (focus): setare / renunțare oricând ──
  const [focusModal, setFocusModal] = useState(false);
  const saveFocus = (f) => run('focus', async () => {
    await aiClient.meditatii({ action: 'set_focus', kind: f.kind, chapterIds: f.chapterIds, custom: f.custom, deadline: f.deadline || null });
    await refresh();
    setFocusModal(false);
  });
  const clearFocus = () => run('focus', async () => {
    if (!window.confirm('Renunți la pregătirea pentru lucrare/test? Planul întreg rămâne neschimbat.')) return;
    await aiClient.meditatii({ action: 'set_focus', kind: 'examen' }); // examen final / renunțare = fără focus
    await refresh();
    setFocusModal(false);
  });
  // schimbarea rapidă a DATEI lucrării, direct din bannerul 🎯 (fără formular):
  // păstrează tipul/capitolele/indicațiile, modifică doar data limită
  const changeFocusDate = (newDate) => run('focus', async () => {
    const f = st?.focus; if (!f) return;
    await aiClient.meditatii({
      action: 'set_focus', kind: f.kind,
      chapterIds: (f.chapters || []).map((c) => c.id).filter((id) => !String(id).startsWith('custom-')),
      custom: f.custom || '', deadline: newDate || null,
    });
    await refresh();
  });
  // pregătirea pe SUBIECTELE examenului: doar Subiectul I / II / I+II
  const setExamScope = (scope) => run('focus', async () => {
    await aiClient.meditatii({ action: 'set_exam_scope', scope: scope || null });
    await refresh();
  });

  const openLesson = (chapterId) => run('lesson', async () => {
    const r = await aiClient.meditatii({ action: 'lesson', chapterId });
    setLessonView(r); setQuiz(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const startExercises = (chapterId, difficulty = null, forceGenerate = false) => run('exercises', async () => {
    const r = await aiClient.meditatii({ action: 'exercises', chapterId, difficulty, forceGenerate });
    setLessonView(null);
    // SITE-FIRST (cerința 1, runda 5): există un exercițiu interactiv potrivit
    // chiar în site → îl deschidem pe ACELA; rezultatul se înregistrează
    // automat (medSesId) în plan, rapoarte și „Progresul meu".
    if (r.siteTest) { navigate(r.siteTest.url); return; }
    setQuiz({
      kind: 'exercitii', sessionId: r.sessionId, questions: r.questions, topic: r.chapter.title,
      title: `✍️ Exerciții · ${r.chapter.title}`, subtitle: `Dificultate: ${r.difficulty}. Rezolvă în ritmul tău — la final îți explic tot.`,
      siteExercises: r.siteExercises,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const startRemediation = (mistakeId) => run('remediation', async () => {
    const r = await aiClient.meditatii({ action: 'remediation', mistakeId });
    setQuiz({
      kind: 'remediere', sessionId: r.sessionId, questions: r.questions,
      title: '🔁 Exerciții de remediere (același tip)', subtitle: 'Fixăm exact procedeul la care ai greșit — 10 exerciții de același fel.',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  const startReview = (reviewId, chapterTitle) => run('review', async () => {
    const r = await aiClient.meditatii({ action: 'review_start', reviewId });
    setQuiz({
      kind: 'recapitulare', sessionId: r.sessionId, questions: r.questions, topic: r.chapterTitle || chapterTitle,
      title: `🔁 Recapitulare · ${r.chapterTitle || chapterTitle}`, subtitle: 'Scurt și la obiect — ca să nu uiți materia.',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // focusTest=true → TEST DE VERIFICARE doar din capitolele pregătirii pentru
  // lucrare (focus), nu simulare de examen
  const startSimulare = (forceGenerate = false, focusTest = false) => run('simulare', async () => {
    const r = await aiClient.meditatii({ action: 'simulare', forceGenerate, focus: focusTest });
    // SITE-FIRST: un TEST din site (categoria examenului / capitolele lucrării)
    // nefolosit încă → se deschide acela; abia după epuizare se generează unul.
    if (r.siteTest) { navigate(r.siteTest.url); return; }
    const isLucrare = r.focusTest || r.examType === 'lucrare';
    setQuiz({
      kind: 'simulare', sessionId: r.sessionId, questions: r.questions,
      topic: isLucrare ? 'Lucrare de verificare' : (EXAM_LABELS[r.examType] || r.examType),
      title: isLucrare ? '🧩 Test de verificare · capitolele lucrării' : `🎯 Simulare interactivă · ${EXAM_LABELS[r.examType] || r.examType}`,
      subtitle: isLucrare
        ? 'Doar din capitolele alese pentru lucrare — să vedem cât de pregătit ești.'
        : 'Construită după modelul subiectelor din site, cu punctele tale slabe incluse.',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // „Dă-mi o temă acum": o temă neterminată NU mai blochează primirea alteia
  // (cerință) — serverul dă temă la orice cerere a elevului
  const askHomework = () => run('homework', async () => {
    const r = await aiClient.meditatii({ action: 'homework_assign' });
    await refresh();
    if (r.skipped) setActionError('Nu am găsit acum un material potrivit — mai încearcă după ce avansezi în plan.');
    else setTab('teme');
  });

  // „Încheie meditația și dă-mi tema" (cerința 3, runda 5): închide lucrul,
  // primește temă pentru acasă; data viitoare reiei de unde ai rămas.
  const endSession = () => run('homework', async () => {
    setQuiz(null); setLessonView(null);
    const r = await aiClient.meditatii({ action: 'homework_assign' });
    await refresh();
    setTab('teme');
    coachAfter({ type: 'session_end', title: r.assigned?.title || null, skipped: r.skipped || null });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Deschide / RELUĂ o temă (oricând, indiferent de stare): răspunsurile
  // salvate (ciornă sau finalizare incompletă) revin în formular.
  const openHomework = (hw) => run('homework', async () => {
    const r = await aiClient.meditatii({ action: 'homework_start', id: hw.id });
    if (r.kind === 'content') { navigate(r.url); return; }
    const resumed = !!(r.resumed && Array.isArray(r.answers));
    setQuiz({
      kind: 'tema', homeworkId: r.homeworkId, questions: r.questions,
      initialAnswers: resumed ? r.answers : null,
      title: `📚 ${r.title}`,
      subtitle: resumed
        ? `↺ Reluare: ai ${r.answered}/${r.total} răspunsuri salvate — continuă de unde ai rămas. La final o corectez, o notez și îți explic greșelile.`
        : r.status && r.status !== 'data'
          ? 'Reiei o temă deja finalizată — încercare nouă, de la zero. O corectez, o notez și îți explic greșelile.'
          : 'Tema ta de la Profesorul Virtual. O corectez, o notez și îți explic greșelile.',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // „Las-o pe mai târziu": ciorna temei (răspunsurile de până acum)
  const saveHomeworkDraft = (homeworkId, answers) =>
    aiClient.meditatii({ action: 'homework_draft', id: homeworkId, answers });

  const setStyle = (style) => run('style', async () => {
    await aiClient.meditatii({ action: 'set_style', style });
    await refresh();
  });

  // execută pasul propus de profesor (briefing, butoane coach, marcaje din chat)
  function runSuggestion(s) {
    if (!s) return;
    if (s.kind === 'lectie') openLesson(s.chapterId);
    else if (s.kind === 'exercitii') startExercises(s.chapterId);
    else if (s.kind === 'recapitulare') startReview(s.reviewId, s.chapterTitle);
    else if (s.kind === 'remediere') startRemediation(s.mistakeId);
    else if (s.kind === 'tema') openHomework({ id: s.homeworkId });
    else if (s.kind === 'simulare') startSimulare(false, !!s.focus);
    else if (s.kind === 'plan') { setQuiz(null); setLessonView(null); setTab('plan'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (s.kind === 'end') endSession();
  }
  runSuggestionRef.current = runSuggestion;

  // trimiterea unui set → acțiunea corectă pe server
  async function submitQuiz(answers, durationSec) {
    let r;
    if (quiz.kind === 'evaluare') {
      r = await aiClient.meditatii({ action: 'assessment_submit', sessionId: quiz.sessionId, answers, durationSec });
      r.levelInfo = `🧭 Nivelul tău: ${r.level === 'incepator' ? 'începător — pornim de la bază, pas cu pas' : r.level === 'avansat' ? 'avansat — mergem pe exerciții serioase' : 'mediu — consolidăm și creștem'}. ${r.gaps?.length ? `Am găsit lacune la: ${r.gaps.map((g) => g.title).join('; ')} — le-am pus primele în plan.` : 'Nu am găsit lacune mari — bravo!'}`;
      r.pct = r.pct ?? Math.round((r.score / Math.max(1, r.maxScore)) * 100);
    } else if (quiz.kind === 'tema') {
      r = await aiClient.meditatii({ action: 'homework_submit', id: quiz.homeworkId, answers, durationSec });
    } else {
      r = await aiClient.meditatii({ action: 'submit_set', sessionId: quiz.sessionId, answers, durationSec });
    }
    r.onRemediate = (mid) => startRemediation(mid);
    // profesorul comentează prin widget: apreciere + pasul următor (gpt-4o-mini)
    const wrongCount = (r.results || []).filter((x) => !x.correct && !x.skipped).length;
    if (quiz.kind === 'tema') {
      coachAfter({
        type: 'homework_done', title: (quiz.title || '').replace(/^📚\s*/, ''), grade: r.grade, score: r.score, maxScore: r.maxScore,
        complete: r.complete !== false, answered: r.answered, total: r.total,   // temă completă / INCOMPLETĂ
      });
    } else {
      coachAfter({ type: 'set_done', kind: quiz.kind, topic: quiz.topic || null, score: r.score, maxScore: r.maxScore, chapterDone: !!r.chapterDone, wrongCount });
    }
    return r;
  }

  // ── stările speciale ──
  if (loading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="spinner" /></div>;

  if (!user) {
    return (
      <div style={{ maxWidth: 'var(--container)', margin: '0 auto', padding: '32px 20px 60px' }}>
        <Hero />
        <div style={{ textAlign: 'center', padding: 50, background: '#f7f9fc', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔒</div>
          <p style={{ color: 'var(--text-light)', marginBottom: 18 }}>Autentifică-te pentru meditații cu Profesorul Virtual.</p>
          <Link to="/autentificare" className="btn btn-primary">Autentificare</Link>
        </div>
      </div>
    );
  }

  if (isTeacher || isParent) {
    return (
      <div style={{ maxWidth: 'var(--container)', margin: '0 auto', padding: '32px 20px 60px' }}>
        <Hero />
        <div style={card}>
          <p style={{ fontSize: '.95rem', color: 'var(--text)', marginBottom: 10 }}>
            Meditațiile cu Profesorul Virtual sunt pentru <strong>conturile de elev</strong>: profesorul ține minte fiecare elev,
            îi face evaluarea inițială, planul de învățare, îi dă teme și recapitulări.
          </p>
          <p style={{ fontSize: '.9rem', color: 'var(--text-light)' }}>
            Ca {isTeacher ? 'profesor' : 'părinte'}, vezi progresul elevilor asociați (plan, timp de studiu, capitole, dificultăți și recomandări)
            în <Link to="/profil" style={{ color: 'var(--navy)', fontWeight: 700 }}>Contul meu → Raport AI</Link>.
          </p>
        </div>
      </div>
    );
  }

  const premium = st ? st.premium : isPremium;

  return (
    <div className="med-page" style={{ maxWidth: 'var(--container)', margin: '0 auto', padding: '32px 20px 60px', transition: 'padding .25s ease' }}>
      {/* pagina se strânge lângă panoul andocat al Meditatorului (doar pe ecrane late) */}
      {chatDocked && <style>{'@media (min-width: 1100px){ .med-page{ padding-right: 500px !important; max-width: none !important; } }'}</style>}
      <Hero profile={st?.profile} focus={st?.focus} />

      {stError && <div style={{ ...card, background: '#fdecea', color: '#b71c1c', borderColor: '#f5c6cb' }}>⚠️ {stError}</div>}
      {!st && !stError && <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>}

      {st && !premium && (
        <div style={{ ...card, background: '#fff4e5', borderColor: 'var(--gold)' }}>
          <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.05rem', marginBottom: 8 }}>🔒 Meditațiile fac parte din abonament</div>
          <p style={{ fontSize: '.92rem', color: 'var(--text)', marginBottom: 12 }}>
            Un meditator personal, disponibil oricând: <strong>test inițial</strong> care îți găsește lacunele, <strong>plan de învățare</strong> cu obiective
            săptămânale, <strong>teorie + exerciții</strong> din materialele site-ului, <strong>analiza greșelilor</strong> („de ce ai greșit, nu doar că ai greșit"),
            <strong> teme corectate și notate</strong>, <strong>recapitulări programate</strong> ca să nu uiți materia și <strong>simulări de examen</strong> cu predicția notei.
          </p>
          <Link to="/preturi" className="btn btn-primary">Abonează-te pentru meditații →</Link>
        </div>
      )}

      {st && premium && st.needsSetup && !quiz && (
        <SetupWizard onStart={startSetup} starting={busy === 'setup'} error={actionError} />
      )}

      {/* Feedback instant: profesorul „lucrează" (generările durează 20–60s) */}
      {busy && <BusyOverlay label={busy} />}

      {/* Lecția deschisă */}
      {st && premium && lessonView && !quiz && (
        <LessonView data={lessonView} busyLabel={busy}
          onClose={() => setLessonView(null)}
          onExercises={() => startExercises(lessonView.chapter.id)}
          onEnd={endSession} />
      )}

      {/* Un set în lucru (test/exerciții/temă/recapitulare/simulare) */}
      {st && premium && quiz && (
        <QuizRunner key={quiz.sessionId || quiz.homeworkId} title={quiz.title} subtitle={quiz.subtitle}
          questions={quiz.questions} onSubmit={submitQuiz} onAskTeacher={askTeacher}
          homework={quiz.kind === 'tema'} initialAnswers={quiz.initialAnswers || null}
          onSaveDraft={quiz.kind === 'tema' ? (answers) => saveHomeworkDraft(quiz.homeworkId, answers) : null}
          onClose={async (finished, drafted) => { setQuiz(null); if (finished || drafted) await refresh(); }} />
      )}
      {st && premium && quiz?.siteExercises?.length > 0 && (
        <div style={{ ...card, background: '#f7f9fc' }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem', marginBottom: 8 }}>🧩 Din materialele site-ului, la același capitol:</div>
          {quiz.siteExercises.map((s) => (
            <Link key={s.id} to={s.url} style={{ display: 'block', padding: '7px 10px', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6, fontSize: '.86rem', color: 'var(--navy)', fontWeight: 600 }}>
              🧩 {s.title} →
            </Link>
          ))}
        </div>
      )}

      {/* Dashboardul cu taburi */}
      {st && premium && !st.needsSetup && !quiz && !lessonView && (
        <>
          <div style={{ display: 'flex', gap: 8, borderBottom: '2px solid var(--border)', marginBottom: 20, flexWrap: 'wrap' }}>
            {[
              ['azi', '📅 Astăzi'], ['plan', `🗺️ Planul meu${st.plan?.progress != null ? ` · ${st.plan.progress}%` : ''}`],
              ['teme', `📚 Teme${st.pendingHomework ? ` (${st.pendingHomework})` : ''}`],
              ['recapitulari', `🔁 Recapitulări${st.dueReviews?.length ? ` (${st.dueReviews.length})` : ''}`],
              ['simulari', '🎯 Simulări'],
              ['raport', `📋 Raport meditator${(st.openMistakes?.length || st.pendingHomework) ? ' •' : ''}`],
              ['progres', '📈 Progresul meu'],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                background: 'none', border: 'none', padding: '10px 4px', marginBottom: -2,
                borderBottom: '3px solid', borderColor: tab === id ? 'var(--gold)' : 'transparent',
                color: tab === id ? 'var(--navy)' : 'var(--text-muted)', fontWeight: 700, fontSize: '.92rem', cursor: 'pointer',
              }}>{label}</button>
            ))}
          </div>

          {actionError && <div style={{ ...card, background: '#fff4e5', color: '#8a6d1a', borderColor: 'var(--gold)' }}>{actionError}</div>}

          {tab === 'azi' && <TodayTab st={st} busy={busy} onLesson={openLesson} onExercises={startExercises} onReview={startReview} onHomeworkTab={() => setTab('teme')} onEnd={endSession} onFocusOpen={() => setFocusModal(true)} onFocusTest={() => startSimulare(false, true)} onFocusDate={changeFocusDate} onExamScope={setExamScope} />}
          {tab === 'plan' && <PlanTab st={st} busy={busy} onLesson={openLesson} onExercises={startExercises} onFocusOpen={() => setFocusModal(true)} onReset={async () => { if (window.confirm('Sigur reluăm totul de la zero? Planul și evaluarea inițială se șterg.')) { await aiClient.meditatii({ action: 'reset' }); await refresh(); } }} />}
          {tab === 'teme' && <HomeworkTab st={st} busy={busy} onOpen={openHomework} onAsk={askHomework} />}
          {tab === 'recapitulari' && <ReviewsTab st={st} busy={busy} onReview={startReview} />}
          {tab === 'simulari' && <SimTab st={st} busy={busy} onSimulare={startSimulare} onFocusTest={() => startSimulare(false, true)} />}
          {tab === 'raport' && <RaportTab st={st} busy={busy} onOpenHomework={openHomework} onRemediation={startRemediation} onStyle={setStyle} />}
          {tab === 'progres' && <ProgressMeTab st={st} />}
        </>
      )}

      {/* Fereastra „🎯 Pregătire pentru lucrare/test” */}
      {focusModal && st && premium && !st.needsSetup && (
        <FocusModal st={st} saving={busy === 'focus'} error={actionError}
          onSave={saveFocus} onClear={clearFocus} onClose={() => setFocusModal(false)} />
      )}
    </div>
  );
}

function Hero({ profile, focus }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(1.7rem,4vw,2.4rem)', color: 'var(--navy)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <EinsteinIcon size={46} /> Meditații cu Profesorul Virtual
      </h1>
      <p style={{ color: 'var(--text-light)', maxWidth: 680, marginBottom: profile ? 10 : 0 }}>
        Meditatorul tău personal, disponibil oricând: îți cunoaște nivelul, îți construiește planul, îți explică teoria,
        îți dă exerciții și teme din materialele site-ului, îți analizează greșelile și te readuce la ele până le stăpânești.
      </p>
      {profile && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={chip('rgba(15,43,68,.08)', 'var(--navy)')}>🎒 Clasa a {profile.grade}-a</span>
          {profile.examTarget && <span style={chip('rgba(15,43,68,.08)', 'var(--navy)')}>🎯 {EXAM_LABELS[profile.examTarget]}</span>}
          {focus && (
            <span style={chip('rgba(142,68,173,.12)', '#8e44ad')} title={`Pregătire pentru ${focus.kindLabel}`}>
              🎯 {focus.kindLabel}{focus.deadline && !focus.overdue ? ` · ${roDate(focus.deadline)}` : ''}
            </span>
          )}
          {profile.level && <span title="Nivelul stabilit la testul inițial — se recalibrează pe măsură ce lucrezi" style={chip('rgba(232,185,49,.18)', '#8a6d1a')}>📊 Nivel (evaluare inițială): {profile.level}</span>}
          {profile.streakDays > 0 && <span style={chip('rgba(231,76,60,.1)', '#c0392b')}>🔥 {profile.streakDays} {profile.streakDays === 1 ? 'zi' : 'zile'} la rând</span>}
          {profile.totalSeconds > 60 && <span style={chip('rgba(39,174,96,.1)', '#1e7e34')}>⏱ {fmtMin(profile.totalSeconds)} de studiu</span>}
        </div>
      )}
    </div>
  );
}

function LessonView({ data, onClose, onExercises, onEnd, busyLabel }) {
  // „Ascultă" — profesorul recită toată teoria (vocile din sistem, gratuit)
  const [voice, setVoice] = useState(null); // { frac, paused }
  const ctlRef = useRef(null);
  useEffect(() => () => { try { ctlRef.current?.stop?.(); } catch { /* ignore */ } stopSpeaking(); }, []);
  function toggleListen() {
    const ctl = ctlRef.current;
    if (ctl && voice) {
      if (!voice.paused) { ctl.pause(); setVoice((v) => ({ ...v, paused: true })); }
      else { ctl.resume(); setVoice((v) => ({ ...v, paused: false })); }
      return;
    }
    const c = playAnswer(preMessage(String(data.lesson || '')), {
      onProgress: ({ frac }) => setVoice((v) => (v ? { ...v, frac } : v)),
      onEnd: () => { ctlRef.current = null; setVoice(null); },
    });
    if (!c) return;
    ctlRef.current = c;
    setVoice({ frac: 0, paused: false });
  }
  return (
    <div>
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.05rem' }}>📖 Teoria · {data.chapter.title}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {ttsSupported() && (
            <button className="btn btn-outline btn-sm" onClick={toggleListen}
              style={voice && !voice.paused ? { background: 'var(--gold)', color: 'var(--navy)', borderColor: 'var(--gold)' } : {}}>
              {voice ? (voice.paused ? '▶ Continuă' : '❚❚ Pauză') : '🔊 Ascultă teoria'}
            </button>
          )}
          {voice && (
            <div title="Progresul citirii" style={{ width: 90, height: 8, borderRadius: 6, background: 'rgba(15,43,68,.15)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round(Math.min(1, voice.frac || 0) * 100)}%`, background: 'var(--gold)', transition: 'width .3s' }} />
            </div>
          )}
          <button className="btn btn-outline btn-sm" onClick={() => openPrintDocument(`Lecție · ${data.chapter.title}`, lessonHtml(`Lecție · ${data.chapter.title}`, data.lesson))}>📄 Salvează lecția PDF</button>
          <button className="btn btn-outline btn-sm" onClick={onClose}>✕ Închide</button>
        </div>
      </div>
      {data.materials?.length > 0 && (
        <div style={{ ...card, background: '#f7f9fc' }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem', marginBottom: 8 }}>📚 Întâi din materialele site-ului:</div>
          {data.materials.map((m, i) => (
            <Link key={i} to={m.url} style={{ display: 'block', padding: '7px 10px', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6, fontSize: '.86rem', color: 'var(--navy)', fontWeight: 600 }}>
              {m.kind === 'pdf' ? '📄' : m.kind === 'articol' ? '📝' : m.kind === 'manual' ? '📖' : '🧩'} {m.title}{m.is_free === false ? ' ⭐' : ''} →
            </Link>
          ))}
        </div>
      )}
      <div style={{ ...card, fontSize: '.95rem', lineHeight: 1.7 }}>
        <MathText text={data.lesson} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-primary btn-lg" onClick={onExercises} disabled={busyLabel === 'exercises'}>
          {busyLabel === 'exercises' ? 'Pregătesc exercițiile...' : '✍️ Am citit — trecem la exerciții'}
        </button>
        {onEnd && (
          <button className="btn btn-outline" onClick={onEnd} disabled={!!busyLabel}>🏁 Încheie meditația și dă-mi tema</button>
        )}
      </div>
    </div>
  );
}

function TodayTab({ st, busy, onLesson, onExercises, onReview, onHomeworkTab, onEnd, onFocusOpen, onFocusTest, onFocusDate, onExamScope }) {
  const next = st.nextChapter;
  const focus = st.focus;
  const isEN = st.profile?.examTarget === 'evaluare-nationala';
  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return (
    <div>
      {/* 🎯 PREGĂTIREA PENTRU LUCRARE/TEST — recapitulare pe capitolele alese,
          cu numărătoarea zilelor până la data testului */}
      {focus ? (
        <div style={{ ...card, borderLeft: '4px solid #8e44ad', background: 'rgba(142,68,173,.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 240, flex: 1 }}>
              <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#8e44ad', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>
                🎯 Pregătire pentru {focus.kindLabel}
              </div>
              <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.02rem' }}>
                {focus.done}/{focus.total} capitole recapitulate
                {focus.deadline && (
                  focus.overdue
                    ? ' · data testului a trecut'
                    : focus.daysLeft === 0
                      ? ' · TESTUL E AZI! 💪'
                      : ` · până pe ${roDate(focus.deadline)} (${focus.daysLeft} ${focus.daysLeft === 1 ? 'zi' : 'zile'})`
                )}
              </div>
              {focus.perWeek != null && (
                <div style={{ fontSize: '.8rem', color: 'var(--text-light)', marginTop: 2 }}>
                  Ritmul necesar ca să termini la timp: ~{focus.perWeek} {focus.perWeek === 1 ? 'capitol' : 'capitole'}/săptămână.
                </div>
              )}
              {focus.custom && <div style={{ fontSize: '.78rem', color: 'var(--text-muted)', marginTop: 2 }}>📝 Indicațiile tale: {focus.custom}</div>}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {focus.chapters.map((c) => {
                  const stl = STATUS_LABELS[c.status] || STATUS_LABELS.de_parcurs;
                  return <span key={c.id} style={chip(stl.bg, stl.color)} title={stl.label}>{c.status === 'finalizat' ? '✓' : '•'} {c.title}</span>;
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexDirection: 'column' }}>
              {/* data lucrării se schimbă DIRECT de aici (fără formular) */}
              <label style={{ fontSize: '.72rem', fontWeight: 700, color: '#8e44ad', display: 'flex', flexDirection: 'column', gap: 3 }}>
                📅 Data testului
                <input type="date" value={focus.deadline || ''} min={minDate} disabled={!!busy}
                  onChange={(e) => onFocusDate(e.target.value)}
                  title="Schimbă data lucrării — recapitularea se recalculează după ea"
                  style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 9px', fontSize: '.82rem', fontFamily: 'inherit', color: 'var(--navy)' }} />
              </label>
              <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={onFocusTest} title="Test generat DOAR din capitolele lucrării">
                🧩 Test de verificare
              </button>
              <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={onFocusOpen}>✏️ Modifică</button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'rgba(142,68,173,.04)', borderColor: 'rgba(142,68,173,.25)' }}>
          <span style={{ fontSize: '.88rem', color: 'var(--text)' }}>
            🎯 <strong>Ai un test sau o lucrare în curând?</strong> Alege capitolele și data — îți fac planul de recapitulare pentru el.
          </span>
          <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={onFocusOpen}>Pregătește-mă pentru lucrare/test</button>
        </div>
      )}

      {/* Pregătirea pe SUBIECTELE examenului: doar Subiectul I / II / I+II —
          planul, simulările și explicațiile meditatorului se adaptează */}
      {st.profile?.examTarget && (
        <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderColor: st.examScope ? 'var(--gold)' : 'var(--border)', background: st.examScope ? 'rgba(232,185,49,.05)' : '#fff' }}>
          <span style={{ fontSize: '.88rem', color: 'var(--text)', flex: '1 1 300px' }}>
            📚 <strong>Pregătirea pentru {EXAM_LABELS[st.profile.examTarget] || 'examen'}:</strong> poți să te concentrezi întâi doar pe anumite subiecte —
            planul, simulările și explicațiile meditatorului se adaptează; când ești gata, treci mai departe (schimbi alegerea de aici oricând).
          </span>
          <select value={st.examScope || ''} disabled={!!busy} onChange={(e) => onExamScope(e.target.value)}
            style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 11px', fontSize: '.86rem', fontFamily: 'inherit', color: 'var(--navy)', fontWeight: 600 }}>
            <option value="">Tot examenul (toate subiectele)</option>
            <option value="s1">{isEN ? 'Doar Subiectul I (grilă · algebră)' : 'Doar Subiectul I (itemi scurți)'}</option>
            <option value="s2">{isEN ? 'Doar Subiectul al II-lea (grilă · geometrie)' : 'Doar Subiectul al II-lea (algebră)'}</option>
            <option value="s1s2">{isEN ? 'Subiectele I și II (fără Subiectul III)' : 'Subiectele I și II (fără analiză)'}</option>
          </select>
        </div>
      )}

      {/* Pasul din plan — mesajele și îndrumarea vin în WIDGET (Meditatorul tău) */}
      {next ? (
        <div style={{ ...card, borderLeft: '4px solid var(--gold)' }}>
          <div style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--gold-dim)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>Profesorul îți recomandă azi</div>
          <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.1rem', marginBottom: 4 }}>{next.title}</div>
          <div style={{ fontSize: '.85rem', color: 'var(--text-light)', marginBottom: 12 }}>
            {next.status === 'de_parcurs' ? 'Începem cu teoria, apoi exersăm.' : next.status === 'teorie' ? 'Ai citit teoria — acum exersăm!' : 'Continuăm exercițiile până stăpânești capitolul (80%+).'}
            {next.mastery != null && ` Stăpânire actuală: ${Math.round(next.mastery * 100)}%.`}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => (next.status === 'de_parcurs' ? onLesson(next.id) : onExercises(next.id))} disabled={!!busy}>
              {busy === 'lesson' || busy === 'exercises' ? 'Se pregătește...' : next.status === 'de_parcurs' ? '📖 Începe cu teoria' : next.status === 'teorie' ? '✍️ Fă exerciții' : '✍️ Continuă de unde ai rămas'}
            </button>
            {/* Știe deja teoria? Sare direct la exerciții (cerința 2, runda 5) */}
            {next.status === 'de_parcurs' && (
              <button className="btn btn-outline" onClick={() => onExercises(next.id)} disabled={!!busy}>✍️ Știu teoria — fă exerciții</button>
            )}
            {next.status !== 'de_parcurs' && (
              <button className="btn btn-outline" onClick={() => onLesson(next.id)} disabled={!!busy}>📖 Recitesc teoria</button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ ...card, borderLeft: '4px solid #27ae60' }}>
          <div style={{ fontWeight: 800, color: '#1e7e34', fontSize: '1.05rem' }}>🏆 Ai parcurs toate capitolele din plan!</div>
          <div style={{ fontSize: '.88rem', color: 'var(--text-light)', marginTop: 4 }}>Continuă cu recapitulările și simulările de examen ca să rămâi în formă.</div>
        </div>
      )}

      {/* Recapitulări scadente */}
      {st.dueReviews?.length > 0 && (
        <div style={{ ...card, background: 'rgba(52,152,219,.06)', borderColor: 'rgba(52,152,219,.3)' }}>
          <div style={{ fontWeight: 700, color: '#1f6dab', marginBottom: 8 }}>🔁 Ca să nu uiți materia, azi recapitulăm:</div>
          {st.dueReviews.slice(0, 3).map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#fff', borderRadius: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '.88rem', color: 'var(--navy)', fontWeight: 600 }}>{r.chapterTitle}</span>
              <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={() => onReview(r.id, r.chapterTitle)}>{busy === 'review' ? '...' : '▶ 5 întrebări rapide'}</button>
            </div>
          ))}
        </div>
      )}

      {/* Teme în așteptare (+ cele finalizate incomplet, reluabile oricând) */}
      {(st.pendingHomework > 0 || st.incompleteHomework > 0) && (
        <div style={{ ...card, background: 'rgba(232,185,49,.08)', borderColor: 'var(--gold)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: 'var(--navy)' }}>
            {st.pendingHomework > 0 && <>📚 Ai {st.pendingHomework} {st.pendingHomework === 1 ? 'temă nefăcută' : 'teme nefăcute'} de la profesor.</>}
            {st.incompleteHomework > 0 && (
              <span style={{ display: 'block', fontSize: '.82rem', fontWeight: 600, color: '#b9590f', marginTop: st.pendingHomework > 0 ? 2 : 0 }}>
                ◐ {st.incompleteHomework === 1 ? 'O temă e finalizată incomplet' : `${st.incompleteHomework} teme sunt finalizate incomplet`} — o poți relua oricând.
              </span>
            )}
          </span>
          <button className="btn btn-primary btn-sm" onClick={onHomeworkTab}>Vezi temele →</button>
        </div>
      )}

      {/* Încheie meditația cu temă pentru acasă (cerința 3, runda 5) */}
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#f7f9fc' }}>
        <span style={{ fontSize: '.88rem', color: 'var(--text-light)' }}>Gata pentru azi? Profesorul îți dă temă și data viitoare reluați de unde ați rămas.</span>
        <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={onEnd}>🏁 Încheie meditația și dă-mi tema</button>
      </div>

    </div>
  );
}

function PlanTab({ st, busy, onLesson, onExercises, onReset, onFocusOpen }) {
  const plan = st.plan || {};
  const chapters = plan.chapters || [];
  const focus = st.focus;
  const focusIds = new Set((focus?.chapters || []).map((c) => c.id));
  return (
    <div>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: 0 }}>Planul tău de învățare</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={onFocusOpen}
              title="Pregătire pentru o lucrare sau un test din anumite capitole, cu dată limită">
              🎯 {focus ? 'Pregătirea pentru lucrare' : 'Pregătire pentru lucrare/test'}
            </button>
            <span style={{ fontWeight: 800, color: 'var(--navy)' }}>{plan.progress || 0}%</span>
          </div>
        </div>
        <div style={{ height: 12, background: 'var(--border)', borderRadius: 99, overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ height: '100%', width: `${plan.progress || 0}%`, background: 'linear-gradient(90deg, var(--gold), #27ae60)', borderRadius: 99, transition: 'width .5s' }} />
        </div>
        <div style={{ fontSize: '.83rem', color: 'var(--text-light)' }}>
          🎯 Obiectivul săptămânal: <strong>{plan.weeklyGoal?.chapters || 2} capitole</strong>, ~{plan.weeklyGoal?.exercises || 20} exerciții, ~{plan.weeklyGoal?.minutes || 180} minute.
          {plan.estWeeks ? <> · Timp estimat pentru tot planul: <strong>~{plan.estWeeks} săptămâni</strong>.</> : null}
        </div>
        {focus && (
          <div style={{ fontSize: '.83rem', color: '#8e44ad', marginTop: 6 }}>
            🎯 Recapitulare pentru <strong>{focus.kindLabel}</strong>: {focus.done}/{focus.total} capitole (marcate mai jos)
            {focus.deadline && !focus.overdue ? <> · până pe <strong>{roDate(focus.deadline)}</strong>{focus.daysLeft != null ? ` (${focus.daysLeft} ${focus.daysLeft === 1 ? 'zi' : 'zile'})` : ''}</> : null}
            {focus.perWeek != null ? <> · ritm necesar ~{focus.perWeek}/săptămână</> : null}.
          </div>
        )}
      </div>

      {chapters.map((c, i) => {
        const stl = STATUS_LABELS[c.status] || STATUS_LABELS.de_parcurs;
        const inFocus = focusIds.has(c.id);
        return (
          <div key={c.id} style={{ ...card, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', ...(inFocus ? { borderColor: 'rgba(142,68,173,.45)', background: 'rgba(142,68,173,.03)' } : {}) }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: c.status === 'finalizat' ? '#27ae60' : 'var(--navy)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '.85rem', flexShrink: 0 }}>
              {c.status === 'finalizat' ? '✓' : i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.95rem' }}>{c.title}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                <span style={chip(stl.bg, stl.color)}>{stl.label}</span>
                {inFocus && <span style={chip('rgba(142,68,173,.12)', '#8e44ad')} title="Capitol din pregătirea pentru lucrare/test">🎯 pentru lucrare</span>}
                {c.mastery != null && <span style={{ fontSize: '.76rem', color: 'var(--text-muted)' }}>stăpânire {Math.round(c.mastery * 100)}%</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={() => onLesson(c.id)}>📖 Teorie</button>
              <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => onExercises(c.id)}>✍️ Exerciții</button>
            </div>
          </div>
        );
      })}

      <button onClick={onReset} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '.78rem', textDecoration: 'underline', cursor: 'pointer', marginTop: 6 }}>
        Reia evaluarea inițială de la zero
      </button>
    </div>
  );
}

// Stările unei teme: de rezolvat → FINALIZATĂ (toate problemele) sau
// INCOMPLETĂ („🏁 Finalizează tema" fără toate problemele). Orice temă se
// poate RELUA oricând; una neterminată nu blochează primirea altora.
function HomeworkTab({ st, busy, onOpen, onAsk }) {
  // de rezolvat → incomplete → finalizate (în fiecare grup, cele mai noi primele)
  const hw = [...(st.homework || [])].sort((a, b) => HW_STATE_RANK[hwState(a)] - HW_STATE_RANK[hwState(b)]);
  const counts = hw.reduce((acc, h) => { acc[hwState(h)] = (acc[hwState(h)] || 0) + 1; return acc; }, {});
  return (
    <div>
      <div style={{ ...card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)' }}>Temele tale de la Profesorul Virtual</div>
          <div style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>
            Întâi primești exerciții din site; când le termini, îți generez altele pe nivelul tău. Le corectez, le notez și îți explic greșelile.
            Poți <strong>finaliza o temă și fără toate problemele</strong> (se înregistrează ca <em>incompletă</em>), o <strong>reiei oricând</strong>, iar o temă neterminată nu te împiedică să primești altele.
          </div>
          {hw.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <span style={chip('rgba(232,185,49,.18)', '#8a6d1a')}>📌 De rezolvat: {counts.pending || 0}</span>
              <span style={chip('rgba(230,126,34,.14)', '#b9590f')}>◐ Incomplete: {counts.incomplete || 0}</span>
              <span style={chip('rgba(39,174,96,.12)', '#1e7e34')}>🏁 Finalizate: {counts.complete || 0}</span>
            </div>
          )}
        </div>
        <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={onAsk}>{busy === 'homework' ? '...' : '➕ Dă-mi o temă acum'}</button>
      </div>
      {hw.length === 0 && <div style={card}><p style={{ color: 'var(--text-muted)', fontSize: '.9rem', margin: 0 }}>Încă nu ai teme. Cere una acum sau așteaptă — profesorul îți dă teme pe măsură ce lucrați împreună.</p></div>}
      {hw.map((h) => {
        const state = hwState(h);
        const fb = h.feedback || {};
        const hasScore = h.max_score != null && h.max_score > 0;
        return (
          <div key={h.id} style={{ ...card, padding: '14px 18px', ...(state === 'incomplete' ? { borderColor: 'rgba(230,126,34,.45)' } : {}) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.93rem' }}>
                  {h.kind === 'content' ? '🧩' : '📚'} {h.title}
                </div>
                <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 3 }}>
                  {h.kind === 'content' ? 'Exercițiu interactiv din site' : 'Set pregătit de profesor'} · dată pe {new Date(h.assigned_at).toLocaleDateString('ro-RO')}
                  {h.due_at && state === 'pending' ? ` · termen ${new Date(h.due_at).toLocaleDateString('ro-RO')}` : ''}
                  {state !== 'pending' && h.completed_at ? ` · finalizată pe ${new Date(h.completed_at).toLocaleDateString('ro-RO')}` : ''}
                </div>
                {state === 'complete' && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={chip('rgba(39,174,96,.12)', '#1e7e34')}>🏁 Temă finalizată{hasScore ? ` · ${h.score}/${h.max_score}` : ''}</span>
                    {fb.grade != null && <span style={chip('rgba(232,185,49,.18)', '#8a6d1a')}>Nota {fb.grade}</span>}
                  </div>
                )}
                {state === 'incomplete' && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={chip('rgba(230,126,34,.14)', '#b9590f')}>
                      ◐ Temă incompletă{fb.total ? ` · ${fb.answered ?? 0}/${fb.total} probleme rezolvate` : h.kind === 'content' ? ' · închisă fără scor' : ''}{hasScore ? ` · ${h.score}/${h.max_score} corecte` : ''}
                    </span>
                    {fb.grade != null && <span style={chip('rgba(232,185,49,.18)', '#8a6d1a')}>Nota {fb.grade}</span>}
                    <span style={{ fontSize: '.76rem', color: 'var(--text-muted)' }}>o poți relua oricând — nu blochează alte teme</span>
                  </div>
                )}
                {state === 'pending' && h.draftAnswered > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <span style={chip('rgba(52,152,219,.12)', '#1f6dab')}>💾 Ciornă salvată · {h.draftAnswered} {h.draftAnswered === 1 ? 'răspuns' : 'răspunsuri'}</span>
                  </div>
                )}
              </div>
              {state === 'pending'
                ? <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => onOpen(h)}>{h.draftAnswered > 0 ? '▶ Continuă' : '▶ Rezolvă'}</button>
                : state === 'incomplete'
                  ? <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => onOpen(h)} title="Continuă problemele rămase — răspunsurile date sunt păstrate">↺ Reia tema</button>
                  : <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={() => onOpen(h)} title="Încercare nouă la o temă finalizată">↺ Reia</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ReviewsTab({ st, busy, onReview }) {
  const due = st.dueReviews || [];
  return (
    <div>
      <div style={card}>
        <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 4 }}>Repetiția inteligentă</div>
        <p style={{ fontSize: '.85rem', color: 'var(--text-light)', margin: 0 }}>
          După fiecare capitol finalizat revin cu recapitulări scurte: <strong>după 1 zi → după 7 zile → după 30 de zile</strong>.
          Așa creierul fixează materia pe termen lung și nu o mai uiți. 🧠
        </p>
      </div>
      {due.length === 0 ? (
        <div style={card}><p style={{ color: 'var(--text-muted)', fontSize: '.9rem', margin: 0 }}>Nimic de recapitulat azi. 🎉 Finalizează capitole din plan și recapitulările apar aici la momentul potrivit (te anunț și la clopoțel).</p></div>
      ) : due.map((r) => (
        <div key={r.id} style={{ ...card, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.93rem' }}>{r.chapterTitle}</div>
            <div style={{ fontSize: '.76rem', color: 'var(--text-muted)', marginTop: 3 }}>
              Etapa {r.stage + 1}/3 · {r.stage === 0 ? 'recapitularea de a doua zi' : r.stage === 1 ? 'recapitularea de după o săptămână' : 'recapitularea de după o lună'}
              {' · începe cu exercițiile la care ai greșit'}
            </div>
          </div>
          <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => onReview(r.id, r.chapterTitle)}>{busy === 'review' ? '...' : '▶ Începe (5 întrebări)'}</button>
        </div>
      ))}
    </div>
  );
}

// ─── „Raportul meditatorului" — ce are elevul de lucrat, pe scurt (rolldown) ─
function RaportTab({ st, busy, onOpenHomework, onRemediation, onStyle }) {
  const pendingHw = (st.homework || []).filter((h) => hwState(h) === 'pending');
  const incompleteHw = (st.homework || []).filter((h) => hwState(h) === 'incomplete');
  const mistakes = st.openMistakes || [];
  const styles = ['mai simplu, cu cuvinte de zi cu zi', 'vizual, cu desene și scheme', 'prin exemple din viața reală', 'pas cu pas, foarte mărunt'];
  const preferred = st.profile?.memory?.preferredStyle;
  const roll = { ...card, padding: '14px 18px' };
  const sum = { cursor: 'pointer', fontWeight: 700, color: 'var(--navy)', fontSize: '.95rem', fontFamily: 'var(--font-display)' };
  return (
    <div>
      {/* Teme nefăcute */}
      <details style={roll} open={pendingHw.length > 0 || incompleteHw.length > 0}>
        <summary style={sum}>📚 Teme nefăcute {pendingHw.length ? `(${pendingHw.length})` : '— niciuna 🎉'}{incompleteHw.length ? ` · ◐ incomplete (${incompleteHw.length})` : ''}</summary>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pendingHw.length === 0 && <span style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>Ești la zi cu temele. Bravo!</span>}
          {pendingHw.map((h) => (
            <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f7f9fc', borderRadius: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <span style={{ fontSize: '.88rem', fontWeight: 600, color: 'var(--navy)' }}>{h.kind === 'content' ? '🧩' : '📚'} {h.title}</span>
                <span style={{ display: 'block', fontSize: '.74rem', color: 'var(--text-muted)' }}>{h.due_at ? `termen ${new Date(h.due_at).toLocaleDateString('ro-RO')}` : ''}{h.draftAnswered > 0 ? ` · ciornă: ${h.draftAnswered} răspunsuri` : ''}</span>
              </div>
              <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => onOpenHomework(h)}>{h.draftAnswered > 0 ? '▶ Continuă' : '▶ Rezolvă'}</button>
            </div>
          ))}
          {/* finalizate INCOMPLET — nu sunt „nefăcute", dar se pot relua oricând */}
          {incompleteHw.length > 0 && (
            <>
              <div style={{ fontSize: '.8rem', fontWeight: 700, color: '#b9590f', marginTop: 4 }}>◐ Finalizate incomplet — le poți relua oricând (nu blochează alte teme):</div>
              {incompleteHw.map((h) => (
                <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'rgba(230,126,34,.06)', borderRadius: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <span style={{ fontSize: '.88rem', fontWeight: 600, color: 'var(--navy)' }}>{h.kind === 'content' ? '🧩' : '📚'} {h.title}</span>
                    <span style={{ display: 'block', fontSize: '.74rem', color: 'var(--text-muted)' }}>
                      {h.feedback?.total ? `${h.feedback.answered ?? 0}/${h.feedback.total} probleme rezolvate` : 'închisă fără scor'}{h.feedback?.grade != null ? ` · nota ${h.feedback.grade}` : ''}
                    </span>
                  </div>
                  <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={() => onOpenHomework(h)}>↺ Reia tema</button>
                </div>
              ))}
            </>
          )}
        </div>
      </details>

      {/* Greșeli de vindecat */}
      <details style={roll} open={mistakes.length > 0}>
        <summary style={sum}>🩹 Greșeli de vindecat {mistakes.length ? `(${mistakes.length})` : '— niciuna 🎉'}</summary>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: '.78rem', color: 'var(--text-muted)', margin: 0 }}>La fiecare greșeală îți dau 10 exerciții de exact același tip, până stăpânești procedeul.</p>
          {mistakes.length === 0 && <span style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>Nimic de vindecat acum.</span>}
          {mistakes.slice(0, 6).map((m) => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#f7f9fc', borderRadius: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: '.78rem', fontWeight: 700, color: '#c0392b' }}>{ERROR_LABELS[m.error_type] || m.error_type}{m.topic ? ` · ${niceTopic(m.topic)}` : ''}</div>
                <div style={{ fontSize: '.82rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420 }}><MathText text={fixLatexClient(m.statement || '')} /></div>
              </div>
              <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={() => onRemediation(m.id)}>🔁 10 la fel</button>
            </div>
          ))}
        </div>
      </details>

      {/* Nota estimată */}
      <details style={roll}>
        <summary style={sum}>🎯 Nota estimată{st.prediction ? `: ${st.prediction.grade}` : ''}</summary>
        <div style={{ marginTop: 10 }}>
          {st.prediction ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ fontSize: '2rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--navy)', background: 'rgba(232,185,49,.15)', borderRadius: 12, padding: '8px 16px' }}>{st.prediction.grade}</div>
              <div style={{ flex: 1, minWidth: 220, fontSize: '.84rem', color: 'var(--text)' }}>
                Estimare {st.prediction.confidence} — din stăpânirea subiectelor, teme și simulări.
                {st.prediction.weakChapters?.length ? <div style={{ marginTop: 4 }}><strong>Pentru o notă mai mare:</strong> {st.prediction.weakChapters.join('; ')}.</div> : null}
              </div>
            </div>
          ) : <span style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>Apare după primele seturi rezolvate, teme și simulări.</span>}
        </div>
      </details>

      {/* Cum să îți explic */}
      <details style={roll}>
        <summary style={sum}>💡 Cum să îți explic{preferred ? `: ${preferred}` : ''}</summary>
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {styles.map((sName) => (
              <button key={sName} disabled={!!busy} onClick={() => onStyle(sName)} style={{
                border: `1px solid ${preferred === sName ? 'var(--gold)' : 'var(--border)'}`,
                background: preferred === sName ? 'rgba(232,185,49,.15)' : '#fff',
                color: 'var(--navy)', borderRadius: 18, padding: '6px 12px', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer',
              }}>{preferred === sName ? '✓ ' : ''}{sName}</button>
            ))}
          </div>
          <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>Țin minte alegerea ta și explic mereu așa — în lecții, la exerciții și în conversație.</p>
        </div>
      </details>
    </div>
  );
}

// ─── „Progresul meu" — stăpânire + REZULTATELE la temele și testele rezolvate ─
function ProgressMeTab({ st }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null); // testele din site rezolvate (progress)
  useEffect(() => {
    aiClient.progress().then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const { data: rows } = await supabase.from('progress')
          .select('content_id, score, max_score, attempts, completed_at, test_title')
          .eq('user_id', user.id).order('completed_at', { ascending: false }).limit(30);
        setResults(rows || []);
      } catch { setResults([]); }
    })();
  }, [user?.id]);
  const masteryColor = (m) => (m >= 0.75 ? '#27ae60' : m >= 0.4 ? '#e8b931' : '#e74c3c');
  const p = st.profile || {};
  // temele FINALIZATE — complet sau incomplet (cele incomplete, cu eticheta lor)
  const hwDone = (st.homework || []).filter((h) => hwState(h) !== 'pending');
  const doneSessions = (st.sessions || []).filter((s) => s.status === 'finalizata' && s.max_score && !s.site && s.kind !== 'evaluare');
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12, marginBottom: 18 }}>
        {[
          ['Plan parcurs', `${st.plan?.progress ?? 0}%`],
          ['Timp de studiu', fmtMin(p.totalSeconds)],
          ['Zile la rând', `${p.streakDays || 0} 🔥`],
          ['Nota estimată', st.prediction ? st.prediction.grade : '—'],
        ].map(([label, value]) => (
          <div key={label} style={{ background: 'var(--navy)', color: '#fff', borderRadius: 'var(--radius-lg)', padding: 16 }}>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--gold)' }}>{value}</div>
            <div style={{ fontSize: '.78rem', opacity: 0.85 }}>{label}</div>
          </div>
        ))}
      </div>

      {error && <div style={{ ...card, background: '#fdecea', color: '#b71c1c' }}>⚠️ {error}</div>}
      {!data && !error && <div style={{ padding: 30, textAlign: 'center' }}><div className="spinner" /></div>}

      {/* Rezultatele la temele de la profesor + testele din site rezolvate — rolldown */}
      <details style={card} open={false}>
        <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--navy)', fontSize: '1.05rem' }}>
          📚 Rezultatele tale la teme și teste{(hwDone.length + doneSessions.length + (results || []).length) ? ` (${hwDone.length + doneSessions.length + (results || []).filter((r) => !hwDone.some((h) => h.content_id === r.content_id)).length})` : ''}
        </summary>
        <p style={{ fontSize: '.78rem', color: 'var(--text-muted)', margin: '8px 0 12px' }}>Aceleași rezultate le văd și profesorii/părinții asociați, în raportul lor.</p>
        {hwDone.length === 0 && (results || []).length === 0 && doneSessions.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '.88rem', margin: 0 }}>Încă nimic — rezolvă temele de la profesor și testele din site, iar rezultatele apar aici.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {hwDone.slice(0, 10).map((h) => {
              const pc = h.max_score ? Math.round((h.score / h.max_score) * 100) : 0;
              const incomplete = hwState(h) === 'incomplete';
              return (
                <div key={'hw-' + h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '7px 10px', background: 'rgba(232,185,49,.08)', border: '1px solid rgba(232,185,49,.4)', borderRadius: 8, fontSize: '.85rem', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--navy)', fontWeight: 600 }}>📚 Temă · {h.title}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{h.completed_at ? ` · ${new Date(h.completed_at).toLocaleDateString('ro-RO')}` : ''}</span>
                    {incomplete && <span style={{ marginLeft: 8, fontSize: '.74rem', fontWeight: 700, color: '#b9590f' }}>◐ incompletă{h.feedback?.total ? ` (${h.feedback.answered ?? 0}/${h.feedback.total} rezolvate)` : ''}</span>}
                  </span>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    {h.max_score
                      ? <strong style={{ color: masteryColor(pc / 100) }}>{h.score}/{h.max_score} ({pc}%)</strong>
                      : <span style={{ color: 'var(--text-muted)' }}>fără scor</span>}
                    {h.feedback?.grade != null && <span style={{ marginLeft: 8, fontWeight: 700, color: '#8a6d1a' }}>nota {h.feedback.grade}</span>}
                  </span>
                </div>
              );
            })}
            {/* Seturile lucrate CU profesorul (exerciții/recapitulări/simulări
                generate) — cele „din site" apar mai jos, cu titlul testului */}
            {doneSessions.slice(0, 10).map((s) => {
                const pc = Math.round((s.score / s.max_score) * 100);
                const icons = { exercitii: '✍️ Exerciții', remediere: '🩹 Remediere', recapitulare: '🔁 Recapitulare', simulare: '🎯 Simulare', tema: '📚 Temă' };
                return (
                  <div key={'ss-' + s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '7px 10px', background: '#f7f9fc', borderRadius: 8, fontSize: '.85rem', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--navy)', fontWeight: 600 }}>{icons[s.kind] || '✍️ Set'}{s.topic ? ` · ${EXAM_LABELS[s.topic] || niceTopic(s.topic)}` : ''}
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{s.completed_at ? ` · ${new Date(s.completed_at).toLocaleDateString('ro-RO')}` : ''}</span>
                    </span>
                    <strong style={{ color: masteryColor(pc / 100), whiteSpace: 'nowrap' }}>{s.score}/{s.max_score} ({pc}%)</strong>
                  </div>
                );
              })}
            {(results || []).filter((r) => !hwDone.some((h) => h.content_id === r.content_id)).slice(0, 10).map((r, i) => {
              const pc = r.max_score ? Math.round((r.score / r.max_score) * 100) : 0;
              return (
                <div key={'pr-' + r.content_id + i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '7px 10px', background: '#f7f9fc', borderRadius: 8, fontSize: '.85rem', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--navy)', fontWeight: 600 }}>🧩 {r.test_title || 'Test interactiv'}
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{r.completed_at ? ` · ${new Date(r.completed_at).toLocaleDateString('ro-RO')}` : ''} · {r.attempts || 1} încercări</span>
                  </span>
                  <strong style={{ color: masteryColor(pc / 100), whiteSpace: 'nowrap' }}>{r.score}/{r.max_score} ({pc}%)</strong>
                </div>
              );
            })}
          </div>
        )}
      </details>

      {data && (
        <details style={card} open={false}>
          <summary style={{ cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--navy)', fontSize: '1.05rem' }}>
            📈 Stăpânirea pe subiecte{(data.mastery || []).length ? ` (${data.mastery.length})` : ''}
          </summary>
          <div style={{ height: 12 }} />
          {(data.mastery || []).length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '.9rem', margin: 0 }}>Încă nu ai date — rezolvă seturi de exerciții și progresul apare aici, subiect cu subiect.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data.mastery.map((m) => (
                <div key={m.category + m.topic}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: 'var(--navy)' }}>{niceTopic(m.topic)} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {m.category}</span></span>
                    <span style={{ color: 'var(--text-muted)' }}>{Math.round(m.mastery * 100)}% · {m.correct}/{m.attempts}</span>
                  </div>
                  <div style={{ height: 8, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round(m.mastery * 100)}%`, background: masteryColor(m.mastery), borderRadius: 99, transition: 'width .4s' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </details>
      )}

      {st.prediction?.weakChapters?.length > 0 && (
        <div style={{ ...card, background: 'rgba(232,185,49,.08)', borderColor: 'var(--gold)' }}>
          <strong style={{ color: 'var(--navy)', fontSize: '.9rem' }}>🎯 Pentru o notă mai mare, consolidează:</strong>
          <div style={{ fontSize: '.88rem', color: 'var(--text)', marginTop: 6 }}>{st.prediction.weakChapters.join(' · ')}</div>
        </div>
      )}
    </div>
  );
}

function SimTab({ st, busy, onSimulare, onFocusTest }) {
  const navigate = useNavigate();
  const sims = (st.sessions || []).filter((s) => s.kind === 'simulare' && s.status === 'finalizata');
  const examLabel = EXAM_LABELS[st.examType] || 'examen';
  const focus = st.focus;

  // Pagina din site cu exercițiile NIVELULUI elevului (stabilit la înscriere):
  // EN → /evaluare-nationala · BAC → /bacalaureat/<profilul lui> · fără examen
  // → /clase/<clasa lui>. Butoanele „alege din baza de date" duc AICI, pe tabul
  // potrivit (interactive / PDF) — elevul vede doar exercițiile nivelului lui.
  const ex = st.profile?.examTarget;
  const levelPath = ex === 'evaluare-nationala' ? '/evaluare-nationala'
    : ex === 'bac-mate-info' ? '/bacalaureat/mate-info'
    : ex === 'bac-stiinte' ? '/bacalaureat/stiinte-naturii'
    : ex === 'bac-tehnologic' ? '/bacalaureat/tehnologic'
    : `/clase/${st.profile?.grade || 8}`;
  const levelLabel = ex ? (EXAM_LABELS[ex] || 'examen') : `clasa a ${st.profile?.grade || 8}-a`;

  const [pdfMode, setPdfMode] = useState(null); // null | 'ai' — meniul de generare PDF cu AI

  return (
    <div>
      {/* ── Testul lucrării (pregătirea pe capitole activă) ── */}
      {focus && (
        <div style={{ ...card, borderLeft: '4px solid #8e44ad' }}>
          <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.02rem', marginBottom: 4 }}>🧩 Test de verificare · {focus.kindLabel}</div>
          <p style={{ fontSize: '.86rem', color: 'var(--text-light)', marginBottom: 10 }}>
            Un test DOAR din capitolele pregătirii tale ({focus.chapters.map((c) => c.title).join(' · ')})
            {focus.deadline && !focus.overdue ? <> — testul tău e pe <strong>{roDate(focus.deadline)}</strong></> : null}.
            Întâi caut un test potrivit în site; dacă nu găsesc, îl generez.
          </p>
          <button className="btn btn-primary" disabled={!!busy} onClick={onFocusTest}>
            {busy === 'simulare' ? 'Pregătesc testul...' : '🧩 Dă-mi testul de verificare'}
          </button>
        </div>
      )}

      {/* ── Simulare interactivă: 1) alege din baza de date · 2) generează nou ── */}
      <div style={{ ...card, borderLeft: '4px solid var(--navy)' }}>
        <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1.05rem', marginBottom: 4 }}>🎯 Simulare interactivă · {examLabel}</div>
        <p style={{ fontSize: '.86rem', color: 'var(--text-light)', marginBottom: 12 }}>
          <strong>Alege un test din baza de date a site-ului</strong> — se deschide pagina cu testele pentru <strong>{levelLabel}</strong> —
          sau cere-mi să îți <strong>generez unul nou</strong> în stilul subiectelor oficiale, cu <strong>punctele tale slabe incluse</strong>.
          Rezultatul se înregistrează și îl văd și părinții/profesorii tăi.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={!!busy} onClick={() => navigate(levelPath, { state: { returnTab: 'interactive' } })}>
            📚 Alege din baza de date a site-ului
          </button>
          <button className="btn btn-outline" disabled={!!busy} onClick={() => onSimulare(true)}>
            {busy === 'simulare' ? 'Generez simularea...' : '✨ Generează nou'}
          </button>
        </div>

        {sims.length > 0 && (
          <div style={{ marginTop: 14, fontSize: '.83rem', color: 'var(--text)' }}>
            <strong>Simulările tale:</strong>{' '}
            {sims.slice(0, 5).map((s, i) => (
              <span key={s.id} style={{ marginRight: 8 }}>
                {new Date(s.created_at).toLocaleDateString('ro-RO')}: <strong>{s.max_score ? Math.round((s.score / s.max_score) * 100) : 0}%</strong>{i < Math.min(sims.length, 5) - 1 ? ' ·' : ''}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Subiect PDF: 1) alege din baza de date · 2) generează cu AI ── */}
      <details style={{ ...card }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, color: 'var(--navy)' }}>📄 Vreau un subiect de examen PDF (ca la examen, cu barem)</summary>
        <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', margin: '8px 0 12px' }}>
          Alege un subiect PDF gata pregătit — se deschide pagina cu subiectele pentru <strong>{levelLabel}</strong> — sau generează
          unul nou cu AI: document tipăribil, cu variantă de elev și barem.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button className="btn btn-primary" onClick={() => navigate(levelPath, { state: { returnTab: 'pdf' } })}>
            📚 Alege PDF din baza de date
          </button>
          <button className={pdfMode === 'ai' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setPdfMode((m) => (m === 'ai' ? null : 'ai'))}>
            ✨ Generează subiect nou cu AI
          </button>
        </div>
        {pdfMode === 'ai' && <ExamGenerator />}
      </details>
    </div>
  );
}
