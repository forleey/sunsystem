// Units: km, s, kg. Angles in source tables: degrees (J2000 mean ecliptic elements).
export const G0 = 6.6743e-20;            // km^3 / (kg s^2)
export const C_KMS = 299792.458;         // km/s
export const G_ACC = 9.80665e-3;         // 1 g in km/s^2
export const AU = 1.495978707e8;         // km
export const LY = 9.4607304725808e12;    // km
export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

// a[km] e i[deg] O=lon.asc.node W=lon.perihelion L=mean lon (deg, J2000)
export const PLANETS = [
  { name:'Mercury', m:3.3011e23, r:2439.7,  a:57.909e6,   e:0.20563, i:7.005,  O:48.331,  W:77.456,  L:252.251, day:5067000,  tilt:0.03,  type:'rock',  c1:0x8a8a8a, c2:0x5c5350, c3:0xb9b0a8 },
  { name:'Venus',   m:4.8675e24, r:6051.8,  a:108.209e6,  e:0.00677, i:3.395,  O:76.680,  W:131.533, L:181.979, day:-20997000, tilt:177.4, type:'venus', c1:0xe8d3a4, c2:0xc9a368, c3:0xf5ecd7 },
  { name:'Earth',   m:5.9724e24, r:6371.0,  a:149.596e6,  e:0.01671, i:0.0,    O:0.0,     W:102.937, L:100.464, day:86164,    tilt:23.44, type:'earth', c1:0x01020f, c2:0x688d6c, c3:0x869aa6 },
  { name:'Mars',    m:6.4171e23, r:3389.5,  a:227.923e6,  e:0.09339, i:1.850,  O:49.558,  W:336.041, L:355.447, day:88643,    tilt:25.19, type:'rock',  c1:0xb5532a, c2:0x6e2f1c, c3:0xe0a878 },
  { name:'Jupiter', m:1.8982e27, r:69911,   a:778.570e6,  e:0.04839, i:1.303,  O:100.474, W:14.728,  L:34.396,  day:35730,    tilt:3.13,  type:'gas',   c1:0xc8a06a, c2:0x8a5a3a, c3:0xe8d8c0 },
  { name:'Saturn',  m:5.6834e26, r:58232,   a:1433.529e6, e:0.05386, i:2.485,  O:113.665, W:92.599,  L:49.954,  day:38362,    tilt:26.73, type:'gas',   c1:0xd8c08a, c2:0xa88a58, c3:0xf0e6c8, rings:[74500,140200] },
  { name:'Uranus',  m:8.6810e25, r:25362,   a:2872.463e6, e:0.04726, i:0.773,  O:74.006,  W:170.954, L:313.238, day:-62064,   tilt:97.77, type:'ice',   c1:0x9fd6d2, c2:0x6fb2b8, c3:0xd0efec },
  { name:'Neptune', m:1.0241e26, r:24622,   a:4495.060e6, e:0.01134, i:1.770,  O:131.784, W:44.965,  L:304.880, day:57996,    tilt:28.32, type:'ice',   c1:0x3457c4, c2:0x24348a, c3:0x7da3e8 },
  { name:'Pluto',   m:1.3030e22, r:1188.3,  a:5906.380e6, e:0.24880, i:17.16,  O:110.299, W:224.069, L:238.929, day:-551855,  tilt:122.5, type:'rock',  c1:0xc7b39a, c2:0x77614e, c3:0xe8ddd0 },
];

export const SUN  = { name:'Sun',  m:1.98892e30, r:696340 };
export const MOON = { name:'Moon', m:7.342e22, r:1737.4, a:384400, e:0.0549, i:5.145, O:125.08, W:318.15, L:13.18, day:2360591, tilt:6.68, type:'moon', c1:0x9a9a9a, c2:0x5a5a5a, c3:0xcfcfcf };

// M31 Andromeda: real direction (ecliptic lon ~27.8°, lat ~33.3°), 2.537 Mly away, ~220 kly across.
export const ANDROMEDA = {
  name: 'Andromeda',
  dist: 2.537e6 * LY,
  radius: 110e3 * LY,
  eclLon: 27.85 * Math.PI / 180,
  eclLat: 33.35 * Math.PI / 180,
};

export const SHIP = {
  name: 'Starship',
  lengthKm: 0.30,          // ~300 m, constitution-class-ish
  jumpAccelG: 100000,      // Andromeda jump
  startOrbitR: 20000,      // km from Earth's center
};

export function fmtKm(km) {
  const a = Math.abs(km);
  if (a >= 0.1 * LY) return (km / LY).toFixed(2) + ' ly';
  if (a >= 0.05 * AU) return (km / AU).toFixed(2) + ' AU';
  if (a >= 1e6) return (km / 1e6).toFixed(2) + ' M km';
  return Math.round(km).toLocaleString('en-US') + ' km';
}

export function fmtSpeed(kms) {
  if (kms >= 0.01 * C_KMS) {
    const c = kms / C_KMS;
    return (c >= 1000 ? Math.round(c).toLocaleString('en-US') : c.toFixed(2)) + ' c';
  }
  return kms >= 100 ? Math.round(kms).toLocaleString('en-US') + ' km/s' : kms.toFixed(2) + ' km/s';
}

export function fmtWarp(w) {
  if (w >= 1e6) return (w / 1e6).toPrecision(3) + 'M×';
  if (w >= 1e3) return (w / 1e3).toPrecision(3) + 'k×';
  return (w >= 100 ? Math.round(w) : w.toPrecision(3)) + '×';
}

export function fmtDate(simSec) {
  const ms = J2000_MS + simSec * 1000;
  if (Math.abs(ms) < 8.6e15) {
    const d = new Date(ms);
    return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
  return 'year ' + Math.round(2000 + simSec / 3.15576e7).toLocaleString('en-US');
}
