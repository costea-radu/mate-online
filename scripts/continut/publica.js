#!/usr/bin/env node
// =====================================================================
// scripts/continut/publica.js — GitHub Action-ul „Publică" (repo-ul privat
// examenmate-continut, .github/workflows/publica.yml) — 21 nov. 2026
//
// Rularea task-ului programat (skill-ul „examenmate-continut") pune fiecare unitate în
// unitati/<data>/<procedura>-<id>/ (fișierele + manifest.json) și face push. Action-ul
// clonează mate-online, rulează acest script cu cheia de serviciu (secretele
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) și:
//   · procesează fiecare unitate care n-are încă rezultate/<unitate>.json
//     (api/_lib/continutGenerat.js → proceseazaUnitate: precondițiile live, verificările
//     automate, urcarea în Storage, publicarea directă sau ciorna, jurnalul);
//   · scrie rezultatul în rezultate/<unitate>.json (Action-ul îl pune înapoi în repo).
// O unitate deja înregistrată nu se procesează a doua oară (unitate e UNIQUE în tabelă).
//
//   node scripts/continut/publica.js --dir <clona repo-ului privat>
// =====================================================================
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const CG = require('../../api/_lib/continutGenerat');

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
// rezultate/<unitate cu „/" → „__">.json
const cheieRezultat = (unitate) => String(unitate).replace(/[^A-Za-z0-9._-]+/g, '__');

// unitati/**/manifest.json → [{ folder, unitate }] (unitate = calea relativă la unitati/)
function gasesteUnitati(dir) {
  const radacina = path.join(dir, 'unitati');
  const out = [];
  if (!fs.existsSync(radacina)) return out;
  const walk = (d, adancime) => {
    if (adancime > 4) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, adancime + 1);
      else if (e.isFile() && e.name === 'manifest.json') out.push(path.dirname(p));
    }
  };
  walk(radacina, 0);
  return out.sort().map((folder) => ({ folder, unitate: path.relative(radacina, folder).split(path.sep).join('/') }));
}

async function proceseazaToate({ dir, supa, log = console.log }) {
  const rezultate = [];
  for (const { folder, unitate } of gasesteUnitati(dir)) {
    const fisRez = path.join(dir, 'rezultate', `${cheieRezultat(unitate)}.json`);
    if (fs.existsSync(fisRez)) continue;
    let rez;
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
      const citeste = async (nume) => {
        if (!CG.numeFisierOk(nume)) throw new Error(`nume de fișier nepermis: ${nume}`);
        return fs.readFileSync(path.join(folder, nume));
      };
      rez = await CG.proceseazaUnitate(supa, { manifest, unitate, citeste });
    } catch (e) {
      rez = { unitate, status: 'esuat', eroare: e.message };
    }
    rez = { ...rez, procesat_la: new Date().toISOString() };
    fs.mkdirSync(path.dirname(fisRez), { recursive: true });
    fs.writeFileSync(fisRez, `${JSON.stringify(rez, null, 2)}\n`);
    log(`${String(rez.status).padEnd(10)} ${unitate}${rez.motiv ? ` — ${rez.motiv}` : ''}${rez.eroare ? ` — ${rez.eroare}` : ''}`);
    rezultate.push(rez);
  }
  return rezultate;
}

async function main() {
  const dir = path.resolve(arg('--dir', process.cwd()));
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Lipsesc secretele SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (Settings → Secrets and variables → Actions).');
  }
  const supa = require('../../api/_lib/http').admin();
  const rez = await proceseazaToate({ dir, supa });
  const pe = (st) => rez.filter((r) => r.status === st).length;
  const rezumat = rez.length
    ? `Unități procesate: ${rez.length} · publicate ${pe('publicat')} · ciorne ${pe('ciorna')} · conflicte ${pe('conflict')} · eșuate ${pe('esuat')} · verificate ${pe('verificat')} · nimic ${pe('nimic')}`
    : 'Nicio unitate nouă.';
  console.log(rezumat);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const linii = rez.map((r) => `| ${r.status} | ${r.unitate} | ${(r.motiv || r.eroare || '').replace(/\|/g, '/').slice(0, 200)} |`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Publică\n\n${rezumat}\n\n${linii.length ? `| stare | unitate | motiv |\n|---|---|---|\n${linii.join('\n')}\n` : ''}`);
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { gasesteUnitati, proceseazaToate, cheieRezultat };
