// Meshes for sun, planets, trails, Andromeda. Positions set each frame relative to focus.
import * as THREE from 'three';
import { toRender } from './scene.js?v=84';
import { ANDROMEDA } from './data.js?v=84';
import {
  SUN_V, SUN_F, CORONA_V, CORONA_F, GLARE_F, PLANET_V, PLANET_F, PLANET_DEFS_PRE,
  ATMO_V, ATMO_F, RING_V, RING_F, GALAXY_V, GALAXY_F, logDepth,
} from './shaders.js?v=84';

const TYPE_DEF = { rock: 'TYPE_ROCK', gas: 'TYPE_GAS', ice: 'TYPE_ICE', earth: 'TYPE_EARTH', venus: 'TYPE_VENUS', moon: 'TYPE_MOON' };

const texLoader = new THREE.TextureLoader();
function loadTex(file) {
  const t = texLoader.load('./textures/' + file);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

// progressive upgrade: boot with the bundled 2K map, swap in the 8K version
// from R2 once it arrives (R2 CORS is open; TextureLoader defaults to anonymous)
const TEX_BASE = 'https://pub-71534651969246d597a0c1bf543eff8c.r2.dev/textures/';
function upgradeTex(uniform, file) {
  texLoader.load(TEX_BASE + file, t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
    const old = uniform.value;
    uniform.value = t;
    if (old) setTimeout(() => old.dispose(), 2000);
  }, undefined, () => {});   // keep 2K on failure
}
const ATMO = {
  Earth: [0x07080a, 1.025], Venus: [0xe8c79a, 1.03], Mars: [0xd88a5a, 1.02],
  Jupiter: [0xd8b890, 1.012], Saturn: [0xe8d8a8, 1.012], Uranus: [0xa8e0dc, 1.015], Neptune: [0x5a78d8, 1.015], Titan: null,
};

