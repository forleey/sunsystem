// Generative hull detailing for the megastructure stations. The build meshes
// are smooth primitives; at Moon/Pluto scale they read as blank plastic. This
// injects procedural shading into their standard materials (onBeforeCompile):
//   - panel plating on two scales: per-cell tone variation + dark seams
//   - sparse lit window strips in horizontal bands (emissive, survive night)
// Everything is computed from the mesh's object-space position, so the
// pattern sticks to the hull, costs no geometry and works at any scale.

export function applyGreebleShading(root, { freq = 42, winFreq = 160, strength = 0.24 } = {}) {
  root.traverse(n => {
    if (!n.isMesh) return;
    const mats = Array.isArray(n.material) ? n.material : [n.material];
    for (const m of mats) {
      if (!m || m.userData._greeble || !m.isMeshStandardMaterial) continue;
      // leave pure glow materials (windows, blinkers) alone
      if (m.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.2 && !m.map) continue;
      m.userData._greeble = true;
      m.onBeforeCompile = sh => {
        sh.uniforms.uGFreq = { value: freq };
        sh.uniforms.uGWin = { value: winFreq };
        sh.uniforms.uGStr = { value: strength };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vGrbPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrbPos = position;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', /* glsl */`#include <common>
varying vec3 vGrbPos;
uniform float uGFreq, uGWin, uGStr;
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
{
  // sparse window strips in horizontal bands — lit day and night
  vec3 wc = vGrbPos * uGWin;
  vec3 wcell = floor(wc);
  float band = step(0.66, fract(vGrbPos.y * uGFreq * 0.5));
  float lit = step(0.76, grbHash(wcell + 7.3)) * band;
  vec3 wf = abs(fract(wc) - 0.5);
  float inWin = 1.0 - smoothstep(0.30, 0.42, max(wf.x, max(wf.y, wf.z)));
  totalEmissiveRadiance += vec3(1.0, 0.86, 0.62) * (lit * inWin * 2.4);
}
`);
      };
      m.needsUpdate = true;
    }
  });
}
