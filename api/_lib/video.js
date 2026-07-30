// =====================================================================
// api/_lib/video.js — GENERATORUL DE VIDEOCLIPURI SIMPLE ale agentului
// (extensia Fazei 4 din GHID_AGENT_SEO_ACTIUNI.md, cerută de admin).
//
// Ce face: montaj de SLIDE-URI branded (aceleași fonturi/culori ca
// api/social-image.js) + imagini reale din site → MP4 H.264 (implicit
// vertical 1080×1920 — Reels/Shorts/TikTok; opțional orizontal), cu
// MUZICĂ DE FUNDAL: instrumental original sintetizat, inclus în repo
// (api/_lib/audio/fundal.mp3 — fără drepturi de autor). Adminul îl poate
// înlocui oricând urcând propriul fișier în Storage, bucketul
// `agent-media`, la calea `audio/fundal.mp3` (are prioritate; vezi
// resolveMusic). Fără niciun fișier → pistă de liniște (ca înainte).
//
// Șabloane de scenă:
//   intro      — titlu mare + subtitlu (deschiderea clipului)
//   lista      — titlu + până la 5 puncte (funcții, pași, formule Unicode)
//   imagine    — imagine reală (URL) + titlu dedesubt (paginile site-ului)
//   statistica — număr/valoare uriașă + explicație (ex. „500+ exerciții")
//   final      — CTA de închidere (examenmate.com + îndemn)
//
// Lanțul: satori (slide → SVG) → sharp (SVG → PNG) → ffmpeg (PNG-uri cu
// durate → MP4). ffmpeg vine din pachetul `ffmpeg-static` (binar inclus
// la npm install); satori/sharp există din Faza 3. Toate încărcate LAZY —
// fără ele restul agentului merge, iar execuția dă un mesaj clar.
//
// Cine cheamă renderVideo(): api/_lib/seo.js → executeAction('create_video')
// (la APROBAREA propunerii — nimic nu se randează fără OK-ul adminului).
// Fișierul rezultat urcă în Supabase Storage (bucket public `agent-media`,
// creat de supabase/agent_media.sql) — URL-ul devine media_url pentru
// FB/IG (publicare automată) sau pentru coada manuală YouTube/TikTok.
// =====================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SITE = (process.env.SITE_ORIGIN && process.env.SITE_ORIGIN !== '*')
  ? process.env.SITE_ORIGIN.replace(/\/$/, '')
  : 'https://examenmate.com';

// Brandul (oglinda src/styles/global.css — aceleași valori ca social-image.js)
const NAVY = '#0f2b44', NAVY_DARK = '#091e30', NAVY_LIGHT = '#183d5e';
const GOLD = '#e8b931', GOLD_LIGHT = '#f5d76e';
const WHITE = '#ffffff', MUTED = '#b8c4d4';

const SCENE_TEMPLATES = ['intro', 'lista', 'imagine', 'statistica', 'final'];
const FORMATS = { vertical: { w: 1080, h: 1920 }, orizontal: { w: 1920, h: 1080 } };
const STORAGE_BUCKET = 'agent-media';

