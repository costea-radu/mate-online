// =====================================================================
// src/lib/aiModels.js — modelele Claude dintre care poate alege adminul
// în agenți (SEO, generator de exerciții, task-uri programate).
// OGLINDA listei permise de server (api/_lib/claude.js → MODELS) — ține-le
// sincron. Serverul validează oricum: un ID necunoscut cade pe implicit.
// TOATE modelele merg cu ACEEAȘI cheie ANTHROPIC_API_KEY din Vercel —
// nu e nevoie de chei separate; modelul se trimite per cerere.
// =====================================================================
export const AI_MODELS = [
  { id: 'claude-sonnet-5',   label: 'Sonnet 5',   hint: 'rapid și echilibrat — recomandat pentru sarcinile de zi cu zi' },
  { id: 'claude-opus-5',     label: 'Opus 5',     hint: 'foarte capabil — ideal pentru teste complexe și analize (mai lent și mai scump)' },
  { id: 'claude-fable-5',    label: 'Fable 5',    hint: 'cel mai nou și mai capabil model Anthropic (iunie 2026) — cel mai scump' },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5',  hint: 'cel mai rapid și mai ieftin — pentru sarcini simple (atenție la calcule)' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', hint: 'generația anterioară Sonnet' },
  { id: 'claude-opus-4-8',   label: 'Opus 4.8',   hint: 'generația anterioară Opus' },
];

export const DEFAULT_AI_MODEL = AI_MODELS[0].id;
