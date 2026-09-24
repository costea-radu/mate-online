// =====================================================================
// src/lib/live/realtime.js — cine e în sală, chatul și rezultatele, în timp real
//
// Canal PRIVAT Supabase Realtime „live:<id>" (vezi supabase/meditatii_live.sql):
//   · PREZENȚA — fiecare elev își anunță numele, mâna ridicată, reacțiile,
//     camera/microfonul (doar ca pictograme: imaginea și sunetul NU pleacă nicăieri);
//   · difuzările vin DOAR de la server: „chat" (mesaje + răspunsurile
//     profesorului), „poll" (rezultatele unei întrebări), „session" (schimbări).
// Dacă timpul real nu merge (rețea, politici), sala cade pe interogări rare.
// =====================================================================
import { supabase } from '../supabase';

export function joinLiveChannel({ sessionId, me, onPresence, onChat, onPoll, onSession, onStatus }) {
  let state = { id: me.id, name: me.name, role: 'elev', hand: false, cam: false, mic: false, reaction: null, joined: Date.now() };
  let lastTrack = 0, pending = null, subscribed = false;
  const ch = supabase.channel(`live:${sessionId}`, {
    config: { private: true, broadcast: { self: false }, presence: { key: me.id } },
  });

  const flush = async () => {
    pending = null;
    lastTrack = Date.now();
    if (!subscribed) return;
    try { await ch.track(state); } catch { /* reîncercăm la următoarea schimbare */ }
  };

  ch.on('presence', { event: 'sync' }, () => {
    const raw = ch.presenceState();
    const people = [];
    for (const [key, metas] of Object.entries(raw || {})) {
      const m = metas && metas[metas.length - 1];
      if (m) people.push({ ...m, id: m.id || key });
    }
    people.sort((a, b) => (a.joined || 0) - (b.joined || 0));
    onPresence?.(people);
  });
  ch.on('broadcast', { event: 'chat' }, ({ payload }) => payload?.msg && onChat?.(payload.msg));
  ch.on('broadcast', { event: 'poll' }, ({ payload }) => payload && onPoll?.(payload));
  ch.on('broadcast', { event: 'session' }, ({ payload }) => onSession?.(payload || {}));
  ch.subscribe((status) => {
    subscribed = status === 'SUBSCRIBED';
    onStatus?.(status);
    if (subscribed) flush();
  });

  return {
    // presence are limite de rată: grupăm schimbările (cel mult ~3/s)
    update(patch) {
      state = { ...state, ...patch };
      const wait = Math.max(0, 350 - (Date.now() - lastTrack));
      if (pending) return;
      pending = setTimeout(flush, wait);
    },
    get state() { return state; },
    leave() {
      if (pending) clearTimeout(pending);
      try { ch.untrack(); } catch { /* ignore */ }
      supabase.removeChannel(ch);
    },
  };
}
