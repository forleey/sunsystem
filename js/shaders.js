// GLSL chunks. All meshes are positioned camera-relative (floating origin), so
// world-space here means "render space": km, focus object at origin.
export const NOISE = /* glsl */`
vec3 hash3(vec3 p){ p=vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));
  return fract(sin(p)*43758.5453123); }
float hash1(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453123); }
float vnoise(vec3 p){
  vec3 i=floor(p), f=fract(p); vec3 u=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash1(i+vec3(0,0,0)),hash1(i+vec3(1,0,0)),u.x),
                 mix(hash1(i+vec3(0,1,0)),hash1(i+vec3(1,1,0)),u.x),u.y),
             mix(mix(hash1(i+vec3(0,0,1)),hash1(i+vec3(1,0,1)),u.x),
                 mix(hash1(i+vec3(0,1,1)),hash1(i+vec3(1,1,1)),u.x),u.y),u.z);
}
float fbm(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p=p*2.07+vec3(13.7); a*=0.5; } return v; }
float ridged(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*(1.0-abs(2.0*vnoise(p)-1.0)); p=p*2.13+vec3(7.3); a*=0.5; } return v; }
`;

export const SKY_V = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position * 1.0e-15;   // keep |vDir|^2 inside float32 range for normalize()
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_Position = projectionMatrix * mv; }
`;
export const SKY_F = NOISE + /* glsl */`
varying vec3 vDir;
uniform vec3 uGNorth, uGCenter;
float starLayer(vec3 d, float scale, float thr, float glow){
  vec3 p = d*scale; vec3 i=floor(p), f=fract(p);
  vec3 h = hash3(i);
  float lum = (h.z-thr)/(1.0-thr);
  if(lum<=0.0) return 0.0;
  vec3 sp = 0.2 + 0.6*h;
  float dist = length(f-sp);
  return pow(lum,3.0) * exp(-dist*dist*glow);
}
void main(){
  vec3 d = normalize(vDir);
  float s1 = starLayer(d,42.0,0.80,520.0)*1.5;
  float s2 = starLayer(d,95.0,0.72,700.0)*1.1;
  float s3 = starLayer(d,210.0,0.75,900.0)*0.8;
  vec3 tint = mix(vec3(1.0,0.82,0.65), vec3(0.72,0.82,1.0), hash1(floor(d*137.0)));
  vec3 stars = (s1+s2+s3) * tint;
  float lat = dot(d, uGNorth);
  float band = exp(-lat*lat*42.0);
  float wisp = fbm(d*6.0)*0.6 + fbm(d*16.0)*0.4;
  wisp = pow(max(wisp,0.0), 2.2) * 2.0;
  float core = pow(max(dot(d,uGCenter),0.0), 5.0)*2.0 + 0.45;
  float dust = smoothstep(0.38,0.72,fbm(d*9.0+vec3(31.4))) * band;
  vec3 mwc = mix(vec3(0.55,0.64,0.92), vec3(1.0,0.86,0.66), min(core*0.4,1.0));
  vec3 mw = band*(0.10+wisp)*core*(1.0-0.88*dust) * mwc * 0.30;
  gl_FragColor = vec4(stars + mw + vec3(0.002,0.003,0.006), 1.0);
}
`;

export const SUN_V = /* glsl */`
varying vec3 vN; varying vec3 vP; varying vec3 vV;
void main(){ vN = normalize(normalMatrix * normal); vP = position;
  vec4 mv = modelViewMatrix*vec4(position,1.0); vV = -mv.xyz;
  gl_Position = projectionMatrix*mv; }
