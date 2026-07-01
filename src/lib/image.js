// =====================================================================
// src/lib/image.js — micșorează imaginea în browser înainte de upload
// (payload mic = rapid și sub limita serverless)
// =====================================================================
export async function fileToCompressedDataUrl(file, { maxDim = 1280, quality = 0.7 } = {}) {
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('Nu am putut citi fișierul.'));
    fr.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Fișierul nu este o imagine validă.'));
    i.src = dataUrl;
  });

  let { width, height } = img;
  if (Math.max(width, height) > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height); // fundal alb (pentru PNG cu transparență)
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL('image/jpeg', quality);
}
