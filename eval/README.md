# Setul de evaluare al agenților AI (`npm run eval`)

Măsoară, cu cifre, cât de corect rezolvă modelele tale itemii de examen — ca să
decizi pe bază de date ce model pui pe chat (`AI_CHAT_MODEL` / `AI_TUTOR_MODEL`),
pe generare (`AI_GEN_CHAT_MODEL`) și pe verificare (`AI_VERIFY_MODEL`), și ca să
prinzi regresiile când schimbi un prompt.

## Rulare

```bash
npm run eval                                   # toate itemii, modelul de chat din env, tutor + verificator
npm run eval -- --models gpt-4o-mini,gpt-5-mini --mode tutor
npm run eval -- --only en --limit 15           # doar Evaluare Națională, primii 15
npm run eval -- --models gpt-5-mini --effort low   # modele cu raționament: reasoning_effort
npm run eval -- --mock                         # fără rețea — verifică harness-ul (trebuie 100%)
```

## Cum decizi modelul de chat (punctul 1.4 din audit)

1. `npm run eval -- --mode tutor --models gpt-4o-mini,gpt-5-mini --effort low` (≈ 0,1–0,3 lei pe rulare completă).
2. Compară acuratețea și costul din rezumat (și itemii greșiți din `.md`).
3. Pune câștigătorul DOAR pe explicațiile pas-cu-pas: `AI_TUTOR_MODEL=gpt-5-mini` și, dacă e model
   cu raționament, `AI_REASONING_EFFORT=low` (în Vercel → Environment Variables). Asistentul
   general (`assistant`/`exams`/`students`) rămâne pe `AI_CHAT_MODEL` — acolo nu se calculează.
4. Peste bugetul zilnic soft, `pickModel` coboară automat pe `AI_CHAT_MODEL` (vezi GHID_LIMITE_AI.md).

Cheile se citesc din env sau din `.env.local` / `.env` (necomise). Rapoartele ajung în
`eval/reports/<data>_<mod>_<model>.md` + `.json` (ignorate de git), cu acuratețea pe
examen, itemii greșiți (oficial vs. obținut) și costul estimat în lei.

- **mode=tutor** — Profesorul Virtual cu persona și regulile reale (`api/_lib/ai.js`),
  fără RAG; i se cere rezolvarea completă și o linie finală `RĂSPUNS FINAL: …`.
- **mode=verify** — verificatorul independent (`api/_lib/verify.js`): rezolvă fără cheie
  și compară. Așa vezi cât de bun e modelul din `AI_VERIFY_MODEL` înainte să te bazezi pe el.

Compararea răspunsurilor e matematică, nu textuală (`api/_lib/mathcheck.js`): `1/2 = 0,5`,
`x = 3` = `3`, `2\sqrt{3}` = `2√3`, mulțimi în orice ordine. „Nedecis” = forme pe care
codul nu le poate compara (demonstrații, text) — nu se numără nici corect, nici greșit.

## Itemi

`eval/items/*.json` — fiecare fișier e o listă de itemi:

```json
{ "id": "en-002", "exam": "evaluare-nationala", "subject": "I", "topic": "procente",
  "statement": "$25\\%$ din $840$ este:", "options": ["21", "210", "2100", "84"], "answer": "b",
  "source": "seed — verificat manual" }
{ "id": "bac-015", "exam": "bacalaureat", "profile": "mate-info", "topic": "derivate",
  "statement": "Fie $f(x) = \\frac{1}{x-1}$. Determinați $f'(x)$.", "answer": "-1/(x-1)^2" }
```

- `seed-en.json`, `seed-bac.json` — 52 de itemi scriși și verificați manual (pornire).
- `node eval/import-db.js` — importă exercițiile interactive structurate din `content`
  (cu răspunsurile lor) → `db-<categorie>.json`. Setul crește cu materialele tale.
- `node eval/import-feedback.js` — fiecare 👎 din chat devine un item `needsReview: true`
  (întrebarea + răspunsul considerat greșit). Completezi `answer` după verificare și
  devine caz de regresie; până atunci e sărit (vezi-l cu `--include-review`).

Regula de aur: un item intră în set DOAR cu răspunsul oficial verificat (barem sau
calcul propriu). Un set cu chei greșite măsoară greșit.
