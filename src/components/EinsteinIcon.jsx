// =====================================================================
// src/components/EinsteinIcon.jsx
// Desen original (caricatură) care evocă Einstein — păr alb dezordonat +
// mustață stufoasă. Nu este o fotografie protejată de drepturi de autor.
// =====================================================================
export default function EinsteinIcon({ size = 40, style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={style} aria-label="Profesor Virtual" role="img">
      {/* păr alb dezordonat (spate) */}
      <g fill="#f3f4f6" stroke="#d9dce1" strokeWidth="1">
        <path d="M14 30 C4 30 6 16 14 16 C10 8 22 4 26 10 C30 3 44 5 44 13 C54 10 58 24 50 28 C60 30 56 42 48 40 L16 40 C8 42 6 32 14 30 Z" />
        <circle cx="12" cy="26" r="5" /><circle cx="9" cy="33" r="4" />
        <circle cx="52" cy="24" r="5" /><circle cx="55" cy="32" r="4" />
        <circle cx="18" cy="15" r="4" /><circle cx="46" cy="15" r="4" />
      </g>
      {/* față */}
      <ellipse cx="32" cy="33" rx="15" ry="16" fill="#f7d9b8" stroke="#e0b98f" strokeWidth="1" />
      {/* frunte / linii */}
      <path d="M24 24 Q32 21 40 24" fill="none" stroke="#e0b98f" strokeWidth="1" opacity=".7" />
      {/* sprâncene stufoase */}
      <path d="M22 29 Q26 26 30 29" fill="none" stroke="#c9ccd1" strokeWidth="3" strokeLinecap="round" />
      <path d="M34 29 Q38 26 42 29" fill="none" stroke="#c9ccd1" strokeWidth="3" strokeLinecap="round" />
      {/* ochi */}
      <circle cx="26" cy="33" r="2" fill="#3a3f47" />
      <circle cx="38" cy="33" r="2" fill="#3a3f47" />
      {/* nas */}
      <path d="M32 34 L30 40 Q32 42 34 40" fill="none" stroke="#d9a878" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* mustață stufoasă */}
      <path d="M22 43 Q27 41 32 43 Q37 41 42 43 Q40 48 32 46 Q24 48 22 43 Z" fill="#e6e8eb" stroke="#c9ccd1" strokeWidth="1" />
      {/* gură */}
      <path d="M28 47 Q32 49 36 47" fill="none" stroke="#b98a63" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
