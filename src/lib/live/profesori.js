// =====================================================================
// src/lib/live/profesori.js — ASPECTUL profesorilor virtuali
// Numele, genul și descrierea vin de la server (api/_lib/live.js). Aici
// stă doar ce ține de imagine: portretul animat („rig"-ul) din public/live/<id>/.
//
// Un rig se adaugă fără cod: public/live/<id>/rig.json + fotografia lui (vezi
// GHID_MEDITATII_LIVE.md → „Portretul animat"). Până atunci, profesorul apare
// ca într-un Zoom cu camera oprită: inițiale, culoarea lui și inelul care
// pulsează când vorbește.
// =====================================================================
const rigCache = new Map();

export function loadRig(teacherId) {
  if (!teacherId) return Promise.resolve(null);
  if (rigCache.has(teacherId)) return rigCache.get(teacherId);
  // „no-cache" = revalidare (304 ieftin): după o scenă nouă, rig.json și imaginile rămân pereche
  const p = fetch(`/live/${encodeURIComponent(teacherId)}/rig.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((rig) => {
      if (!rig || !rig.photo) return null;
      const base = `/live/${teacherId}/`;
      const abs = (u) => (!u ? null : /^(https?:)?\//.test(u) ? u : base + u);
      return {
        ...rig,
        photo: abs(rig.photo), plate: abs(rig.plate), thumb: abs(rig.thumb || rig.photo),
        atlas: rig.atlas ? { ...rig.atlas, src: abs(rig.atlas.src) } : null,
        fg: rig.fg ? { ...rig.fg, src: abs(rig.fg.src) } : null,
      };
    })
    .catch(() => null);
  rigCache.set(teacherId, p);
  return p;
}

export function initials(name) {
  const parts = String(name || '').replace(/^prof\.?\s*/i, '').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'P';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

// culoarea de rezervă, dacă serverul nu trimite una
export const teacherColor = (t) => (t && t.color) || (t && t.gender === 'f' ? '#b0417a' : '#1f6dab');