export class SystemView {
  constructor(scene, sim) {
    this.scene = scene;
    this.sim = sim;
    this.entries = [];
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.camPosU = [];

    const sun = sim.bodies[0];
    const sunGrp = new THREE.Group();
    this.sunMat = new THREE.ShaderMaterial({
      ...logDepth(SUN_V, SUN_F), uniforms: { uTime: { value: 0 } },
    });
    const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(sun.r, 128, 80), this.sunMat);
    sunGrp.add(sunMesh);
    this.coronaMat = new THREE.ShaderMaterial({
      ...logDepth(CORONA_V, CORONA_F), uniforms: { uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const corona = new THREE.Mesh(new THREE.PlaneGeometry(sun.r * 5.6, sun.r * 5.6), this.coronaMat);
    corona.onBeforeRender = (r, s, cam) => corona.quaternion.copy(cam.quaternion);
    sunGrp.add(corona);
    // self-luminous point source: a glare quad locked to ~5° apparent size so
    // the sun dazzles from any distance (corona takes over when close);
    // depth-tested, so planets can eclipse it
    const glareMat = new THREE.ShaderMaterial({
      ...logDepth(CORONA_V, GLARE_F),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const glare = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glareMat);
    const glareTmp = new THREE.Vector3();
    glare.onBeforeRender = (r, s, cam) => {
      glare.quaternion.copy(cam.quaternion);
      const d = glare.getWorldPosition(glareTmp).distanceTo(cam.position);
      const px = Math.max(d * 0.09, sun.r * 2.4) / (sunGrp.scale.x || 1);
      glare.scale.set(px, px, 1);
    };
    sunGrp.add(glare);
    scene.add(sunGrp);
    // hot sun: the point light only drives standard materials (ships &
    // stations — planets shade themselves), so this cranks THEIR lit sides
    this.light = new THREE.PointLight(0xfff2dd, 0.95, 0, 0);
    sunGrp.add(this.light);
    // shadow floor ~zero: unlit sides read as pure silhouette
    scene.add(new THREE.AmbientLight(0x32404f, 0.016));
    this.entries.push({ body: sun, grp: sunGrp, mesh: sunMesh, isSun: true, spin: 2.13e6 });

    for (const b of sim.bodies.slice(1)) this.addPlanet(b);
    this.makeTrails();
    this.makeAndromeda();
  }

  addPlanet(b) {
    const d = b.def;
    const grp = new THREE.Group();
    const uniforms = {
      uC1: { value: new THREE.Color(d.c1) }, uC2: { value: new THREE.Color(d.c2) },
      uC3: { value: new THREE.Color(d.c3) }, uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uCamPos: { value: new THREE.Vector3() }, uTime: { value: 0 }, uSeed: { value: Math.abs(d.a % 1000) / 1000 + 0.1 },
    };
    this.camPosU.push(uniforms.uCamPos);
    if (b.name === 'Earth') {
      uniforms.uDayMap = { value: loadTex('2k_earth_daymap.jpg') };
      uniforms.uNightMap = { value: loadTex('2k_earth_nightmap.jpg') };
      uniforms.uCloudMap = { value: loadTex('2k_earth_clouds.jpg') };
      upgradeTex(uniforms.uDayMap, '8k_earth_daymap.jpg');
      upgradeTex(uniforms.uCloudMap, '8k_earth_clouds.jpg');
    } else if (b.name === 'Moon') {
      uniforms.uDayMap = { value: loadTex('2k_moon.jpg') };
    }
    const mat = new THREE.ShaderMaterial({
      ...logDepth(PLANET_V, PLANET_DEFS_PRE + PLANET_F),
      uniforms, defines: { [TYPE_DEF[d.type]]: 1 },
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(b.r, 160, 96), mat);
    const tiltGrp = new THREE.Group();
    tiltGrp.rotation.z = -(d.tilt || 0) * Math.PI / 180;
    tiltGrp.add(mesh);
    grp.add(tiltGrp);

    const a = ATMO[b.name];
    if (a) {
      const am = new THREE.ShaderMaterial({
        ...logDepth(ATMO_V, ATMO_F),
        uniforms: {
          uColor: { value: new THREE.Color(a[0]) }, uSunDir: { value: uniforms.uSunDir.value },
          uCamPos: { value: new THREE.Vector3() },
        },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
      });
      this.camPosU.push(am.uniforms.uCamPos);
      tiltGrp.add(new THREE.Mesh(new THREE.SphereGeometry(b.r * a[1], 128, 80), am));
    }
    if (d.rings) {
      const [ri, ro] = d.rings;
      const rm = new THREE.ShaderMaterial({
        ...logDepth(RING_V, RING_F),
        uniforms: { uSunDir: { value: uniforms.uSunDir.value }, uInner: { value: ri }, uOuter: { value: ro } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const rg = new THREE.RingGeometry(ri, ro, 128, 1);
      // RingGeometry uv.x runs angularly by default in some versions; remap radially
      const pos = rg.attributes.position, uv = rg.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getY(i));
        uv.setXY(i, (r - ri) / (ro - ri), 0.5);
      }
      const ring = new THREE.Mesh(rg, rm);
      ring.rotation.x = -Math.PI / 2;
      tiltGrp.add(ring);
    }
    this.scene.add(grp);
    this.entries.push({ body: b, grp, mesh, mat, spin: d.day || 86400 });
  }

  makeTrails() {
    this.trails = [];
    for (const b of this.sim.bodies.slice(1)) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(541 * 3), 3));
      const mat = new THREE.LineBasicMaterial({
        color: b.name === 'Moon' ? 0x557788 : 0x3a6f96, transparent: true, opacity: 0.55,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.scene.add(line);
      this.trails.push({ body: b, line, geo });
    }
  }

  makeAndromeda() {
    const A = ANDROMEDA;
    const grp = new THREE.Group();
    const dir = new THREE.Vector3(
      Math.cos(A.eclLat) * Math.cos(A.eclLon),
      Math.sin(A.eclLat),
      -Math.cos(A.eclLat) * Math.sin(A.eclLon),
    );
    this.andromedaPos = dir.clone().multiplyScalar(A.dist);   // render-frame ecliptic-mapped, heliocentric
    const mat = new THREE.ShaderMaterial({
      ...logDepth(GALAXY_V, GALAXY_F),
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const disk = new THREE.Mesh(new THREE.PlaneGeometry(A.radius * 2, A.radius * 2), mat);
    grp.add(disk);

    // sprinkle of in-disk stars for 3D parallax on arrival
    const N = 3500, arr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = A.radius * Math.sqrt(Math.random()) * (0.25 + 0.75 * Math.random());
      const th = Math.random() * Math.PI * 2;
      arr[i * 3] = Math.cos(th) * r;
      arr[i * 3 + 1] = Math.sin(th) * r;
      arr[i * 3 + 2] = (Math.random() - 0.5) * A.radius * 0.07 * (1.2 - r / A.radius);
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const cnv = document.createElement('canvas');
    cnv.width = cnv.height = 64;
    const ctx = cnv.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(205,225,255,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({
      color: 0xcfe0ff, size: A.radius * 0.007, transparent: true, opacity: 0.55,
      map: new THREE.CanvasTexture(cnv), alphaTest: 0.01,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    }));
    grp.add(pts);
    grp.rotation.set(-0.95, 0.45, 0.3);    // M31-ish strong inclination
    grp.renderOrder = -5;
    this.scene.add(grp);
    this.andromedaGrp = grp;
  }

  // focusPos: physics V3 of the focused object; everything renders relative to it.
  update(focusPos, camera, sizeMult, trailsOn, dtWall) {
    const sim = this.sim, t = sim.time;
    this.sunMat.uniforms.uTime.value = t % 1e5;
    this.coronaMat.uniforms.uTime.value = t % 1e5;
    const sun = sim.bodies[0];

    for (const u of this.camPosU) u.value.copy(camera.position);

    for (const e of this.entries) {
      const b = e.body;
      this.tmp2.set(b.pos.x - focusPos.x, b.pos.y - focusPos.y, b.pos.z - focusPos.z);
      toRender(this.tmp2, e.grp.position);
      const s = e.isSun ? Math.min(sizeMult, 60) : sizeMult;
      e.grp.scale.setScalar(s);
      e.mesh.rotation.y = (t / Math.abs(e.spin)) * Math.PI * 2 * Math.sign(e.spin);
      if (e.mat) {
        this.tmp2.set(sun.pos.x - b.pos.x, sun.pos.y - b.pos.y, sun.pos.z - b.pos.z);
        toRender(this.tmp2, e.mat.uniforms.uSunDir.value).normalize();
        e.mat.uniforms.uTime.value = t % 1e6;
      }
    }

    const earth = sim.body('Earth');
    for (const tr of this.trails) {
      tr.line.visible = trailsOn;
      if (!trailsOn) continue;
      const b = tr.body, parent = b.name === 'Moon' ? earth : sun;
      const arr = tr.geo.attributes.position.array;
      const pts = b.trail;
      let n = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        this.tmp2.set(p.x + parent.pos.x - focusPos.x, p.y + parent.pos.y - focusPos.y, p.z + parent.pos.z - focusPos.z);
        toRender(this.tmp2, this.tmp);
        arr[n++] = this.tmp.x; arr[n++] = this.tmp.y; arr[n++] = this.tmp.z;
      }
      this.tmp2.set(b.pos.x - focusPos.x, b.pos.y - focusPos.y, b.pos.z - focusPos.z);
      toRender(this.tmp2, this.tmp);
      arr[n++] = this.tmp.x; arr[n++] = this.tmp.y; arr[n++] = this.tmp.z;
      tr.geo.setDrawRange(0, pts.length + 1);
      tr.geo.attributes.position.needsUpdate = true;
    }

    // Andromeda is fixed in space (heliocentric); shift by focus only.
    this.tmp2.set(sun.pos.x - focusPos.x, sun.pos.y - focusPos.y, sun.pos.z - focusPos.z);
    toRender(this.tmp2, this.tmp);
    this.andromedaGrp.position.copy(this.tmp).add(this.andromedaPos);
  }
}
