import { authHeaders } from '../lib/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { aiClient } from '../lib/aiClient';
import { ChatPanel, TutorFab } from '../components/AITutor';
import { injectTutorBridge } from '../lib/tutorBridge';
import { awardBadges } from '../lib/badges';
import { arenaChanged } from '../lib/arena';
import { notaDinScor } from '../lib/nota';
import TestModeBadge from '../components/TestModeBadge';
import EinsteinIcon from '../components/EinsteinIcon';
import { ReviewToast } from '../components/ReviewWidget';

export default function InteractiveViewer() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { isPremium, isAdmin, user, loading: authLoading } = useAuth();
  const [srcDoc, setSrcDoc] = useState(state?.srcDoc || null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scoreSaved, setScoreSaved] = useState(false);
  const [savedScore, setSavedScore] = useState(null);
  const [saveError, setSaveError] = useState(null); // eroarea de salvare devine VIZIBILĂ
  const [iframeKey, setIframeKey] = useState(0); // se incrementează → exercițiul se reîncarcă de la zero
  const startedAtRef = useRef(Date.now());
  const iframeRef = useRef(null);
  const realScoreAtRef = useRef(0);
  const lastAnswersRef = useRef(null); // răspunsurile citite din pagină (bridge)   // când a sosit ultimul MATE_SCORE autentic
  const hintTimerRef = useRef(null);  // hint în așteptare (plasa de siguranță)

  // ─── Profesorul Virtual lângă exercițiu ───────────────────────────────────
  const [tutorOpen, setTutorOpen] = useState(!!state?.openTutor);   // deschis din chat → rămâne deschis
  const tutorConvId = state?.tutorConvId || null;                    // conversația continuă
  const [exState, setExState] = useState(null);                     // starea live din exercițiu (bridge)
  const [autoPrompt, setAutoPrompt] = useState(null);                // mesaj trimis automat în chat
  const [newBadges, setNewBadges] = useState([]);                    // insigne proaspăt câștigate (toast)
  const [xpToast, setXpToast] = useState(null);                       // XP / streak / misiune câștigate (Arena)
  const [duelRez, setDuelRez] = useState(null);                       // rezultatul duelului, după trimiterea scorului
  const [reviewOpen, setReviewOpen] = useState(false);               // „Cum ți s-a părut testul?" (după scor salvat)
  const reviewAskedRef = useRef(new Set());                          // testele pentru care am întrebat deja (în această vizită)
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 800);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 800);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Înălțimea panoului pe mobil (% din ecran) — se trage de bara albastră
  const [panelPct, setPanelPct] = useState(48);
  const dragBar = useRef(null);
  function barDown(e) {
    if (!isMobile) return;
    dragBar.current = { y: e.clientY, pct: panelPct };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  }
  function barMove(e) {
    const d = dragBar.current;
    if (!d) return;
    e.preventDefault();
    const pct = d.pct - ((e.clientY - d.y) / window.innerHeight) * 100;
    setPanelPct(Math.max(22, Math.min(90, pct)));
  }
  function barUp(e) {
    if (!dragBar.current) return;
    dragBar.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }

  const [searchParams] = useSearchParams();
  const idParam = searchParams.get('id');
  const temaId = searchParams.get('temaId'); // deschis ca TEMĂ de la Meditatorul AI
  const gtId = searchParams.get('gt');       // TEMĂ PE GRUPĂ (/tema-grupa): repartizarea acestui elev
  const medSesId = searchParams.get('medSesId'); // sesiune „site-first" de la Meditator (exerciții/simulare din site)
  const duelId = searchParams.get('duel');   // DUEL 1-la-1 (/arena): rezultatul intră în duel
  // În duel, ca și la testul pe grupă, Profesorul Virtual e închis: altfel
  // duelul ar măsura cine știe să întrebe tutorele, nu cine știe matematică.
  const faraAjutor = !!gtId || !!duelId;
  const [hwMarked, setHwMarked] = useState(null); // { grade } — tema bifată
  const [medMarked, setMedMarked] = useState(null); // { pct } — sesiunea de meditații bifată
  const [hwFinalizing, setHwFinalizing] = useState(false); // „🏁 Finalizează tema" în curs
  const [hwError, setHwError] = useState(null);
  const [item, setItem] = useState(state?.item || null);
  // „Grant": deschide un material PREMIUM pentru un elev fără abonament, când
  // adminul a trimis tema pe grupă cu opțiunea „testele premium gratuit".
  const [grant, setGrant] = useState(state?.grant || null);

  // „🏁 Finalizează tema" (temă DIN SITE de la Meditator): cu scor salvat tema
  // e deja bifată → înapoi la meditații; fără scor se înregistrează ca TEMĂ
  // INCOMPLETĂ (nu mai e „nefăcută", nu blochează alte teme, se reia oricând).
  async function finalizeHomework() {
    if (!temaId) return;
    if (hwMarked) { navigate('/meditatii?tab=teme'); return; }
    const ok = window.confirm(
      'Finalizezi tema fără să fi apăsat „Verifică/Corectează"?\n\n' +
      'Se înregistrează ca TEMĂ INCOMPLETĂ — o poți relua oricând din Meditații → Teme, iar o temă neterminată nu te împiedică să primești altele.'
    );
    if (!ok) return;
    setHwFinalizing(true); setHwError(null);
    try {
      const r = await aiClient.meditatii({ action: 'homework_finalize', id: temaId });
      if (r?.complete) setHwMarked({ grade: r.grade });
      navigate('/meditatii?tab=teme');
    } catch (e) {
      setHwError(e.message || 'Tema nu s-a putut finaliza — mai încearcă.');
    } finally { setHwFinalizing(false); }
  }

  // Deschidere directă prin link ?id= (din chat/notificări): aducem materialul.
  useEffect(() => {
    if (!idParam) return;
    if (item && item.id === idParam) return; // deja încărcat exact acest material
    setSrcDoc(null); // curăță exercițiul vechi (ex. link intern din tutor către alt ?id=)
    (async () => {
      const { data } = await supabase.from('content').select('*').eq('id', idParam).single();
      if (data) { setItem(data); return; }
      // Temă pe grupă cu material premium dat gratuit: RLS nu-i lasă elevului
      // rândul din `content`, deci îl aducem de pe server (cu grant).
      if (gtId) {
        try {
          const r = await aiClient.groupAssignmentPick({ pickId: gtId });
          if (r?.target?.item) { setItem(r.target.item); setGrant(r.target.grant || null); return; }
        } catch { /* cade pe mesajul de mai jos */ }
      }
      setError('Materialul nu a fost găsit.'); setLoading(false);
    })();
  }, [idParam]); // eslint-disable-line

  // Resetează cronometrul când se încarcă alt exercițiu
  useEffect(() => { startedAtRef.current = Date.now(); }, [item?.id]);

  function goBack() {
    if (state?.returnTo) {
      navigate(state.returnTo, { state: { scrollToCardId: state.scrollToCardId, returnTab: state.returnTab, returnSubcategory: state.returnSubcategory, returnContentType: state.returnContentType } });
    } else {
      navigate(-1);
    }
  }

  // DUEL: cronometrul pornește pe server la prima deschidere a exercițiului.
  // (Durata nu se mai trimite din browser — altfel oricine ar câștiga
  // egalitățile cu „am rezolvat în 1 secundă".)
  useEffect(() => {
    if (!duelId || !user) return;
    aiClient.duel({ action: 'start', id: duelId }).catch(() => {});
  }, [duelId, user]);

  // ─── Salvare progres primit de la iframe ────────────────────────────────────
  useEffect(() => {
    async function saveScore(score, maxScore, answers = null) {
      if (typeof score !== 'number' || typeof maxScore !== 'number') return;
      if (!user || !item) return;
      // răspunsurile elevului (din mesajul testului sau citite din pagină de
      // bridge): serverul RECALCULEAZĂ scorul din cheile materialului (Etapa 3)
      const raw = Array.isArray(answers) && answers.length ? answers : lastAnswersRef.current;
      const ans = Array.isArray(raw) && raw.length ? raw.slice(0, 60) : null;

      // TEMĂ de la Meditatorul AI (deschisă cu ?temaId=...): se bifează DIRECT
      // pe server, independent de salvarea în `progress` — drumul sigur.
      if (temaId) {
        aiClient.meditatii({ action: 'homework_score', id: temaId, score, maxScore, answers: ans })
          .then((r) => { if (r?.ok) setHwMarked({ grade: r.grade }); })
          .catch(() => {});
      }

      // TEMĂ PE GRUPĂ (deschisă cu ?gt=...): rezultatul intră direct în raportul
      // profesorului, lângă testul repartizat acestui elev.
      if (gtId) aiClient.groupAssignmentScore({ pickId: gtId, score, maxScore }).catch(() => {});

      // Sesiune „site-first" de la Meditator (exerciții/simulare cu test din
      // site): rezultatul intră în planul de meditații, predicția notei și
      // rapoartele pentru părinți/profesori.
      if (medSesId) {
        aiClient.meditatii({ action: 'session_score', id: medSesId, score, maxScore, answers: ans })
          .then((r) => { if (r?.ok) setMedMarked({ pct: r.pct }); })
          .catch(() => {});
      }

      // Timpul petrecut în această sesiune (secunde) + cumulul anterior
      const sessionSeconds = Math.max(0, Math.round((Date.now() - startedAtRef.current) / 1000));

      // 1) Drumul sigur (Etapa 3): serverul verifică răspunsurile (când le are)
      //    și scrie `progress` cu rolul de serviciu; fără răspunsuri (teste
      //    încărcate manual) salvează scorul trimis, plafonat
      {
        try {
          const r = await aiClient.scoreSubmit({ contentId: item.id, answers: ans, score, maxScore, durationSec: sessionSeconds, duelId });
          if (r?.ok) {
            setScoreSaved(true);
            setSavedScore({ score: r.score, maxScore: r.maxScore, verified: !!r.verified });
            setSaveError(null);
            startedAtRef.current = Date.now();
            aiClient.meditatii({ action: 'homework_check' }).catch(() => {});
            // Arena: XP, serie de zile, misiunea zilei, puncte de ligă
            if (r.xp && r.xp.xp > 0) { setXpToast(r.xp); arenaChanged(r.xp); }
            if (duelId && r.duel) setDuelRez(r.duel);
            awardBadges(user.id, { score: r.score, maxScore: r.maxScore, attempts: r.attempts || 1, category: item.category })
              .then((earned) => { if (earned.length) setNewBadges(earned); })
              .catch(() => {});
            return;
          }
        } catch (e) {
          // serverul a respins scorul neverificat (pagină veche în cache):
          // NU îl salvăm pe drumul vechi — elevul reîncarcă și rezolvă din nou
          if (/verific/i.test(e?.message || '')) { setSaveError(e.message); return; }
          console.warn('ai-score indisponibil, salvez direct:', e?.message);
        }
      }

      // 2) Drumul vechi — doar dacă serverul nu a răspuns (scriere directă, RLS)
      try {
        // Citește înregistrarea existentă pentru a cumula încercări și timp
        let existing = null;
        try {
          const { data: ex } = await supabase
            .from('progress')
            .select('*')
            .eq('user_id', user.id)
            .eq('content_id', item.id)
            .maybeSingle();
          existing = ex || null;
        } catch { /* prima încercare */ }

        const attempts = (existing?.attempts || 0) + 1;
        const timeSpent = (existing?.time_spent || 0) + sessionSeconds;

        const base = {
          user_id: user.id,
          content_id: item.id,
          score,
          max_score: maxScore,
          completed_at: new Date().toISOString(),
          attempts,
        };
        // Snapshot: titlul/tipul/categoria testului se salvează ÎN rezultat,
        // ca rezultatul să rămână lizibil și DUPĂ ștergerea materialului
        // (supabase/pastreaza_rezultate.sql — fără el, coloanele lipsesc și
        // se reia salvarea fără snapshot).
        const snapshot = {
          test_title: item.title || null,
          content_type: item.content_type || null,
          category: item.category || null,
        };

        // Încearcă complet (snapshot + time_spent); dacă lipsesc coloane
        // (migrări nerulate), reia progresiv fără ele.
        let { error } = await supabase
          .from('progress')
          .upsert({ ...base, ...snapshot, time_spent: timeSpent }, { onConflict: 'user_id,content_id' });
        if (error) {
          const retry1 = await supabase
            .from('progress')
            .upsert({ ...base, time_spent: timeSpent }, { onConflict: 'user_id,content_id' });
          error = retry1.error;
        }
        if (error) {
          const retry2 = await supabase
            .from('progress')
            .upsert(base, { onConflict: 'user_id,content_id' });
          error = retry2.error;
        }

        if (!error) {
          setScoreSaved(true);
          setSavedScore({ score, maxScore });
          setSaveError(null);
          startedAtRef.current = Date.now(); // pregătește o eventuală reîncercare

          // Meditații: dacă exercițiul era TEMĂ de la Profesorul Virtual, se
          // bifează PE LOC „rezolvată" (nu abia la următoarea vizită pe /meditatii)
          aiClient.meditatii({ action: 'homework_check' }).catch(() => {});

          // Insigne: verifică dacă scorul aduce insigne noi (nu blocăm UI-ul)
          awardBadges(user.id, { score, maxScore, attempts, category: item.category })
            .then((earned) => { if (earned.length) setNewBadges(earned); })
            .catch(() => {});
        } else {
          console.error('Progress save error:', error);
          setSaveError(error.message || 'Scorul nu s-a putut salva.');
        }
      } catch (err) {
        console.error('Progress save error:', err);
        setSaveError(err.message || 'Scorul nu s-a putut salva.');
      }
    }

    function handleMessage(event) {
      // Acceptăm mesaje de la orice origine (iframe e încărcat din Supabase Storage)
      if (event.source === window || !event.data || typeof event.data !== 'object') return;
      const d = event.data;

      if (d.type === 'MATE_RESET_REQ') {
        // Butonul „Resetează" al testului nu a funcționat (unele variante de
        // BAC au funcția de reset defectă): resetăm noi — reîncărcăm exercițiul
        // de la zero (scor 0, răspunsuri goale), fără ca elevul să iasă din test.
        realScoreAtRef.current = 0;
        if (hintTimerRef.current) { clearTimeout(hintTimerRef.current); hintTimerRef.current = null; }
        startedAtRef.current = Date.now();
        setScoreSaved(false);
        setSavedScore(null);
        setSaveError(null);
        setIframeKey((k) => k + 1);
        return;
      }

      if (d.type === 'MATE_SCORE') {
        // Scorul autentic, trimis de codul testului — are întotdeauna prioritate.
        realScoreAtRef.current = Date.now();
        if (hintTimerRef.current) { clearTimeout(hintTimerRef.current); hintTimerRef.current = null; }
        saveScore(d.score, d.maxScore, d.answers);
        return;
      }

      if (d.type === 'MATE_SCORE_HINT') {
        // PLASA DE SIGURANȚĂ: unele teste au codul MATE_SCORE în fișier, dar nu
        // îl trimit la „Corectează". Bridge-ul citește atunci scorul din pagină
        // și trimite un HINT. Îl folosim DOAR dacă nu sosește un MATE_SCORE
        // autentic — altfel tema rămânea „nerezolvată" și părinții neanunțați.
        if (typeof d.score !== 'number' || typeof d.maxScore !== 'number' || d.maxScore <= 0) return;
        if (Date.now() - realScoreAtRef.current < 5000) return; // scor real deja primit
        if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
        hintTimerRef.current = setTimeout(() => {
          hintTimerRef.current = null;
          if (Date.now() - realScoreAtRef.current < 5000) return; // a sosit între timp
          saveScore(d.score, d.maxScore);
        }, 1200);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
      if (hintTimerRef.current) { clearTimeout(hintTimerRef.current); hintTimerRef.current = null; }
    };
  }, [user, item, temaId, medSesId]);

  // ─── Mesajele bridge-ului (exercițiu → tutor) ───────────────────────────────
  useEffect(() => {
    function onTutorMsg(event) {
      const d = event.data;
      if (event.source === window || !d || typeof d !== 'object') return;
      // răspunsurile elevului, citite din pagină de bridge (Etapa 3): serverul
      // recalculează scorul din ele, chiar dacă testul e un HTML mai vechi
      if (d.type === 'MATE_ANSWERS' && Array.isArray(d.answers)) { lastAnswersRef.current = d.answers; return; }
      if (d.type === 'MATE_TUTOR_STATE' && d.payload) setExState(d.payload);
      if (d.type === 'MATE_TUTOR_OPEN') {
        if (d.payload) setExState(d.payload);
        setTutorOpen(true);
        // „Întreabă profesorul virtual" → profesorul explică pasul curent natural,
        // pornind de la indicațiile exercițiului, fără să dea răspunsul.
        // Dacă elevul a apăsat „Ajutor" pe un exercițiu-grilă (Subiectul I/II),
        // bridge-ul trimite eticheta lui în payload.focus → mesajul îl numește exact.
        const focus = d.payload && d.payload.focus;
        setAutoPrompt({
          id: Date.now(),
          text: focus
            ? `Ajută-mă la ${focus}: explică-mi ce am de făcut și dă-mi un indiciu, fără să-mi spui răspunsul.`
            : 'Ajută-mă la pasul la care sunt acum: explică-mi ce am de făcut și dă-mi un indiciu, fără să-mi spui răspunsul.',
        });
      }
    }
    window.addEventListener('message', onTutorMsg);
    return () => window.removeEventListener('message', onTutorMsg);
  }, []);

  // Trimite o acțiune a AI-ului către exercițiu (completare răspuns / alegere grilă)
  function sendTutorAction(action) {
    try { iframeRef.current?.contentWindow?.postMessage({ type: 'MATE_TUTOR_ACTION', action }, '*'); } catch { /* noop */ }
  }

  // Insignele-toast dispar singure
  useEffect(() => {
    if (!newBadges.length) return;
    const t = setTimeout(() => setNewBadges([]), 7000);
    return () => clearTimeout(t);
  }, [newBadges]);

  // Toastul de XP dispare singur după 8 secunde
  useEffect(() => {
    if (!xpToast) return undefined;
    const t = setTimeout(() => setXpToast(null), 8000);
    return () => clearTimeout(t);
  }, [xpToast]);

  // ─── Recenzie după test ─────────────────────────────────────────────────────
  // La 1,5 s după ce scorul s-a SALVAT (deci există rândul din `progress` pe
  // care îl cere RLS-ul tabelului `reviews`), întrebăm o singură dată per test
  // „Cum ți s-a părut?" — card nemodal, stânga-sus (insignele stau dreapta-sus).
  // Dacă elevul îl închide fără notă, nu mai insistăm în această sesiune.
  const reviewSkipKey = item?.id ? `em_review_skip_${item.id}` : null;
  useEffect(() => {
    if (!scoreSaved || !savedScore || !user || !item?.id) return;
    if (reviewAskedRef.current.has(item.id)) return;
    try { if (reviewSkipKey && sessionStorage.getItem(reviewSkipKey)) return; } catch { /* ignore */ }
    // marcăm „întrebat" abia când cardul chiar apare: dacă scorul se salvează
    // de două ori în 1,5 s (dublu „Verifică"), cronometrul doar se reia
    const id = item.id;
    const t = setTimeout(() => { reviewAskedRef.current.add(id); setReviewOpen(true); }, 1500);
    return () => clearTimeout(t);
  }, [scoreSaved, savedScore, user, item?.id, reviewSkipKey]);
  useEffect(() => { setReviewOpen(false); }, [item?.id]);
  function closeReview() {
    setReviewOpen(false);
    try { if (reviewSkipKey) sessionStorage.setItem(reviewSkipKey, '1'); } catch { /* ignore */ }
  }

  // Contextul viu trimis Profesorului Virtual (starea exercițiului + nivelul)
  const tutorContext = useMemo(() => ({
    interactive: true,
    category: item?.category || null,
    contentId: item?.id || null,
    title: item?.title || null,
    exerciseText: exState?.text
      ? `Exercițiul „${item?.title || exState.title || ''}":\n${exState.text}`
      : (item?.title ? `Exercițiul „${item.title}" (elevul nu a început încă niciun pas).` : ''),
  }), [item, exState]);

  // HTML-ul exercițiului cu bridge-ul injectat (exercițiile din DB NU se modifică)
  const finalDoc = useMemo(() => (srcDoc ? injectTutorBridge(srcDoc) : null), [srcDoc]);

  useEffect(() => {
    if (authLoading) return;
    if (!item) { if (!idParam) navigate('/'); return; }

    // adminul are acces la orice material (altfel testarea temelor premium
    // dintr-un cont de admin fără abonament era respinsă tăcut → /preturi)
    const canAccess = item.is_free || isPremium || isAdmin || !!grant;
    if (!canAccess) { navigate('/preturi'); return; }

    // srcDoc direct din state (transmis de ContentPage)
    if (state?.srcDoc) {
      setLoading(false);
      return;
    }

    async function load() {
      try {
        // Semnăm TOT (gratuit + premium) prin get-file-url — merge și pe bucket
        // privat, deci nu mai depindem de URL-uri publice brute.
        const res = await fetch('/api/get-file-url', {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ contentId: item.id, grant }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Eroare server');
        const url = data.url;

        // Fetch cu XMLHttpRequest ca fallback pentru iOS Safari
        const html = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', url, true);
          xhr.responseType = 'text';
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
            else reject(new Error(`HTTP ${xhr.status}`));
          };
          xhr.onerror = () => reject(new Error('Eroare de rețea'));
          xhr.send();
        });
        setSrcDoc(html);
      } catch (err) {
        console.error('InteractiveViewer load error:', err);
        setError('Nu s-a putut încărca exercițiul. Încearcă din nou.');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [item, isPremium, authLoading, grant]);

  if (authLoading || loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f0f4f8', gap: 16 }}>
        <div className="spinner" />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Se încarcă exercițiul...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f0f4f8', gap: 16, textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: '3rem' }}>⚠️</div>
        <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)' }}>Eroare</h2>
        <p style={{ color: 'var(--text-muted)' }}>{error}</p>
        <button className="btn btn-primary" onClick={goBack}>← Înapoi</button>
      </div>
    );
  }

  const scorePct = savedScore ? Math.round((savedScore.score / savedScore.maxScore) * 100) : null;
  const scoreColor = scorePct >= 80 ? '#2e7d32' : scorePct >= 50 ? '#e65100' : '#c62828';
  // Nota cu 10 puncte din oficiu (testele care raportează „din 100" o au deja inclusă)
  const savedNota = savedScore ? notaDinScor(savedScore.score, savedScore.maxScore) : null;

  return (
    <div className="iv-root" style={{ display: 'flex', flexDirection: 'column', background: 'var(--navy-dark)' }}>
      {/* 100dvh pe mobil: altfel bara browserului taie câmpul de scris al chatului */}
      <style>{`.iv-root{height:100vh;height:100dvh}`}</style>
      {/* Bara de sus */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px', background: 'var(--navy)', flexShrink: 0,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={goBack}
            style={{
              background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff', borderRadius: 6, padding: '6px 14px', cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: 600,
            }}
          >
            ← Înapoi
          </button>
          {/* Test pe grupă: mesageria e oprită cât timp elevul rezolvă */}
          {gtId && <TestModeBadge compact />}
          {duelId && (
            <span style={{
              background: 'rgba(232,185,49,0.16)', border: '1px solid var(--gold)', color: 'var(--gold)',
              borderRadius: 12, padding: '3px 10px', fontSize: '0.76rem', fontWeight: 800, whiteSpace: 'nowrap',
            }} title="Duel: ai o singură încercare, iar Profesorul Virtual e închis">⚔️ DUEL</span>
          )}
          {item?.category === 'manuale' && (
            <button
              onClick={() => navigate('/')}
              style={{
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                color: 'rgba(255,255,255,0.7)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
                fontSize: '0.82rem', fontWeight: 500,
              }}
            >
              🏠 Home
            </button>
          )}
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8rem' }}>|</div>
          <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.95rem' }}>
            🧩 {item?.title}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Profesorul Virtual lângă exercițiu — deschidere manuală: chat gol,
              așteaptă întrebarea elevului. În timpul unui TEST PE GRUPĂ (?gt=…)
              butonul dispare: elevul nu poate cere ajutor la test. */}
          {!faraAjutor && <button
            onClick={() => { setAutoPrompt(null); setTutorOpen((o) => !o); }}
            title="Te ajută să rezolvi exercițiul, pas cu pas"
            style={{
              background: tutorOpen ? 'var(--gold)' : 'rgba(232,185,49,0.15)',
              border: '1px solid var(--gold)', color: tutorOpen ? 'var(--navy)' : 'var(--gold)',
              borderRadius: 14, padding: '4px 14px', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1.25,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.83rem', fontWeight: 700 }}>
              <EinsteinIcon size={18} /> {tutorOpen ? 'Închide profesorul' : 'Profesorul virtual'}
            </span>
            {!tutorOpen && (
              <span style={{ fontSize: '0.62rem', fontWeight: 600, opacity: 0.9 }}>
                te ajută să rezolvi exercițiul
              </span>
            )}
          </button>}

          {/* Tema de la Meditatorul AI — bifată */}
          {hwMarked && (
            <div style={{
              background: 'var(--gold)', color: 'var(--navy)', padding: '4px 14px', borderRadius: 20,
              fontSize: '0.82rem', fontWeight: 700, animation: 'fadeIn 0.4s ease',
            }}>
              ✓ Temă bifată · nota {hwMarked.grade}
            </div>
          )}

          {/* Temă de la Meditator: „🏁 Finalizează tema" — și neterminată
              (se înregistrează ca incompletă, reluabilă oricând) */}
          {temaId && (
            <button
              onClick={finalizeHomework}
              disabled={hwFinalizing}
              title={hwMarked
                ? 'Tema e bifată cu scorul tău — înapoi la meditații'
                : 'Închide tema acum, chiar dacă nu ai terminat: se înregistrează ca temă incompletă și o poți relua oricând'}
              style={{
                background: hwMarked ? 'rgba(39,174,96,0.22)' : 'rgba(232,185,49,0.15)',
                border: `1px solid ${hwMarked ? '#27ae60' : 'var(--gold)'}`,
                color: hwMarked ? '#d9f5e3' : 'var(--gold)', borderRadius: 14, padding: '6px 14px',
                cursor: hwFinalizing ? 'wait' : 'pointer', fontSize: '0.83rem', fontWeight: 700, whiteSpace: 'nowrap',
              }}
            >
              {hwFinalizing ? '⏳ Finalizez…' : hwMarked ? '🏁 Temă finalizată — înapoi la meditații' : '🏁 Finalizează tema'}
            </button>
          )}
          {hwError && (
            <div style={{ background: '#c62828', color: '#fff', padding: '4px 14px', borderRadius: 20, fontSize: '0.8rem', fontWeight: 700 }} title={hwError}>
              ⚠ Tema nu s-a putut finaliza — reîncearcă
            </div>
          )}

          {/* Sesiune de meditații (exerciții/simulare din site) — înregistrată */}
          {!hwMarked && medMarked && (
            <div style={{
              background: 'var(--gold)', color: 'var(--navy)', padding: '4px 14px', borderRadius: 20,
              fontSize: '0.82rem', fontWeight: 700, animation: 'fadeIn 0.4s ease',
            }}>
              ✓ Trimis Meditatorului · {medMarked.pct}%
            </div>
          )}

          {/* Eroare de salvare — vizibilă, nu doar în consolă */}
          {saveError && (
            <div style={{
              background: '#c62828', color: '#fff', padding: '4px 14px', borderRadius: 20,
              fontSize: '0.8rem', fontWeight: 700,
            }} title={saveError}>
              ⚠ Scorul nu s-a salvat — reîncearcă „Verifică"
            </div>
          )}

          {/* Scor salvat */}
          {scoreSaved && savedScore && (
            <div style={{
              background: scoreColor, color: '#fff',
              padding: '4px 14px', borderRadius: 20,
              fontSize: '0.82rem', fontWeight: 700,
              animation: 'fadeIn 0.4s ease',
            }}>
              ✓ Scor salvat: {savedScore.score}/{savedScore.maxScore} ({scorePct}%){savedNota != null && !hwMarked ? ` · nota ${savedNota}` : ''}
            </div>
          )}

          <div style={{
            fontSize: '0.75rem', fontWeight: 700, padding: '4px 12px', borderRadius: 20,
            background: item?.is_free ? 'rgba(39,174,96,0.2)' : 'rgba(232,185,49,0.2)',
            color: item?.is_free ? '#27ae60' : 'var(--gold)',
            border: `1px solid ${item?.is_free ? 'rgba(39,174,96,0.3)' : 'rgba(232,185,49,0.3)'}`,
          }}>
            {item?.is_free ? 'Gratuit' : '⭐ Premium'}
          </div>
        </div>
      </div>

      {/* Exercițiul + Profesorul Virtual, unul lângă altul, interconectate */}
      <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', minHeight: 0 }}>
        {finalDoc !== null && (
          <iframe
            key={iframeKey}
            ref={iframeRef}
            srcDoc={finalDoc}
            style={{ flex: 1, border: 'none', width: '100%', minHeight: 0, background: '#fff' }}
            title={item?.title}
            sandbox="allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation"
          />
        )}

        {tutorOpen && !faraAjutor && (
          <div style={{
            flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff', minHeight: 0,
            ...(isMobile
              ? { height: `${panelPct}%`, borderTop: '3px solid var(--gold)' }
              : { width: 400, maxWidth: '45vw', borderLeft: '3px solid var(--gold)' }),
          }}>
            {/* Pe mobil, bara albastră e și mâner: trage în sus/jos ca să mărești sau să micșorezi panoul */}
            <div
              onPointerDown={barDown} onPointerMove={barMove} onPointerUp={barUp} onPointerCancel={barUp}
              style={{
                background: 'var(--navy)', color: '#fff', padding: isMobile ? '4px 12px 8px' : '8px 12px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
                ...(isMobile ? { cursor: 'ns-resize', touchAction: 'none', position: 'relative' } : {}),
              }}>
              {isMobile && (
                <div style={{
                  position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)',
                  width: 44, height: 4, borderRadius: 3, background: 'rgba(255,255,255,.45)',
                }} />
              )}
              <div style={{ fontWeight: 700, fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <EinsteinIcon size={20} /> Profesorul Virtual
              </div>
              <button onClick={() => { setAutoPrompt(null); setTutorOpen(false); }}
                style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: '.78rem', fontWeight: 600 }}>
                ✕
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ChatPanel
                compact
                context={tutorContext}
                onAction={sendTutorAction}
                initialConversationId={tutorConvId}
                autoPrompt={autoPrompt}
              />
            </div>
          </div>
        )}
      </div>

      {/* Widget plutitor pe desktop (FloatingTutor global e ascuns pe /exercitiu):
          deschide profesorul LÂNGĂ exercițiu; se poate MUTA (tragi de el) */}
      {!tutorOpen && !isMobile && !faraAjutor && (
        <TutorFab onOpen={() => { setAutoPrompt(null); setTutorOpen(true); }} />
      )}

      {/* Toast: XP câștigat (Arena — src/pages/Arena.jsx) */}
      {xpToast && (
        <div style={{ position: 'fixed', top: 70, left: 16, zIndex: 2000, maxWidth: 320 }}>
          <div style={{
            background: 'var(--navy)', color: '#fff', borderRadius: 12, padding: '12px 14px',
            boxShadow: '0 8px 24px rgba(0,0,0,.28)', border: '1px solid rgba(232,185,49,.5)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '1.4rem' }}>⭐</span>
              <strong style={{ fontSize: '1rem' }}>+{xpToast.xp} XP</strong>
              {xpToast.streakUp && <span style={{ marginLeft: 'auto', fontSize: '.85rem' }}>🔥 {xpToast.streak} zile</span>}
              <button onClick={() => setXpToast(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.6)', marginLeft: xpToast.streakUp ? 6 : 'auto' }}>✕</button>
            </div>
            <div style={{ fontSize: '.78rem', color: 'rgba(255,255,255,.75)', marginTop: 6, lineHeight: 1.5 }}>
              {xpToast.nivelNou && <div>🎉 Nivel nou: <strong>{xpToast.nivelNou.name}</strong></div>}
              {xpToast.misiune?.tocmaiFinalizata && <div>🎯 Misiunea zilei — terminată!</div>}
              {xpToast.misiune && !xpToast.misiune.done && <div>🎯 Misiune: {xpToast.misiune.progress}/{xpToast.misiune.target}</div>}
              {xpToast.liga && <div>{xpToast.liga.icon} Liga {xpToast.liga.name}: {xpToast.liga.puncte} puncte</div>}
              {xpToast.plafonAtins && <div>Ai atins plafonul zilnic de puncte de ligă.</div>}
              <Link to="/arena" style={{ color: 'var(--gold-light)', textDecoration: 'underline' }}>Vezi Arena</Link>
            </div>
          </div>
        </div>
      )}

      {/* Toast: cum a mers duelul (după trimiterea scorului) */}
      {duelRez && (
        <div style={{ position: 'fixed', top: 150, left: 16, zIndex: 2000, maxWidth: 320 }}>
          <div style={{
            background: '#fff', border: '2px solid var(--gold)', borderRadius: 12, padding: '12px 14px',
            boxShadow: '0 8px 24px rgba(0,0,0,.25)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: 'var(--navy)' }}>
              <span style={{ fontSize: '1.3rem' }}>⚔️</span>
              {duelRez.gata ? 'Duel încheiat' : duelRez.deja ? 'Ai jucat deja acest duel' : 'Rezultat trimis'}
              <button onClick={() => setDuelRez(null)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#6b7689' }}>✕</button>
            </div>
            <div style={{ fontSize: '.8rem', color: '#6b7689', marginTop: 6, lineHeight: 1.5 }}>
              {duelRez.asteptam && 'Așteptăm și rezultatul adversarului. Îți spunem când termină.'}
              {duelRez.altMaterial && 'Rezultatul nu intră în duel: nu e exercițiul duelului.'}
              {duelRez.neverificat && 'Rezultatul nu intră în duel: exercițiul nu are cheie de verificare pe server.'}
              {duelRez.gata && 'Vezi cine a câștigat în Arenă.'}
              {' '}<Link to="/arena" style={{ color: 'var(--navy)', fontWeight: 700 }}>Deschide Arena</Link>
            </div>
          </div>
        </div>
      )}

      {/* Toast: insigne noi câștigate */}
      {newBadges.length > 0 && (
        <div style={{ position: 'fixed', top: 70, right: 16, zIndex: 2000, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {newBadges.map((b) => (
            <div key={b.id} style={{
              background: '#fff', border: '2px solid var(--gold)', borderRadius: 12, padding: '10px 14px',
              boxShadow: '0 8px 24px rgba(0,0,0,.25)', display: 'flex', alignItems: 'center', gap: 10, maxWidth: 340,
            }}>
              <span style={{ fontSize: '1.6rem' }}>{b.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '.9rem' }}>Insignă nouă: {b.name}</div>
                <div style={{ fontSize: '.78rem', color: '#6b7689' }}>{b.desc}</div>
              </div>
              <button onClick={() => setNewBadges([])}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7689', fontSize: '.9rem' }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Card: „Cum ți s-a părut testul?" — stele + comentariu (src/components/ReviewWidget.jsx) */}
      {reviewOpen && item?.id && (
        <ReviewToast targetType="content" targetId={item.id} title={item.title} onClose={closeReview} />
      )}
    </div>
  );
}
