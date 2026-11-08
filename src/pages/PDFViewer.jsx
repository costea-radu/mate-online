import { authHeaders } from '../lib/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { ChatPanel, TutorFab } from '../components/AITutor';
import EinsteinIcon from '../components/EinsteinIcon';
import { aiClient } from '../lib/aiClient';
import TestModeBadge from '../components/TestModeBadge';
import ManerLatime from '../components/ManerLatime';
import { useLatimePanou } from '../lib/latimePanou';
import { pdfFrameSrc, pageWidthPt, pdfColumnWidth, paginiPanelWidth, readPaginiPref, savePaginiPref, readViewerPref, saveViewerPref } from '../lib/pdfFrame';
import { loadPdfJs, pdfInlineSupport } from '../lib/pdfjs';
import PdfCanvasViewer from '../components/PdfCanvasViewer';
import { examDocumentHtml, printExam } from '../lib/examPrint';
import { useBaraSusVizibila, paddingBara } from '../lib/baraSus';
// „✏️ Rezolvă pe PDF" (7 nov. 2026): stratul invizibil de scris peste paginile
// testelor de Evaluare Națională + „✅ Corectează" (api/rezolva-pdf.js)
import { useRezolvarePdf, rezolvareToolbar, RezolvareFooter } from '../components/RezolvarePdf';
import PregatireToast, { deAratat } from '../components/PregatireToast';
import { onPregatire, arenaChanged } from '../lib/arena';

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// Vizualizatorul PDF al site-ului (pdf.js pe <canvas>) — pe telefon și pe orice
// browser fără vizualizator PDF (tablele interactive: Samsung Flip / Tizen, tablele
// cu Android — „file format unsupported"): src/components/PdfCanvasViewer.jsx,
// src/lib/pdfjs.js (4 nov. 2026; până atunci era aici, doar pentru telefon).

// Pagina din PDF-ul deschis unde începe baremul inclus („subiecte + barem" în
// același fișier): prima pagină, de la a doua încolo, cu titlul „BAREM…".
async function findBaremPage(data) {
  if (!data) return null;
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  try {
    for (let n = 2; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      if (/\bBAREM(?:UL)?\b/i.test(tc.items.map((i) => i.str).join(' '))) return n;
    }
    return null;
  } finally {
    try { doc.destroy(); } catch { /* noop */ }
  }
}

