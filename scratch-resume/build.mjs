import fs from 'fs';

const b64 = (p, mime) => `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
const ttf = p => b64(p, 'font/ttf');
const jpg = p => b64(p, 'image/jpeg');

let html = fs.readFileSync('template.html', 'utf8');

// ---- fonts ----
const fonts = {
  FONT_SANS_REG:   ttf('fonts/NotoSansKannada-Regular.ttf'),
  FONT_SANS_BOLD:  ttf('fonts/NotoSansKannada-Bold.ttf'),
  FONT_SANS_BLACK: ttf('fonts/NotoSansKannada-Black.ttf'),
  FONT_SERIF_MED:  ttf('fonts/NotoSerifKannada-Medium.ttf'),
  FONT_SERIF_BOLD: ttf('fonts/NotoSerifKannada-Bold.ttf'),
  FONT_SERIF_BLACK:ttf('fonts/NotoSerifKannada-Black.ttf'),
  FONT_PLAYFAIR_SB:ttf('fonts/Playfair-SemiBold.ttf'),
  FONT_PLAYFAIR_BK:ttf('fonts/Playfair-Black.ttf'),
};
for (const [k,v] of Object.entries(fonts)) html = html.replaceAll(`{{${k}}}`, v);

// ---- images ----
const imgDir = 'images';
for (const f of fs.readdirSync(imgDir)) {
  if (!f.endsWith('.jpg')) continue;
  const key = f.replace('.jpg','');
  html = html.replaceAll(`{{IMG_${key}}}`, jpg(`${imgDir}/${f}`));
}

// ---- corner ornaments ----
const cornerSVG = `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.6">
<path d="M4 42 C4 20 20 4 42 4"/><path d="M11 47 C11 27 27 11 47 11" stroke-width=".9"/>
<circle cx="13" cy="13" r="3.2" fill="currentColor" stroke="none"/>
<path d="M24 13 q11 0 11 11 M13 24 q0 11 11 11" stroke-width=".9"/></svg>`;
const corners = `<div class="corner c-tl">${cornerSVG}</div><div class="corner c-tr">${cornerSVG}</div><div class="corner c-bl">${cornerSVG}</div><div class="corner c-br">${cornerSVG}</div>`;
html = html.replaceAll('{{CORNERS}}', corners);

// sanity: any leftover placeholders?
const leftover = [...html.matchAll(/\{\{[A-Z_]+\}\}/g)].map(m=>m[0]);
if (leftover.length) console.log('WARNING leftover placeholders:', [...new Set(leftover)]);

// artifact.html = body content only (for Artifact tool, which supplies its own doctype/head)
fs.writeFileSync('artifact.html', html);

// resume.html = full standalone doc with UTF-8 charset (for local PDF rendering)
const standalone = `<!doctype html><html lang="kn"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ಉದಯ ಶೆಟ್ಟಿ ಕಾಂತಾವರ</title></head><body>\n${html}\n</body></html>`;
fs.writeFileSync('resume.html', standalone);
console.log('written. artifact:', (html.length/1024/1024).toFixed(2), 'MB');
