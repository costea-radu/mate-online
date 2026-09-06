// =====================================================================
// src/lib/chatUnread.js — BULINA ROȘIE de mesaje noi (ca la Messenger)
//
// Un singur „magazin" pentru tot site-ul: oricâte componente cer numărul de
// mesaje necitite (bara de sus, meniul burger, iconița 💬), serverul e întrebat
// O SINGURĂ DATĂ, iar răspunsul e împărțit tuturor.
//
// Reguli de scalare, ca la indicatorul de forum:
//   • întrebăm doar cu TABUL VIZIBIL (un tab uitat deschis nu bate serverul);
//   • revenirea pe fereastră aduce imediat numărul actualizat;
//   • două cereri nu pleacă niciodată mai aproape de MIN_GAP una de alta.
//
// `refreshChatUnread()` — chemat din mesagerie după ce se citește sau se
// trimite un mesaj, ca bulina să scadă pe loc, fără să aștepte următorul tic.
//
// Sursa numărului: POST /api/messages { action: 'unread' } → { count, threads }.
// =====================================================================
import { useEffect, useState } from 'react';
import { aiClient } from './aiClient';
import { supabase } from './supabase';

const POLL = 30000;     // cât de des întrebăm serverul, cu tabul vizibil
const MIN_GAP = 4000;   // nu batem serverul mai des de atât

// ─── TIMP REAL ───────────────────────────────────────────────────────────────
// Interogarea din 30 în 30 de secunde e doar plasa de siguranță. Bulina roșie
// apare PE LOC pentru că ascultăm exact canalele pe care mesageria dă semnalul
// când cineva trimite un mesaj (`mesagerie:<threadId>`, broadcast fără
// conținut — src/components/Mesagerie.jsx). Nimic nou de deschis către browser:
// numărul tot de la /api/messages vine, doar că îl cerem în clipa potrivită.
const RT_CANAL = (threadId) => `mesagerie:${threadId}`;
const RT_EVENIMENT = 'mesaj';
const MAX_CANALE = 24;
let canale = [];
let cheieCanale = '';
let rtDebounce = null;

// mai multe mesaje trimise unul după altul → o singură întrebare la server
function cereDupaSemnal() {
  clearTimeout(rtDebounce);
  rtDebounce = setTimeout(() => { fetchUnread(true); }, 300);
}

function ascultaFirele(ids) {
  const cheie = (ids || []).slice(0, MAX_CANALE).join(',');
  if (cheie === cheieCanale) return;          // aceleași fire → nu refacem nimic
  inchideCanale();
  cheieCanale = cheie;
  if (!cheie || !logat) return;
  canale = cheie.split(',').filter(Boolean).map((id) => {
    const ch = supabase.channel(RT_CANAL(id), { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: RT_EVENIMENT }, cereDupaSemnal);
    ch.subscribe();
    return ch;
  });
}

function inchideCanale() {
  clearTimeout(rtDebounce);
  canale.forEach((c) => { try { supabase.removeChannel(c); } catch { /* deja închis */ } });
  canale = [];
  cheieCanale = '';
}

// `loaded` = am primit măcar o dată un număr REAL de la server. Alerta de
// mesaj nou se uită la el ca să nu sune la prima încărcare, pentru mesaje
// vechi necitite.
let state = { count: 0, threads: 0, last: null, loaded: false };
const subs = new Set();
let timer = null;
let lastAt = 0;
let inFlight = null;
let logat = false;

function emit() {
  subs.forEach((fn) => { try { fn(state); } catch { /* componentă demontată */ } });
}

function setState(next) {
  const laFel = next.count === state.count
    && next.threads === state.threads
    && next.loaded === state.loaded
    && (next.last?.at || null) === (state.last?.at || null);
  if (laFel) return;
  state = next;
  emit();
}

async function fetchUnread(force = false) {
  if (!logat) return undefined;
  if (!force && Date.now() - lastAt < MIN_GAP) return undefined;
  if (inFlight) return inFlight;
  lastAt = Date.now();
  inFlight = (async () => {
    try {
      const r = await aiClient.chatUnread();
      setState({
        count: Math.max(0, Number(r?.count) || 0),
        threads: Math.max(0, Number(r?.threads) || 0),
        last: r?.last || null,
        loaded: true,
      });
      if (Array.isArray(r?.threadIds)) ascultaFirele(r.threadIds);
    } catch {
      // rețea sau sesiune expirată → păstrăm ultima valoare, reîncercăm la tic
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

const onWake = () => { if (document.visibilityState !== 'hidden') fetchUnread(true); };

function start() {
  if (timer) return;
  timer = setInterval(() => { if (document.visibilityState !== 'hidden') fetchUnread(); }, POLL);
  window.addEventListener('focus', onWake);
  document.addEventListener('visibilitychange', onWake);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  window.removeEventListener('focus', onWake);
  document.removeEventListener('visibilitychange', onWake);
  inchideCanale();
}

/**
 * Reîmprospătare la cerere (după citirea unui mesaj, la schimbarea paginii…).
 * `force` sare peste pragul de MIN_GAP; fără el, cererile prea dese se ignoră.
 */
export function refreshChatUnread(force = true) {
  return fetchUnread(force);
}

/**
 * Numărul exact, aflat din altă parte (mesageria îl are deja în lista de
 * conversații). Bulina se potrivește pe loc, fără încă o cerere la server.
 */
export function setChatUnread({ count = 0, threads = 0, last = null } = {}) {
  lastAt = Date.now();
  setState({
    count: Math.max(0, Number(count) || 0),
    threads: Math.max(0, Number(threads) || 0),
    last: last || null,
    loaded: true,
  });
}

/**
 * Mesajele necitite: { count, threads, last, loaded } — `last` e cel mai nou
 * mesaj necitit (expeditor + început de text), folosit de alerta de pe ecran;
 * `loaded` spune dacă numărul a venit deja de la server măcar o dată.
 * `enabled` = utilizator logat.
 */
export function useChatUnread(enabled = true) {
  const [val, setVal] = useState(state);

  useEffect(() => {
    if (!enabled) {
      logat = false;
      lastAt = 0;
      inchideCanale();
      setState({ count: 0, threads: 0, last: null, loaded: false });
      setVal(state);
      return undefined;
    }
    logat = true;
    subs.add(setVal);
    setVal(state);
    start();
    fetchUnread(true);
    return () => {
      subs.delete(setVal);
      if (!subs.size) stop();
    };
  }, [enabled]);

  return val;
}
