// Generative megastation K-7 — an O'Neill cylinder habitat: a spinning
// city-in-a-can, the single most believable "inhabited space megacity" form
// (rotation gives gravity, so the settlement wraps the inside of the drum).
//
// The read is carried by the classic O'Neill signature — the shell is split
// into alternating LAND stripes (solid white hull, greebled) and GLASS stripes
// (glowing warm from the city lit inside) running the length of the drum. From
// the side you see "people live here, it's night indoors"; down the open axis
// you glimpse the warm interior. Structure follows the real grammar: endcap
// domes, an agricultural torus collar, an axial docking hub with radial arms,
// truss bands, radiator fins and solar wings.
//
// Art direction (deliberate): the hull is white/grey like the rest of the
// fleet — the ONLY saturated colour anywhere is the window light (mostly warm
// sodium, a few cool). Three detail octaves (drum -> modules -> greeble carpet)
// and a density gradient toward the middle sell the scale. Everything is stock
// MeshStandardMaterial + a baked CanvasTexture for the windows — no custom
// shader math, so none of the Apple-Silicon pow/normalize NaN traps apply.
//
// Buildings/greeble are InstancedMesh (a handful of draw calls). Seeded.

function mulberry32(a) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(i, j) {
  let h = Math.imul(i + 1, 374761393) ^ Math.imul(j + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Procedural window field baked to a canvas: a dense grid of lit/dark cells,
// mostly warm sodium with a few cool ones, plus dark service-floor bands. Used
// as an emissiveMap so bloom lifts the bright texels — the "thousands of
// lights" trick without any geometry or live-shader risk.
function makeWindowTexture(THREE, rnd) {
  const W = 256, H = 512, cols = 30, rows = 68;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1c1206'; ctx.fillRect(0, 0, W, H);          // dim warm base -> stripe glows softly
  const cw = W / cols, chh = H / rows;
  for (let r = 0; r < rows; r++) {
    const service = (r % 13 === 0);                             // occasional dim mechanical deck
    const bandLit = service ? 0.06 : 0.52;
    for (let c = 0; c < cols; c++) {
      if (rnd() > bandLit) continue;
      const cool = rnd() < 0.11;
      let fill;
      if (cool) fill = `rgb(${150 + (rnd() * 45 | 0)},${198 + (rnd() * 40 | 0)},255)`;
      else { const w = rnd(); fill = `rgb(255,${180 + (w * 48 | 0)},${86 + (w * 74 | 0)})`; }
      ctx.fillStyle = fill;
      const px = c * cw + cw * 0.2, py = r * chh + chh * 0.22;
      ctx.fillRect(px, py, cw * 0.6, chh * 0.52);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildGreebleStation(THREE, { seed = 7, R = 3.0 } = {}) {
  const rnd = mulberry32(seed);
  const TAU = Math.PI * 2;
  const grp = new THREE.Group();
  grp.userData.noWash = true;   // K-7 owns its palette (white hull + warm windows)

  // ---- drum dimensions (bounding sphere ~R, so the fleet's 297x scale holds) ----
  const cylR = R * 0.46;        // drum radius
  const cylHalf = R * 0.90;     // half length -> length:diam ~2:1 (iconic O'Neill tube)
  const cylLen = cylHalf * 2;
  const SEG = 6;                // 3 land + 3 glass stripes (60 deg each)
  const arc = TAU / SEG;

  // ---- materials (white/grey hull; warm windows the only colour) ----
  const HULL = new THREE.MeshStandardMaterial({ color: 0xd3d7dd, metalness: 0.38, roughness: 0.46 });
  const HULL_DK = new THREE.MeshStandardMaterial({ color: 0x9aa1ac, metalness: 0.52, roughness: 0.58 });
  const winTex = makeWindowTexture(THREE, rnd);
  winTex.repeat.set(1, 3.1);                                    // tile windows along the drum length
  const GLASS = new THREE.MeshStandardMaterial({
    color: 0x090b11, metalness: 0.15, roughness: 0.35,
    emissive: 0xffffff, emissiveIntensity: 3.8, emissiveMap: winTex,
  });
  // faint inner tube: a soft warm glow you catch looking down the open axis
  const innerTex = makeWindowTexture(THREE, mulberry32(seed + 91));
  innerTex.repeat.set(2, 4);
  const GLOW_IN = new THREE.MeshStandardMaterial({
    color: 0x070810, emissive: 0xffb877, emissiveIntensity: 1.15,
    emissiveMap: innerTex, side: THREE.BackSide, roughness: 1,
  });

  // ---- shell: alternating land (hull) and glass (window) longitudinal arcs.
  // glass sits in a recessed channel so the window band reads as a canyon of
  // light between the smooth hull stripes. ----
  for (let s = 0; s < SEG; s++) {
    const th0 = s * arc;
    const land = (s % 2 === 0);
    const rad = land ? cylR : cylR * 0.955;
    const geo = new THREE.CylinderGeometry(rad, rad, cylLen, 44, 1, true, th0, arc);
    grp.add(new THREE.Mesh(geo, land ? HULL : GLASS));
  }
  // inner glow tube (seen through the open hub eyes at the ends)
  grp.add(new THREE.Mesh(new THREE.CylinderGeometry(cylR * 0.9, cylR * 0.9, cylLen * 0.98, 32, 1, true), GLOW_IN));

  // ---- endcap domes + agri-torus collar near the +Y cap ----
  function cap(sign) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(cylR, 44, 18, 0, TAU, 0, Math.PI / 2), HULL);
    dome.scale.set(1, sign * 0.24, 1);            // shallow dome, negative y flips it
    dome.position.y = sign * cylHalf;
    grp.add(dome);
    // two structural rings hugging the cap rim
    for (let k = 1; k <= 2; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(cylR * (0.42 + k * 0.24), cylR * 0.014, 6, 64), HULL_DK);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = sign * (cylHalf + cylR * 0.02);
      grp.add(ring);
    }
  }
  cap(1); cap(-1);
  // agricultural torus collar, ringing the drum just under the +Y endcap
  const collar = new THREE.Mesh(new THREE.TorusGeometry(cylR * 1.05, cylR * 0.085, 14, 80), HULL);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = cylHalf * 0.9;
  grp.add(collar);

  // ---- truss bands wrapping the drum (mid detail octave) ----
  for (let k = 0; k < 3; k++) {
    const y = -cylHalf + (k + 0.5) / 3 * cylLen;
    const band = new THREE.Mesh(new THREE.TorusGeometry(cylR * 1.012, cylR * 0.016, 6, 84), HULL_DK);
    band.rotation.x = Math.PI / 2; band.position.y = y;
    grp.add(band);
  }

  // ---- axial hub + radial docking arms + docked craft (scale anchors) ----
  const hubTop = cylHalf + R * 0.34;
  const spar = new THREE.Mesh(new THREE.CylinderGeometry(cylR * 0.05, cylR * 0.05, hubTop * 2, 12), HULL_DK);
  grp.add(spar);
  for (const sy of [1, -1]) {
    const hubY = sy * (cylHalf + R * 0.14);
    grp.add(new THREE.Mesh(new THREE.CylinderGeometry(cylR * 0.16, cylR * 0.20, R * 0.10, 20), HULL)
      .translateY(hubY));
    const arms = 7;
    for (let a = 0; a < arms; a++) {
      const th = (a / arms) * TAU + sy * 0.2;
      const armLen = cylR * (0.34 + hash2(a, sy + 5) * 0.22);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(cylR * 0.03, R * 0.03, armLen), HULL_DK);
      arm.position.set(Math.cos(th) * (cylR * 0.22 + armLen / 2), hubY, Math.sin(th) * (cylR * 0.22 + armLen / 2));
      arm.rotation.y = -th;
      grp.add(arm);
      if (hash2(a, sy + 17) > 0.4) {   // a docked utility craft at the arm tip
        const craft = new THREE.Mesh(new THREE.BoxGeometry(cylR * 0.05, cylR * 0.04, cylR * 0.13), HULL);
        craft.position.set(Math.cos(th) * (cylR * 0.22 + armLen), hubY, Math.sin(th) * (cylR * 0.22 + armLen));
        craft.rotation.y = -th;
        grp.add(craft);
      }
    }
  }

  // ---- radiator fins + solar wings standing off the hull (mid octave) ----
  for (let i = 0; i < 6; i++) {
    const th = (i / 6) * TAU + 0.3, y = (hash2(i, 41) - 0.5) * cylLen * 0.5;
    const c = Math.cos(th), s = Math.sin(th);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(cylR * 0.9, R * 0.006, cylR * 0.5),
      i % 2 ? HULL : HULL_DK);
    fin.position.set(c * cylR * 1.5, y, s * cylR * 1.5);
    fin.rotation.y = -th;
    grp.add(fin);
  }
  for (const sy of [1, -1]) {
    for (const sx of [1, -1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(R * 0.5, R * 0.004, R * 0.14), HULL_DK);
      wing.position.set(sx * R * 0.4, sy * (cylHalf + R * 0.30), 0);
      grp.add(wing);
    }
  }

  // ---- greeble carpet on the LAND stripes (fine octave, density gradient) ----
  const NBOX = 9000;
  const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), HULL.clone(), NBOX);
  boxes.frustumCulled = false;
  const m4 = new THREE.Matrix4(), bx = new THREE.Vector3(), by = new THREE.Vector3(),
    bz = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), col = new THREE.Color();
  let bi = 0;
  // place a box tangent to the drum wall: local +Y = radial out, +Z = axis
  function putWall(theta, y, radialBase, sTan, sRad, sAxis, shade) {
    if (bi >= NBOX) return;
    const c = Math.cos(theta), s = Math.sin(theta);
    by.set(c, 0, s); bx.set(-s, 0, c);
    m4.makeBasis(bx, by, bz);
    m4.scale(sc.set(sTan, sRad, sAxis));
    m4.setPosition(c * (radialBase + sRad / 2), y, s * (radialBase + sRad / 2));
    boxes.setMatrixAt(bi, m4);
    boxes.setColorAt(bi, col.setScalar(shade));
    bi++;
  }
  const rows = 42, around = 26;
  for (let li = 0; li < SEG; li += 2) {           // land stripes only (even segments)
    const th0 = li * arc;
    for (let ri = 0; ri < rows; ri++) {
      const yf = (ri + 0.5) / rows;               // 0..1 along length
      const y = -cylHalf * 0.92 + yf * cylLen * 0.92;
      // clean poles, busy equator (smooth-vs-busy) — ends stay nearly bare
      const dens = Math.max(0, 1 - Math.pow(Math.abs(yf - 0.5) * 2, 2.4)) * 0.82;
      for (let ci = 0; ci < around; ci++) {
        if (rnd() > dens) continue;
        const th = th0 + (ci + 0.5) / around * arc;
        // footprint wider than height -> flat blocks hugging the hull, not spikes
        const wTan = (0.018 + rnd() * 0.045) * R;
        const wAx = (0.018 + rnd() * 0.045) * R;
        const big = rnd() > 0.94;                 // rare taller module — kept low & wide
        const h = (big ? 0.028 + rnd() * 0.03 : 0.005 + rnd() * 0.018) * R;
        const wm = big ? 1.5 : 1;                 // widen the tall ones so they read as blocks
        putWall(th, y, cylR, wTan * wm, h, wAx * wm, 0.74 + rnd() * 0.24);
      }
    }
  }
  boxes.count = bi;
  boxes.instanceMatrix.needsUpdate = true;
  if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
  grp.add(boxes);

  // ---- nav blinkers for fleet.place() (hub tips + rim) ----
  grp.userData.blinkers = [];
  const BL = [
    [cylR * 1.1, 0, 0, 0xff5544], [-cylR * 1.1, 0, 0, 0x44ff77],
    [0, hubTop, 0, 0xffffff], [0, -hubTop, 0, 0xffffff],
  ];
  for (const [x, y, z, c] of BL) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(R * 0.014, 6, 6),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.6 }));
    b.position.set(x, y, z);
    grp.add(b);
    grp.userData.blinkers.push(b);
  }
  return grp;
}
