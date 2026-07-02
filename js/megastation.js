// Generative megastation — a kit-bashed city-in-space in the spirit of big
// Trek concept art. Everything derives from a seed: a squashed saucer core
// with stacked plateaus, a central spire, a hanging under-city, thousands of
// instanced greeble boxes in wildly uneven sizes, antenna masts and lit
// window strips. ~12 draw calls total thanks to InstancedMesh.

function mulberry32(a) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildGreebleStation(THREE, { seed = 7, R = 3.0, T = 0.9 } = {}) {
  const rnd = mulberry32(seed);
  const grp = new THREE.Group();

  const HULL = new THREE.MeshStandardMaterial({ color: 0xc9ced7, metalness: 0.35, roughness: 0.55 });
  const DARK = new THREE.MeshStandardMaterial({ color: 0x99a0ac, metalness: 0.4, roughness: 0.6 });
  const GLOW = new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0xbfe3ff, emissiveIntensity: 1.7 });
  const WARM = new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0xffd9a0, emissiveIntensity: 1.6 });

  // ---- core hull ----
  const surf = r => (T / 2) * Math.sqrt(Math.max(0, 1 - (r / R) * (r / R)));   // saucer top profile
  const saucer = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 28), HULL);
  saucer.scale.set(1, (T / 2) / R, 1);
  grp.add(saucer);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.015, R * 1.015, T * 0.5, 72, 1, true), DARK);
  grp.add(rim);
  // stacked plateaus above and below (uneven city terraces)
  const terraces = [];
  let ty = surf(0) * 0.9;
  for (let i = 0, tr = R * 0.62; i < 4; i++) {
    const h = R * (0.05 + rnd() * 0.06);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(tr, tr * 1.04, h, 48), i % 2 ? DARK : HULL);
    mesh.position.y = ty + h / 2;
    grp.add(mesh);
    terraces.push({ r: tr, y: ty + h });
    ty += h;
    tr *= 0.6 + rnd() * 0.12;
  }
  let by = -surf(0) * 0.9;
  for (let i = 0, br = R * 0.5; i < 3; i++) {
    const h = R * (0.05 + rnd() * 0.05);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(br * 1.04, br, h, 48), i % 2 ? HULL : DARK);
    mesh.position.y = by - h / 2;
    grp.add(mesh);
    by -= h;
    br *= 0.55 + rnd() * 0.12;
  }
  // central spire (slim core — gets its own greeble coat below) + mast
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.035, R * 0.07, R * 0.8, 10), HULL);
  spire.position.y = ty + R * 0.4;
  grp.add(spire);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.007, R * 0.007, R * 0.5, 6), DARK);
  mast.position.y = ty + R * 1.05;
  grp.add(mast);
  // continuous light rings on the rim + terraces (the signature glow bands)
  const ringGlow = new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0x9fd8ff, emissiveIntensity: 2.2 });
  for (const yy of [-T * 0.21, 0, T * 0.21]) {
    const lr = new THREE.Mesh(new THREE.TorusGeometry(R * 1.02, 0.008, 6, 96), ringGlow);
    lr.rotation.x = Math.PI / 2;
    lr.position.y = yy;
    grp.add(lr);
  }
  for (const t2 of terraces) {
    const lr = new THREE.Mesh(new THREE.TorusGeometry(t2.r * 1.01, 0.006, 6, 72), ringGlow);
    lr.rotation.x = Math.PI / 2;
    lr.position.y = t2.y - 0.02;
    grp.add(lr);
  }

  // ---- instanced greebles ----
  const NBOX = 4200, NANT = 140, NWIN = 2000;
  const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), HULL.clone(), NBOX);
  const ants = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 5), DARK.clone(), NANT);
  const winsC = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), GLOW, NWIN);
  const winsW = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), WARM, NWIN);
  for (const im of [boxes, ants, winsC, winsW]) im.frustumCulled = false;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler(),
    sc = new THREE.Vector3(), pp = new THREE.Vector3(), col = new THREE.Color();
  let bi = 0, ai = 0, wc = 0, ww = 0;
  function putBox(x, y, z, sx, sy, sz, yaw, shade) {
    if (bi >= NBOX) return;
    eu.set(0, yaw, 0); q.setFromEuler(eu);
    m4.compose(pp.set(x, y, z), q, sc.set(sx, sy, sz));
    boxes.setMatrixAt(bi, m4);
    boxes.setColorAt(bi, col.setScalar(shade));
    bi++;
  }
  function putAnt(x, y, z, r, h) {
    if (ai >= NANT) return;
    q.identity();
    m4.compose(pp.set(x, y + h / 2, z), q, sc.set(r, h, r));
    ants.setMatrixAt(ai, m4);
    ai++;
  }
  function putWin(mesh, idx, x, y, z, w, h, yaw) {
    m4.compose(pp.set(x, y, z), q.setFromEuler(eu.set(0, yaw, 0)), sc.set(w, h, 0.004));
    mesh.setMatrixAt(idx, m4);
  }

  // size distribution: many small, few huge (log spread)
  const bsize = () => 0.018 * Math.exp(rnd() * 2.3);

  // upper city on the saucer top
  for (let i = 0; i < 1500; i++) {
    const r = R * 0.97 * Math.sqrt(rnd()), th = rnd() * Math.PI * 2;
    const s = bsize(), h = s * (0.4 + rnd() * 3.2);
    putBox(Math.cos(th) * r, surf(r) + h / 2 - s * 0.15, Math.sin(th) * r,
      s * (0.5 + rnd()), h, s * (0.5 + rnd()), rnd() * Math.PI, 0.78 + rnd() * 0.26);
  }
  // hanging under-city
  for (let i = 0; i < 950; i++) {
    const r = R * 0.9 * Math.sqrt(rnd()), th = rnd() * Math.PI * 2;
    const s = bsize(), h = s * (0.4 + rnd() * 3.6);
    putBox(Math.cos(th) * r, -surf(r) - h / 2 + s * 0.15, Math.sin(th) * r,
      s * (0.5 + rnd()), h, s * (0.5 + rnd()), rnd() * Math.PI, 0.72 + rnd() * 0.24);
  }
  // rim flank machinery
  for (let i = 0; i < 520; i++) {
    const th = rnd() * Math.PI * 2, rr = R * (1.0 + rnd() * 0.05);
    const s = bsize() * 0.9;
    putBox(Math.cos(th) * rr, (rnd() - 0.5) * T * 0.62, Math.sin(th) * rr,
      s * (0.4 + rnd() * 1.6), s * (0.4 + rnd() * 1.4), s * (0.3 + rnd()), th, 0.7 + rnd() * 0.3);
  }
  // tower stacks up (uneven skyscrapers, tallest near the middle)
  for (let i = 0; i < 110; i++) {
    const r = R * 0.75 * Math.sqrt(rnd()), th = rnd() * Math.PI * 2;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    let y = surf(r), s = 0.05 + rnd() * 0.12 * (1 - r / R);
    const steps = 2 + Math.floor(rnd() * 5);
    for (let k = 0; k < steps; k++) {
      const h = s * (1.2 + rnd() * 2.4);
      putBox(x + (rnd() - 0.5) * s * 0.4, y + h / 2, z + (rnd() - 0.5) * s * 0.4,
        s, h, s * (0.7 + rnd() * 0.6), rnd() * Math.PI, 0.8 + rnd() * 0.22);
      y += h;
      s *= 0.62 + rnd() * 0.2;
    }
    if (rnd() > 0.55) putAnt(x, y, z, 0.006 + rnd() * 0.008, 0.1 + rnd() * 0.3);
  }
  // stalactite stacks down
  for (let i = 0; i < 70; i++) {
    const r = R * 0.6 * Math.sqrt(rnd()), th = rnd() * Math.PI * 2;
    const x = Math.cos(th) * r, z = Math.sin(th) * r;
    let y = -surf(r), s = 0.04 + rnd() * 0.1 * (1 - r / R);
    const steps = 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < steps; k++) {
      const h = s * (1.2 + rnd() * 2.6);
      putBox(x + (rnd() - 0.5) * s * 0.4, y - h / 2, z + (rnd() - 0.5) * s * 0.4,
        s, h, s * (0.7 + rnd() * 0.6), rnd() * Math.PI, 0.68 + rnd() * 0.2);
      y -= h;
      s *= 0.6 + rnd() * 0.2;
    }
    if (rnd() > 0.7) putAnt(x, y - 0.2, z, 0.005 + rnd() * 0.006, 0.12 + rnd() * 0.2);
  }
  // scattered top antennas
  for (let i = 0; i < 60; i++) {
    const r = R * 0.9 * Math.sqrt(rnd()), th = rnd() * Math.PI * 2;
    putAnt(Math.cos(th) * r, surf(r), Math.sin(th) * r, 0.004 + rnd() * 0.007, 0.08 + rnd() * 0.35);
  }
  // greeble coat on the central spire (broken silhouette instead of a cone)
  for (let i = 0; i < 260; i++) {
    const hFrac = rnd();
    const y = ty + hFrac * R * 0.78;
    const rr = R * (0.075 - hFrac * 0.04) * (0.8 + rnd() * 0.6);
    const th = rnd() * Math.PI * 2;
    const s = 0.01 + rnd() * 0.05 * (1 - hFrac * 0.6);
    putBox(Math.cos(th) * rr, y, Math.sin(th) * rr,
      s * (0.5 + rnd()), s * (0.6 + rnd() * 2.4), s * (0.5 + rnd()), th, 0.78 + rnd() * 0.24);
  }

  // window strips: rim band rows (cyan) + terrace edges (warm)
  for (let i = 0; i < NWIN; i++) {
    const th = rnd() * Math.PI * 2;
    if (rnd() < 0.62 && wc < NWIN) {
      const rr = R * 1.018;
      const y = (Math.floor(rnd() * 5) - 2) * T * 0.11 + (rnd() - 0.5) * 0.01;
      putWin(winsC, wc, Math.cos(th) * rr, y, Math.sin(th) * rr,
        0.02 + rnd() * 0.05, 0.008 + rnd() * 0.01, -th);
      wc++;
    } else if (ww < NWIN) {
      const t2 = terraces[Math.floor(rnd() * terraces.length)];
      putWin(winsW, ww, Math.cos(th) * t2.r * 1.005, t2.y - 0.02 - rnd() * 0.03, Math.sin(th) * t2.r * 1.005,
        0.015 + rnd() * 0.03, 0.006 + rnd() * 0.008, -th);
      ww++;
    }
  }
  winsC.count = wc; winsW.count = ww;
  boxes.count = bi; ants.count = ai;
  boxes.instanceMatrix.needsUpdate = true;
  ants.instanceMatrix.needsUpdate = true;
  winsC.instanceMatrix.needsUpdate = true;
  winsW.instanceMatrix.needsUpdate = true;
  if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
  grp.add(boxes, ants, winsC, winsW);

  // nav blinkers for fleet.place()
  grp.userData.blinkers = [];
  const BL = [[R * 1.05, 0, 0, 0xff5544], [-R * 1.05, 0, 0, 0x44ff77], [0, ty + R * 1.3, 0, 0xffffff], [0, by - R * 0.5, 0, 0xffffff]];
  for (const [x, y, z, c] of BL) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.5 }));
    b.position.set(x, y, z);
    grp.add(b);
    grp.userData.blinkers.push(b);
  }
  return grp;
}
