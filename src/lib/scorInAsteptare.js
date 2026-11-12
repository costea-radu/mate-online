// =====================================================================
// src/lib/scorInAsteptare.js — rezultatul unui test rezolvat FĂRĂ cont, păstrat
// până la crearea contului (11 nov. 2026, seara)
//
// De ce: testele interactive se rezolvă fără cont, dar rezultatul vizitatorului
// se pierdea și nimic nu-l invita să-și facă unul — exact în clipa în care îi
// pasă cel mai mult (tocmai și-a aflat nota). Acum, la sfârșitul testului
// apare „Creează cont gratuit ca să-ți păstrezi rezultatul" (InteractiveViewer),
// rezultatul stă 48 de ore în browser, iar după autentificare îl salvează
// serverul, VERIFICAT din răspunsuri (src/components/ScorInAsteptare.jsx →
// /api/ai-score). Logică pură — testată în test/scor-in-asteptare.test.js.
// =====================================================================
export const CHEIE = 'em_scor_in_asteptare';
export const VALABIL_MS = 48 * 3600 * 1000;
export const INCERCARI_MAX = 3;

const stocare = () => { try { return window.localStorage; } catch { return null; } };

export function pastreazaScor(s, { storage = stocare(), now = Date.now() } = {}) {
  if (!storage || !s || !s.contentId) return false;
  const score = Number(s.score);
  const maxScore = Number(s.maxScore);
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0 || score < 0) return false;
  const rand = {
    contentId: String(s.contentId),
    title: String(s.title || '').slice(0, 160),
    score: Math.min(score, maxScore),
    maxScore,
    answers: Array.isArray(s.answers) && s.answers.length ? s.answers.slice(0, 60) : null,
    durationSec: Math.max(0, Math.min(6 * 3600, Math.round(Number(s.durationSec) || 0))),
    at: now,
    incercari: 0,
  };
  try { storage.setItem(CHEIE, JSON.stringify(rand)); return true; } catch { return false; }
}

export function uitaScorul({ storage = stocare() } = {}) {
  try { if (storage) storage.removeItem(CHEIE); } catch { /* ignore */ }
}

// rezultatul păstrat (sau null: nimic, expirat ori stricat — atunci se și șterge)
export function scorPastrat({ storage = stocare(), now = Date.now() } = {}) {
  if (!storage) return null;
  let s = null;
  try { s = JSON.parse(storage.getItem(CHEIE) || 'null'); } catch { s = null; }
  if (!s) return null;
  const ok = s.contentId && Number(s.maxScore) > 0 && Number.isFinite(Number(s.score)) && now - Number(s.at || 0) < VALABIL_MS && now >= Number(s.at || 0) - 60000;
  if (!ok) { uitaScorul({ storage }); return null; }
  return s;
}

// încă o încercare de salvare; după INCERCARI_MAX renunțăm (rezultatul se șterge)
export function incaOIncercare({ storage = stocare(), now = Date.now() } = {}) {
  const s = scorPastrat({ storage, now });
  if (!s) return null;
  s.incercari = (Number(s.incercari) || 0) + 1;
  if (s.incercari > INCERCARI_MAX) { uitaScorul({ storage }); return null; }
  try { storage.setItem(CHEIE, JSON.stringify(s)); } catch { /* ignore */ }
  return s;
}

// eroarea serverului e definitivă (nu are rost să mai încercăm)?
export const eroareDefinitiva = (mesaj) => /verific|negăsit|interzis|obligatoriu|abonament/i.test(String(mesaj || ''));
