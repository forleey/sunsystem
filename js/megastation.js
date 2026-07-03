// Generative DARK megacity station — a dense, night-side arcology in the
// spirit of Coruscant / Blade Runner / Blame!. Built on the canonical
// procedural-city pipeline (Parish-Muller / CityEngine) mapped to a POLAR
// GRID for the disc: concentric ring roads + radial avenues whose spoke count
// grows with radius (cells stay ~square), buildings axis-aligned to their
// cell's radial/tangential frame (never random yaw), district-coherent height
// zoning (downtown-core towers -> low industrial rim), podium + wedding-cake
// setbacks, a few landmark super-towers.
//
// What makes it a *city* rather than grey massing:
//   * a procedural WINDOW / depth shader — every facade carries a dense grid
//     of individually lit windows (per-window random on/off + colour from a
//     warm/cyan/amber/magenta palette), so the hull is near-black and the
//     lights carry the read. Lots of randomness, seeded per building.
//   * neon billboards (big saturated emissive panels) on tower faces.
//   * animated flying-traffic skylanes (streams of light circling the city).
//   * a soft light-haze dome so the whole thing glows like a lit city at night.
//
// InstancedMesh throughout (~15 draw calls). Seeded / reproducible.

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

// ---- procedural window / depth shader for the city hull (dark base, dense
// per-window random lights). Injected into a MeshStandardMaterial so it still
// takes the sun; windows are additive emissive on top. ----
function makeCityMaterial(THREE) {
  const m = new THREE.MeshStandardMaterial({ color: 0x05070c, metalness: 0.5, roughness: 0.72 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCityLocal; varying vec3 vCityN; varying float vCitySeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vCityLocal = position * iS;
          vCitySeed = fract(sin(dot(instanceMatrix[3].xyz, vec3(12.9898,78.233,37.719))) * 43758.5453);
        #else
          vCityLocal = position; vCitySeed = 0.3;
        #endif
        vCityN = normal;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCityLocal; varying vec3 vCityN; varying float vCitySeed;
        float ch21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 an = abs(normalize(vCityN));
        if (an.y < 0.55) {                              // side faces only -> windows
          float wp = 0.014, fh = 0.010;                 // window pitch, floor height (station units)
          vec2 uv = (an.x > an.z) ? vec2(vCityLocal.z, vCityLocal.y) : vec2(vCityLocal.x, vCityLocal.y);
          float faceOff = (an.x > an.z) ? 17.0 : 41.0;
          vec2 g = vec2(uv.x / wp, uv.y / fh);
          vec2 cell = floor(g);
          vec2 f = fract(g);
          // window interior vs mullion frame
          float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.22, f.y) * step(f.y, 0.9);
          float rndW = ch21(cell + vCitySeed * 53.0 + faceOff);
          // vertical block of "this floor is lit" + per-window flicker of occupancy
          float floorLit = step(0.35, ch21(vec2(cell.y, vCitySeed * 91.0 + faceOff)));
          float lit = step(0.40, rndW) * mix(0.55, 1.0, floorLit);
          float chc = ch21(cell * 1.73 + vCitySeed * 13.0);
          vec3 wc = chc < 0.58 ? vec3(1.0,0.86,0.62)       // warm white (most)
                  : chc < 0.80 ? vec3(0.55,0.82,1.0)       // cyan
                  : chc < 0.93 ? vec3(1.0,0.62,0.25)        // amber
                  :              vec3(1.0,0.4,0.85);        // magenta
          float bright = 0.35 + 0.65 * ch21(cell + 7.3);
          totalEmissiveRadiance += wc * (lit * win * bright * 2.1);
        } else {
          // rooftops: occasional red hazard beacon
          vec2 rc = floor(vec2(vCityLocal.x, vCityLocal.z) / 0.02);
          if (ch21(rc + vCitySeed * 5.0) > 0.985) totalEmissiveRadiance += vec3(1.0,0.15,0.1) * 2.0;
        }
        // faint panel seams darken the near-black hull
        vec3 pc = abs(fract(vCityLocal / 0.05) - 0.5);
        float seam = smoothstep(0.44, 0.5, max(max(pc.x, pc.y), pc.z));
        diffuseColor.rgb *= 1.0 - seam * 0.5;
      }`);
  };
  return m;
}

export function buildGreebleStation(THREE, { seed = 7, R = 3.0, T = 0.9 } = {}) {
  const rnd = mulberry32(seed);
  const TAU = Math.PI * 2;
  const grp = new THREE.Group();

  const HULL = new THREE.MeshStandardMaterial({ color: 0x0a0e15, metalness: 0.45, roughness: 0.7 });
  const DARK = new THREE.MeshStandardMaterial({ color: 0x070a10, metalness: 0.5, roughness: 0.75 });
  const CITY = makeCityMaterial(THREE);
  const NEON = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const LANEMAT = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const ROADMAT = new THREE.MeshStandardMaterial({ color: 0x05070c, emissive: 0x3a6a9a, emissiveIntensity: 1.4 });

  // ---- base hull: dark squashed saucer + rim + central mesa + spire ----
  const surf = r => (T / 2) * Math.sqrt(Math.max(0, 1 - (r / R) * (r / R)));
  const saucer = new THREE.Mesh(new THREE.SphereGeometry(R, 72, 30), HULL);
  saucer.scale.set(1, (T / 2) / R, 1);
  grp.add(saucer);
  grp.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 1.015, R * 1.015, T * 0.5, 80, 1, true), DARK));

  const mesaR = R * 0.16, mesaH = R * 0.10;
  const mesa = new THREE.Mesh(new THREE.CylinderGeometry(mesaR * 0.8, mesaR, mesaH, 32), DARK);
  mesa.position.y = surf(0) + mesaH / 2;
  grp.add(mesa);
  const spireBaseY = surf(0) + mesaH;
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.025, R * 0.055, R * 0.85, 10), HULL);
  spire.position.y = spireBaseY + R * 0.42;
  grp.add(spire);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.005, R * 0.005, R * 0.6, 6), DARK);
  mast.position.y = spireBaseY + R * 1.1;
  grp.add(mast);

  // ---- instanced pools ----
  const NBOX = 16000, NANT = 300, NNEON = 700, NROAD = 1600;
  const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), CITY, NBOX);
  const ants = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 5), DARK.clone(), NANT);
  const neon = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), NEON, NNEON);
  const roads = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), ROADMAT, NROAD);
  boxes.frustumCulled = ants.frustumCulled = neon.frustumCulled = roads.frustumCulled = false;

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler(),
    scv = new THREE.Vector3(), pp = new THREE.Vector3(), col = new THREE.Color();
  let bi = 0, ai = 0, ni = 0, ridx = 0;
  function putBox(x, y, z, sx, sy, sz, yaw) {
    if (bi >= NBOX) return;
    m4.compose(pp.set(x, y, z), q.setFromEuler(eu.set(0, yaw, 0)), scv.set(sx, sy, sz));
    boxes.setMatrixAt(bi++, m4);
  }
  function putAnt(x, y, z, r, h) {
    if (ai >= NANT) return;
    m4.compose(pp.set(x, y + h / 2, z), q.identity(), scv.set(r, h, r));
    ants.setMatrixAt(ai++, m4);
  }
  const NEONCOL = [[1.0, 0.2, 0.7], [0.2, 0.9, 1.0], [1.0, 0.55, 0.1], [0.5, 1.0, 0.3], [0.8, 0.3, 1.0]];
  function putNeon(x, y, z, sx, sy, sz, yaw, c) {
    if (ni >= NNEON) return;
    m4.compose(pp.set(x, y, z), q.setFromEuler(eu.set(0, yaw, 0)), scv.set(sx, sy, sz));
    neon.setMatrixAt(ni, m4);
    neon.setColorAt(ni, col.setRGB(c[0], c[1], c[2]));
    ni++;
  }
  function putRoad(x, y, z, sx, sy, sz, yaw) {
    if (ridx >= NROAD) return;
    m4.compose(pp.set(x, y, z), q.setFromEuler(eu.set(0, yaw, 0)), scv.set(sx, sy, sz));
    roads.setMatrixAt(ridx++, m4);
  }

  // ring-road radii and zoning (inner = tall downtown, outer = low fabric)
  const ringR = [0.17, 0.29, 0.42, 0.56, 0.70, 0.83, 0.955].map(f => f * R);
  const CELL_W = 0.30 * R, LOT = 0.085 * R, roadHalf = 0.014 * R;
  const zone = [
    { h: 0.72, tall: 0.60, mid: 0.32, low: 0.06, plaza: 0.02 },
    { h: 0.56, tall: 0.48, mid: 0.40, low: 0.09, plaza: 0.03 },
    { h: 0.40, tall: 0.32, mid: 0.46, low: 0.18, plaza: 0.04 },
    { h: 0.30, tall: 0.20, mid: 0.48, low: 0.27, plaza: 0.05 },
    { h: 0.22, tall: 0.10, mid: 0.44, low: 0.39, plaza: 0.07 },
    { h: 0.15, tall: 0.04, mid: 0.34, low: 0.52, plaza: 0.10 },
  ];

  function cityLayer(sign, density, heightMul) {
    for (let ring = 0; ring < ringR.length - 1; ring++) {
      const rIn = ringR[ring], rOut = ringR[ring + 1], rMid = (rIn + rOut) / 2;
      const spokes = Math.max(6, Math.round(TAU * rMid / CELL_W));
      const z = zone[ring];
      for (let s = 0; s < spokes; s++) {
        const th0 = (s / spokes) * TAU, th1 = ((s + 1) / spokes) * TAU;
        let a = hash2(ring * 97 + (sign > 0 ? 0 : 1000), s), type;
        if ((a -= z.tall) < 0) type = 'tall';
        else if ((a -= z.mid) < 0) type = 'mid';
        else if ((a -= z.low) < 0) type = 'low';
        else type = 'plaza';
        if (rnd() > density) continue;

        const arc = rMid * (th1 - th0);
        const nT = Math.max(1, Math.round((arc - 2 * roadHalf) / LOT));
        const nR = Math.max(1, Math.round((rOut - rIn - 2 * roadHalf) / LOT));
        const landmark = type === 'tall' && ring <= 2 && hash2(s, ring + 313) > 0.82;

        for (let lt = 0; lt < nT; lt++) {
          for (let lr = 0; lr < nR; lr++) {
            if (type === 'plaza' && rnd() > 0.35) continue;
            const th = th0 + (lt + 0.5) / nT * (th1 - th0);
            const rr = rIn + roadHalf + (lr + 0.5) / nR * (rOut - rIn - 2 * roadHalf);
            const x = Math.cos(th) * rr, zc = Math.sin(th) * rr;
            const base = sign * surf(rr), yaw = -th;
            const wT = (th1 - th0) / nT * rr * 0.86, wR = (rOut - rIn - 2 * roadHalf) / nR * 0.86;
            const foot = Math.min(wT, wR);

            if (type === 'plaza') {
              putBox(x, base + sign * 0.01 * R, zc, wR, 0.02 * R, wT, yaw);
              continue;
            }
            const podH = (0.025 + rnd() * 0.03) * R;
            putBox(x, base + sign * podH / 2, zc, wR, podH, wT, yaw);

            let towH = z.h * heightMul * (0.4 + rnd() * 0.6) * R;
            if (type === 'low') towH *= 0.4;
            if (type === 'mid') towH *= 0.72;
            if (landmark && lt === (nT >> 1) && lr === (nR >> 1)) towH *= 2.6;
            let fw = foot * (0.55 + rnd() * 0.3), y = base + sign * podH;
            const steps = type === 'tall' ? 2 + Math.floor(rnd() * 3) : 1 + (rnd() > 0.6 ? 1 : 0);
            let topY = y;
            for (let k = 0; k < steps; k++) {
              const segH = towH / steps * (0.75 + rnd() * 0.4);
              const jx = (rnd() - 0.5) * fw * 0.15, jz = (rnd() - 0.5) * fw * 0.15;
              putBox(x + jx, y + sign * segH / 2, zc + jz, fw, segH, fw * (0.72 + rnd() * 0.4), yaw);
              y += sign * segH; topY = y;
              fw *= 0.62 + rnd() * 0.2;
            }
            // rooftop mast on the taller towers
            if (sign > 0 && towH > 0.35 * R && rnd() > 0.45) putAnt(x, topY, zc, 0.004 + rnd() * 0.006, 0.05 + rnd() * 0.26);
            // neon billboard on a face of prominent towers
            if (towH > 0.3 * R && rnd() > 0.55) {
              const nc = NEONCOL[(hash2(s * 13 + lt, ring * 7 + lr) * NEONCOL.length) | 0];
              const ny = base + sign * (podH + towH * (0.4 + rnd() * 0.4));
              const off = fw * 0.5 + 0.004;
              const nx = x + Math.cos(th) * off, nz = zc + Math.sin(th) * off;   // face outward (radial)
              putNeon(nx, ny, nz, 0.006, towH * (0.12 + rnd() * 0.2), wT * (0.2 + rnd() * 0.3), yaw, nc);
            }
          }
        }
      }
    }
  }
  cityLayer(1, 1.0, 1.0);
  cityLayer(-1, 0.5, 0.55);

  // ---- glowing road grid (ring roads + radial avenues) ----
  for (let ring = 0; ring < ringR.length; ring++) {
    const rr = ringR[ring], y = surf(rr) + 0.005 * R;
    const seg = Math.max(60, Math.round(TAU * rr / (0.05 * R)));
    for (let s = 0; s < seg; s++) {
      const th = (s / seg) * TAU;
      putRoad(Math.cos(th) * rr, y, Math.sin(th) * rr, 0.007 * R, 0.005 * R, (TAU * rr / seg) * 0.92, -th);
    }
  }
  const avenues = 28;
  for (let a = 0; a < avenues; a++) {
    const th = (a / avenues) * TAU, c = Math.cos(th), s = Math.sin(th), steps = 26;
    for (let k = 0; k < steps; k++) {
      const rr = ringR[0] + (k + 0.5) / steps * (ringR[ringR.length - 1] - ringR[0]);
      putRoad(c * rr, surf(rr) + 0.005 * R, s * rr, 0.9 * (ringR[ringR.length - 1] - ringR[0]) / steps, 0.005 * R, 0.006 * R, -th);
    }
  }

  // ---- rim machinery + spire greeble ----
  for (let i = 0; i < 120; i++) {
    const th = (i / 120) * TAU + (hash2(i, 7) - 0.5) * 0.02, h = (0.05 + hash2(i, 11) * 0.16) * R;
    putBox(Math.cos(th) * (R + h / 2), (hash2(i, 13) - 0.5) * T * 0.5, Math.sin(th) * (R + h / 2),
      h, (0.04 + hash2(i, 17) * 0.12) * R, (0.03 + hash2(i, 19) * 0.06) * R, -th);
  }
  for (let i = 0; i < 260; i++) {
    const hF = rnd(), y = spireBaseY + hF * R * 0.8, rr = R * (0.06 - hF * 0.035) * (0.8 + rnd() * 0.6);
    const th = rnd() * TAU, sz = (0.007 + rnd() * 0.04 * (1 - hF * 0.6)) * R;
    putBox(Math.cos(th) * rr, y, Math.sin(th) * rr, sz * (0.6 + rnd()), sz * (0.7 + rnd() * 2.4), sz * (0.6 + rnd()), -th);
  }

  boxes.count = bi; ants.count = ai; neon.count = ni; roads.count = ridx;
  for (const im of [boxes, ants, neon, roads]) im.instanceMatrix.needsUpdate = true;
  if (neon.instanceColor) neon.instanceColor.needsUpdate = true;
  grp.add(boxes, ants, neon, roads);

  // ---- flying-traffic skylanes: animated streams of light on visible routes.
  // Lanes ride ABOVE the rooftops so they read against the dark sky/haze, each
  // with a faint continuous guide-line so the route shows between vehicles. ----
  const lanes = [];
  const LANEDEF = [
    // [radiusFrac, heightFrac, count, angularSpeed, dir, tilt, tail?]
    [0.55, 0.34, 90, 0.05, 1, 0.02, 1], [0.72, 0.46, 120, 0.042, -1, 0.05, 0],
    [0.90, 0.30, 150, 0.036, 1, 0.03, 1], [1.06, 0.54, 130, 0.03, -1, 0.06, 0],
    [0.64, 0.66, 80, 0.055, 1, 0.08, 1], [1.20, 0.22, 120, 0.028, 1, 0.02, 0],
    [0.42, 0.80, 60, 0.06, -1, 0.05, 1], [0.98, 0.72, 90, 0.033, -1, 0.10, 0],
  ];
  let laneTotal = 0;
  for (const d of LANEDEF) laneTotal += d[2];
  const traffic = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), LANEMAT, laneTotal);
  traffic.frustumCulled = false;
  const guideMat = new THREE.MeshBasicMaterial({ color: 0x2b6ea8, transparent: true, opacity: 0.28, toneMapped: false });
  {
    let idx = 0;
    for (const [rf, hf, cnt, spd, dir, tilt, tail] of LANEDEF) {
      const rr = rf * R, hy = surf(0) + hf * R + 0.04 * R;
      const base = [];
      for (let i = 0; i < cnt; i++) base.push((i / cnt) * TAU + hash2(idx, i) * 0.03);
      lanes.push({ rr, hy, spd, dir, tilt, start: idx, cnt, base });
      // bright streaks so bloom catches them: headlight blue-white / tail amber-red
      const c = tail ? [2.6, 1.1, 0.5] : [0.8, 1.6, 2.6];
      for (let i = 0; i < cnt; i++) traffic.setColorAt(idx + i, col.setRGB(c[0], c[1], c[2]));
      idx += cnt;
      // faint continuous guide ring marking the route
      const guide = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.004 * R, 4, 120), guideMat);
      guide.rotation.x = Math.PI / 2;
      guide.position.y = hy;
      grp.add(guide);
    }
    traffic.instanceColor.needsUpdate = true;
  }
  grp.add(traffic);
  const tm = new THREE.Matrix4(), tq = new THREE.Quaternion(), te = new THREE.Euler(), tp = new THREE.Vector3(), ts = new THREE.Vector3();
  grp.userData.animate = (t) => {
    for (const L of lanes) {
      for (let i = 0; i < L.cnt; i++) {
        const a = L.base[i] + L.dir * L.spd * t;
        const ca = Math.cos(a), sa = Math.sin(a);
        const x = ca * L.rr, z = sa * L.rr, y = L.hy + Math.sin(a * 2.0 + i) * L.tilt * L.rr;
        tm.compose(tp.set(x, y, z), tq.setFromEuler(te.set(0, a + Math.PI / 2, 0)), ts.set(0.075 * R, 0.007 * R, 0.007 * R));
        traffic.setMatrixAt(L.start + i, tm);
      }
    }
    traffic.instanceMatrix.needsUpdate = true;
  };
  grp.userData.animate(0);

  // ---- light-haze dome: soft additive glow so the city reads as lit at night ----
  const hazeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    uniforms: { uColor: { value: new THREE.Color(0x2a4a72) } },
    vertexShader: `varying vec3 vN; varying vec3 vP;
      void main(){ vN = normalize(normalMatrix * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vN; varying vec3 vP; uniform vec3 uColor;
      void main(){
        float rim = pow(1.0 - abs(vN.z), 2.0);
        float low = smoothstep(-0.4, 0.5, vP.y / ${(R * 1.4).toFixed(3)});   // denser near the disc
        gl_FragColor = vec4(uColor * rim * (0.25 + low * 0.5), rim * 0.5);
      }`,
  });
  const haze = new THREE.Mesh(new THREE.SphereGeometry(R * 1.5, 32, 24), hazeMat);
  haze.scale.set(1, 0.6, 1);
  grp.add(haze);

  // nav blinkers for fleet.place()
  grp.userData.blinkers = [];
  const topY = spireBaseY + R * 1.05;
  const BL = [[R * 1.06, 0, 0, 0xff5544], [-R * 1.06, 0, 0, 0x44ff77], [0, topY, 0, 0xffffff], [0, -surf(0) - R * 0.3, 0, 0xffffff]];
  for (const [x, y, z, c] of BL) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.5 }));
    b.position.set(x, y, z);
    grp.add(b);
    grp.userData.blinkers.push(b);
  }
  return grp;
}
