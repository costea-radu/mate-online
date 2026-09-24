// =====================================================================
// src/lib/live/timeline.js — cronologia lecției în browser
// OGLINDA funcțiilor sceneAt / qnaSchedule din api/_lib/live.js (testate
// acolo și aici, în test/meditatii-live-client.test.js): fiecare browser
// calculează la fel unde suntem, deci toți elevii văd și aud același lucru.
// =====================================================================

export function sceneAt(timeline, pos) {
  const sc = (timeline && timeline.scenes) || [];
  if (!sc.length) return { index: -1, scene: null, offset: 0 };
  if (pos <= 0) return { index: 0, scene: sc[0], offset: Math.max(0, pos) };
  for (let i = 0; i < sc.length; i++) {
    const s = sc[i];
    if (pos < s.t0 + s.dur || i === sc.length - 1) return { index: i, scene: s, offset: Math.max(0, pos - s.t0) };
  }
  return { index: sc.length - 1, scene: sc[sc.length - 1], offset: 0 };
}

// segmentul care se aude la `offset` secunde în scenă (sau null în pauze)
export function segmentAt(scene, offset) {
  const segs = scene?.segs || [];
  for (let i = 0; i < segs.length; i++) {
    const g = segs[i];
    if (offset >= g.t && offset < g.t + g.dur) return { index: i, seg: g, into: offset - g.t };
  }
  return { index: -1, seg: null, into: 0 };
}

// Răspunsurile rostite ale profesorului în sesiunile de întrebări (grup) —
// programare deterministă, identică pe server și în fiecare browser.
export function qnaSchedule(msgs, windows) {
  const out = [];
  const ws = (windows || []).slice().sort((a, b) => a.t0 - b.t0);
  const queue = (msgs || []).filter((m) => m && m.dur > 0).slice().sort((a, b) => a.id - b.id);
  let wi = 0, cursor = ws.length ? ws[0].t0 : 0;
  for (const m of queue) {
    let placed = false;
    while (wi < ws.length && !placed) {
      const w = ws[wi];
      const start = Math.max(cursor, w.t0, (m.createdSec || 0) + 1.5);
      if (start + m.dur <= w.t1 + 0.01) {
        out.push({ id: m.id, at: Math.round(start * 1000) / 1000, dur: m.dur });
        cursor = start + m.dur + 0.8;
        placed = true;
      } else {
        wi++;
        cursor = wi < ws.length ? ws[wi].t0 : cursor;
      }
    }
    if (!placed) break;
  }
  return out;
}

// ferestrele de întrebări dintr-o cronologie
export function qnaWindows(timeline) {
  return ((timeline && timeline.scenes) || []).filter((s) => s.type === 'intrebari').map((s) => ({ t0: s.t0, t1: s.t0 + s.dur }));
}

// Tabla pentru itemul curent: toate rândurile scrise până acum în scenele
// „explicatie" ale itemului (pe barem, apoi celelalte moduri), plus cât din
// rândul curent e scris (0..1) — scrisul merge în ritmul vocii.
export function boardState(timeline, index, offset) {
  const sc = (timeline && timeline.scenes) || [];
  const cur = sc[index];
  if (!cur || cur.item == null) return null;
  const item = cur.item;
  const blocks = [];
  for (let i = 0; i <= index; i++) {
    const s = sc[i];
    if (s.item !== item || s.type !== 'explicatie') continue;
    const lines = [];
    const within = i === index ? offset : Infinity;
    for (const g of s.segs || []) {
      if (!g.board || !g.board.length) continue;
      if (within < g.t) break;
      const frac = within >= g.t + g.dur ? 1 : Math.max(0, (within - g.t) / Math.max(0.1, g.dur));
      const n = g.board.length;
      g.board.forEach((text, j) => {
        const f = Math.max(0, Math.min(1, frac * n - j));
        if (f > 0) lines.push({ key: `${g.id}-${j}`, text, frac: f });
      });
    }
    blocks.push({ key: `b${i}`, mode: s.mode, label: s.label, lines });
  }
  return { item, ref: cur.ref, title: cur.title, blocks };
}

// Scena „item" (enunțul) a itemului — pentru tabla digitală
export function itemHead(timeline, item) {
  return ((timeline && timeline.scenes) || []).find((s) => s.type === 'item' && s.item === item) || null;
}

export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
}
