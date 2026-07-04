// Generative planetary city-disc built from TEXTURES + a DEPTH (displacement)
// MAP — not instanced boxes. A high-res grid plane samples a procedurally
// painted height map for its building relief, an emissive map paints the
// carpet of city lights + glowing road web, and a Sobel-derived normal map
// gives the relief its shading. A cluster of giant orbital-tether towers
// rises from the downtown core (the reference's space elevators).
//
// Everything is drawn once onto <canvas> at build time, so it's ~4 draw calls
// total and seeded/reproducible.

function mulberry32(a) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildGreebleStation(THREE, { seed = 7, R = 2.6 } = {}) {
  const rnd = mulberry32(seed);
  const TAU = Math.PI * 2;
  const grp = new THREE.Group();
  const S = 1024, C = S / 2;                     // texture size, centre
  const cityR = S * 0.47;                        // city radius in texels

  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const hCan = mk(), eCan = mk(), aCan = mk();   // height, emissive, albedo
  const hx = hCan.getContext('2d'), ex = eCan.getContext('2d'), ax = aCan.getContext('2d');

  // downtown-tall radial falloff (bid-rent): height/density decay from centre
  const falloff = (px, py) => {
    const d = Math.hypot(px - C, py - C) / cityR;
    return Math.max(0, 1 - d * d);
  };

  // ---- base fields ----
  hx.fillStyle = '#000'; hx.fillRect(0, 0, S, S);
  ax.fillStyle = '#0c0e12'; ax.fillRect(0, 0, S, S);
  ex.fillStyle = '#000'; ex.fillRect(0, 0, S, S);
  // soft base plateau on the height map (the ground the city sits on)
  {
    const g = hx.createRadialGradient(C, C, 0, C, C, cityR);
    g.addColorStop(0, 'rgba(60,60,60,1)'); g.addColorStop(0.6, 'rgba(38,38,38,1)');
    g.addColorStop(1, 'rgba(0,0,0,1)');
    hx.fillStyle = g; hx.beginPath(); hx.arc(C, C, cityR, 0, TAU); hx.fill();
  }

  // ---- road web: radial avenues + concentric rings + jittered local grid ----
  // roads read as recessed canyons (dark on height) and glowing lines (emissive)
  function road(x0, y0, x1, y1, wH, wE, warm) {
    hx.strokeStyle = '#050505'; hx.lineWidth = wH; hx.lineCap = 'round';
    hx.beginPath(); hx.moveTo(x0, y0); hx.lineTo(x1, y1); hx.stroke();
    ex.strokeStyle = warm ? 'rgba(255,150,60,0.9)' : 'rgba(140,190,255,0.85)';
    ex.lineWidth = wE; ex.lineCap = 'round';
    ex.beginPath(); ex.moveTo(x0, y0); ex.lineTo(x1, y1); ex.stroke();
  }
  const NA = 16;
  for (let a = 0; a < NA; a++) {
    const th = (a / NA) * TAU + (rnd() - 0.5) * 0.05;
    road(C, C, C + Math.cos(th) * cityR, C + Math.sin(th) * cityR, 8, a % 3 === 0 ? 5 : 3.5, a % 3 === 0);
  }
  for (let ring = 1; ring <= 9; ring++) {
    const rr = cityR * (ring / 9) * (0.95 + rnd() * 0.08);
    hx.strokeStyle = '#050505'; hx.lineWidth = 5; hx.beginPath(); hx.arc(C, C, rr, 0, TAU); hx.stroke();
    ex.strokeStyle = 'rgba(160,200,255,0.7)'; ex.lineWidth = 2.6; ex.beginPath(); ex.arc(C, C, rr, 0, TAU); ex.stroke();
  }
  // jittered local street grid (clipped to the disc)
  for (let gx = 0; gx < S; gx += 26) {
    road(gx + (rnd() - 0.5) * 8, 0, gx + (rnd() - 0.5) * 8, S, 2.5, 1.0, false);
    road(0, gx + (rnd() - 0.5) * 8, S, gx + (rnd() - 0.5) * 8, 2.5, 1.0, false);
  }

  // ---- building blocks: rectangles of random height, taller near centre ----
  hx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9000; i++) {
    const th = rnd() * TAU, rr = cityR * Math.pow(rnd(), 0.7);
    const px = C + Math.cos(th) * rr, py = C + Math.sin(th) * rr;
    const f = falloff(px, py);
    if (rnd() > 0.35 + f * 0.6) continue;                   // sparser toward the rim
    const w = 4 + rnd() * 14, h = 4 + rnd() * 14;
    const hgt = Math.floor((0.15 + rnd() * 0.85) * (0.4 + f * 0.85) * 200);
    hx.fillStyle = `rgb(${hgt},${hgt},${hgt})`;
    hx.save(); hx.translate(px, py); hx.rotate(rnd() < 0.5 ? 0 : Math.PI / 2 * rnd());
    hx.fillRect(-w / 2, -h / 2, w, h); hx.restore();
  }
  // a few tall spike districts
  for (let i = 0; i < 40; i++) {
    const th = rnd() * TAU, rr = cityR * Math.pow(rnd(), 1.4) * 0.6;
    const px = C + Math.cos(th) * rr, py = C + Math.sin(th) * rr;
    const g = hx.createRadialGradient(px, py, 0, px, py, 10 + rnd() * 26);
    g.addColorStop(0, 'rgba(230,230,230,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    hx.fillStyle = g; hx.beginPath(); hx.arc(px, py, 36, 0, TAU); hx.fill();
  }
  hx.globalCompositeOperation = 'source-over';
  // blur the height field so displacement gives smooth block plateaus, not
  // per-texel needles (the city is a low relief carpet; towers add the height)
  hx.filter = 'blur(2px)'; hx.drawImage(hCan, 0, 0); hx.filter = 'none';

  // ---- albedo: faint block variation over the dark ground ----
  ax.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4000; i++) {
    const th = rnd() * TAU, rr = cityR * Math.sqrt(rnd());
    const px = C + Math.cos(th) * rr, py = C + Math.sin(th) * rr;
    const v = 8 + Math.floor(rnd() * 26);
    ax.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
    ax.fillRect(px, py, 3 + rnd() * 10, 3 + rnd() * 10);
  }
  ax.globalCompositeOperation = 'source-over';

  // ---- emissive: carpet of window/street lights, denser toward the centre ----
  ex.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 42000; i++) {
    const th = rnd() * TAU, rr = cityR * Math.pow(rnd(), 0.6);
    const px = C + Math.cos(th) * rr, py = C + Math.sin(th) * rr;
    const f = falloff(px, py);
    if (rnd() > 0.25 + f * 0.7) continue;
    const c = rnd();
    ex.fillStyle = c < 0.68 ? 'rgba(255,190,110,0.95)'      // warm sodium
      : c < 0.9 ? 'rgba(160,200,255,0.9)'                    // cool
      : 'rgba(255,120,90,0.9)';                              // amber
    const s = rnd() < 0.9 ? 1 : 2;
    ex.fillRect(px, py, s, s);
  }
  ex.globalCompositeOperation = 'source-over';

  // ---- normal map from the height field (Sobel) ----
  const nCan = mk(), nx = nCan.getContext('2d');
  {
    const hd = hx.getImageData(0, 0, S, S).data;
    const nd = nx.createImageData(S, S);
    const H = (x, y) => hd[(((y & (S - 1)) * S) + (x & (S - 1))) * 4] / 255;
    const strength = 3.0;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dzdx = (H(x + 1, y) - H(x - 1, y)) * strength;
        const dzdy = (H(x, y + 1) - H(x, y - 1)) * strength;
        let nxv = -dzdx, nyv = -dzdy, nzv = 1;
        const il = 1 / Math.hypot(nxv, nyv, nzv); nxv *= il; nyv *= il; nzv *= il;
        const o = (y * S + x) * 4;
        nd.data[o] = (nxv * 0.5 + 0.5) * 255;
        nd.data[o + 1] = (nyv * 0.5 + 0.5) * 255;
        nd.data[o + 2] = (nzv * 0.5 + 0.5) * 255;
        nd.data[o + 3] = 255;
      }
    }
    nx.putImageData(nd, 0, 0);
  }

  // ---- circular alpha mask (feathered edge) ----
  const mCan = mk(), mx = mCan.getContext('2d');
  const mg = mx.createRadialGradient(C, C, cityR * 0.9, C, C, cityR);
  mg.addColorStop(0, '#fff'); mg.addColorStop(1, '#000');
  mx.fillStyle = '#000'; mx.fillRect(0, 0, S, S);
  mx.fillStyle = mg; mx.beginPath(); mx.arc(C, C, cityR, 0, TAU); mx.fill();

  const tex = (can, srgb) => {
    const t = new THREE.CanvasTexture(can);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const heightT = tex(hCan, false), emitT = tex(eCan, true), albT = tex(aCan, true),
    normT = tex(nCan, false), alphaT = tex(mCan, false);

  // ---- the city surface: a displaced textured disc ----
  const seg = 320;
  const geo = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg);
  const mat = new THREE.MeshStandardMaterial({
    map: albT, emissiveMap: emitT, emissive: 0xffffff, emissiveIntensity: 2.3,
    displacementMap: heightT, displacementScale: R * 0.07,
    normalMap: normT, normalScale: new THREE.Vector2(1.6, 1.6),
    alphaMap: alphaT, transparent: true, alphaTest: 0.35,
    metalness: 0.15, roughness: 0.88,
  });
  const city = new THREE.Mesh(geo, mat);
  city.rotation.x = -Math.PI / 2;                // lie flat in XZ, displace +Y
  grp.add(city);

  // dark disc hull under the city (gives the slab a body + underside)
  const hull = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.99, R * 0.9, R * 0.18, 96),
    new THREE.MeshStandardMaterial({ color: 0x0a0d12, metalness: 0.4, roughness: 0.8 }));
  hull.position.y = -R * 0.09;
  grp.add(hull);
  // frilly underside spikes
  for (let i = 0; i < 60; i++) {
    const th = rnd() * TAU, rr = R * (0.2 + rnd() * 0.7);
    const len = R * (0.1 + rnd() * 0.45) * (1 - rr / R * 0.5);
    const sp = new THREE.Mesh(new THREE.ConeGeometry(R * (0.02 + rnd() * 0.03), len, 5),
      new THREE.MeshStandardMaterial({ color: 0x07090d, metalness: 0.4, roughness: 0.85 }));
    sp.position.set(Math.cos(th) * rr, -R * 0.18 - len / 2, Math.sin(th) * rr);
    sp.rotation.x = Math.PI;
    grp.add(sp);
  }

  // ---- giant orbital-tether towers rising from the downtown core ----
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, metalness: 0.6, roughness: 0.45 });
  const towerGlow = new THREE.MeshStandardMaterial({ color: 0x0a0c10, emissive: 0x9fd0ff, emissiveIntensity: 1.6 });
  const nTowers = 5;
  for (let i = 0; i < nTowers; i++) {
    const th = (i / nTowers) * TAU + rnd() * 0.5, rr = i === 0 ? 0 : R * (0.07 + rnd() * 0.18);
    const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
    const Ht = R * (i === 0 ? 3.6 : 2.4 + rnd() * 1.4), botR = R * (0.05 + rnd() * 0.03), topR = botR * 0.4;
    const baseY = R * 0.16;
    // stepped base building
    for (let k = 0; k < 3; k++) {
      const br = botR * (3.2 - k), bh = R * (0.12 - k * 0.02);
      const b = new THREE.Mesh(new THREE.CylinderGeometry(br * 0.85, br, bh, 8), towerMat);
      b.position.set(x, baseY + k * bh * 0.9, z); grp.add(b);
    }
    // the shaft
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(topR, botR, Ht, 10), towerMat);
    shaft.position.set(x, baseY + Ht / 2, z); grp.add(shaft);
    // emissive accent lines up the shaft
    const gl = new THREE.Mesh(new THREE.CylinderGeometry(topR * 1.05, botR * 1.05, Ht, 10, 1, true), towerGlow);
    gl.position.copy(shaft.position); gl.scale.set(1, 1, 1);
    const glm = towerGlow.clone(); glm.emissiveIntensity = 0.8; gl.material = glm;
    grp.add(gl);
  }

  // ---- warm haze glow over the city ----
  const hazeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    uniforms: { uColor: { value: new THREE.Color(0x5a4a34) } },
    vertexShader: `varying vec3 vN; varying vec3 vP;
      void main(){ vN = normalize(normalMatrix*normal); vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vN; varying vec3 vP; uniform vec3 uColor;
      void main(){ float rim = pow(1.0-abs(vN.z),1.8);
        float low = smoothstep(0.5,-0.2, vP.y/${(R).toFixed(2)});
        gl_FragColor = vec4(uColor*rim*(0.3+low*0.6), rim*0.5); }`,
  });
  const haze = new THREE.Mesh(new THREE.SphereGeometry(R * 1.25, 32, 20), hazeMat);
  haze.scale.set(1, 0.5, 1); haze.position.y = R * 0.15;
  grp.add(haze);

  // nav blinkers for fleet.place()
  grp.userData.blinkers = [];
  const BL = [[R * 0.95, R * 0.1, 0, 0xff5544], [-R * 0.95, R * 0.1, 0, 0x44ff77], [0, R * 3.4, 0, 0xffffff]];
  for (const [x, y, z, c] of BL) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6),
      new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.5 }));
    b.position.set(x, y, z); grp.add(b); grp.userData.blinkers.push(b);
  }
  return grp;
}
