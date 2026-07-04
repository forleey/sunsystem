// Generative megastation — a structured city-in-space, built with the
// canonical procedural-city pipeline (Parish/Müller: road network -> blocks
// -> lots -> buildings) mapped onto a POLAR GRID for the disc:
//
//   * Concentric ring roads + radial avenues whose count GROWS with radius,
//     so cells stay roughly square (no pizza-slice distortion).
//   * Each cell is a district block, subdivided into lots; every building is
//     axis-aligned to the cell's local radial/tangential frame — never a
//     random yaw. That alignment is what reads as "built" instead of "noise".
//   * Height zoning: a downtown core of towers falling off toward a low
//     industrial rim, with per-DISTRICT coherence (a whole cell is tall, low,
//     or an open plaza) rather than per-building jitter, plus a few landmark
//     super-towers. Podium + tower massing gives the setback silhouette.
//   * Glowing road strips run along every ring road and avenue — the signature
//     grid-of-light seen from orbit.
//
// All buildings are InstancedMesh boxes (~a dozen draw calls). Seeded, so the
// same seed always yields the same city.

function mulberry32(a) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// deterministic per-cell hash (spatial coherence: same cell -> same value)
function hash2(i, j) {
  let h = Math.imul(i + 1, 374761393) ^ Math.imul(j + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function buildGreebleStation(THREE, { seed = 7, R = 3.0, T = 0.9 } = {}) {
  const rnd = mulberry32(seed);
  const TAU = Math.PI * 2;
  const grp = new THREE.Group();

  const HULL = new THREE.MeshStandardMaterial({ color: 0xc9ced7, metalness: 0.35, roughness: 0.55 });
  const DARK = new THREE.MeshStandardMaterial({ color: 0x99a0ac, metalness: 0.4, roughness: 0.6 });
  const ROAD = new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0x8fd0ff, emissiveIntensity: 2.4 });
  const WARM = new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0xffcf85, emissiveIntensity: 2.0 });

  // ---- base hull: squashed saucer + rim + central mesa + spire ----
  const surf = r => (T / 2) * Math.sqrt(Math.max(0, 1 - (r / R) * (r / R)));
  const saucer = new THREE.Mesh(new THREE.SphereGeometry(R, 72, 30), HULL);
  saucer.scale.set(1, (T / 2) / R, 1);
  grp.add(saucer);
  grp.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 1.015, R * 1.015, T * 0.5, 80, 1, true), DARK));

  // central mesa the downtown core sits on
  const mesaR = R * 0.16, mesaH = R * 0.10;
  const mesa = new THREE.Mesh(new THREE.CylinderGeometry(mesaR * 0.8, mesaR, mesaH, 32), DARK);
  mesa.position.y = surf(0) + mesaH / 2;
  grp.add(mesa);
  const spireBaseY = surf(0) + mesaH;
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.03, R * 0.06, R * 0.7, 10), HULL);
  spire.position.y = spireBaseY + R * 0.35;
  grp.add(spire);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.006, R * 0.006, R * 0.5, 6), DARK);
  mast.position.y = spireBaseY + R * 0.9;
  grp.add(mast);

  // ---- instanced pools ----
  const NBOX = 9000, NANT = 240;
  const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), HULL.clone(), NBOX);
  const ants = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 5), DARK.clone(), NANT);
  const roads = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), ROAD, 1400);
  boxes.frustumCulled = ants.frustumCulled = roads.frustumCulled = false;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler(),
    sc = new THREE.Vector3(), pp = new THREE.Vector3(), col = new THREE.Color();
  let bi = 0, ai = 0, ri = 0;
  function putBox(x, y, z, sx, sy, sz, yaw, shade) {
    if (bi >= NBOX) return;
    m4.compose(pp.set(x, y, z), q.setFromEuler(eu.set(0, yaw, 0)), sc.set(sx, sy, sz));
    boxes.setMatrixAt(bi, m4);
    boxes.setColorAt(bi, col.setScalar(shade));
    bi++;
  }
  function putAnt(x, y, z, r, h) {
    if (ai >= NANT) return;
    m4.compose(pp.set(x, y + h / 2, z), q.identity(), sc.set(r, h, r));
    ants.setMatrixAt(ai, m4); ai++;
  }
  function putRoad(x, y, z, sx, sy, sz, yaw) {
    if (ri >= 1400) return;
    m4.compose(pp.set(x, y, z), q.setFromEuler(eu.set(0, yaw, 0)), sc.set(sx, sy, sz));
    roads.setMatrixAt(ri, m4); ri++;
  }

  // ring-road radii (fractions of R). Downtown starts at the mesa edge.
  const ringR = [0.17, 0.31, 0.47, 0.64, 0.81, 0.955].map(f => f * R);
  const CELL_W = 0.34 * R;          // target angular cell width -> spoke count
  const LOT = 0.13 * R;             // target lot size -> lots per cell
  const roadHalf = 0.018 * R;       // half street width (the canyon gap + light)

  // per-ring zoning: tower height ceiling + district-type weights.
  // inner = downtown towers, outer = low industrial fabric.
  const zone = [
    { h: 0.62, tall: 0.55, mid: 0.35, low: 0.08, plaza: 0.02 },
    { h: 0.46, tall: 0.42, mid: 0.42, low: 0.12, plaza: 0.04 },
    { h: 0.32, tall: 0.24, mid: 0.46, low: 0.24, plaza: 0.06 },
    { h: 0.22, tall: 0.10, mid: 0.42, low: 0.40, plaza: 0.08 },
    { h: 0.15, tall: 0.03, mid: 0.30, low: 0.57, plaza: 0.10 },
  ];

  // build one city layer on a saucer face (sign +1 top, -1 hanging under-city)
  function cityLayer(sign, density, heightMul) {
    for (let ring = 0; ring < ringR.length - 1; ring++) {
      const rIn = ringR[ring], rOut = ringR[ring + 1];
      const rMid = (rIn + rOut) / 2;
      const spokes = Math.max(6, Math.round(TAU * rMid / CELL_W));
      const z = zone[ring];
      for (let s = 0; s < spokes; s++) {
        const th0 = (s / spokes) * TAU, th1 = ((s + 1) / spokes) * TAU;
        // district type for this whole cell (spatial coherence)
        const dh = hash2(ring * 97 + (sign > 0 ? 0 : 1000), s);
        let type; // 'tall' | 'mid' | 'low' | 'plaza'
        let a = dh;
        if ((a -= z.tall) < 0) type = 'tall';
        else if ((a -= z.mid) < 0) type = 'mid';
        else if ((a -= z.low) < 0) type = 'low';
        else type = 'plaza';
        if (rnd() > density) continue;                 // under-city is sparser

        // subdivide the cell into a lot grid (tangential x radial)
        const arc = rMid * (th1 - th0);
        const nT = Math.max(1, Math.round((arc - 2 * roadHalf) / LOT));
        const nR = Math.max(1, Math.round((rOut - rIn - 2 * roadHalf) / LOT));
        const isLandmark = type === 'tall' && ring <= 1 && hash2(s, ring + 313) > 0.86;

        for (let lt = 0; lt < nT; lt++) {
          for (let lr = 0; lr < nR; lr++) {
            const th = th0 + (lt + 0.5) / nT * (th1 - th0);
            const rr = rIn + roadHalf + (lr + 0.5) / nR * (rOut - rIn - 2 * roadHalf);
            const x = Math.cos(th) * rr, zc = Math.sin(th) * rr;
            const base = sign * surf(rr);
            const yaw = -th;                            // local X = radial, Z = tangential
            const wT = (th1 - th0) / nT * rr * 0.82;    // lot tangential span (with street gap)
            const wR = (rOut - rIn - 2 * roadHalf) / nR * 0.82;
            const foot = Math.min(wT, wR);

            if (type === 'plaza') {
              // low deck + a couple of rooftop units — open space
              putBox(x, base + sign * 0.012 * R, zc, wR, 0.024 * R, wT, yaw, 0.62 + rnd() * 0.1);
              continue;
            }
            // podium fills the lot
            const podH = (0.03 + rnd() * 0.03) * R;
            putBox(x, base + sign * podH / 2, zc, wR, podH, wT, yaw, 0.7 + rnd() * 0.14);

            // tower(s) on top, aligned to the lot, stepped back
            let towH = z.h * heightMul * (0.45 + rnd() * 0.55) * R;
            if (type === 'low') towH *= 0.4;
            if (type === 'mid') towH *= 0.72;
            if (isLandmark && lt === (nT >> 1) && lr === (nR >> 1)) towH *= 2.4;
            let fw = foot * (0.5 + rnd() * 0.28), y = base + sign * podH;
            const steps = type === 'tall' ? 2 + Math.floor(rnd() * 2) : 1;
            for (let k = 0; k < steps; k++) {
              const segH = towH / steps * (0.8 + rnd() * 0.3);
              putBox(x, y + sign * segH / 2, zc, fw, segH, fw * (0.8 + rnd() * 0.3), yaw, 0.78 + rnd() * 0.2);
              y += sign * segH;
              fw *= 0.66 + rnd() * 0.16;               // setback
            }
            // rooftop antenna on the tallest downtown towers
            if (sign > 0 && towH > 0.4 * R && rnd() > 0.5) putAnt(x, y, zc, 0.005 + rnd() * 0.006, 0.06 + rnd() * 0.22);
          }
        }
      }
    }
  }
  cityLayer(1, 1.0, 1.0);        // top city, full
  cityLayer(-1, 0.55, 0.6);      // hanging under-city, sparser + shorter

  // ---- road light grid: ring roads + radial avenues (top face) ----
  for (let ring = 0; ring < ringR.length; ring++) {
    const rr = ringR[ring], y = surf(rr) + 0.006 * R;
    const seg = Math.max(48, Math.round(TAU * rr / (0.06 * R)));
    for (let s = 0; s < seg; s++) {
      const th = (s / seg) * TAU;
      putRoad(Math.cos(th) * rr, y, Math.sin(th) * rr,
        0.008 * R, 0.006 * R, (TAU * rr / seg) * 0.9, -th);
    }
  }
  const avenues = 24;
  for (let a = 0; a < avenues; a++) {
    const th = (a / avenues) * TAU, c = Math.cos(th), s = Math.sin(th);
    const steps = 20;
    for (let k = 0; k < steps; k++) {
      const rr = ringR[0] + (k + 0.5) / steps * (ringR[ringR.length - 1] - ringR[0]);
      putRoad(c * rr, surf(rr) + 0.006 * R, s * rr,
        0.9 * (ringR[ringR.length - 1] - ringR[0]) / steps, 0.006 * R, 0.008 * R, -th);
    }
  }

  // ---- rim machinery (aligned to the rim, radial docking pylons) ----
  for (let i = 0; i < 96; i++) {
    const th = (i / 96) * TAU + (hash2(i, 7) - 0.5) * 0.02;
    const rr = R * 1.0;
    const h = (0.05 + hash2(i, 11) * 0.14) * R;
    putBox(Math.cos(th) * (rr + h / 2), (hash2(i, 13) - 0.5) * T * 0.5, Math.sin(th) * (rr + h / 2),
      h, (0.04 + hash2(i, 17) * 0.1) * R, (0.03 + hash2(i, 19) * 0.06) * R, -th, 0.6 + hash2(i, 23) * 0.25);
  }

  // ---- spire greeble: broken silhouette instead of a clean cone ----
  for (let i = 0; i < 220; i++) {
    const hFrac = rnd();
    const y = spireBaseY + hFrac * R * 0.68;
    const rr = R * (0.065 - hFrac * 0.035) * (0.8 + rnd() * 0.6);
    const th = rnd() * TAU;
    const s = (0.008 + rnd() * 0.04 * (1 - hFrac * 0.6)) * R;
    putBox(Math.cos(th) * rr, y, Math.sin(th) * rr, s * (0.6 + rnd()), s * (0.7 + rnd() * 2.2), s * (0.6 + rnd()), -th, 0.78 + rnd() * 0.22);
  }

  boxes.count = bi; ants.count = ai; roads.count = ri;
  boxes.instanceMatrix.needsUpdate = true;
  ants.instanceMatrix.needsUpdate = true;
  roads.instanceMatrix.needsUpdate = true;
  if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
  grp.add(boxes, ants, roads);

  // nav blinkers for fleet.place()
  grp.userData.blinkers = [];
  const topY = spireBaseY + R * 0.95;
  const BL = [[R * 1.05, 0, 0, 0xff5544], [-R * 1.05, 0, 0, 0x44ff77], [0, topY, 0, 0xffffff], [0, -surf(0) - R * 0.3, 0, 0xffffff]];
  for (const [x, y, z, c] of BL) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.5 }));
    b.position.set(x, y, z);
    grp.add(b);
    grp.userData.blinkers.push(b);
  }
  return grp;
}