export default function PDFViewer() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user, isPremium, isAdmin, loading: authLoading } = useAuth();
  const [blobUrl, setBlobUrl] = useState(null);
  const [pdfData, setPdfData] = useState(null);       // ArrayBuffer — viewerul intern de pe mobil
  const [viewerFailed, setViewerFailed] = useState(false); // pdf.js indisponibil → varianta veche
  // ⬜ / ⬛ Testele de EN (7 nov. 2026): varianta „fără suprafață neagră" — alb lipit
  // peste dreptunghiul negru de pe pagina 2 (botul: api/_lib/pagina2Run.js) — se
  // deschide implicit; „⬛ Original" din bară arată PDF-ul neatins, iar butonul devine
  // „⬜ Fără suprafață neagră". Fiecare variantă se aduce o singură dată (variantsRef).
  const [varianta, setVarianta] = useState(null);   // null = fără variantă albă · 'alb' · 'original'
  const [varLoading, setVarLoading] = useState(false);
  const variantsRef = useRef({});                   // { forId, alb: { data, url }, original: { data, url } }
  // 🖥️ Vizualizatorul (4 nov. 2026): al browserului (iframe) sau al site-ului (pdf.js
  // pe <canvas>). Implicit al site-ului unde browserul n-are vizualizator PDF — pe
  // tablele interactive (Samsung Flip / Tizen, Android) iframe-ul rămânea cu „file
  // format unsupported". Butonul din bară îl schimbă; alegerea se ține minte.
  const [viewerPref, setViewerPref] = useState(readViewerPref);   // '' | 'intern' | 'browser'
  const inlineOk = useMemo(() => pdfInlineSupport(), []);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mobile, setMobile] = useState(false);

  const [searchParams] = useSearchParams();
  const idParam = searchParams.get('id');
  const gtId = searchParams.get('gt');       // TEMĂ PE GRUPĂ (/tema-grupa)
  const duelId = searchParams.get('duel');   // DUEL 1-la-1 (/arena)
  // În duel, ca la testul pe grupă, Profesorul Virtual nu mai dă ajutor:
  // panoul rămâne deschis DOAR ca să poți trimite răspunsurile spre corectare
  // (la PDF-uri acolo se calculează punctajul), dar în „mod test".
  const modTest = !!gtId || !!duelId;
  // BIBLIOTECA UTILIZATORILOR (?lib=<id>): PDF-urile publicate / încărcate de
  // profesori și testele generate se deschid aici, cu Profesorul Virtual alături.
  // Accesul îl verifică serverul (api/ai-public.js → get: gratuit / abonat / autor).
  const libId = modTest ? null : searchParams.get('lib');
  const isLib = !!libId;
  // deschis din „🎯 Pregătește-mă de examen" (testul zilei): pornește singur
  // „✏️ Rezolvă pe PDF" (EN) sau foaia de lucru (BAC și celelalte), o dată
  const dinPregatire = !modTest && searchParams.get('pregatire') === '1';
  const pregPornitRef = useRef(false);
  const [pregRez, setPregRez] = useState(null);    // { rez, fel } — PregatireToast
  const pregItemiRef = useRef(-1);
  const [lib, setLib] = useState(null);             // rândul din ai_public_library (kind 'pdf' | 'exam')
  const [examHtml, setExamHtml] = useState(null);   // testul generat (kind 'exam'), ca document HTML
  const [item, setItem] = useState(state?.item || null);
  // „Grant": material premium trimis gratuit de admin printr-o temă pe grupă.
  const [grant, setGrant] = useState(state?.grant || null);

  // ─── Profesorul Virtual lângă PDF ─────────────────────────────────────────
  const [tutorOpen, setTutorOpen] = useState(!!state?.openTutor);
  // comenzile chatului (ChatPanel → cmdRef): corectarea de pe PDF apare în conversație
  const chatCmdRef = useRef(null);
  // ✏️ REZOLVĂ PE PDF — elevul încercuiește litera la grile (Subiectele I și II) și
  // scrie rezolvarea la Subiectul al III-lea direct pe paginile PDF-ului, într-un
  // strat transparent; „✅ Corectează" la final (src/components/RezolvarePdf.jsx)
  const [solveOn, setSolveOn] = useState(false);
  const [solveBusy, setSolveBusy] = useState(false);
  // ✍️ Foaia de lucru se deschide ÎN zona de conversație a profesorului
  // (butonul e în antetul panoului), nu ca fereastră peste PDF
  const [workOpen, setWorkOpen] = useState(false);
  // Lățimea panoului profesorului PE CALCULATOR: elevul o trage de marginea
  // stângă (ca înălțimea pe telefon, de bara albastră) și se ține minte;
  // „□ / ❐” trece între lățimea obișnuită și una mare (src/lib/latimePanou.js).
  // Cât e deschisă foaia de lucru, panoul se lățește singur (vezi setWork).
  // Lățirile AUTOMATE (pe calculator): foaia de lucru deschisă ('foaie') și
  // coloana cu paginile ascunsă ('pagini'). Panoul ia lățimea cea mai mare cerută
  // și revine la lățimea elevului când nicio cauză nu mai e activă — dacă între
  // timp elevul n-a ales singur alta, trăgând de margine (atunci rămâne a lui).
  const autoRef = useRef({ before: null, causes: new Map() });
  const lat = useLatimePanou({
    storageKey: 'pv:latime', initial: 400,
    // lățimea aleasă de elev cu mâna rămâne și după ce închide foaia / arată paginile
    onUserResize: () => { autoRef.current.before = null; },
  });
  function autoWiden(cause, w) {
    const a = autoRef.current;
    const had = a.causes.size > 0;
    if (w) {
      if (!had || a.before === null) a.before = lat.width;
      a.causes.set(cause, w);
    } else {
      if (!a.causes.has(cause)) return;
      a.causes.delete(cause);
      if (a.before === null) return;            // elevul a ales singur lățimea între timp
    }
    const want = a.causes.size ? Math.max(a.before || 0, ...a.causes.values()) : a.before;
    if (!a.causes.size) a.before = null;
    if (want) lat.setWidth(want, { save: false });
  }
  // 📑 Coloana cu paginile (miniaturile) din vizualizatorul PDF al browserului —
  // '' = cum vrea browserul (neatins), '0' = ascunsă, '1' = arătată (src/lib/pdfFrame.js)
  const [pagini, setPagini] = useState(readPaginiPref);
  const faraPagini = pagini === '0';
  const tutorConvId = state?.tutorConvId || null;
  const [pdfText, setPdfText] = useState(null);      // textul extras din PDF
  const [pdfFileName, setPdfFileName] = useState(null); // numele original al fișierului testului
  const [barem, setBarem] = useState(null);          // {id, title, text, fileName, matchedBy, evidence} — baremul asociat testului
  const [baremStatus, setBaremStatus] = useState(null); // 'este_barem' = PDF-ul deschis e chiar un barem
  const [pdfLoading, setPdfLoading] = useState(false);
  // Admin (Etapa 2, 3.1): alegerea manuală a baremului pentru acest test
  const [baremPick, setBaremPick] = useState({ open: false, loading: false, candidates: [], override: null, choice: '', saving: false, msg: null });
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth < 800);
  // Telefon (sub 520 px): bara de sus se strânge — butoanele pe un rând, fără
  // subtitlu, fără eticheta Gratuit/Premium. Altfel bara ieșea din ecran
  // (≈490 px de conținut): titlul dispărea, iar eticheta se tăia.
  const [tiny, setTiny] = useState(typeof window !== 'undefined' && window.innerWidth < 520);
  useEffect(() => {
    const onResize = () => { setNarrow(window.innerWidth < 800); setTiny(window.innerWidth < 520); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // DUEL pe un test PDF: cronometrul pornește pe server la deschiderea testului,
  // exact ca la exercițiile interactive. Fără asta, egalitățile de procent
  // rămâneau remize, pentru că niciunul dintre timpi nu era măsurat.
  useEffect(() => {
    if (!duelId || !user) return;
    aiClient.duel({ action: 'start', id: duelId }).catch(() => {});
  }, [duelId, user]);

  // Înălțimea panoului pe ecrane înguste (%) — se trage de bara albastră
  const [panelPct, setPanelPct] = useState(52);
  const dragBar = useRef(null);
  function barDown(e) {
    if (!narrow) return;
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

  // Textul PDF-ului (+ baremul asociat) se aduce o singură dată: când elevul
  // deschide profesorul, apasă „📋 Barem" sau, pentru un cont logat, la scurt
  // timp după ce s-a încărcat PDF-ul (serverul îl ține în cache — ai_pdf_text).
  // Din nou după ce adminul schimbă baremul asociat.
  // Întoarce { barem, baremStatus } (null la eroare).
  const ctxPromiseRef = useRef(null);
  const ctxFailedRef = useRef(false);
  const ctxKey = isLib ? (lib?.id || null) : (item?.id || null);
  function loadPdfContext() {
    if (!ctxKey) return Promise.resolve(null);
    if (ctxPromiseRef.current) return ctxPromiseRef.current;
    setPdfLoading(true);
    const p = aiClient.pdfContext(isLib ? { libraryId: lib.id } : { contentId: item.id })
      .then((r) => {
        ctxFailedRef.current = false;
        setPdfText(r?.text || '');
        setPdfFileName(r?.fileName || null);
        setBaremStatus(r?.baremStatus || null);
        // baremul asociat (BAC sau Evaluare Națională) + dovada potrivirii:
        // metadate (titlu/fișier), antetul PDF-urilor (an + variantă), conținut,
        // „inclus" (subiecte + barem în același fișier) sau „admin" (asociat manual)
        const b = r?.baremText && r?.barem
          ? { id: r.barem.id || null, title: r.barem.title || 'Barem', text: r.baremText, fileName: r.barem.fileName || null, matchedBy: r.barem.matchedBy || null, evidence: r.barem.evidence || null }
          : null;
        setBarem(b);
        return { barem: b, baremStatus: r?.baremStatus || null };
      })
      .catch(() => { ctxFailedRef.current = true; setPdfText(''); return null; })
      .finally(() => { setPdfLoading(false); ctxPromiseRef.current = null; });
    ctxPromiseRef.current = p;
    return p;
  }
  useEffect(() => {
    // (după o încercare eșuată — de ex. cea de la încărcare — profesorul mai încearcă o dată)
    if (!tutorOpen || !ctxKey || (pdfText !== null && !ctxFailedRef.current) || pdfLoading) return;
    loadPdfContext();
  }, [tutorOpen, ctxKey]); // eslint-disable-line
  // Cont logat: contextul se aduce și fără profesor deschis, ca „📋 Barem" să
  // știe din prima dacă există barem (și profesorul să pornească imediat).
  // Nu și în test/duel — acolo butonul de barem nu există.
  useEffect(() => {
    if (!user || modTest || loading || !ctxKey || pdfText !== null) return;
    const t = setTimeout(() => { loadPdfContext(); }, 900);
    return () => clearTimeout(t);
  }, [user, modTest, loading, ctxKey]); // eslint-disable-line

  // Admin: deschide lista de bareme-candidat din aceeași categorie
  async function openBaremPick() {
    if (baremPick.open) { setBaremPick((b) => ({ ...b, open: false, msg: null })); return; }
    setBaremPick((b) => ({ ...b, open: true, loading: true, msg: null }));
    try {
      const r = await aiClient.pdfBaremCandidates({ contentId: item.id });
      const override = r?.current?.override || null;
      setBaremPick((b) => ({ ...b, loading: false, candidates: r?.candidates || [], override, choice: override || (r?.current?.barem?.id || '') }));
    } catch (e) { setBaremPick((b) => ({ ...b, loading: false, msg: 'Eroare: ' + e.message })); }
  }
  // Admin: salvează asocierea (baremId=null → înapoi la potrivirea automată)
  async function saveBaremPick(baremId) {
    setBaremPick((b) => ({ ...b, saving: true, msg: null }));
    try {
      await aiClient.pdfSetBarem({ contentId: item.id, baremId });
      setBaremPick((b) => ({ ...b, saving: false, open: false, override: baremId || null, msg: null }));
      setPdfText(null); // reîncărcăm textul + baremul (serverul a pus noul barem în cache)
      loadPdfContext();
    } catch (e) { setBaremPick((b) => ({ ...b, saving: false, msg: 'Eroare: ' + e.message })); }
  }

  // ── „📋 Barem": baremul asociat se deschide ÎN LOCUL subiectelor ────────────
  // Butonul din bară (unde era „✍️ Spațiu de lucru" — acum „✍️ Foaie de lucru" —, mutat în antetul
  // Profesorului Virtual). Baremul separat se descarcă o dată (get-file-url —
  // aceleași reguli de acces ca la orice PDF) și se arată în același
  // vizualizator, cu profesorul alături; un nou clic → înapoi la subiecte.
  // Baremul inclus în același PDF („subiecte + barem") → saltul la pagina lui.
  // În testul pe grupă și în duel butonul NU există: baremul = răspunsurile.
  const [baremView, setBaremView] = useState({ open: false, status: 'idle', data: null, url: null, forId: null, inclus: false, page: 1, seq: 0 });
  const [baremFailed, setBaremFailed] = useState(false); // pdf.js n-a putut desena baremul (telefon)
  const [note, setNote] = useState(null);                // { text, link? } — mesaj scurt sub bară
  const baremUrlRef = useRef(null);
  const baremPageRef = useRef(null);                     // pagina baremului inclus (căutată o dată)
  useEffect(() => () => { if (baremUrlRef.current) URL.revokeObjectURL(baremUrlRef.current); }, []);
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);
  // adminul a schimbat baremul asociat → cel descărcat nu mai e bun
  useEffect(() => {
    setBaremView((v) => (v.forId && v.forId !== (barem?.id || null)
      ? { ...v, open: false, status: 'idle', data: null, url: null, forId: null }
      : v));
  }, [barem?.id]);
  // PDF-ul deschis e chiar un barem → butonul n-are rost (după subcategorie sau
  // după verdictul serverului; titlul singur nu ajunge: „subiecte + barem")
  const isBaremItem = item?.subcategory === 'bareme';
  // (materialele din bibliotecă n-au barem asociat din platformă: rezolvările unui
  // test generat / baremul inclus în PDF le are doar profesorul virtual)
  const showBaremBtn = !modTest && !isLib && !isBaremItem && baremStatus !== 'este_barem';

  // ✏️ „Rezolvă pe PDF": testele PDF de Evaluare Națională (din platformă și din
  // Biblioteca utilizatorilor), nu baremele; nu în testul pe grupă / duel (acolo
  // răspunsurile pleacă la profesor cu „📝 Răspunde la test").
  const isEnPdf = item?.category === 'evaluare-nationala' && !isBaremItem && baremStatus !== 'este_barem';
  const canSolve = isEnPdf && !modTest && !examHtml && !!pdfData;
  const solveActive = solveOn && canSolve;
  // La BAC și la celelalte PDF-uri (și la testele de EN din testul pe grupă / duel),
  // „✏️ Rezolvă" deschide FOAIA DE LUCRU din panoul profesorului (8 nov. 2026)
  const rezolvaFoaie = !canSolve && (!!pdfData || !!examHtml) && !isBaremItem && baremStatus !== 'este_barem';
  const inkKey = isLib ? (lib?.id ? `lib:${lib.id}` : null) : (item?.id || null);
  const solve = useRezolvarePdf({ on: solveActive, data: pdfData, draftKey: inkKey });
  useEffect(() => {
    if (solveActive && solve.mapState === 'fail') {
      setNote({ text: 'Nu am recunoscut structura acestui PDF (subiectele și exercițiile). Poți scrie pe el; la „✅ Corectează" îl citește profesorul virtual (Premium).' });
    }
  }, [solveActive, solve.mapState]);

  async function toggleBarem() {
    if (baremView.open) {
      // înapoi la subiecte (la baremul inclus: înapoi la prima pagină)
      setBaremView((v) => ({ ...v, open: false, status: v.status === 'loading' ? 'idle' : v.status, page: 1, seq: v.seq + 1 }));
      return;
    }
    if (baremView.status === 'loading') return;
    if (!user) {
      setNote({ text: 'Autentifică-te ca să deschizi baremul acestui test.', link: { to: '/autentificare', label: 'Autentificare' } });
      return;
    }
    let b = barem;
    if (pdfText === null || pdfLoading || ctxFailedRef.current) {
      setBaremView((v) => ({ ...v, status: 'loading' }));
      const r = await loadPdfContext();
      if (!r) {
        setBaremView((v) => ({ ...v, status: 'idle' }));
        setNote({ text: 'Nu am putut căuta baremul acum. Încearcă din nou peste câteva secunde.' });
        return;
      }
      b = r.barem;
    }
    if (!b || !b.id) {
      setBaremView((v) => ({ ...v, status: 'idle' }));
      setNote({ text: 'Nu am găsit baremul acestui test.' });
      return;
    }
    // baremul e în ACELAȘI PDF, după subiecte → sărim la pagina lui
    if (b.matchedBy === 'inclus' || b.id === item?.id) {
      setBaremView((v) => ({ ...v, status: 'loading' }));
      let page = baremPageRef.current;
      if (!page) {
        try { page = await findBaremPage(pdfData); } catch { page = null; }
        baremPageRef.current = page;
      }
      if (!page) {
        setBaremView((v) => ({ ...v, status: 'idle' }));
        setNote({ text: 'Baremul e inclus în acest PDF, după subiecte — derulează până la el.' });
        return;
      }
      setBaremView((v) => ({ ...v, open: true, status: 'ok', inclus: true, page, seq: v.seq + 1 }));
      setNote({ text: `📋 Baremul e în același PDF și începe la pagina ${page}.` });
      return;
    }
    if (baremView.forId === b.id && baremView.data) {
      setBaremView((v) => ({ ...v, open: true, status: 'ok', inclus: false }));
      return;
    }
    setBaremFailed(false);
    setBaremView((v) => ({ ...v, open: true, status: 'loading', inclus: false }));
    try {
      const res = await fetch('/api/get-file-url', {
        method: 'POST', headers: await authHeaders(), body: JSON.stringify({ contentId: b.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(d.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
      const resp = await fetch(d.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      if (baremUrlRef.current) URL.revokeObjectURL(baremUrlRef.current);
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
      baremUrlRef.current = url;
      // dacă elevul a apăsat între timp „înapoi la subiecte", rămâne acolo
      setBaremView((v) => ({ ...v, status: 'ok', data: buf, url, forId: b.id, inclus: false }));
    } catch (e) {
      setBaremView((v) => ({ ...v, open: false, status: 'idle' }));
      setNote(e.status === 403
        ? { text: 'Baremul acestui test face parte din abonament.', link: { to: '/preturi', label: 'Vezi abonamentele' } }
        : { text: 'Nu am putut deschide baremul. Încearcă din nou.' });
    }
  }

  // ✍️ Foaia de lucru (în zona de conversație). Pe desktop, panoul se lățește
  // cât e deschis (o foaie de 400 px e prea îngustă) și revine la închidere —
  // dacă între timp elevul n-a ales singur altă lățime, trăgând de margine.
  function setWork(next) {
    if (next === workOpen) return;
    if (!narrow) autoWiden('foaie', next ? lat.wideW : null);
    setWorkOpen(next);
  }

  // „🎯 Pregătește-mă de examen": felicitarea (ziua bifată) sau progresul spre ea
  function arataPregatire(rez) {
    const fel = deAratat(rez, { dinPregatire });
    if (!fel) return;
    if (fel === 'progres') {
      if (rez.itemi === pregItemiRef.current) return;
      pregItemiRef.current = rez.itemi;
    }
    setPregRez({ rez, fel });
  }
  // corectările din panoul profesorului (formularul de răspunsuri, foaia de lucru)
  useEffect(() => onPregatire((rez) => arataPregatire(rez)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // testul zilei: o singură dată, după ce PDF-ul s-a încărcat — rezolvarea pe PDF
  // (EN) sau foaia de lucru (BAC / alte PDF-uri; doar cu cont)
  useEffect(() => {
    if (!dinPregatire || pregPornitRef.current) return;
    if (canSolve && !solveOn) {
      pregPornitRef.current = true;
      toggleSolve();
    } else if (rezolvaFoaie && user && !(tutorOpen && workOpen)) {
      pregPornitRef.current = true;
      setTutorOpen(true);
      setWork(true);
    }
  }, [dinPregatire, canSolve, rezolvaFoaie, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // ✏️ „Rezolvă" pe un PDF care nu e test de EN: foaia de lucru, în panoul profesorului
  function toggleFoaia() {
    if (tutorOpen && workOpen) { setWork(false); return; }
    if (!user) {
      setNote({ text: 'Autentifică-te ca să rezolvi pe foaia de lucru.', link: { to: '/autentificare', label: 'Autentificare' } });
      return;
    }
    setTutorOpen(true);
    setWork(true);
  }

  // ✏️ Pornește / oprește rezolvarea pe PDF (scrisul rămâne în ciorna locală)
  function toggleSolve() {
    if (solveOn) { solve.store.flush(); setSolveOn(false); return; }
    if (baremView.open) setBaremView((v) => ({ ...v, open: false, page: 1, seq: v.seq + 1 }));
    setViewerFailed(false);
    setSolveOn(true);
    setNote({ text: '✏️ Încercuiește litera la grile și scrie rezolvarea la Subiectul al III-lea, direct pe pagină. Cu două degete derulezi și mărești. La final: „✅ Corectează".' });
  }

  // ✅ „Corectează": grilele recunoscute → barem (fără AI); zonele scrise de mână →
  // imagini ale paginii cu scrisul pe ea → corectorul (Premium). Corectarea apare în
  // conversația Profesorului Virtual și, cu ✔ / ✖ și punctaje, chiar pe PDF.
  async function corecteazaPePdf() {
    if (solveBusy) return;
    if (!user) {
      setNote({ text: 'Autentifică-te ca să-ți corectăm rezolvarea de pe PDF.', link: { to: '/autentificare', label: 'Autentificare' } });
      return;
    }
    if (solve.mapState === 'loading') { setNote({ text: 'Mai citesc testul — încearcă din nou peste o clipă.' }); return; }
    const req = solve.request();
    if (!req.any) {
      setNote({ text: 'Încercuiește răspunsurile sau scrie rezolvarea pe PDF, apoi apasă „✅ Corectează".' });
      return;
    }
    // Corectarea e Premium; fără abonament: 2 corectări gratuite ale GRILEI (după barem,
    // fără AI — le numără serverul), apoi îndemnul spre Premium
    const premium = isPremium || isAdmin;
    const laPremium = { to: '/preturi', label: 'Vezi abonamentele' };
    if (!req.harta && !premium) {
      setNote({ text: 'La acest PDF rezolvarea o citește profesorul virtual — corectarea face parte din abonamentul Premium.', link: laPremium });
      return;
    }
    if (!premium && !req.grile.length) {
      setNote(req.nerecunoscute.length
        ? { text: 'N-am văzut nicio literă încercuită clar la grile — încercuiește litera răspunsului ales (ca să schimbi, taie-o și încercuiește alta).' }
        : { text: 'Corectarea scrisului de mână de la Subiectul al III-lea face parte din abonamentul Premium.', link: laPremium });
      return;
    }
    setSolveBusy(true);
    setTutorOpen(true);
    let h = null;
    try {
      let images = [], thumb = null;
      if (premium && (req.scris.length || !req.harta)) {
        const r = await solve.renderImages(req);
        images = r.images; thumb = r.thumb;
      }
      // chatul se montează odată cu panoul profesorului
      for (let i = 0; i < 40 && !chatCmdRef.current; i++) await new Promise((ok) => setTimeout(ok, 50));
      const cmd = chatCmdRef.current;
      h = cmd && cmd.beginExternal ? cmd.beginExternal({
        userText: '✏️ Corectează-mi rezolvarea de pe PDF.', thumb,
        pendingText: images.length ? '⏳ Corectez grilele după barem și citesc ce ai scris pe PDF…' : '⏳ Corectez grilele după barem…',
      }) : null;
      const r = await aiClient.rezolvaPdf({
        context: { contentId: isLib ? null : (item?.id || null), libraryId: isLib ? (lib?.id || null) : null, title: item?.title || null, category: item?.category || null },
        conversationId: cmd && cmd.conversationId ? cmd.conversationId() : null,
        grile: req.grile, nerecunoscute: req.nerecunoscute, scris: req.scris,
        harta: req.harta, structura: req.structura, images, thumb, durationSec: solve.durationSec(),
      });
      if (h) h.done(r.text, { conversationId: r.conversationId, messageId: r.messageId });
      solve.keepResult(r, req.sigs);
      arataPregatire(r.pregatire);   // „🎯 Pregătește-mă de examen": ziua bifată / cât mai e
      if (r.pregatire?.tocmaiBifata) arenaChanged();
      if (r.gratuite) {
        setNote({
          text: r.gratuite.ramase > 0
            ? `🎁 Corectare gratuită a grilei: ${r.gratuite.folosite} din ${r.gratuite.total} — ți-a mai rămas ${r.gratuite.ramase === 1 ? 'una' : r.gratuite.ramase}.${r.premiumNeeded ? ' Subiectul al III-lea îl corectează profesorul virtual cu Premium.' : ''}`
            : '🎁 Aceasta a fost ultima corectare gratuită a grilei. De acum, corectarea de pe PDF face parte din abonamentul Premium.',
          link: laPremium,
        });
      } else if (r.premiumNeeded) {
        setNote({ text: 'Grilele sunt corectate. Scrisul de la Subiectul al III-lea îl corectează profesorul virtual cu Premium.', link: laPremium });
      } else if (req.outside) {
        setNote({ text: 'Unele trasee sunt în afara exercițiilor (antet, margini) — nu le-am corectat.' });
      }
    } catch (e) {
      if (h) h.fail(e.message, { premium: !!e.premium, banner: e.gratuite ? '🔒 Ai folosit corectările gratuite ale grilei.' : null });
      if (e.gratuite) solve.markGratuite(e.gratuite);
      setNote(e.premium
        ? { text: e.message, link: laPremium }
        : { text: e.message || 'Corectarea nu a reușit. Mai încearcă o dată.' });
    } finally {
      setSolveBusy(false);
    }
  }
  async function descarcaPdfRezolvat() {
    try { await solve.downloadPdf(item?.title || 'test'); }
    catch (e) { console.error('PDF cu rezolvarea:', e); setNote({ text: 'Nu am putut pregăti PDF-ul cu rezolvarea. Încearcă din nou.' }); }
  }

  // 📑 Coloana cu paginile ascunsă + profesorul deschis → panoul ia locul ei: cel puțin
  // lățimea coloanei de miniaturi (pagina PDF rămâne cât era), iar pe ecranele late și
  // mai mult — PDF-ului îi rămâne doar cât îi trebuie paginii la 100%. Paginile arătate
  // din nou / profesorul închis → panoul revine la lățimea de dinainte.
  const pdfCol = useMemo(() => pdfColumnWidth(pageWidthPt(pdfData)), [pdfData]);
  // PDF-ul desenat de site (nu de browser): pe telefon, pe tablele interactive /
  // browserele fără vizualizator PDF, sau la cerere
  // („✏️ Rezolvă pe PDF" desenează și el pagina: stratul de scris stă peste ea)
  const internal = mobile || solveActive || viewerPref === 'intern' || (viewerPref !== 'browser' && !inlineOk);
  function toggleViewer() {
    const next = internal ? 'browser' : 'intern';
    setViewerPref(next);
    saveViewerPref(next);
    setViewerFailed(false);
  }
  // coloana cu miniaturi există doar în vizualizatorul browserului
  const paginiActive = !mobile && !narrow && !examHtml && !!blobUrl && !internal;
  useEffect(() => {
    const on = paginiActive && tutorOpen && faraPagini;
    // lățimea aleasă de elev, nu cea lățită de foaia de lucru deschisă
    const base = autoRef.current.before ?? lat.width;
    autoWiden('pagini', on ? paginiPanelWidth({ base, vw: window.innerWidth, pdfCol }) : null);
  }, [paginiActive, tutorOpen, faraPagini, pdfCol]); // eslint-disable-line react-hooks/exhaustive-deps
  function togglePagini() {
    const next = faraPagini ? '1' : '0';
    setPagini(next);
    savePaginiPref(next);
  }

  const tutorContext = useMemo(() => ({
    pdf: true,
    category: item?.category || null,
    contentId: isLib ? null : (item?.id || null),
    // material din Biblioteca utilizatorilor: serverul îi citește singur textul (și
    // baremul, unde există) — în chat, la „Răspunde în chat" și la corectarea scrisului
    libraryId: isLib ? (lib?.id || null) : null,
    title: item?.title || null,
    // formularul „Răspunde în chat" pornește doar dacă textul testului e citibil
    pdfReadable: !!(pdfText && pdfText.trim().length > 80),
    exerciseText: pdfText
      ? pdfText
      : (item?.title ? `Materialul PDF „${item.title}" este deschis, dar textul lui nu a putut fi citit automat (poate fi un PDF scanat). Cere-i elevului să scrie enunțul sau să îl fotografieze.` : ''),
    fileName: pdfFileName,               // numele original al fișierului testului
    baremText: barem?.text || null,
    baremTitle: barem?.title || null,
    baremFileName: barem?.fileName || null, // numele original al fișierului baremului
  }), [item, pdfText, pdfFileName, barem, isLib, lib]);

  // Materialul din Biblioteca utilizatorilor (?lib=<id>): serverul verifică accesul
  // și dă adresa semnată a PDF-ului (bucketul e privat) sau testul generat.
  const uidKey = user?.id || null;
  useEffect(() => {
    if (!libId || authLoading) return;
    if (!uidKey) { setError('Autentifică-te ca să deschizi materialele din Biblioteca utilizatorilor.'); setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const { item: row } = await aiClient.publicGet({ id: libId });
        if (!alive) return;
        if (!row || (row.kind !== 'pdf' && row.kind !== 'exam')) { setError('Acest material nu se deschide în vizualizator.'); setLoading(false); return; }
        setLib(row);
        setItem({ id: null, title: row.title, category: row.category || null, is_free: !!row.is_free, lib: true });
      } catch (e) {
        if (!alive) return;
        setError(e.premium
          ? 'Acest material din bibliotecă face parte din abonament. Fără abonament poți deschide doar materialele marcate „Gratuit".'
          : (e.message || 'Materialul nu a fost găsit.'));
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [libId, authLoading, uidKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (item || !idParam || libId) return;
    (async () => {
      const { data } = await supabase.from('content').select('*').eq('id', idParam).single();
      if (data) { setItem(data); return; }
      // Temă pe grupă cu PDF premium dat gratuit: rândul nu trece de RLS,
      // deci îl aducem de pe server (cu grant).
      if (gtId) {
        try {
          const r = await aiClient.groupAssignmentPick({ pickId: gtId });
          if (r?.target?.item) { setItem(r.target.item); setGrant(r.target.grant || null); return; }
        } catch { /* cade pe mesajul de mai jos */ }
      }
      setError('Materialul nu a fost găsit.'); setLoading(false);
    })();
  }, [idParam]); // eslint-disable-line

  function goBack() {
    if (state?.returnTo) {
      navigate(state.returnTo, { state: { scrollToCardId: state.scrollToCardId, returnTab: state.returnTab, returnSubcategory: state.returnSubcategory, returnContentType: state.returnContentType } });
    } else {
      navigate(-1);
    }
  }

  useEffect(() => {
    setMobile(isMobile());
  }, []);

  // iOS: tastatura poate „împinge" pagina în sus; după închiderea ei rămânea
  // aplicația deplasată (bara de sus sub ceas și baterie). O readucem la poziția 0
  // (doar când nu se scrie — cât timp e tastatura deschisă, iOS ține câmpul la vedere).
  // Același lucru și în testele interactive: src/lib/baraSus.js.
  useBaraSusVizibila();

  useEffect(() => {
    if (authLoading) return;
    if (!item) { if (!idParam && !libId) navigate('/'); return; }
    // (biblioteca: accesul l-a verificat deja serverul, la publicGet)
    if (!item.lib && !item.is_free && !isPremium && !isAdmin && !grant) { navigate('/preturi'); return; }
    // testul generat din bibliotecă: documentul lui (ca la „📄 Deschide PDF"), fără fișier
    if (item.lib && lib?.kind === 'exam') {
      setExamHtml(examDocumentHtml(lib.payload?.exam || {}, { embedded: true }));
      setLoading(false);
      return undefined;
    }

    let createdUrl = null; // pt. revocarea CORECTĂ a blob-ului în cleanup
    const forId = item.id || null;
    variantsRef.current = { forId };
    async function load() {
      try {
        let buffer;
        let which = null;  // testele de EN cu variantă albă: 'alb' (implicit) / 'original'
        if (item.lib) {
          // PDF din bibliotecă: URL semnat de server (sau base64-ul vechilor PDF-uri mici)
          const b = await aiClient.getLibraryPdfBlob(lib?.payload || {});
          buffer = await b.arrayBuffer();
        } else {
          // Semnăm TOT (gratuit + premium) prin get-file-url — funcționează și pe
          // bucket privat, deci nu mai depindem de URL-uri publice brute.
          // `variante`: la testele de EN vine și linkul variantei fără suprafața neagră
          const res = await fetch('/api/get-file-url', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({ contentId: item.id, grant, variante: true }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          const url = data.url;

          // întâi varianta fără suprafața neagră; dacă nu vine, originalul (fără buton)
          let response = data.alb ? await fetch(data.alb).catch(() => null) : null;
          if (response && response.ok) which = 'alb';
          else response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          buffer = await response.arrayBuffer();
        }
        const blob = new Blob([buffer], { type: 'application/pdf' });
        const localUrl = URL.createObjectURL(blob);
        createdUrl = localUrl;
        if (which) variantsRef.current = { forId, [which]: { data: buffer, url: localUrl } };
        setVarianta(which);
        setPdfData(buffer);
        setBlobUrl(localUrl);
      } catch (err) {
        console.error(err);
        setError('Nu s-a putut încărca fișierul. Încearcă din nou.');
      } finally {
        setLoading(false);
      }
    }

    load();

    return () => {
      // revocăm URL-ul CHIAR creat (starea blobUrl e încă null când rulează efectul)
      if (createdUrl) URL.revokeObjectURL(createdUrl);
      // și cealaltă variantă, adusă la „⬛ Original" / „⬜ Fără suprafață neagră"
      const v = variantsRef.current || {};
      for (const k of ['alb', 'original']) if (v[k] && v[k].url && v[k].url !== createdUrl) URL.revokeObjectURL(v[k].url);
      variantsRef.current = {};
    };
  }, [authLoading, item, isPremium, isAdmin, grant, lib]);

  // „⬛ Original" ↔ „⬜ Fără suprafață neagră": cealaltă variantă se aduce la primul clic
  // (link semnat proaspăt), apoi trecerea e pe loc
  async function toggleVarianta() {
    if (!varianta || varLoading || !item?.id) return;
    const next = varianta === 'alb' ? 'original' : 'alb';
    const forId = item.id;
    let v = variantsRef.current[next];
    if (!v) {
      setVarLoading(true);
      try {
        const res = await fetch('/api/get-file-url', {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ contentId: forId, grant, variante: true }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
        const u = next === 'alb' ? d.alb : d.url;
        if (!u) throw new Error('varianta nu mai există');
        const r = await fetch(u);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const buf = await r.arrayBuffer();
        if (variantsRef.current.forId !== forId) return;          // s-a deschis între timp alt test
        v = { data: buf, url: URL.createObjectURL(new Blob([buf], { type: 'application/pdf' })) };
        variantsRef.current[next] = v;
      } catch (e) {
        console.error('PDF varianta:', e);
        setNote({ text: next === 'alb' ? 'Nu am putut deschide varianta fără suprafață neagră. Încearcă din nou.' : 'Nu am putut deschide originalul. Încearcă din nou.' });
        return;
      } finally {
        setVarLoading(false);
      }
    }
    setViewerFailed(false);
    setPdfData(v.data);
    setBlobUrl(v.url);
    setVarianta(next);
  }

  if (authLoading || loading) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#1a1a2e', gap:16 }}>
        <div className="spinner" />
        <p style={{ color:'rgba(255,255,255,0.5)', fontSize:'0.9rem' }}>Se încarcă fișierul...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#1a1a2e', gap:16, padding:24, textAlign:'center' }}>
        <div style={{ fontSize:'3rem' }}>⚠️</div>
        <p style={{ color:'rgba(255,255,255,0.7)', maxWidth: 460 }}>{error}</p>
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', justifyContent:'center' }}>
          <button className="btn btn-primary" onClick={goBack}>← Înapoi</button>
          {/autentific/i.test(error) && <Link to="/autentificare" className="btn btn-outline" style={{ color:'#fff', borderColor:'rgba(255,255,255,.4)' }}>Autentificare</Link>}
          {/abonament/i.test(error) && <Link to="/preturi" className="btn" style={{ background:'var(--gold)', color:'var(--navy)', fontWeight:700 }}>Vezi abonamentele</Link>}
        </div>
      </div>
    );
  }

  // Bara de sus. Pe telefon (7 nov. 2026): „← Înapoi" · „📋 Barem" · „⬛ Original" ·
  // profesorul virtual (doar Einstein, ca în bara testelor interactive), fără titlu
  // (oricum nu încăpea: rămânea „📄…"); dacă tot nu încap, trec pe al doilea rând —
  // niciun buton nu mai iese din ecran. Sus, nu sub bara de stare (src/lib/baraSus.js).
  const barStyle = {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    ...(tiny ? paddingBara(7, 8) : paddingBara(10, 20)), background:'var(--navy)', flexShrink:0,
    boxShadow:'0 2px 8px rgba(0,0,0,0.3)', gap: tiny ? 6 : 12,
    ...(tiny ? { flexWrap:'wrap', rowGap:6 } : {}),
  };

  const backBtn = {
    background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)',
    color:'#fff', borderRadius:tiny ? 10 : 6, padding: tiny ? '0 9px' : '6px 14px', cursor:'pointer',
    fontSize:'0.85rem', fontWeight:600, whiteSpace:'nowrap', flexShrink:0,
    ...(tiny ? { height:34 } : {}),
  };

  const badge = {
    fontSize:'0.75rem', fontWeight:700, padding:'4px 12px', borderRadius:20,
    background: item?.is_free ? 'rgba(39,174,96,0.2)' : 'rgba(232,185,49,0.2)',
    color: item?.is_free ? '#27ae60' : 'var(--gold)',
    border:`1px solid ${item?.is_free ? 'rgba(39,174,96,0.3)' : 'rgba(232,185,49,0.3)'}`,
    whiteSpace:'nowrap',
  };
  // butonul mic de admin din rândul cu baremul (⚙ barem)
  const adminBtn = {
    background:'#fff', border:'1px solid var(--border)', color:'var(--navy)', borderRadius:6,
    padding:'2px 8px', cursor:'pointer', fontSize:'.7rem', fontWeight:600, whiteSpace:'nowrap', flexShrink:0,
  };

  // ── Butonul din bară (vizibil și pe desktop, și pe mobil) ────────────────
  // TEST PE GRUPĂ (?gt=…): Profesorul Virtual e oprit — nu se pot pune întrebări.
  // Panoul rămâne totuși de deschis pentru „📝 Răspunde în chat": la testele
  // PDF formularul de răspuns e chiar modul în care punctajul ajunge la profesor.
  const tutorIcon = tiny && !modTest;   // pe telefon: doar Einstein (ca în bara testelor interactive)
  const tutorBtn = tutorIcon ? (
    <button
      onClick={() => setTutorOpen((o) => !o)}
      aria-label={tutorOpen ? 'Închide profesorul virtual' : 'Profesorul virtual'} aria-pressed={tutorOpen}
      title="Profesorul virtual — te ajută la exercițiile din PDF"
      style={{
        width: 38, height: 34, flexShrink: 0, borderRadius: 10, cursor: 'pointer', padding: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: tutorOpen ? 'var(--gold)' : 'rgba(232,185,49,0.15)', border: '1px solid var(--gold)',
      }}
    >
      <EinsteinIcon size={24} />
    </button>
  ) : (
    <button
      onClick={() => setTutorOpen((o) => !o)}
      title={modTest ? 'Completează răspunsurile la test' : 'Întreabă-l despre exercițiile din acest material'}
      style={{
        background: tutorOpen ? 'var(--gold)' : 'rgba(232,185,49,0.15)',
        border: '1px solid var(--gold)', color: tutorOpen ? 'var(--navy)' : 'var(--gold)',
        borderRadius: 14, padding: tiny ? '4px 10px' : '4px 12px', cursor: 'pointer', flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1.25,
        ...(tiny ? { minHeight: 32, justifyContent: 'center' } : {}),
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {modTest ? '📝' : <EinsteinIcon size={18} />}{' '}
        {tutorOpen ? 'Închide' : modTest ? 'Răspunde la test' : 'Profesorul virtual'}
      </span>
      {!tutorOpen && !tiny && (
        <span style={{ fontSize: '0.62rem', fontWeight: 600, opacity: 0.9 }}>
          {modTest ? 'trimiți răspunsurile spre corectare' : 'te ajută la exercițiile din PDF'}
        </span>
      )}
    </button>
  );

  // ── „📋 Barem" în bară — locul fostului „✍️ Spațiu de lucru" (azi „Foaie de lucru") ──────────────
  const baremLoading = baremView.status === 'loading';
  const baremBtn = showBaremBtn && (
    <button
      onClick={toggleBarem}
      aria-pressed={baremView.open}
      title={baremView.open ? 'Înapoi la subiectele testului' : 'Deschide baremul oficial asociat acestui test'}
      style={{
        background: baremView.open ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.10)',
        border: '1px solid rgba(255,255,255,0.3)',
        color: baremView.open ? 'var(--navy)' : '#fff', borderRadius: tiny ? 10 : 14, padding: tiny ? '0 9px' : '4px 12px',
        cursor: baremLoading && !baremView.open ? 'progress' : 'pointer', flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1.25,
        ...(tiny ? { height: 34, justifyContent: 'center' } : {}),
      }}
    >
      <span style={{ fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {baremView.open ? '📄 Subiectele' : baremLoading ? '⏳ Barem…' : '📋 Barem'}
      </span>
      {!tiny && (
        <span style={{ fontSize: '0.62rem', fontWeight: 600, opacity: 0.8, whiteSpace: 'nowrap' }}>
          {baremView.open ? 'înapoi la test' : 'deschide baremul'}
        </span>
      )}
    </button>
  );
  // ── „✏️ Rezolvă pe PDF" (testele de Evaluare Națională) ──────────────────
  // (pulsează cât nu e pornit — 8 nov. 2026: „fă butonul «rezolvă» pulsatil ca să
  // atragă atenția"; animația: .em-pulse din src/styles/global.css). La testele de EN
  // pornește rezolvarea PE PDF; la BAC și la celelalte PDF-uri deschide foaia de lucru.
  const foaieActiva = tutorOpen && workOpen;
  const rezolvaActiv = canSolve ? solveActive : foaieActiva;
  const solveBtn = (canSolve || rezolvaFoaie) && (
    <button
      onClick={canSolve ? toggleSolve : toggleFoaia}
      aria-pressed={rezolvaActiv}
      className={rezolvaActiv ? undefined : 'em-pulse'}
      title={canSolve
        ? (solveActive
          ? 'Închide rezolvarea pe PDF (ce ai scris rămâne salvat pe acest dispozitiv)'
          : 'Rezolvă testul direct pe PDF: încercuiește litera la grile și scrie rezolvarea la Subiectul al III-lea; la final „✅ Corectează"')
        : (foaieActiva
          ? 'Închide foaia de lucru'
          : 'Rezolvă pe foaia de lucru: scrii cu degetul sau cu creionul, iar profesorul virtual îți corectează rezolvarea după barem')}
      style={{
        background: rezolvaActiv ? 'var(--gold)' : 'rgba(232,185,49,0.15)', border: '1px solid var(--gold)',
        color: rezolvaActiv ? 'var(--navy)' : 'var(--gold)', borderRadius: tiny ? 10 : 14, padding: tiny ? '0 9px' : '4px 12px',
        cursor: 'pointer', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1.25,
        ...(tiny ? { height: 34, justifyContent: 'center' } : {}),
      }}
    >
      <span style={{ fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {canSolve
          ? (solveActive ? '✏️ Rezolvi pe PDF' : (tiny ? '✏️ Rezolvă' : '✏️ Rezolvă pe PDF'))
          : (foaieActiva ? '✏️ Foaia de lucru' : '✏️ Rezolvă')}
      </span>
      {!tiny && (
        <span style={{ fontSize: '0.62rem', fontWeight: 600, opacity: 0.85, whiteSpace: 'nowrap' }}>
          {rezolvaActiv ? 'apasă ca să închizi' : (canSolve ? 'încercuiește și scrie pe test' : 'pe foaia de lucru')}
        </span>
      )}
    </button>
  );
  // stratul de scris, uneltele (în bara de zoom) și „✅ Corectează" de după ultima pagină
  const solveProps = solveActive ? {
    overlay: solve.overlay,
    toolbar: rezolvareToolbar({ solve, compact: narrow, busy: solveBusy, onCorect: corecteazaPePdf, onClose: toggleSolve, onDownload: descarcaPdfRezolvat, premium: isPremium || isAdmin }),
    footer: <RezolvareFooter solve={solve} busy={solveBusy} onCorect={corecteazaPePdf} premium={isPremium || isAdmin} />,
  } : {};
  const badgeJsx = !tiny && <span style={badge} title={isLib ? 'Material din Biblioteca utilizatorilor' : undefined}>{isLib ? '🏛️ ' : ''}{item?.is_free ? 'Gratuit' : '⭐ Premium'}</span>;

  // ── 📑 „Ascunde paginile" (pe calculator, la PDF-urile din vizualizatorul browserului):
  // coloana cu miniaturi dispare, iar Profesorul Virtual deschis se lățește în locul ei
  const paginiBtn = paginiActive && (
    <button
      onClick={togglePagini}
      aria-pressed={faraPagini}
      title={faraPagini
        ? 'Arată din nou coloana cu paginile din stânga (PDF-ul se reîncarcă de la prima pagină)'
        : 'Ascunde coloana cu paginile din stânga: PDF-ul se retrage, iar Profesorul Virtual se lățește în locul ei (PDF-ul se reîncarcă de la prima pagină)'}
      style={{
        background: faraPagini ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.10)',
        border: '1px solid rgba(255,255,255,0.3)', color: faraPagini ? 'var(--navy)' : '#fff',
        borderRadius: 14, padding: '4px 12px', cursor: 'pointer', flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1.25,
      }}
    >
      <span style={{ fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{faraPagini ? '📑 Arată paginile' : '📑 Ascunde paginile'}</span>
      {!tiny && (
        <span style={{ fontSize: '0.62rem', fontWeight: 600, opacity: 0.8, whiteSpace: 'nowrap' }}>
          {faraPagini ? 'coloana din stânga' : 'lățește profesorul'}
        </span>
      )}
    </button>
  );
  // 🖥️ Vizualizatorul PDF (calculator, table interactive): al browserului ↔ al site-ului.
  // Pe browserele fără vizualizator PDF butonul nu apare: acolo merge doar al site-ului.
  const viewerBtn = !mobile && !examHtml && !!blobUrl && !solveActive && (inlineOk || viewerPref === 'browser') && (
    <button
      onClick={toggleViewer}
      aria-pressed={internal}
      title={internal
        ? 'Deschide PDF-ul în vizualizatorul browserului (cu coloana de pagini, căutare, tipărire)'
        : 'PDF-ul nu se vede (de exemplu pe tabla interactivă apare „file format unsupported")? Îl desenează site-ul, cu zoom și „Pagina întreagă"'}
      style={{
        background: internal ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.10)',
        border: '1px solid rgba(255,255,255,0.3)', color: internal ? 'var(--navy)' : '#fff',
        borderRadius: 14, padding: '4px 12px', cursor: 'pointer', flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1.25,
      }}
    >
      <span style={{ fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{internal ? '🌐 Vizualizatorul browserului' : '🖥️ Nu se vede PDF-ul?'}</span>
      {!tiny && (
        <span style={{ fontSize: '0.62rem', fontWeight: 600, opacity: 0.8, whiteSpace: 'nowrap' }}>
          {internal ? 'cu coloana de pagini' : 'vizualizatorul ExamenMate'}
        </span>
      )}
    </button>
  );
  // testul generat din bibliotecă: tipărirea (aceeași fereastră ca înainte)
  const printBtn = examHtml && lib?.payload?.exam && !tiny && (
    <button onClick={() => printExam(lib.payload.exam, { withSolutions: false })} title="Deschide testul într-o fereastră de tipărire (Printează / Salvează ca PDF)"
      style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff', borderRadius: 14, padding: '6px 12px', cursor: 'pointer', flexShrink: 0, fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
      🖨️ Printează
    </button>
  );

  // Baremul separat, în locul subiectelor (testul rămâne încărcat dedesubt,
  // ascuns — la întoarcere e exact unde l-ai lăsat)
  const showBaremDoc = baremView.open && !baremView.inclus;

  // ── „⬛ Original" / „⬜ Fără suprafață neagră" — testele de EN cu varianta albă ──
  // Implicit se vede varianta albă, iar butonul spune „⬛ Original"; apăsat, arată
  // originalul (cu dreptunghiul negru) și devine „⬜ Fără suprafață neagră".
  const peOriginal = varianta === 'original';
  const variantaBtn = !!varianta && !showBaremDoc && (
    <button
      onClick={toggleVarianta}
      aria-pressed={peOriginal}
      disabled={varLoading}
      title={peOriginal
        ? 'Arată testul fără suprafața neagră de pe pagina 2 (alb în locul dreptunghiului)'
        : 'Arată PDF-ul original, cu dreptunghiul negru de pe pagina 2'}
      style={{
        background: peOriginal ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.10)',
        border: '1px solid rgba(255,255,255,0.3)', color: peOriginal ? 'var(--navy)' : '#fff',
        borderRadius: tiny ? 10 : 14, cursor: varLoading ? 'progress' : 'pointer', flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
        ...(tiny
          ? { width: 118, height: 34, padding: '0 6px', lineHeight: 1.1 }
          : { padding: '4px 12px', lineHeight: 1.25 }),
      }}
    >
      <span style={{
        fontWeight: 700, textAlign: 'center',
        ...(tiny ? { fontSize: peOriginal ? '0.7rem' : '0.8rem', whiteSpace: peOriginal ? 'normal' : 'nowrap' } : { fontSize: '0.82rem', whiteSpace: 'nowrap' }),
      }}>
        {varLoading ? '⏳ …' : peOriginal ? '⬜ Fără suprafață neagră' : '⬛ Original'}
      </span>
      {!tiny && (
        <span style={{ fontSize: '0.62rem', fontWeight: 600, opacity: 0.8, whiteSpace: 'nowrap' }}>
          {peOriginal ? 'alb pe pagina 2' : 'cu dreptunghiul negru'}
        </span>
      )}
    </button>
  );
  const baremPane = showBaremDoc && (
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#1a1a2e' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', flexShrink: 0,
        background: '#f0f9f1', color: '#1e7e34', borderBottom: '1px solid #cfe8d4', fontSize: '.78rem', fontWeight: 700,
      }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          📋 Barem: {barem?.title || 'baremul testului'}
        </span>
        <button type="button" onClick={toggleBarem}
          style={{ background: '#fff', border: '1px solid #cfe8d4', color: 'var(--navy)', borderRadius: 8, padding: '3px 10px', fontSize: '.74rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
          📄 Înapoi la subiecte
        </button>
      </div>
      {baremLoading || !baremView.data ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <div className="spinner" />
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem' }}>Se încarcă baremul…</span>
        </div>
      ) : !internal ? (
        <iframe key={`barem-${pagini}`} src={pdfFrameSrc(baremView.url, { pagini })} title={barem?.title || 'Barem'} style={{ flex: 1, border: 'none', width: '100%', minHeight: 0 }} />
      ) : !baremFailed ? (
        <PdfCanvasViewer key={baremView.forId} data={baremView.data} blobUrl={baremView.url} onFail={() => setBaremFailed(true)} />
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: '3rem' }}>📋</div>
          <a href={baremView.url} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-block', padding: '12px 28px', background: 'var(--gold)', color: 'var(--navy-dark)', borderRadius: 10, fontWeight: 700, textDecoration: 'none' }}>
            📂 Deschide baremul
          </a>
        </div>
      )}
    </div>
  );

  // Mesajul scurt de sub bară (barem negăsit, abonament, autentificare)
  const noteJsx = note && (
    <div role="status" style={{
      position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 1600,
      background: '#fff', color: 'var(--navy)', borderRadius: 10, padding: '9px 12px 9px 14px',
      boxShadow: '0 8px 28px rgba(0,0,0,.35)', fontSize: '.84rem', fontWeight: 600, lineHeight: 1.4,
      width: 'max-content', maxWidth: 'min(92vw, 460px)', display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span>{note.text}</span>
      {note.link && (
        <Link to={note.link.to} style={{ background: 'var(--gold)', color: 'var(--navy)', borderRadius: 7, padding: '4px 10px', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          {note.link.label}
        </Link>
      )}
      <button type="button" onClick={() => setNote(null)} aria-label="Închide mesajul"
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '.9rem', padding: '0 2px' }}>✕</button>
    </div>
  );

  // Testul deschis: la baremul inclus în același PDF, vizualizatorul sare la
  // pagina baremului și înapoi (pe desktop, iframe-ul se reîncarcă la #page=N)
  const testJump = baremView.inclus ? { page: baremView.open ? baremView.page : 1, seq: baremView.seq } : null;
  const testSrc = pdfFrameSrc(blobUrl, { page: testJump ? testJump.page : null, pagini });
  // (iframe-ul se reîncarcă la schimbarea paginii-țintă sau a coloanei cu pagini)
  const testKey = `${testJump ? `test-${testJump.seq}` : 'test'}-${pagini || 'x'}`;

  // ── Widgetul plutitor (vizibil în vizualizatorul de PDF; se poate MUTA) ──
  const tutorWidget = !tutorOpen && !modTest && <TutorFab onOpen={() => setTutorOpen(true)} />;
  // 🎯 „Pregătește-mă de examen": felicitarea / progresul spre bifa zilei
  const pregToast = pregRez && <PregatireToast rez={pregRez.rez} fel={pregRez.fel} onClose={() => setPregRez(null)} top={note ? 150 : 110} />;

  // ── Panoul de chat, interconectat cu PDF-ul deschis ─────────────────────
  const tutorPanel = tutorOpen && (
    <div style={{
      flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff', minHeight: 0, position: 'relative',
      ...(narrow
        ? { height: `${panelPct}%`, borderTop: '3px solid var(--gold)' }
        : { width: lat.width, borderLeft: '3px solid var(--gold)' }),
    }}>
      {/* Pe calculator: mânerul de pe marginea stângă — tragi și fereastra se lățește */}
      {!narrow && <ManerLatime lat={lat} />}
      <div
        onPointerDown={barDown} onPointerMove={barMove} onPointerUp={barUp} onPointerCancel={barUp}
        style={{
          background: 'var(--navy)', color: '#fff', padding: narrow ? '4px 12px 8px' : '8px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          ...(narrow ? { cursor: 'ns-resize', touchAction: 'none', position: 'relative', userSelect: 'none', WebkitUserSelect: 'none' } : {}),
        }}>
        {narrow && (
          <div style={{
            position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)',
            width: 44, height: 4, borderRadius: 3, background: 'rgba(255,255,255,.45)',
          }} />
        )}
        <div style={{ fontWeight: 700, fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          {modTest ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📝 Răspunsurile tale</span>
            : <><EinsteinIcon size={20} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Profesorul Virtual</span></>}
        </div>
        {/* Butoanele din antet nu pornesc tragerea panoului (pe telefon antetul e
            mânerul): fără stopPropagation, captura pointerului lua clicul butonului */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }} onPointerDown={(e) => e.stopPropagation()}>
          {/* ✍️ FOAIA DE LUCRU — se deschide chiar aici, în zona de conversație
              (foaie goală, ca zona conversației, fără linii). Rămâne și în test:
              e ciorna elevului, nu ajutor de la AI. */}
          {user && (
            <button onClick={() => setWork(!workOpen)}
              aria-pressed={workOpen}
              title={workOpen ? 'Înapoi la conversație' : 'Scrie rezolvarea cu degetul sau cu creionul pe o foaie albă, aici — profesorul o corectează după barem'}
              style={{
                background: workOpen ? 'var(--gold)' : 'rgba(232,185,49,0.15)', border: '1px solid var(--gold)',
                color: workOpen ? 'var(--navy)' : 'var(--gold)', borderRadius: 14, padding: '3px 11px',
                cursor: 'pointer', fontSize: '.78rem', fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1.3,
              }}>
              {workOpen ? '💬 Conversația' : '✍️ Foaie de lucru'}
            </button>
          )}
          {/* Mărire/micșorare fereastră — doar pe desktop (pe mobil se trage de bară) */}
          {!narrow && (
            <button onClick={() => { autoRef.current.before = null; lat.setWidth(lat.isWide ? 400 : lat.wideW); }}
              title={lat.isWide ? 'Lățimea obișnuită (sau trage de marginea din stânga)' : 'Fereastră mare (sau trage de marginea din stânga)'}
              aria-label={lat.isWide ? 'Micșorează fereastra profesorului' : 'Mărește fereastra profesorului'}
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: '.82rem', fontWeight: 600, lineHeight: 1.2 }}>
              {lat.isWide ? '❐' : '□'}
            </button>
          )}
          <button onClick={() => setTutorOpen(false)}
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: '.78rem', fontWeight: 600 }}>
            ✕
          </button>
        </div>
      </div>
      {pdfLoading && (
        <div style={{ padding: '6px 12px', fontSize: '.76rem', color: 'var(--text-muted)', background: '#fffdf5', borderBottom: '1px solid var(--border)' }}>
          📄 citesc materialul…
        </div>
      )}
      {!pdfLoading && barem && (
        <div title={[
          'Explicațiile și răspunsurile se dau pe baza acestui barem oficial',
          barem.fileName && barem.matchedBy !== 'inclus' ? `(fișier: ${barem.fileName})` : '',
          barem.evidence ? `— potrivire: ${barem.evidence}` : '',
          barem.matchedBy ? `[${{ inclus: 'baremul e în același PDF', metadate: 'titlu + numele fișierului', 'metadate+antet': 'titlu/fișier, confirmate de antetul PDF-urilor', 'metadate+continut': 'titlu/fișier, confirmate de conținut', antet: 'antetul PDF-urilor (an + variantă)', 'antet+continut': 'antetul PDF-urilor + conținut', continut: 'conținutul (numerele din enunțuri)', admin: 'asociat manual de administrator', bot: 'asociat de botul de examene', biblioteca: 'rezolvările incluse în testul din bibliotecă' }[barem.matchedBy] || barem.matchedBy}]` : '',
        ].filter(Boolean).join(' ')}
          style={{ padding: '5px 12px', fontSize: '.74rem', fontWeight: 600, color: '#1e7e34', background: '#f0f9f1', borderBottom: '1px solid var(--border)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            📋 Barem asociat: {barem.matchedBy === 'inclus' ? 'inclus în acest PDF' : barem.title}
            {barem.evidence && barem.matchedBy !== 'inclus' ? <span style={{ fontWeight: 400, color: '#2d7a3a' }}> · {barem.evidence}</span> : null}
          </span>
          {isAdmin && !isLib && <button type="button" onClick={openBaremPick} title="Admin: alege manual baremul acestui test" style={adminBtn}>⚙ barem</button>}
        </div>
      )}
      {/* Admin: testul n-are barem asociat automat → poate fi ales manual */}
      {!pdfLoading && !barem && isAdmin && !isLib && pdfText !== null && (
        <div style={{ padding: '5px 12px', fontSize: '.74rem', fontWeight: 600, color: '#8a6d1a', background: '#fffbea', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 1 }}>📋 Fără barem asociat (doar adminii văd acest rând)</span>
          <button type="button" onClick={openBaremPick} title="Admin: alege manual baremul acestui test" style={adminBtn}>⚙ asociază barem</button>
        </div>
      )}
      {/* Admin: lista de bareme-candidat (aceeași categorie) — asocierea se salvează pe server (ai_pdf_text.barem_override_id) */}
      {isAdmin && baremPick.open && (
        <div style={{ padding: '8px 12px', fontSize: '.76rem', background: '#f7f9fc', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {baremPick.loading ? <span style={{ color: 'var(--text-muted)' }}>caut baremele din categorie…</span> : (
            <>
              <select value={baremPick.choice} onChange={(e) => setBaremPick((b) => ({ ...b, choice: e.target.value }))}
                style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 7px', fontSize: '.76rem' }}>
                <option value="">— alege baremul (PDF din aceeași categorie) —</option>
                {baremPick.candidates.map((c) => <option key={c.id} value={c.id}>{c.isBarem ? '📋 ' : '📄 '}{c.title}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" disabled={baremPick.saving || !baremPick.choice} onClick={() => saveBaremPick(baremPick.choice)} className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '.74rem' }}>
                  {baremPick.saving ? 'Salvez…' : '✓ Folosește acest barem'}
                </button>
                <button type="button" disabled={baremPick.saving || !baremPick.override} onClick={() => saveBaremPick(null)} className="btn btn-outline" style={{ padding: '4px 10px', fontSize: '.74rem' }}
                  title="Șterge asocierea manuală; serverul potrivește din nou automat">↺ Automat</button>
                <span style={{ color: 'var(--text-muted)' }}>{baremPick.override ? 'asociere manuală activă' : 'potrivire automată'}</span>
              </div>
              {baremPick.msg && <span style={{ color: '#b71c1c' }}>{baremPick.msg}</span>}
            </>
          )}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatPanel compact context={tutorContext} initialConversationId={tutorConvId} testMode={modTest} cmdRef={chatCmdRef}
          workspace={{
            open: workOpen,
            onClose: () => setWork(false),
            title: item?.title || '',
            hint: (pdfText || '').slice(0, 700),
            // aceeași ciornă ca până acum (fereastra veche folosea aceeași cheie)
            storageKey: isLib ? `pdf:lib:${lib?.id || 'material'}` : `pdf:${item?.id || 'material'}`,
          }} />
      </div>
    </div>
  );

  // ── Mobile: PDF-ul se redă ÎN pagină (pdf.js), cu Profesorul Virtual activ ──
  // Vizualizatoarele native de pe telefon descarcă fișierul sau acoperă
  // aplicația (și profesorul dispărea). Canvas-ul intern păstrează totul la un loc.
  if (mobile && (pdfData || blobUrl)) {
    const internalViewer = pdfData && !viewerFailed;
    return (
      <div className="pdf-root" style={{ display:'flex', flexDirection:'column', background:'#1a1a2e' }}>
        {/* html/body blocate cât e deschis PDF-ul: fără derulat „pe lângă" aplicație
            (zona goală albă care apărea la unele derulări pe telefon) */}
        <style>{`.pdf-root{height:100vh;height:100dvh}html,body{overflow:hidden;overscroll-behavior:none}`}</style>
        <div style={barStyle}>
          <button onClick={goBack} style={backBtn}>← Înapoi</button>
          {tiny ? <span style={{ flex:1 }} /> : (
            <span style={{ color:'#fff', fontWeight:600, fontSize:'0.9rem', flex:1, textAlign:'center', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              📄 {item?.title}
            </span>
          )}
          {gtId && <TestModeBadge compact />}
          {duelId && (
            <span style={{
              background: 'rgba(232,185,49,0.16)', border: '1px solid var(--gold)', color: 'var(--gold)',
              borderRadius: 12, padding: '3px 10px', fontSize: '0.74rem', fontWeight: 800, whiteSpace: 'nowrap',
            }} title="Duel: Profesorul Virtual nu dă indicii">⚔️ DUEL</span>
          )}
          {solveBtn}
          {baremBtn}
          {variantaBtn}
          {tutorBtn}
          {badgeJsx}
        </div>

        <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
          {/* subiectele rămân încărcate (doar ascunse) cât se vede baremul */}
          <div style={{ flex:1, minHeight:0, display: showBaremDoc ? 'none' : 'flex', flexDirection:'column' }}>
          {internalViewer ? (
            <PdfCanvasViewer data={pdfData} blobUrl={blobUrl} onFail={() => setViewerFailed(true)} jumpTo={testJump} {...solveProps} />
          ) : (
            <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:24, padding:32, textAlign:'center', overflowY:'auto' }}>
              <div style={{ fontSize:'4rem' }}>📄</div>
              <div style={{ color:'#fff', fontWeight:600, fontSize:'1.1rem' }}>{item?.title}</div>
              <p style={{ color:'rgba(255,255,255,0.6)', fontSize:'0.9rem', lineHeight:1.6, maxWidth:320 }}>
                Apasă butonul de mai jos pentru a deschide PDF-ul în aplicația nativă a dispozitivului tău.
              </p>
              <a
                href={blobUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display:'inline-block', padding:'14px 36px', background:'var(--gold)',
                  color:'var(--navy-dark)', borderRadius:10, fontWeight:700,
                  fontSize:'1rem', textDecoration:'none', boxShadow:'0 4px 16px rgba(232,185,49,0.35)',
                }}
              >
                📂 Deschide PDF-ul
              </a>
              <p style={{ color:'rgba(255,255,255,0.35)', fontSize:'0.78rem' }}>
                Linkul este temporar și expiră la închiderea paginii.
              </p>
            </div>
          )}
          </div>
          {baremPane}

          {tutorPanel}
        </div>
        {tutorWidget}
        {noteJsx}
        {pregToast}
      </div>
    );
  }

  // ── Desktop: iframe cu blob URL + Profesorul Virtual alături ─────────────
  return (
    <div className="pdf-root" style={{ display:'flex', flexDirection:'column', background:'#1a1a2e' }}>
      <style>{`.pdf-root{height:100vh;height:100dvh}`}</style>
      <div style={barStyle}>
        <button onClick={goBack} style={backBtn}>← Înapoi</button>
        <span style={{ color:'rgba(255,255,255,0.35)' }}>|</span>
        <span style={{ color:'#fff', fontWeight:600, fontSize:'0.95rem', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          📄 {item?.title}
        </span>
        {gtId && <TestModeBadge compact />}
        {viewerBtn}
        {paginiBtn}
        {printBtn}
        {solveBtn}
        {baremBtn}
        {variantaBtn}
        {tutorBtn}
        {badgeJsx}
      </div>

      <div style={{ flex:1, display:'flex', flexDirection: narrow ? 'column' : 'row', minHeight:0 }}>
        {blobUrl && !internal && (
          <iframe
            key={testKey}
            src={testSrc}
            style={{ flex:1, border:'none', width:'100%', minHeight:0, display: showBaremDoc ? 'none' : 'block' }}
            title={item?.title}
          />
        )}
        {/* tablele interactive / browserele fără vizualizator PDF: îl desenează site-ul
            (subiectele rămân încărcate, doar ascunse, cât se vede baremul) */}
        {blobUrl && internal && (
          <div style={{ flex:1, minHeight:0, minWidth:0, display: showBaremDoc ? 'none' : 'flex', flexDirection:'column' }}>
            {pdfData && !viewerFailed ? (
              <PdfCanvasViewer data={pdfData} blobUrl={blobUrl} onFail={() => setViewerFailed(true)} jumpTo={testJump} {...solveProps} />
            ) : (
              <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:18, padding:32, textAlign:'center' }}>
                <div style={{ fontSize:'3.4rem' }}>📄</div>
                <p style={{ color:'rgba(255,255,255,0.75)', fontSize:'0.92rem', lineHeight:1.6, maxWidth:440, margin:0 }}>
                  Vizualizatorul PDF nu s-a putut încărca (rețeaua blochează CDN-ul?). Încearcă din nou sau deschide fișierul separat.
                </p>
                <div style={{ display:'flex', gap:10, flexWrap:'wrap', justifyContent:'center' }}>
                  <button onClick={() => setViewerFailed(false)} className="btn btn-primary">↻ Încearcă din nou</button>
                  <a href={blobUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display:'inline-block', padding:'10px 22px', background:'var(--gold)', color:'var(--navy-dark)', borderRadius:10, fontWeight:700, textDecoration:'none' }}>
                    📂 Deschide PDF-ul
                  </a>
                </div>
              </div>
            )}
          </div>
        )}
        {/* testul generat din Biblioteca utilizatorilor: documentul lui (KaTeX din CDN), izolat */}
        {examHtml && (
          <iframe
            srcDoc={examHtml}
            sandbox="allow-scripts allow-modals"
            style={{ flex:1, border:'none', width:'100%', minHeight:0, background:'#f3f4f6' }}
            title={item?.title || 'Test'}
          />
        )}
        {baremPane}
        {tutorPanel}
      </div>

      {tutorWidget}
      {noteJsx}
      {pregToast}
    </div>
  );
}
