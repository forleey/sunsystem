// Renderer, post-processing, sky. Render space = km, focus object at origin,
// ecliptic (x,y,z) mapped to render (x, z, -y) so ecliptic north is +Y.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { SKY_V, SKY_F, logDepth } from './shaders.js?v=83';

export function toRender(v, out) { return out.set(v.x, v.z, -v.y); }

function eclDir(lonRad, latRad) {
  const cl = Math.cos(latRad);
  return new THREE.Vector3(
    cl * Math.cos(lonRad),
    Math.sin(latRad),                    // render Y = ecliptic Z
    -cl * Math.sin(lonRad)               // render Z = -ecliptic Y
  );
}

export function createStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.80;   // baked default (main.js LOOK_DEF re-applies on load)
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1e-3, 2e20);
  camera.position.set(0, 2e4, 6e4);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // radius 0.83 (not 0.45): a tighter radius lets the separable blur trace the
  // ship's boxy bright silhouette, so a saturated engine core blooms into a
  // hard rounded-square halo. The wider radius melts it back into a soft disc.
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.0, 0.83, 0.86);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);

  // film look: grain + vignette + subtle chromatic aberration + teal/orange
  // grading + dither, in one full-screen pass AFTER FXAA (so the grain stays crisp)
  const FilmLookShader = {
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uSat: { value: 1.07 },     // saturation
      uCon: { value: 0.955 },    // contrast
      uGrain: { value: 1.0 },    // grain strength multiplier
      uVig: { value: 1.0 },      // vignette strength multiplier
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse;
      uniform float uTime;
      uniform vec2 uRes;
      uniform float uSat, uCon, uGrain, uVig;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec2 c = vUv - 0.5;
        float r2 = dot(c, c);

        // lens: chromatic aberration growing toward the frame edge
        vec2 ca = c * (r2 * 0.010);
        vec3 col;
        col.r = texture2D(tDiffuse, vUv + ca).r;
        col.g = texture2D(tDiffuse, vUv).g;
        col.b = texture2D(tDiffuse, vUv - ca).b;

        // grade: teal shadows, warm highlights, adjustable saturation + contrast
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, col * vec3(0.93, 1.00, 1.07), (1.0 - smoothstep(0.0, 0.45, lum)) * 0.35);
        col = mix(col, col * vec3(1.06, 1.00, 0.93), smoothstep(0.55, 1.0, lum) * 0.28);
        col = mix(vec3(lum), col, uSat);
        col = clamp((col - 0.5) * uCon + 0.5, 0.0, 1.0);

        // vignette (corners ~ -22% at strength 1)
        float vigBase = mix(0.78, 1.0, 1.0 - smoothstep(0.32, 1.0, sqrt(r2) * 1.5));
        col *= clamp(1.0 - (1.0 - vigBase) * uVig, 0.0, 1.0);

        // animated film grain, stronger in the shadows
        float g = hash(vUv * uRes + vec2(fract(uTime * 13.7) * 91.0, fract(uTime * 7.3) * 57.0)) - 0.5;
        col += g * (0.045 * (1.0 - smoothstep(0.0, 0.6, lum)) + 0.012) * uGrain;

        // dither kills banding in the dark space gradients
        col += (hash(vUv * uRes * 1.71 + fract(uTime * 3.1)) - 0.5) * (2.0 / 255.0);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  };
  const film = new ShaderPass(FilmLookShader);
  composer.addPass(film);

  function setSize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h); composer.setSize(w, h);
    const pr = renderer.getPixelRatio();
    fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    film.material.uniforms.uRes.value.set(w * pr, h * pr);
  }
  setSize();
  window.addEventListener('resize', setSize);

  return { renderer, scene, camera, composer, bloom, film };
}

export function makeSky(scene) {
  const DEG = Math.PI / 180;
  const mat = new THREE.ShaderMaterial({
    ...logDepth(SKY_V, SKY_F),
    uniforms: {
      uGNorth: { value: eclDir(180.02 * DEG, 29.81 * DEG) },
      uGCenter: { value: eclDir(266.84 * DEG, -5.54 * DEG) },
    },
    side: THREE.BackSide, depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(6e19, 48, 32), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  return sky;
}