`;
export const SUN_F = NOISE + /* glsl */`
varying vec3 vN; varying vec3 vP; varying vec3 vV;
uniform float uTime;
void main(){
  vec3 p = normalize(vP);
  float t = uTime*0.013;
  float g = ridged(p*4.0 + vec3(t, -t*0.7, t*0.4));
  float cells = fbm(p*16.0 - vec3(t*2.0));
  float m = g*0.85 + cells*0.65;
  vec3 c = mix(vec3(0.95,0.28,0.02), vec3(1.0,0.58,0.10), smoothstep(0.25,0.75,m));
  c = mix(c, vec3(1.0,0.93,0.70), smoothstep(0.72,1.15,m));
  float limb = pow(max(dot(normalize(vN), normalize(vV)),0.0), 0.75);
  gl_FragColor = vec4(c * (0.30+0.85*limb) * 1.05, 1.0);
}
`;

export const CORONA_V = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv*2.0-1.0; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;
export const CORONA_F = NOISE + /* glsl */`
varying vec2 vUv;
uniform float uTime;
void main(){
  float r = length(vUv);
  float ang = atan(vUv.y, vUv.x);
  float fl = fbm(vec3(cos(ang), sin(ang), uTime*0.05)*3.0);
  float ray = 0.75 + 0.5*fl;
  float a = pow(max(0.0, 1.0-r), 3.2) * ray;
  a += pow(max(0.0,1.0-r),10.0)*1.2;
  vec3 c = mix(vec3(1.0,0.55,0.18), vec3(1.0,0.85,0.55), a);
  gl_FragColor = vec4(c*a*0.62, a*0.7);
}
`;

export const PLANET_V = /* glsl */`
varying vec3 vN; varying vec3 vP; varying vec3 vWp; varying vec2 vUv;
void main(){
  vN = normalize(mat3(modelMatrix) * normal);
  vP = position;
  vUv = uv;
  vWp = (modelMatrix*vec4(position,1.0)).xyz;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
}
`;
export const PLANET_F = NOISE + /* glsl */`
varying vec3 vN; varying vec3 vP; varying vec3 vWp; varying vec2 vUv;
uniform vec3 uC1,uC2,uC3,uSunDir,uCamPos;
uniform float uTime,uSeed;
#ifdef TYPE_EARTH
uniform sampler2D uDayMap, uNightMap, uCloudMap;
#endif
#ifdef TYPE_MOON
uniform sampler2D uDayMap;
#endif
void main(){
  vec3 p = normalize(vP) + vec3(uSeed*17.0);
  vec3 n = normalize(vN);
  vec3 sd = normalize(uSunDir);
  vec3 vd = normalize(uCamPos - vWp);
  float ndl = dot(n, sd);
  float day = clamp(ndl*1.15+0.06, 0.0, 1.0);
  vec3 col; float spec = 0.0; vec3 emis = vec3(0.0);

#ifdef TYPE_GAS
  float sw = fbm(p*3.0)*0.9;
  float bands = fbm(vec3(p.x*0.6, p.y*7.0 + sw*1.6 + uTime*0.001, p.z*0.6));
  float storm = smoothstep(0.62,0.85, fbm(p*5.0+vec3(8.2)));
  col = mix(uC2c(), uC1c(), smoothstep(0.25,0.75,bands));
  col = mix(col, uC3c(), smoothstep(0.55,0.95,bands)*0.6);
  col = mix(col, uC3c()*1.12, storm*0.5);
#endif
#ifdef TYPE_ICE
  float m = fbm(p*2.4 + vec3(0.0, uTime*0.0008, 0.0));
  col = mix(uC2c(), uC1c(), smoothstep(0.3,0.8,m));
  col = mix(col, uC3c(), pow(fbm(p*5.0),3.0)*0.8);
#endif
#ifdef TYPE_ROCK
  float m = fbm(p*3.2);
  float cr = ridged(p*7.0)*0.5;
  col = mix(uC2c(), uC1c(), smoothstep(0.2,0.8,m));
  col = mix(col, uC3c(), smoothstep(0.55,0.95,cr));
#endif
#ifdef TYPE_MOON
  col = texture2D(uDayMap, vUv).rgb * 1.05;
#endif
#ifdef TYPE_VENUS
  float m = fbm(p*2.6 + vec3(uTime*0.004,0.0,0.0));
  float sw2 = fbm(vec3(p.x*1.4, p.y*4.0+m*2.0, p.z*1.4) - vec3(uTime*0.006));
  col = mix(uC2c(), uC1c(), smoothstep(0.2,0.8,sw2));
  col = mix(col, uC3c(), smoothstep(0.6,1.0,m)*0.7);
#endif
#ifdef TYPE_EARTH
  vec3 albedo = texture2D(uDayMap, vUv).rgb;
  float cl = texture2D(uCloudMap, vec2(vUv.x + uTime*8.0e-7, vUv.y)).r;
  col = mix(albedo, vec3(1.0), cl*0.9);
  float ocean = smoothstep(0.03, 0.12, albedo.b - albedo.r);   // water reads blue in the day map
  spec = ocean * (1.0 - cl);
  float night = 1.0 - smoothstep(-0.2, 0.05, ndl);
  vec3 lights = texture2D(uNightMap, vUv).rgb;
  emis = lights * night * (1.0 - cl*0.8) * 1.2;
#endif

  vec3 h = normalize(sd+vd);
  float sp = pow(max(dot(n,h),0.0), 300.0) * spec * 0.3;   // tight sun glint, no plastic sheen
  vec3 outc = col*day + vec3(1.0,0.95,0.85)*sp*day + emis;
  outc += col*0.012;                       // faint ambient so night side isn't void
  gl_FragColor = vec4(outc, 1.0);
}
`;

// helper: colors come in as uniforms; tiny macros keep code above terse
export const PLANET_DEFS_PRE = /* glsl */`
#define uC1c() (uC1)
#define uC2c() (uC2)
#define uC3c() (uC3)
`;

export const ATMO_V = /* glsl */`
varying vec3 vN; varying vec3 vWp;
void main(){ vN = normalize(mat3(modelMatrix)*normal);
  vWp = (modelMatrix*vec4(position,1.0)).xyz;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;
export const ATMO_F = /* glsl */`
varying vec3 vN; varying vec3 vWp;
uniform vec3 uColor,uSunDir,uCamPos;
void main(){
  vec3 n = normalize(vN);
  vec3 vd = normalize(uCamPos - vWp);
  float fres = pow(1.0 - abs(dot(n,vd)), 3.2);
  float lit = clamp(dot(n, normalize(uSunDir))*1.4+0.35, 0.0, 1.0);
  gl_FragColor = vec4(uColor * fres * lit * 1.6, fres*lit);
}
`;

export const RING_V = /* glsl */`
varying vec2 vUv; varying vec3 vWp;
void main(){ vUv = uv; vWp=(modelMatrix*vec4(position,1.0)).xyz;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;
export const RING_F = NOISE + /* glsl */`
varying vec2 vUv; varying vec3 vWp;
uniform vec3 uSunDir; uniform float uInner,uOuter;
void main(){
  float r = mix(uInner,uOuter,vUv.x);
  float t = (r-uInner)/(uOuter-uInner);
  float bands = fbm(vec3(t*26.0, 0.0, 0.0))*0.6 + fbm(vec3(t*90.0,5.0,0.0))*0.4;
  float gap = smoothstep(0.02,0.08,abs(t-0.62));          // Cassini-ish division
  float a = smoothstep(0.0,0.06,t)*(1.0-smoothstep(0.86,1.0,t))*(0.25+0.75*bands)*gap;
  vec3 c = mix(vec3(0.55,0.47,0.36), vec3(0.83,0.76,0.62), bands);
  gl_FragColor = vec4(c*1.05, a*0.92);
}
`;

export const GALAXY_V = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv*2.0-1.0; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
`;
export const GALAXY_F = NOISE + /* glsl */`
varying vec2 vUv;
void main(){
  float r = length(vUv);
  if(r>1.0) discard;
  float th = atan(vUv.y, vUv.x);
  float phase = th - 3.6*log(r+0.05);
  // pow() base must stay > 0: fast-math cos can dip below -1 and a negative base is NaN per spec
  float arms = pow(max(0.5+0.5*cos(2.0*phase), 0.0) + 1.0e-5, 1.6);
  float grain = fbm(vec3(vUv*7.0, 1.7));
  float speck = pow(max(fbm(vec3(vUv*24.0, 4.2)), 0.0) + 1.0e-5, 2.0)*1.4;
  float diskA = 1.0 - smoothstep(0.12, 1.0, r);
  float bulge = exp(-r*7.0)*2.1 + exp(-r*2.6)*0.45;
  float dust = smoothstep(0.5,0.85,fbm(vec3(vUv*9.0+2.0, phase*0.4)))* smoothstep(0.08,0.3,r);
  float armsB = arms*diskA*(0.30+0.65*grain+speck*0.35)*smoothstep(0.05,0.35,r);
  vec3 c = vec3(1.0,0.83,0.62)*bulge + mix(vec3(0.62,0.72,1.0),vec3(0.9,0.92,1.0),grain)*armsB;
  c *= 1.0-0.70*dust*diskA;
  float a = clamp(bulge*0.9+armsB*0.9, 0.0, 1.0);
  gl_FragColor = vec4(c*1.15, a);
}
`;