// ─── Validarea specificației (PURĂ — testată în test/video.test.js) ──────────
function checkVideoSpec(input = {}) {
  const format = input.format === 'orizontal' ? 'orizontal' : 'vertical';
  const raw = Array.isArray(input.scenes) ? input.scenes : [];
  if (raw.length < 2) throw new Error('Clipul are nevoie de minim 2 scene (ex. intro + final).');
  if (raw.length > 12) throw new Error(`${raw.length} scene — maxim 12 (clip scurt = clip văzut).`);

  const scenes = raw.map((sc, i) => {
    const template = String(sc.template || '').toLowerCase();
    if (!SCENE_TEMPLATES.includes(template)) {
      throw new Error(`Scena ${i + 1}: șablon necunoscut „${sc.template}". Permise: ${SCENE_TEMPLATES.join(', ')}.`);
    }
    const title = String(sc.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title && template !== 'final') throw new Error(`Scena ${i + 1} (${template}): title e obligatoriu.`);
    const out = {
      template, title,
      subtitle: String(sc.subtitle || '').replace(/\s+/g, ' ').trim().slice(0, 220),
      badge: String(sc.badge || '').trim().slice(0, 30),
      seconds: Math.min(Math.max(Number(sc.seconds) || 3.5, 1.5), 10),
    };
    if (template === 'lista') {
      const bullets = (Array.isArray(sc.bullets) ? sc.bullets : [])
        .map((b) => String(b).replace(/\s+/g, ' ').trim().slice(0, 90)).filter(Boolean).slice(0, 5);
      if (!bullets.length) throw new Error(`Scena ${i + 1} (lista): bullets e obligatoriu (1–5 puncte).`);
      out.bullets = bullets;
    }
    if (template === 'imagine') {
      const u = String(sc.image_url || '').trim();
      if (!u) throw new Error(`Scena ${i + 1} (imagine): image_url e obligatoriu (URL REAL — og_image, card generat, imagine din site).`);
      if (!/^https?:\/\//.test(u) && !u.startsWith('/')) throw new Error(`Scena ${i + 1}: image_url trebuie să fie URL absolut (https://…) sau rută pe site (/...).`);
      out.image_url = u.startsWith('/') ? SITE + u : u;
    }
    return out;
  });

  const total = scenes.reduce((s, sc) => s + sc.seconds, 0);
  if (total > 75) throw new Error(`Durata totală e ${Math.round(total)}s — maxim 75s (Reels/Shorts performează scurt).`);
  return { format, scenes, seconds: Math.round(total * 10) / 10, ...FORMATS[format] };
}

// ─── Slide-urile (satori, fără React) ────────────────────────────────────────
const h = (type, style, ...children) => ({
  type,
  props: { style, children: children.length === 1 ? children[0] : children },
});

function fontDir() {
  const local = path.join(__dirname, 'fonts');
  if (fs.existsSync(local)) return local;
  return path.join(process.cwd(), 'api', '_lib', 'fonts');
}

// ─── Muzica de fundal ────────────────────────────────────────────────────────
// Prioritate: (1) fișierul adminului din Storage (agent-media/audio/fundal.*),
// (2) instrumentalul inclus în repo, (3) null → pistă de liniște.
const MUSIC_STORAGE_PATHS = ['audio/fundal.mp3', 'audio/fundal.m4a', 'audio/fundal.wav'];

function bundledMusicPath() {
  for (const base of [path.join(__dirname, 'audio'), path.join(process.cwd(), 'api', '_lib', 'audio')]) {
    const f = path.join(base, 'fundal.mp3');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// Întoarce Buffer (din Storage), string (cale locală) sau null. Nu aruncă.
async function resolveMusic(supa) {
  if (supa) {
    for (const p of MUSIC_STORAGE_PATHS) {
      try {
        const { data, error } = await supa.storage.from(STORAGE_BUCKET).download(p);
        if (!error && data) {
          const buf = Buffer.from(await data.arrayBuffer());
          if (buf.length > 1000) return buf;
        }
      } catch { /* lipsă/bucket inexistent — trecem la fallback */ }
    }
  }
  return bundledMusicPath();
}
let _fonts = null;
function loadFonts() {
  if (_fonts) return _fonts;
  const read = (f) => fs.readFileSync(path.join(fontDir(), f));
  _fonts = [
    { name: 'Fraunces Ext', data: read('Fraunces-ExtraBold-latin-ext.woff'), weight: 800, style: 'normal' },
    { name: 'DM Sans',      data: read('DMSans-Regular.ttf'),                weight: 400, style: 'normal' },
    { name: 'DM Sans',      data: read('DMSans-Bold.ttf'),                   weight: 700, style: 'normal' },
    { name: 'Fraunces',     data: read('Fraunces-ExtraBold-latin.woff'),     weight: 800, style: 'normal' },
    { name: 'DejaVu',       data: read('DejaVuSans-Bold.ttf'),               weight: 700, style: 'normal' },
  ];
  return _fonts;
}

function titleSize(text, base, min) {
  const len = String(text || '').length;
  if (len <= 20) return base;
  if (len <= 40) return Math.round(base * 0.8);
  if (len <= 70) return Math.round(base * 0.62);
  return min;
}

// Construiește arborele unui slide (pur — testat).
function buildScene(scene, { w, h: hh, index, total, imageData = null }) {
  const pad = Math.round(w * 0.08);
  const vertical = hh > w;
  const logo = h('div', { display: 'flex', alignItems: 'baseline' },
    h('span', { fontFamily: 'Fraunces', fontSize: 46, fontWeight: 800, color: WHITE }, 'Examen'),
    h('span', { fontFamily: 'Fraunces', fontSize: 46, fontWeight: 800, color: GOLD }, 'Mate'),
  );
  const header = h('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
    logo,
    scene.badge
      ? h('div', { display: 'flex', fontFamily: 'DM Sans', fontSize: 28, fontWeight: 700, color: GOLD_LIGHT, border: `2px solid ${GOLD}`, borderRadius: 999, padding: '10px 24px' }, scene.badge)
      : h('div', { display: 'flex', fontFamily: 'DM Sans', fontSize: 26, color: MUTED }, `${index + 1}/${total}`),
  );
  const footer = h('div', { display: 'flex', alignItems: 'center' },
    h('div', { display: 'flex', width: 54, height: 6, background: GOLD, borderRadius: 3, marginRight: 18 }),
    h('span', { fontFamily: 'DM Sans', fontSize: 30, fontWeight: 700, color: WHITE }, 'examenmate.com'),
  );

  let middle;
  if (scene.template === 'lista') {
    middle = h('div', { display: 'flex', flexDirection: 'column', width: '100%' },
      h('div', { display: 'flex', fontFamily: 'Fraunces', fontSize: titleSize(scene.title, 84, 52), fontWeight: 800, color: WHITE, lineHeight: 1.12 }, scene.title),
      ...scene.bullets.map((b) => h('div', { display: 'flex', alignItems: 'flex-start', marginTop: 34 },
        h('div', { display: 'flex', width: 16, height: 16, borderRadius: 16, background: GOLD, marginTop: 16, marginRight: 22, flexShrink: 0 }),
        h('div', { display: 'flex', fontFamily: 'DM Sans', fontSize: 42, fontWeight: 700, color: WHITE, lineHeight: 1.3 }, b),
      )),
    );
  } else if (scene.template === 'imagine') {
    middle = h('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' },
      imageData
        // satori cere src/width/height la nivel de PROPS pentru <img> (nu în style)
        ? { type: 'img', props: { src: imageData.src, width: imageData.w, height: imageData.h, style: { borderRadius: 24, border: `3px solid ${NAVY_LIGHT}` } } }
        : h('div', { display: 'flex', width: w - 2 * pad, height: Math.round(hh * 0.35), borderRadius: 24, background: NAVY_LIGHT }),
      h('div', { display: 'flex', fontFamily: 'Fraunces', fontSize: titleSize(scene.title, 66, 44), fontWeight: 800, color: WHITE, marginTop: 44, textAlign: 'center', lineHeight: 1.15 }, scene.title),
      scene.subtitle ? h('div', { display: 'flex', fontFamily: 'DM Sans', fontSize: 36, color: MUTED, marginTop: 22, textAlign: 'center', lineHeight: 1.35 }, scene.subtitle) : h('div', { display: 'flex' }),
    );
  } else if (scene.template === 'statistica') {
    middle = h('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' },
      h('div', { display: 'flex', fontFamily: 'Fraunces', fontSize: vertical ? 260 : 200, fontWeight: 800, color: GOLD, lineHeight: 1 }, scene.title),
      h('div', { display: 'flex', fontFamily: 'DM Sans', fontSize: 46, fontWeight: 700, color: WHITE, marginTop: 24, textAlign: 'center', lineHeight: 1.3 }, scene.subtitle || ''),
    );
  } else if (scene.template === 'final') {
    middle = h('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' },
      h('div', { display: 'flex', fontFamily: 'Fraunces', fontSize: titleSize(scene.title || 'examenmate.com', 88, 56), fontWeight: 800, color: WHITE, textAlign: 'center', lineHeight: 1.12 }, scene.title || 'Matematică pentru EN și BAC'),
      h('div', { display: 'flex', fontFamily: 'DM Sans', fontSize: 40, color: MUTED, marginTop: 30, textAlign: 'center' }, scene.subtitle || 'Exerciții interactive · Rezolvări · Profesor Virtual AI'),
      h('div', { display: 'flex', fontFamily: 'DM Sans', fontSize: 44, fontWeight: 700, color: NAVY_DARK, background: GOLD, borderRadius: 16, padding: '22px 44px', marginTop: 56 }, 'examenmate.com'),
    );
  } else { // intro
    middle = h('div', { display: 'flex', flexDirection: 'column', width: '100%' },
      h('div', { display: 'flex', fontFamily: 'Fraunces', fontSize: titleSize(scene.title, vertical ? 96 : 84, 54), fontWeight: 800, color: WHITE, lineHeight: 1.1 }, scene.title),
      scene.subtitle ? h('div', { display: 'flex', fontFamily: 'DM Sans', fontSize: 42, color: MUTED, marginTop: 34, lineHeight: 1.35 }, scene.subtitle) : h('div', { display: 'flex' }),
    );
  }

  const deco = (txt, top, left, size, rot) => h('div', {
    display: 'flex', position: 'absolute', top, left, fontFamily: 'DM Sans', fontWeight: 700,
    fontSize: size, color: WHITE, opacity: 0.05, transform: `rotate(${rot}deg)`,
  }, txt);

  return h('div', {
    display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
    width: w, height: hh, padding: pad, position: 'relative',
    background: `linear-gradient(150deg, ${NAVY_DARK} 0%, ${NAVY} 55%, ${NAVY_LIGHT} 100%)`,
  },
    deco('π', Math.round(hh * 0.62), Math.round(w * 0.78), 210, -12),
    deco('√x', Math.round(hh * 0.12), Math.round(w * 0.7), 150, 8),
    deco('∑', Math.round(hh * 0.8), Math.round(w * 0.06), 180, 10),
    header, middle, footer,
  );
}

