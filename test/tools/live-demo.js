// Regenerează cronologia DEMONSTRAȚIEI sălii live (src/lib/live/demo.json)
// din scriptul src/lib/live/demoScript.js, cu aceeași funcție ca serverul.
//   node test/tools/live-demo.js
const fs = require('fs');
const path = require('path');
const L = require('../../api/_lib/live');
(async () => {
  const { DEMO_SCRIPT } = await import(path.join(__dirname, '../../src/lib/live/demoScript.js'));
  // grup: întrebările pe pași cu 25 de secunde (în ședințele reale: LIVE_SONDAJ_PAS_SEC, implicit 40)
  const grup = L.buildTimeline(DEMO_SCRIPT, {}, { mode: 'grup', qnaSec: 25, pause: false, stepSec: 25 });
  const privat = L.buildTimeline(DEMO_SCRIPT, {}, { mode: 'privat' });
  const out = { grup: { ...grup, noVoice: true }, privat: { ...privat, noVoice: true } };
  fs.writeFileSync(path.join(__dirname, '../../src/lib/live/demo.json'), JSON.stringify(out));
  console.log('demo.json:', grup.scenes.length, 'scene grup,', grup.duration, 's;', privat.scenes.length, 'scene 1-la-1');
})();
