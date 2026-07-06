// src/lib/aiLabel.js — eticheta asistentului AI, în funcție de rolul contului.
//   profesor → „Asistent AI pentru profesori"
//   părinte  → „Asistent AI pentru părinți"
//   elev / nelogat → „Profesor Virtual" (neschimbat)
export function aiAssistantLabel({ isTeacher, isParent } = {}) {
  if (isTeacher) return 'Asistent AI pentru profesori';
  if (isParent) return 'Asistent AI pentru părinți';
  return 'Profesor Virtual';
}
