import * as THREE from 'three';

// Shared GLSL: value noise / fbm read from a 256x256 white-noise texture (one fetch per octave).
export const GLSL_NOISE = /* glsl */ `
uniform sampler2D tNoise;
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return texture2D(tNoise, (i + f + 0.5) / 256.0).r; }
float fbm5(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3; a *= 0.5; } return s / 0.96875; }
float fbm3(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++){ s += a * n2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 17.3; a *= 0.5; } return s / 0.875; }
`;

// Shared GLSL: the colour of the horizon in a given direction. Used by the sky itself and by the far haze of the
// volumetric pass, so distant geometry always dissolves into exactly the sky behind it.
export const GLSL_SKY_COMMON = /* glsl */ `
uniform vec3 uSunDir, uZen, uHor, uHorAway, uSunCol, uGlow;
float skyToSun(vec3 d){ return clamp(dot(normalize(d.xz + vec2(1e-5)), normalize(uSunDir.xz + vec2(1e-5))) * 0.5 + 0.5, 0.0, 1.0); }
vec3 horizonColor(vec3 d){
  float ts = skyToSun(d);
  vec3 c = mix(uHorAway, uHorAway * 1.25 + vec3(0.05, 0.03, 0.02), smoothstep(0.2, 0.75, ts));
  c = mix(c, uHor * vec3(1.9, 1.55, 1.2), pow(ts, 6.0));
  c = mix(c, uGlow, pow(ts, 34.0));
  return c;
}
`;

export function makeNoiseTexture() {
  const data = new Uint8Array(256 * 256 * 4);
  let s = 2654435769;
  const rnd = () => ((s ^= s << 13), (s >>>= 0), (s ^= s >>> 17), (s ^= s << 5), (s >>>= 0), s / 4294967296);
  for (let i = 0; i < 256 * 256; i++) {
    data[i * 4] = rnd() * 256;
    data[i * 4 + 1] = rnd() * 256;
    data[i * 4 + 2] = rnd() * 256;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 256, 256, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------------------------------------------
// CPU noise (deterministic) for building worlds and for baking the tiling detail textures below.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// value noise; `period` > 0 makes it tile every `period` lattice cells
export function vnoise(x, y, seed = 0, period = 0) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  let fx = x - ix,
    fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const w = (v) => (period > 0 ? ((v % period) + period) % period : v);
  const x0 = w(ix),
    x1 = w(ix + 1),
    y0 = w(iy),
    y1 = w(iy + 1);
  const a = hash2(x0, y0, seed),
    b = hash2(x1, y0, seed),
    c = hash2(x0, y1, seed),
    d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
export function fbm(x, y, octaves = 5, seed = 0, lac = 2.03, gain = 0.5) {
  let a = 0.5,
    s = 0,
    n = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * vnoise(x, y, seed + i * 17);
    n += a;
    x = x * lac + 31.7;
    y = y * lac + 11.3;
    a *= gain;
  }
  return s / n;
}
export function ridged(x, y, octaves = 5, seed = 0) {
  let a = 0.5,
    s = 0,
    n = 0;
  for (let i = 0; i < octaves; i++) {
    const v = 1 - Math.abs(2 * vnoise(x, y, seed + i * 13) - 1);
    s += a * v * v;
    n += a;
    x = x * 2.07 + 13.1;
    y = y * 2.07 + 7.7;
    a *= 0.5;
  }
  return s / n;
}

// Tiling detail textures shared by ground / water / rock shaders:
//   detail  : r fine grain, g broad blotches, b ridged "veins", a medium lumps
//   detailN : rg slope of the fine height field, ba slope of the broad height field (0.5 = flat)
export function makeDetailTextures(size = 256, anisotropy = 8) {
  const N = size;
  const hFine = new Float32Array(N * N),
    hBroad = new Float32Array(N * N);
  const d = new Uint8Array(N * N * 4),
    n = new Uint8Array(N * N * 4);
  const tfbm = (u, v, base, oct, seed) => {
    let a = 0.5,
      s = 0,
      t = 0,
      p = base;
    for (let i = 0; i < oct; i++) {
      s += a * vnoise(u * p, v * p, seed + i * 19, p);
      t += a;
      a *= 0.5;
      p *= 2;
    }
    return s / t;
  };
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = x / N,
        v = y / N,
        i = y * N + x;
      const fine = tfbm(u, v, 32, 3, 1),
        broad = tfbm(u, v, 4, 4, 7),
        lumps = tfbm(u, v, 12, 3, 23);
      const vein = 1 - Math.abs(2 * tfbm(u, v, 8, 4, 41) - 1);
      hFine[i] = fine * 0.6 + lumps * 0.4;
      hBroad[i] = broad;
      d[i * 4] = fine * 255;
      d[i * 4 + 1] = Math.min(255, Math.max(0, (broad - 0.5) * 1.9 + 0.5) * 255);
      d[i * 4 + 2] = Math.pow(vein, 3) * 255;
      d[i * 4 + 3] = Math.min(255, Math.max(0, (lumps - 0.5) * 1.8 + 0.5) * 255);
    }
  const at = (h, x, y) => h[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const fx = (at(hFine, x + 1, y) - at(hFine, x - 1, y)) * 6,
        fy = (at(hFine, x, y + 1) - at(hFine, x, y - 1)) * 6;
      const bx = (at(hBroad, x + 2, y) - at(hBroad, x - 2, y)) * 9,
        by = (at(hBroad, x, y + 2) - at(hBroad, x, y - 2)) * 9;
      const q = (v) => Math.min(255, Math.max(0, Math.round((v * 0.5 + 0.5) * 255)));
      n[i] = q(fx);
      n[i + 1] = q(fy);
      n[i + 2] = q(bx);
      n[i + 3] = q(by);
    }
  const mk = (data) => {
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { detail: mk(d), detailN: mk(n) };
}
