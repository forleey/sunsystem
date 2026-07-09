// Generative hull detailing for the megastructure stations. The build meshes
// are smooth primitives; at Moon/Pluto scale they read as blank plastic. This
// injects procedural shading into their standard materials (onBeforeCompile):
//   - panel plating on two scales: per-cell tone variation + dark seams
//   - lit window strips (emissive, survive night)
// Everything is computed from the mesh's object-space position, so the pattern
// sticks to the hull, costs no geometry and works at any scale.
//
// Windows come in two flavours, chosen per material:
//   - generic (hubs, spokes, boxes): axis-aligned window cells in decks
//   - toroidal (the main ring, tagged m.userData._ringWin): cells laid out in
//     true ring coordinates (angle around the ring x angle around the tube), so
//     the windows follow the curve as neat rows instead of cartesian confetti.
//
// The tunable knobs live as shader uniforms and a reference is stashed on
// m.userData._grb so the in-game editor can drive them live (see editor.js).
import * as THREE from 'three';

export function applyGreebleShading(root, opts = {}) {
  const o = {
    freq: 42,          // panel-plating cell frequency
    strength: 0.24,    // panel tone/seam strength
    winFreq: 46,       // window cell frequency (generic) / column density (ring)
    winBright: 2.2,    // emissive window brightness
    winDensity: 0.72,  // 0..1 fraction of cells that stay dark (higher = fewer lit)
    winTint: 0xffdca8, // warm window colour (sRGB)
    ...opts,
  };
  root.traverse(n => {
    if (!n.isMesh) return;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of mats) {
      if (!m || m.userData._greeble || !m.isMeshStandardMaterial) continue;
      // leave pure glow materials (windows, blinkers) alone
      if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.2 && !m.map) continue;
      m.userData._greeble = true;
      const toroidal = !!m.userData._ringWin;
      const winSnippet = toroidal ? /* glsl */`
  // toroidal windows: neat rows that follow the ring (major radius uGRingR)
  float ang = atan(vGrbPos.y, vGrbPos.x);              // around the ring
  float rad = length(vGrbPos.xy);
  float tv  = atan(vGrbPos.z, rad - uGRingR);          // around the tube
  vec2 wc = vec2(ang * uGRingR * uGWin * 0.1, tv * 0.9549);  // cols x ~6 rows around tube
  vec3 wcell = vec3(floor(wc), 5.0);
  float lit = step(uGWinDen, grbHash(wcell));
  vec2 wf = abs(fract(wc) - 0.5);
  float inWin = (1.0 - smoothstep(0.24, 0.40, wf.x)) * (1.0 - smoothstep(0.26, 0.42, wf.y));
  totalEmissiveRadiance += uGWinTint * (lit * inWin * uGWinBright);
` : /* glsl */`
  // generic windows: axis-aligned cells gathered into horizontal decks
  vec3 wc = vGrbPos * uGWin;
  vec3 wcell = floor(wc);
  float band = step(0.55, fract(vGrbPos.y * uGFreq * 0.32));
  float lit = step(uGWinDen, grbHash(wcell + 7.3)) * band;
  vec3 wf = abs(fract(wc) - 0.5);
  float inWin = (1.0 - smoothstep(0.28, 0.42, max(wf.x, wf.z))) * (1.0 - smoothstep(0.30, 0.44, wf.y));
  totalEmissiveRadiance += uGWinTint * (lit * inWin * uGWinBright);
`;
      m.onBeforeCompile = sh => {
        sh.uniforms.uGFreq = { value: o.freq };
        sh.uniforms.uGStr = { value: o.strength };
        sh.uniforms.uGWin = { value: o.winFreq };
        sh.uniforms.uGWinBright = { value: o.winBright };
        sh.uniforms.uGWinDen = { value: o.winDensity };
        sh.uniforms.uGWinTint = { value: new THREE.Color(o.winTint) };
        sh.uniforms.uGRingR = { value: o.ringR || 1.8 };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vGrbPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrbPos = position;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', /* glsl */`#include <common>
varying vec3 vGrbPos;
uniform float uGFreq, uGWin, uGStr, uGWinBright, uGWinDen, uGRingR;
uniform vec3 uGWinTint;
float grbHash(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
`)
          .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
{
  // panel plating: coarse + fine cells, seams darkened
  vec3 pc = vGrbPos * uGFreq;
  float tone = grbHash(floor(pc)) * 2.0 - 1.0;
  vec3 f = abs(fract(pc) - 0.5);
  float seam = smoothstep(0.44, 0.5, max(max(f.x, f.y), f.z));
  float tone2 = grbHash(floor(vGrbPos * uGFreq * 3.7)) * 2.0 - 1.0;
  diffuseColor.rgb *= 1.0 + tone * uGStr + tone2 * uGStr * 0.5 - seam * 0.34;
}
`)
          .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
{${winSnippet}}
`);
        m.userData._grb = sh.uniforms;   // live handle for the editor
      };
      m.needsUpdate = true;
    }
  });
}
