// =====================================================================
// src/lib/live/player.js — „regizorul" sălii: ce se aude, ce se scrie pe
// tablă și ce întrebare e deschisă, în fiecare moment.
//
// GroupPlayer  — ședința de grup: cronologia e FIXĂ și comună; poziția =
//                ceasul comun − ora de început. Nimeni nu poate opri lecția
//                (ca într-un Zoom real, profesorul merge mai departe), iar
//                cine intră mai târziu aterizează exact unde e clasa.
// PrivatePlayer — 1-la-1: lecția se oprește la întrebări și la „Ai înțeles?",
//                elevul poate cere „Explică altfel", poate pune întrebări (profesorul
//                răspunde cu voce și apoi reia), poate sări la alt item.
//
// Ambele emit o stare simplă (onState) pe care o desenează React.
// =====================================================================
import { clock } from './clock';
import { sceneAt, segmentAt, boardState, itemHead, qnaSchedule, qnaWindows } from './timeline';

const LOOKAHEAD = 9;   // secunde: vocea următoare se descarcă și se programează din timp

// cât durează o frază rostită de vocea browserului (fără fișier audio) — aceeași
// estimare ca pe server (api/_lib/live.js → segDuration), cu o marjă pentru pornire
export const estimateSpeechSec = (text) => {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  return Math.max(1.5, words / 2.4 + 0.5);
};
const TICK_MS = 120;

function captionOf(scene, offset) {
  const { seg } = segmentAt(scene, offset);
  return seg ? seg.caption || seg.say : null;
}

// ═════════════════════════════════════════════════════════════════════════════
export class GroupPlayer {
  constructor({ engine, onState, startsAt = null }) {
    this.engine = engine;
    this.onState = onState;
    this.startsAt = startsAt ? Date.parse(startsAt) : null;   // numărătoarea din sala de așteptare
    this.tl = null;
    this.startedAt = null;
    this.answers = [];       // răspunsurile rostite ale profesorului (întrebări din chat)
    this.plan = [];
    this.timer = null;
    this.lastIndex = -1;
  }

  setTimeline(tl, startedAtIso) {
    this.tl = tl;
    this.startedAt = startedAtIso ? Date.parse(startedAtIso) : null;
    this._replan();
  }

  // mesajele profesorului cu voce: [{ id, sec, dur, audio, lip, text }]
  setAnswers(list) {
    // cu voce generată (fișier) sau, fără chei TTS, rostite de vocea browserului
    this.answers = (list || []).filter((m) => m.role === 'profesor' && !m.private && m.text)
      .map((m) => (m.audio && m.dur > 0 ? m : { ...m, audio: null, dur: estimateSpeechSec(m.text) }));
    this._replan();
  }

  _replan() {
    if (!this.tl) { this.plan = []; return; }
    const msgs = this.answers.map((m) => ({ id: m.id, createdSec: m.sec || 0, dur: m.dur }));
    const byId = new Map(this.answers.map((m) => [m.id, m]));
    this.plan = qnaSchedule(msgs, qnaWindows(this.tl)).map((p) => ({ ...p, msg: byId.get(p.id) }));
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }
  stop() { clearInterval(this.timer); this.timer = null; this.engine.stopAll(null, { hard: true }); }

  position() { return this.startedAt ? (clock.now() - this.startedAt) / 1000 : null; }

