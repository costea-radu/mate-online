// =====================================================================
// src/components/BoardQuestion.jsx — ÎNTREBAREA pusă DIRECT PE TABLĂ
//
// Ca la meditațiile live: grilă (a–d) sau răspuns de completat, cu
// verdictul imediat, răspunsul corect și explicația pe scurt. Profesorul
// citește întrebarea (subtitrare + voce) când apare și spune verdictul.
// Răspunsul se verifică în browser (tabla.js → checkAnswer: „1/2" = „0,5",
// „x = 4" = „4", „2√3" = „2\sqrt{3}") — e o întrebare de verificare, nu o notă.
//   answered = { answer, correct } — starea o ține părintele (rămâne pe tablă)
// =====================================================================
import { useEffect, useRef } from 'react';
import { PollCard } from './live/PollCard';
import { questionPlan, checkAnswer, answerText, verdictSpeech } from '../lib/tabla';

export default function BoardQuestion({ q, id = null, answered = null, onAnswer, onNext = null, nextLabel = 'Mai departe →',
  extra = null, speaker = null, speakKey = 'intrebare', autoSpeak = true, teacherName = 'Prof. Tudor' }) {
  const spoke = useRef(false);
  useEffect(() => {
    if (!q || answered || !autoSpeak || !speaker || spoke.current) return;
    spoke.current = true;
    // dacă tocmai vorbește despre altceva (ex. răspunde în conversație), întrebarea vine după
    speaker.say(questionPlan(q), { key: speakKey, queue: speaker.isBusy() && !speaker.isBusy(speakKey) });
  }, [q, answered, autoSpeak, speaker, speakKey]);
  if (!q) return null;
  const poll = { id: id || q.q, type: q.type, question: q.q, options: q.options };
  // câmpul de completat primește cursorul singur doar pe calculator (pe telefon ar
  // deschide tastatura peste întrebare) și doar la întrebările noi, nu din istoric
  let coarse = false;
  try { coarse = !!window.matchMedia?.('(pointer: coarse)').matches; } catch { /* ignore */ }
  return (
    <div className="bd-q">
      <PollCard poll={poll} teacherName={teacherName} privat
        kicker={`📝 ${teacherName} întreabă`}
        mine={answered ? { answer: answered.answer } : null}
        verdict={answered ? { correct: answered.correct, answer: q.answer } : null}
        explain={answered ? (q.explain || null) : null}
        answerLabel={answerText(q)}
        extra={answered ? extra : null}
        nextLabel={nextLabel}
        onNext={answered ? onNext : null}
        autoFocus={autoSpeak && !coarse}
        onSubmit={async (a) => {
          const correct = checkAnswer(q, a);
          onAnswer?.({ answer: a, correct });
          speaker?.say(verdictSpeech(q, correct), { key: speakKey });
        }} />
    </div>
  );
}
