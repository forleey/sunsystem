// Title shine: the light band that sweeps across the STARBLAZER wordmark.
// It used to be an SMIL <animate> on a rect clipped to the glyphs inside the
// logo SVG, and WebKit repainted the whole wordmark in software every frame of
// the sweep (fps dropped each pass, 02.09.2026). Now the glyphs are a CSS mask
// on an HTML layer and the band moves with transform, so the sweep stays on the
// compositor. The mask is an SVG data URL with the font embedded: mask images
// load in their own document and cannot see the page's web fonts.
const FONT_URL = './fonts/orbitron-900.woff';

function svgMask(fontB64) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 260">` +
    `<style>@font-face{font-family:O;font-weight:900;src:url(data:font/woff;base64,${fontB64}) format('woff')}` +
    `text{font-family:O;font-weight:900;font-size:132px;letter-spacing:4px}</style>` +
    `<g transform="translate(600,132) skewX(-7) translate(-600,-132)">` +
    `<text x="600" y="184" text-anchor="middle" fill="#fff">STARBLAZER</text></g></svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

export async function armShine(el) {
  try {
    const buf = await (await fetch(FONT_URL)).arrayBuffer();
    let bin = '';
    for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
    const url = svgMask(btoa(bin));
    el.style.webkitMaskImage = url;
    el.style.maskImage = url;
    el.classList.add('ready');
  } catch (e) {
    console.warn('title shine disabled:', e);   // logo stays, only the sweep is missing
  }
}