  tick() {
    const tl = this.tl;
    const pos = this.position();
    if (!tl || pos == null) {
      // ceasul comun nu a pornit încă: numărăm până la ora de început (serverul hotărăște atunci)
      const startsIn = this.startsAt ? Math.max(0, (this.startsAt - clock.now()) / 1000) : null;
      this.onState({ phase: 'asteptare', pos: null, startsIn });
      return;
    }
    if (pos < 0) {
      this.engine.stopAll();
      this.onState({ phase: 'asteptare', pos, startsIn: -pos, duration: tl.duration });
      return;
    }
    if (pos >= tl.duration) {
      this.engine.stopAll();
      this.onState({ phase: 'final', pos, duration: tl.duration });
      return;
    }
    const at = sceneAt(tl, pos);
    const want = new Set();
    // vocea: segmentele din scena curentă și din următoarele, în fereastra de anticipare
    for (let i = at.index; i < tl.scenes.length; i++) {
      const s = tl.scenes[i];
      if (s.t0 > pos + LOOKAHEAD) break;
      for (const g of s.segs || []) {
        const t0 = s.t0 + g.t;
        if (t0 + g.dur < pos || t0 > pos + LOOKAHEAD) continue;
        want.add(g.id);
        if (!this.engine.isPlaying(g.id)) {
          this.engine.play(g.id, { url: g.audio, atServerMs: this.startedAt + t0 * 1000, dur: g.dur, lip: g.lip, text: g.say });
        }
      }
    }
    // răspunsurile la întrebări, în ferestrele „Întrebări"
    let answering = null;
    for (const p of this.plan) {
      if (p.at + p.dur < pos || p.at > pos + LOOKAHEAD) continue;
      const id = `qa${p.id}`;
      want.add(id);
      if (!this.engine.isPlaying(id)) this.engine.play(id, { url: p.msg.audio, atServerMs: this.startedAt + p.at * 1000, dur: p.dur, lip: p.msg.lip, text: p.msg.text });
      if (pos >= p.at && pos < p.at + p.dur) answering = p.msg;
    }
    this.engine.stopExcept(want);

    const scene = at.scene;
    const seg = segmentAt(scene, at.offset);
    const board = boardState(tl, at.index, at.offset);
    const head = scene && scene.item != null ? itemHead(tl, scene.item) : null;
    this.lastIndex = at.index;
    this.onState({
      phase: 'live', pos, duration: tl.duration,
      index: at.index, scene, offset: at.offset, remaining: scene ? scene.t0 + scene.dur - pos : 0,
      seg: seg.seg, caption: answering ? answering.text : captionOf(scene, at.offset),
      board, head, answering,
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 1-la-1
// ═════════════════════════════════════════════════════════════════════════════
export class PrivatePlayer {
  constructor({ engine, onState, onSceneChange = null, onNeedAudio = null }) {
    this.engine = engine;
    this.onState = onState;
    this.onSceneChange = onSceneChange;
    this.onNeedAudio = onNeedAudio;
    this.tl = null;
    this.index = 0;
    this.sceneStart = null;       // ora comună (ms) la care offsetul scenei era 0
    this.pausedAt = null;         // offsetul la pauză
    this.inserted = null;         // { kind: 'alt'|'raspuns', scene, back: { index, offset } }
    this.status = 'oprit';        // oprit | ruleaza | pauza | asteapta | incarca | final
    this.timer = null;
    this.answered = {};           // pollId → { answer, correct }
    this.altUsed = {};            // index scenă → câte moduri s-au folosit
  }

  setTimeline(tl) {
    const first = !this.tl;
    this.tl = tl;
    if (first) this.index = 0;
  }

  resumeAt(index) {
    if (!this.tl) return;
    this.index = Math.max(0, Math.min(this.tl.scenes.length - 1, index || 0));
    // reluare: de la începutul itemului (enunțul), nu din mijlocul unei fraze
    const s = this.tl.scenes[this.index];
    if (s && s.item != null) {
      const head = this.tl.scenes.findIndex((x) => x.item === s.item);
      if (head >= 0) this.index = head;
    }
  }

  get scene() { return this.inserted ? this.inserted.scene : (this.tl ? this.tl.scenes[this.index] : null); }

  start() {
    if (!this.tl) return;
    this.status = 'ruleaza';
    this.sceneStart = clock.now();
    this.pausedAt = null;
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }
  stop() { clearInterval(this.timer); this.timer = null; this.engine.stopAll(null, { hard: true }); this.status = 'oprit'; }

  offset() {
    if (this.pausedAt != null) return this.pausedAt;
    return this.sceneStart == null ? 0 : (clock.now() - this.sceneStart) / 1000;
  }

  pause() {
    if (this.status !== 'ruleaza' && this.status !== 'incarca') return;
    this.pausedAt = this.offset();
    this.status = 'pauza';
    this.engine.stopAll(null, { hard: true });
    this.tick();
  }
  resume() {
    if (this.status !== 'pauza') return;
    // reluăm fraza curentă de la început (ca un profesor care reia ideea)
    const sc = this.scene;
    const { seg } = segmentAt(sc, this.pausedAt || 0);
    const from = seg ? seg.t : (this.pausedAt || 0);
    this.sceneStart = clock.now() - from * 1000;
    this.pausedAt = null;
    this.status = 'ruleaza';
    this.tick();
  }

  _enter(index, { hard = true } = {}) {
    this.engine.stopAll(null, { hard });
    this.inserted = null;
    this.index = Math.max(0, Math.min(this.tl.scenes.length - 1, index));
    this.sceneStart = clock.now() + 250;
    this.pausedAt = null;
    const s = this.tl.scenes[this.index];
    this.status = s && s.wait && !(s.poll && this.answered[s.poll.id]) ? 'asteapta' : 'ruleaza';
    this.onSceneChange?.(this.index);
    this.tick();
  }

  next() {
    if (!this.tl) return;
    if (this.inserted) return this._leaveInserted();
    if (this.index >= this.tl.scenes.length - 1) { this.status = 'final'; this.engine.stopAll(); this.tick(); return; }
    this._enter(this.index + 1, { hard: false });
  }

  // salt la începutul altui item (Cuprins) sau la itemul anterior / următor
  gotoItem(item) {
    if (!this.tl) return;
    const i = this.tl.scenes.findIndex((s) => s.item === item);
    if (i >= 0) this._enter(i);
  }
  prevItem() {
    const cur = this.scene?.item;
    if (cur == null) return this._enter(0);
    const start = this.tl.scenes.findIndex((s) => s.item === cur);
    const withinFirstSeconds = this.offset() < 4 && this.index === start;
    const target = withinFirstSeconds ? cur - 1 : cur;
    if (target < 0) return this._enter(0);
    this.gotoItem(target);
  }
  nextItem() {
    const cur = this.scene?.item;
    const i = this.tl.scenes.findIndex((s) => s.item != null && s.item > (cur ?? -1));
    if (i >= 0) this._enter(i); else this._enter(this.tl.scenes.length - 1);
  }

  // răspunsul elevului la întrebare (verificat deja de server)
  pollDone(pollId, result) {
    this.answered[pollId] = result;
    if (this.scene?.type === 'sondaj') this.next();
    else this.tick();
  }

  // „Ai înțeles?" → Da
  understood() { if (this.scene?.type === 'intrebare_intelegere') this.next(); }

  // „Explică altfel" → următorul mod nefolosit (intuitiv → greșeli → altă metodă)
  explainAgain() {
    const sc = this.tl?.scenes[this.index];
    if (!sc || sc.type !== 'intrebare_intelegere' || !sc.alts?.length) return false;
    const k = this.altUsed[this.index] || 0;
    const alt = sc.alts[k % sc.alts.length];
    this.altUsed[this.index] = k + 1;
    this.engine.stopAll(null, { hard: true });
    this.inserted = {
      kind: 'alt',
      scene: { type: 'explicatie', item: sc.item, ref: sc.ref, section: sc.section, title: sc.title, mode: alt.mode, label: alt.label, segs: alt.segs, dur: alt.dur, t0: 0 },
      back: { index: this.index },
    };
    this.sceneStart = clock.now() + 200;
    this.pausedAt = null;
    this.status = 'ruleaza';
    this.tick();
    return true;
  }

  // răspunsul profesorului la o întrebare: întrerupe, răspunde, apoi reia fraza
  playAnswer(msg) {
    if (!msg) return;
    const cur = this.inserted && this.inserted.kind === 'raspuns' ? this.inserted.back : { index: this.index, offset: this.offset(), inserted: this.inserted };
    const dur = msg.dur || estimateSpeechSec(msg.say || msg.text);
    this.engine.stopAll(null, { hard: true });
    this.inserted = {
      kind: 'raspuns',
      scene: { type: 'raspuns', item: this.scene?.item ?? null, t0: 0, dur: dur + 0.6, answerBoard: msg.board || [],
        segs: [{ id: `ans${msg.id}`, t: 0, dur, audio: msg.audio || null, lip: msg.lip || null, say: msg.say || msg.text, caption: msg.text, board: [] }] },
      back: cur,
    };
    this.sceneStart = clock.now() + 150;
    this.pausedAt = null;
    this.status = 'ruleaza';
    this.tick();
  }

  _leaveInserted() {
    const ins = this.inserted;
    this.inserted = null;
    this.engine.stopAll();
    if (ins.kind === 'alt') {
      // după „altfel", întrebăm iar „Ai înțeles?"
      this.index = ins.back.index;
      this.status = 'asteapta';
      this.tick();
      return;
    }
    // după răspuns: înapoi exact unde eram (fraza reluată de la început)
    const back = ins.back || { index: this.index, offset: 0 };
    if (back.inserted) { this.inserted = back.inserted; }
    else this.index = back.index;
    const sc = this.scene;
    if (sc && sc.wait) { this.status = 'asteapta'; this.tick(); return; }
    const { seg } = segmentAt(sc, back.offset || 0);
    const from = seg ? seg.t : Math.min(back.offset || 0, sc ? sc.dur : 0);
    this.sceneStart = clock.now() - from * 1000 + 300;
    this.status = 'ruleaza';
    this.tick();
  }

  tick() {
    const tl = this.tl;
    if (!tl) { this.onState({ phase: 'asteptare' }); return; }
    let sc = this.scene;
    if (this.status === 'ruleaza' && sc && !sc.wait) {
      const off = this.offset();
      // vocea încă se generează pentru segmentul următor → așteptăm (1-la-1 poate porni devreme)
      const { seg } = segmentAt(sc, Math.max(0, off));
      if (seg && !seg.audio && !tl.noVoice && !this.inserted) {
        this.pausedAt = seg.t; this.status = 'incarca'; this.engine.stopAll();
        this.onNeedAudio?.();
      } else if (off >= sc.dur) {
        this.next();
        return;
      } else {
        const want = new Set();
        for (const g of sc.segs || []) {
          if (g.t + g.dur < off || g.t > off + LOOKAHEAD) continue;
          want.add(g.id);
          if (!this.engine.isPlaying(g.id)) this.engine.play(g.id, { url: g.audio, atServerMs: this.sceneStart + g.t * 1000, dur: g.dur, lip: g.lip, text: g.say });
        }
        this.engine.stopExcept(want);
      }
    } else if (this.status === 'incarca') {
      const { seg } = segmentAt(sc, this.pausedAt || 0);
      if (!seg || seg.audio) { this.status = 'pauza'; this.resume(); return; }
    }
    sc = this.scene;
    const off = this.status === 'ruleaza' ? this.offset() : (this.pausedAt ?? 0);
    const { seg } = segmentAt(sc, off);
    // tabla: lucrăm pe cronologia reală; o scenă inserată („altfel", răspunsul) se adaugă dedesubt
    let board = null, head = null;
    if (sc && sc.item != null) {
      const baseIndex = this.inserted ? (this.inserted.back?.index ?? this.index) : this.index;
      const base = boardState(tl, baseIndex, this.inserted ? Infinity : off) || { item: sc.item, ref: sc.ref, title: sc.title, blocks: [] };
      if (this.inserted?.kind === 'alt') {
        const extra = boardState({ scenes: [sc] }, 0, off);
        board = { ...base, blocks: [...base.blocks, ...(extra?.blocks || []).map((b) => ({ ...b, key: 'alt-' + b.key }))] };
      } else if (this.inserted?.kind === 'raspuns' && sc.answerBoard?.length) {
        board = { ...base, blocks: [...base.blocks, { key: 'raspuns', mode: 'raspuns', label: 'Răspuns la întrebare', lines: sc.answerBoard.map((t, j) => ({ key: `ra${j}`, text: t, frac: 1 })) }] };
      } else board = base;
      head = itemHead(tl, sc.item);
    }
    this.onState({
      phase: this.status === 'final' ? 'final' : 'live', status: this.status,
      index: this.index, scene: sc, offset: off, seg: seg || null,
      caption: captionOf(sc, off), board, head, inserted: this.inserted?.kind || null,
      answered: this.answered, altLeft: sc?.alts ? sc.alts.length - ((this.altUsed[this.index] || 0) % (sc.alts.length || 1)) : 0,
    });
  }
}