// ─── Imaginile scenelor: descărcate și încadrate (data URL pentru satori) ────
async function fetchImageData(url, { maxW, maxH }) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'ExamenMate-Video/1.0' } });
  if (!res.ok) throw new Error(`Imaginea ${url} nu a putut fi descărcată (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) throw new Error(`Imaginea ${url} e prea mare (${Math.round(buf.length / 1048576)}MB > 8MB).`);
  const sharp = require('sharp');
  const img = sharp(buf).rotate();
  const meta = await img.metadata();
  const scale = Math.min(maxW / (meta.width || maxW), maxH / (meta.height || maxH), 1);
  const w = Math.max(Math.round((meta.width || maxW) * scale), 2);
  const hh = Math.max(Math.round((meta.height || maxH) * scale), 2);
  const png = await img.resize(w, hh).png().toBuffer();
  return { src: `data:image/png;base64,${png.toString('base64')}`, w, h: hh };
}

// ─── Randarea completă: spec → cadre PNG → MP4 (ffmpeg-static) ───────────────
let _satori = null;
async function getSatori() {
  if (!_satori) _satori = (await import('satori')).default;
  return _satori;
}

function ffmpegPath() {
  try {
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) return p;
  } catch { /* pachet lipsă */ }
  return null;
}
const available = () => !!ffmpegPath();

async function renderScenePng(scene, ctx) {
  const satori = await getSatori();
  const sharp = require('sharp');
  let imageData = null;
  if (scene.template === 'imagine' && scene.image_url) {
    imageData = await fetchImageData(scene.image_url, { maxW: ctx.w - Math.round(ctx.w * 0.16), maxH: Math.round(ctx.h * 0.5) });
  }
  const svg = await satori(buildScene(scene, { ...ctx, imageData }), { width: ctx.w, height: ctx.h, fonts: loadFonts() });
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function runFfmpeg(args, cwd) {
  const bin = ffmpegPath();
  if (!bin) throw new Error('ffmpeg lipsește — rulează `npm install` (pachetul ffmpeg-static e în package.json) și fă deploy.');
  return new Promise((resolve, reject) => {
    execFile(bin, args, { cwd, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(new Error(`ffmpeg a eșuat: ${String(stderr || err.message).slice(-500)}`));
      else resolve();
    });
  });
}

// spec = rezultatul checkVideoSpec(); întoarce { buffer, seconds, width, height }.
// `_scale` (0–1) e DOAR pentru teste — randează micșorat, mult mai rapid.
// `music`: Buffer (din Storage) sau cale locală (instrumentalul din repo) —
// pusă în buclă pe toată durata clipului, cu fade-out la final; null = liniște.
async function renderVideo(spec, { _scale = 1, music = null } = {}) {
  const w = Math.max(Math.round((spec.w * _scale) / 2) * 2, 64);
  const hh = Math.max(Math.round((spec.h * _scale) / 2) * 2, 64);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emvid-'));
  try {
    const listLines = [];
    for (let i = 0; i < spec.scenes.length; i++) {
      const png = await renderScenePng(spec.scenes[i], { w, h: hh, index: i, total: spec.scenes.length });
      const name = `f${String(i).padStart(2, '0')}.png`;
      fs.writeFileSync(path.join(dir, name), png);
      listLines.push(`file '${name}'`, `duration ${spec.scenes[i].seconds}`);
    }
    // concat demuxer: ultimul cadru se repetă (cerință ffmpeg pentru durata finală)
    listLines.push(`file 'f${String(spec.scenes.length - 1).padStart(2, '0')}.png'`);
    fs.writeFileSync(path.join(dir, 'list.txt'), listLines.join('\n'));

    // Muzica: buffer din Storage → fișier temporar; cale locală → direct.
    let musicFile = null;
    if (Buffer.isBuffer(music)) {
      musicFile = path.join(dir, 'music.audio');
      fs.writeFileSync(musicFile, music);
    } else if (typeof music === 'string' && fs.existsSync(music)) {
      musicFile = music;
    }
    const fadeStart = Math.max(0, spec.seconds - 1.2);
    const audioIn = musicFile
      ? ['-stream_loop', '-1', '-i', musicFile]           // în buclă cât ține clipul
      : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
    const audioFx = musicFile
      ? ['-af', `afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeStart.toFixed(2)}:d=1.2`]
      : [];
    // ATENȚIE: cu muzică pe intrare reală, `-shortest` + `-stream_loop` taie
    // clipul prea devreme (cadrele video sunt rare — unul pe scenă); limităm
    // explicit cu `-t` la durata montajului. Pentru liniște (lavfi) rămâne
    // `-shortest`, comportamentul verificat inițial.
    const cut = musicFile ? ['-t', String(spec.seconds)] : ['-shortest'];

    await runFfmpeg([
      '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
      ...audioIn,
      ...cut,
      '-c:v', 'libx264', '-r', '30', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '23',
      ...audioFx,
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      'out.mp4',
    ], dir);

    const buffer = fs.readFileSync(path.join(dir, 'out.mp4'));
    return { buffer, seconds: spec.seconds, width: w, height: hh };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Stocarea: bucket public `agent-media` (supabase/agent_media.sql) ────────
async function uploadVideo(supa, buffer, slug) {
  const name = `videos/${new Date().toISOString().slice(0, 10)}-${slug}-${Math.random().toString(36).slice(2, 7)}.mp4`;
  const { error } = await supa.storage.from(STORAGE_BUCKET).upload(name, buffer, { contentType: 'video/mp4', upsert: false });
  if (error) throw new Error(`Nu am putut urca videoclipul în Storage (rulează supabase/agent_media.sql?): ${error.message}`);
  const { data } = supa.storage.from(STORAGE_BUCKET).getPublicUrl(name);
  if (!data?.publicUrl) throw new Error('Bucketul agent-media nu a întors URL public.');
  return { path: name, url: data.publicUrl };
}

module.exports = {
  SCENE_TEMPLATES, FORMATS, STORAGE_BUCKET, MUSIC_STORAGE_PATHS,
  checkVideoSpec, buildScene, titleSize,
  renderScenePng, renderVideo, uploadVideo,
  resolveMusic, bundledMusicPath,
  available,
};
