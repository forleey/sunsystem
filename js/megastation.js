// Generative FLOATING CLUSTER-CITY — a hanging island arcology in the spirit
// of the reference: a dense vertical massif of clustered towers rising into
// jagged spires up top, a lumpy rock core, and inverted stalactite spires
// dripping below, wrapped in warm haze with scattered flying traffic.
//
// Not a flat disc: tower height + placement are driven by a PEAK NOISE FIELD
// (several sharp gaussian peaks + fbm) so towers clump into mountain-like
// clusters with canyons between them, tallest at a dominant central massif.
// The window/depth shader (dense per-window random lights on near-black hull)
// carries the city read. InstancedMesh throughout, seeded/reproducible.

function mulberry32(a) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(i, j) {
  let h = Math.imul((i | 0) + 1, 374761393) ^ Math.imul((j | 0) + 1, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

// procedural window / depth shader (dark hull, dense per-window random lights)
function makeCityMaterial(THREE) {
  const m = new THREE.MeshStandardMaterial({ color: 0x0b0a08, metalness: 0.45, roughness: 0.72 });
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
        if (an.y < 0.55) {
          float wp = 0.013, fh = 0.009;
          vec2 uv = (an.x > an.z) ? vec2(vCityLocal.z, vCityLocal.y) : vec2(vCityLocal.x, vCityLocal.y);
          float faceOff = (an.x > an.z) ? 17.0 : 41.0;
          vec2 g = vec2(uv.x / wp, uv.y / fh);
          vec2 cell = floor(g), f = fract(g);
          float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.22, f.y) * step(f.y, 0.9);
          float rndW = ch21(cell + vCitySeed * 53.0 + faceOff);
          float floorLit = step(0.35, ch21(vec2(cell.y, vCitySeed * 91.0 + faceOff)));
          float lit = step(0.42, rndW) * mix(0.5, 1.0, floorLit);
          float chc = ch21(cell * 1.73 + vCitySeed * 13.0);
          vec3 wc = chc < 0.62 ? vec3(1.0,0.83,0.55)
                  : chc < 0.82 ? vec3(1.0,0.66,0.3)
                  : chc < 0.94 ? vec3(0.55,0.8,1.0)
                  :              vec3(1.0,0.4,0.7);
          float bright = 0.35 + 0.65 * ch21(cell + 7.3);
          totalEmissiveRadiance += wc * (lit * win * bright * 2.0);
        } else {
          vec2 rc = floor(vec2(vCityLocal.x, vCityLocal.z) / 0.02);
          if (ch21(rc + vCitySeed * 5.0) > 0.985) totalEmissiveRadiance += vec3(1.0,0.2,0.12) * 2.0;
        }
        vec3 pc = abs(fract(vCityLocal / 0.05) - 0.5);
        float seam = smoothstep(0.44, 0.5, max(max(pc.x, pc.y), pc.z));
        diffuseColor.rgb *= 1.0 - seam * 0.5;
      }`);
  };
  return m;
}

export function buildGreebleStation(THREE, { seed = 7, R = 2.6 } = {}) {
  const rnd = mulberry32(seed);
  const TAU = Math.PI * 2;
  const grp = new THREE.Group();

  const ROCK = new THREE.MeshStandardMaterial({ color: 0x0a0806, metalness: 0.2, roughness: 0.98, flatShading: true });
  const CITY = makeCityMaterial(THREE);
  const LANEMAT = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const NEON = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

  // ---- peak field: a few sharp gaussian peaks + fbm -> clustered mountains ----
  const domeH = R * 0.32;              // top surface dome height at center
  const maxH = R * 1.7;                // tallest tower rise
  const peaks = [{ x: 0, z: 0, amp: 1.0, sig: R * 0.28 }];
  const nPeaks = 6;
  for (let i = 0; i < nPeaks; i++) {
    const a = rnd() * TAU, rr = R * (0.28 + rnd() * 0.5);
    peaks.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, amp: 0.5 + rnd() * 0.45, sig: R * (0.13 + rnd() * 0.12) });
  }
  function peakField(x, z) {
    let pv = 0.14 * (vnoise(x / (R * 0.35) + 3, z / (R * 0.35) + 7) * 0.6 + vnoise(x / (R * 0.12), z / (R * 0.12)) * 0.4);
    for (const p of peaks) {
      const dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz;
      pv = Math.max(pv, p.amp * Math.exp(-d2 / (2 * p.sig * p.sig)));
    }
    return Math.min(1, pv);
  }
  const topSurf = rho => domeH * Math.sqrt(Math.max(0, 1 - (rho / R) * (rho / R)));
  // irregular, torn footprint edge
  const footR = th => R * (0.72 + 0.26 * vnoise(Math.cos(th) * 2.3 + 11, Math.sin(th) * 2.3 + 5));

  // ---- lumpy rock core the city clings to ----
  const coreGeo = new THREE.IcosahedronGeometry(R * 0.6, 4);
  {
    const p = coreGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const len = Math.hypot(x, y, z), nx = x / len, ny = y / len, nz = z / len;
      const bump = 0.72 + 0.5 * vnoise(nx * 3 + 20, nz * 3 + 9) + 0.18 * vnoise(nx * 7, nz * 7);
      let r = R * 0.6 * bump;
      x = nx * r; z = nz * r;
      y = ny * r * (ny > 0 ? 0.35 : 1.9);           // flat top (city embeds), long drippy bottom
      // downward spikes on the underside
      if (ny < -0.3) y -= R * 0.8 * Math.pow(-ny, 2.0) * vnoise(nx * 6 + 40, nz * 6 + 3);
      p.setXYZ(i, x, y, z);
    }
    coreGeo.computeVertexNormals();
  }
  grp.add(new THREE.Mesh(coreGeo, ROCK));

  // ---- instanced pools ----
  const NBOX = 20000, NANT = 400, NNEON = 700;
  const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), CITY, NBOX);
  const ants = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 5), ROCK.clone(), NANT);
  const neon = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), NEON, NNEON);
  boxes.frustumCulled = ants.frustumCulled = neon.frustumCulled = false;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler(),
    scv = new THREE.Vector3(), pp = new THREE.Vector3(), col = new THREE.Color();
  let bi = 0, ai = 0, ni = 0;
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
  const NEONCOL = [[1.0, 0.35, 0.1], [1.0, 0.7, 0.15], [0.3, 0.85, 1.0], [1.0, 0.2, 0.55]];
  function putNeon(x, y, z, sx, sy, sz, yaw, c) {
    if (ni >= NNEON) return;
    m4.compose(pp.set(x, y, z), q.setFromEuler(eu.set(0, yaw, 0)), scv.set(sx, sy, sz));
    neon.setMatrixAt(ni, m4); neon.setColorAt(ni, col.setRGB(c[0], c[1], c[2])); ni++;
  }

  // ---- upper city: clustered towers on a jittered grid, height from peakField ----
  const step = R * 0.052;
  const gridYaw = rnd() * TAU;                       // one coherent block orientation
  for (let gx = -R; gx <= R; gx += step) {
    for (let gz = -R; gz <= R; gz += step) {
      const jx = gx + (hash2(gx * 133, gz * 71) - 0.5) * step * 0.7;
      const jz = gz + (hash2(gx * 51, gz * 219) - 0.5) * step * 0.7;
      const rho = Math.hypot(jx, jz), th = Math.atan2(jz, jx);
      if (rho > footR(th)) continue;
      const pv = peakField(jx, jz);
      // canyons / gaps: skip low-density and some random cells
      if (pv < 0.12 && rnd() < 0.75) continue;
      if (rnd() < 0.12) continue;
      const baseY = topSurf(rho) * 0.5 - 0.06 * R;   // embed towers into the core -> one continuous mass
      const h = maxH * (0.10 + pv * 0.95) * (0.5 + 0.55 * rnd());
      const yaw = gridYaw + (rnd() - 0.5) * 0.25 + (hash2(Math.round(jx / (R * 0.3)), Math.round(jz / (R * 0.3))) - 0.5) * 0.6;
      let fw = step * (0.55 + rnd() * 0.4), y = baseY;
      const steps = 1 + Math.floor(pv * 3 + rnd() * 2);
      let topY = y;
      for (let k = 0; k < steps; k++) {
        const segH = h / steps * (0.75 + rnd() * 0.4);
        putBox(jx + (rnd() - 0.5) * fw * 0.15, y + segH / 2, jz + (rnd() - 0.5) * fw * 0.15,
          fw, segH, fw * (0.75 + rnd() * 0.4), yaw);
        y += segH; topY = y;
        fw *= 0.7 + rnd() * 0.18;
      }
      // sharp needle tip on tall towers -> the jagged peaks
      if (h > maxH * 0.5 && rnd() > 0.35) {
        const tipH = h * (0.15 + rnd() * 0.3);
        putBox(jx, topY + tipH / 2, jz, fw * 0.5, tipH, fw * 0.5, yaw);
        putAnt(jx, topY + tipH, jz, 0.004 + rnd() * 0.005, 0.05 + rnd() * 0.2);
        topY += tipH;
      }
      // neon billboard on prominent towers
      if (h > maxH * 0.4 && rnd() > 0.7) {
        const nc = NEONCOL[(hash2(gx * 7, gz * 3) * NEONCOL.length) | 0];
        putNeon(jx + Math.cos(yaw) * fw * 0.6, baseY + h * (0.4 + rnd() * 0.4), jz + Math.sin(yaw) * fw * 0.6,
          0.005, h * (0.1 + rnd() * 0.18), fw * (0.4 + rnd() * 0.5), yaw, nc);
      }
    }
  }

  // ---- hanging stalactite spires below (longest near the peaks/centre) ----
  for (let i = 0; i < 900; i++) {
    const th = rnd() * TAU, rho = footR(th) * Math.sqrt(rnd()) * 0.92;
    const x = Math.cos(th) * rho, z = Math.sin(th) * rho;
    const pv = peakField(x, z);
    if (rnd() > 0.35 + pv * 0.5) continue;
    const underY = -topSurf(rho) * 0.5 - R * 0.1;
    const drop = maxH * (0.25 + pv * 1.1) * (0.5 + 0.6 * rnd()) * (1 - rho / R * 0.5);
    const yaw = gridYaw + (rnd() - 0.5) * 0.5;
    let fw = step * (0.5 + rnd() * 0.5), y = underY;
    const steps = 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < steps; k++) {
      const segH = drop / steps * (0.8 + rnd() * 0.4);
      putBox(x, y - segH / 2, z, fw, segH, fw * (0.8 + rnd() * 0.3), yaw);
      y -= segH; fw *= 0.6 + rnd() * 0.18;            // taper to a point
    }
  }

  boxes.count = bi; ants.count = ai; neon.count = ni;
  for (const im of [boxes, ants, neon]) im.instanceMatrix.needsUpdate = true;
  if (neon.instanceColor) neon.instanceColor.needsUpdate = true;
  grp.add(boxes, ants, neon);

  // ---- scattered flying traffic: individual craft on their own drift arcs.
  // Two fixed HDR-colour pools (warm headlights / cool tails) so they bloom
  // reliably — no dependence on per-instance instanceColor. ----
  const NCRAFT = 240, NWARM = NCRAFT >> 1, NCOOL = NCRAFT - NWARM;
  const warmMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  warmMat.color.setRGB(1.5, 0.85, 0.4);
  const coolMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  coolMat.color.setRGB(0.5, 0.9, 1.5);
  const warmCraft = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), warmMat, NWARM);
  const coolCraft = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), coolMat, NCOOL);
  warmCraft.frustumCulled = coolCraft.frustumCulled = false;
  const craft = [];
  for (let i = 0; i < NCRAFT; i++) {
    const a0 = rnd() * TAU, rad = R * (0.55 + rnd() * 0.9), hy = (rnd() - 0.4) * R * 1.5;
    const cx = (rnd() - 0.5) * R * 0.3, cz = (rnd() - 0.5) * R * 0.3;
    craft.push({ cx, cz, hy, rad, a0, spd: 0.02 + rnd() * 0.06, dir: rnd() > 0.5 ? 1 : -1,
      bob: R * (0.02 + rnd() * 0.06), sz: R * (0.008 + rnd() * 0.012),
      mesh: i < NWARM ? warmCraft : coolCraft, mi: i < NWARM ? i : i - NWARM });
  }
  grp.add(warmCraft, coolCraft);
  const tm = new THREE.Matrix4(), tq = new THREE.Quaternion(), te = new THREE.Euler(), tp = new THREE.Vector3(), tsz = new THREE.Vector3();
  grp.userData.animate = (t) => {
    for (let i = 0; i < NCRAFT; i++) {
      const c = craft[i], a = c.a0 + c.dir * c.spd * t;
      const x = c.cx + Math.cos(a) * c.rad, z = c.cz + Math.sin(a) * c.rad;
      const y = c.hy + Math.sin(a * 2.0 + i) * c.bob;
      tm.compose(tp.set(x, y, z), tq.setFromEuler(te.set(0, a + Math.PI / 2, 0)), tsz.set(c.sz * 3.0, c.sz * 0.5, c.sz * 0.5));
      c.mesh.setMatrixAt(c.mi, tm);
    }
    warmCraft.instanceMatrix.needsUpdate = true;
    coolCraft.instanceMatrix.needsUpdate = true;
  };
  grp.userData.animate(0);

  // ---- warm haze glow enveloping the city ----
  const hazeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    uniforms: { uColor: { value: new THREE.Color(0x6a4326) } },
    vertexShader: `varying vec3 vN; varying vec3 vP;
      void main(){ vN = normalize(normalMatrix * normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vN; varying vec3 vP; uniform vec3 uColor;
      void main(){
        float rim = pow(1.0 - abs(vN.z), 1.8);
        float band = exp(-abs(vP.y) / ${(R * 0.9).toFixed(3)});   // densest around the city mid-band
        gl_FragColor = vec4(uColor * rim * (0.3 + band * 0.7), rim * 0.55);
      }`,
  });
  const haze = new THREE.Mesh(new THREE.SphereGeometry(R * 1.7, 32, 24), hazeMat);
  haze.scale.set(1, 1.15, 1);
  grp.add(haze);

  // nav blinkers for fleet.place()
  grp.userData.blinkers = [];
  const topPeakY = topSurf(0) + maxH * 1.15;
  const BL = [[R * 0.9, 0, 0, 0xff5544], [-R * 0.9, 0, 0, 0x44ff77], [0, topPeakY, 0, 0xffffff], [0, -maxH * 0.9, 0, 0xffaa44]];
  for (const [x, y, z, c] of BL) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.5 }));
    b.position.set(x, y, z);
    grp.add(b);
    grp.userData.blinkers.push(b);
  }
  return grp;
}
