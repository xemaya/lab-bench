import * as THREE from 'three';
import { GLSL_NOISE, GLSL_SKY_COMMON } from './noise.js';

export const SKY_TAG = '// CINE_SKY';

const SKY_FRAG = /* glsl */ `
${SKY_TAG}
precision highp float;
varying vec3 vDir;
uniform float uTime, uEnv, uCloudCover, uCloudGap, uCloudSun, uCloudWarm, uCloudSpeed, uSunDisk;
uniform vec3 uMid, uMidSun, uGround, uCloudLit, uCloudShade;
${GLSL_NOISE}
${GLSL_SKY_COMMON}

void main(){
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  float mu = dot(d, uSunDir);
  float s = max(mu, 0.0);
  float ts = skyToSun(d);

  // ---- clear sky ----
  vec3 hc = horizonColor(d);
  vec3 midC = mix(uMid, uMidSun, pow(ts, 3.0));                 // pale band above the horizon glow
  vec3 clearC = mix(hc, midC, smoothstep(0.0, 0.17, h));
  clearC = mix(clearC, uZen, smoothstep(0.10, 0.5, h));
  // aureole (mie glow round the sun)
  clearC += uSunCol * vec3(1.0, 0.86, 0.68) * (pow(s, 8.0) * 0.14 + pow(s, 64.0) * 0.55 + pow(s, 600.0) * 2.2 + pow(s, 6000.0) * 14.0);

  // ---- cloud deck ----
  vec2 cuv = d.xz / (h + 0.10) * vec2(0.62, 0.95);
  vec2 wind = vec2(-0.012, 0.004) * uTime * uCloudSpeed;
  vec2 q = cuv + wind;
  float warp = fbm3(q * 0.45 + 7.1);
  vec2 qq = q + (warp - 0.5) * 1.3;
  float dens = fbm5(qq);
  // rippled underside (ridged detail), fading with distance so the horizon does not alias
  float ridg = 1.0 - abs(2.0 * fbm3(qq * 3.1 + 5.0) - 1.0);
  dens = dens * 0.86 + (ridg - 0.6) * 0.16 * smoothstep(0.03, 0.25, h);
  float big = n2(q * 0.19 + 3.7);
  float body = dens * 0.74 + big * 0.36;
  float c0 = mix(0.70, 0.21, uCloudCover);
  float cov = smoothstep(c0, c0 + 0.19, body);
  // optional gap: the deck ends above the horizon toward the sun and leaves a clear, burning band
  float edge = mix(0.030, mix(0.030, 0.285, uCloudGap), pow(ts, 1.7));
  float rag = (n2(q * 0.9 + 11.0) - 0.5) * 0.16 + (dens - 0.5) * 0.10;
  float deck = smoothstep(edge - 0.035, edge + 0.11, h + rag * (0.35 + ts));
  cov *= deck;
  // the sun always burns through a ragged hole, never sits behind solid cloud
  float hole = smoothstep(0.972, 0.9985, mu + (dens - 0.5) * 0.012);
  cov *= 1.0 - 0.93 * hole;
  // thin scud drifting in the gap (veils the sun a little, catches fire)
  float scud = smoothstep(0.55, 0.85, fbm3(q * vec2(0.55, 1.9) + 31.0)) * (1.0 - deck) * smoothstep(0.02, 0.10, h) * 0.55 * (1.0 - 0.8 * hole) * uCloudGap;

  // lighting: density gradient toward the sun = self shadowing of the cloud relief
  vec2 sd = normalize(uSunDir.xz + vec2(1e-5));
  float densS = fbm5(qq + sd * 0.22);
  float relief = clamp((dens - densS) * 4.5 + 0.5, 0.0, 1.0);
  float thick = smoothstep(c0 + 0.09, c0 + 0.41, body);
  vec3 cool = mix(uCloudLit, uCloudShade, thick);
  cool *= 0.55 + 0.9 * relief * relief;
  cool += uCloudLit * 0.5 * pow(1.0 - thick, 3.0);                                     // thin spots let sky light through
  // direct sun on the tops / flanks (daylight looks)
  cool += uSunCol * uCloudSun * (0.25 + 0.75 * relief) * (1.0 - 0.6 * thick);
  // warm light raking the underside from a low sun: strongest near the sun and near the deck edge
  float nearSun = pow(ts, 5.0) * exp(-max(h - edge, 0.0) * 4.5) * 0.9 + pow(s, 7.0) * 0.9;
  vec3 warm = (uHor * vec3(1.30, 0.66, 0.40)) * nearSun * (0.05 + 2.2 * relief * relief * relief) * uCloudWarm;
  // burning rim where cloud thins
  float rim = cov * (1.0 - cov) * 4.0;
  warm += uSunCol * rim * pow(ts, 4.0) * (0.5 + 1.6 * pow(s, 6.0)) * (1.0 - 0.85 * hole) * min(uCloudWarm, 1.0);
  vec3 cloudC = cool + warm;
  // aerial perspective: far cloud melts into the horizon colour
  cloudC = mix(cloudC, hc * 0.55 + cloudC * 0.45, exp(-h * 11.0));

  vec3 col = mix(clearC, cloudC, cov * 0.985);
  vec3 scudC = mix(uCloudShade * 2.0, uHor * 1.5, pow(ts, 3.0)) + uSunCol * pow(s, 24.0) * 2.0;
  col = mix(col, scudC, scud);

  // sun disk (not in the environment capture: the directional light is the sun there)
  float veil = (1.0 - cov * 0.92) * (1.0 - scud * 0.7);
  float disk = smoothstep(0.999940, 0.999972, mu);
  col += uSunCol * vec3(1.0, 1.1, 1.24) * disk * uSunDisk * veil * (1.0 - uEnv);

  // below the horizon: haze / ground bounce (mostly hidden by geometry)
  if (d.y < 0.0) {
    float t = clamp(-d.y * 5.0, 0.0, 1.0);
    vec3 low = mix(uHorAway * 0.42, uGround, uEnv);
    low += uHor * 0.55 * pow(ts, 6.0) * exp(d.y * 7.0) * (1.0 - 0.7 * uEnv);
    col = mix(hc + uSunCol * pow(s, 48.0) * 1.5, low, smoothstep(0.0, 1.0, t));
  }
  // keep the PMREM free of fireflies
  col = mix(col, min(col, vec3(6.0)), uEnv);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`;

export function createSky(noiseTex) {
  const uniforms = {
    tNoise: { value: noiseTex },
    uTime: { value: 0 },
    uEnv: { value: 0 },
    uSunDir: { value: new THREE.Vector3(1, 0.2, 0.3).normalize() },
    uSunCol: { value: new THREE.Vector3(1, 0.8, 0.5) },
    uZen: { value: new THREE.Vector3() },
    uMid: { value: new THREE.Vector3() },
    uMidSun: { value: new THREE.Vector3() },
    uHor: { value: new THREE.Vector3() },
    uHorAway: { value: new THREE.Vector3() },
    uGlow: { value: new THREE.Vector3() },
    uGround: { value: new THREE.Vector3() },
    uCloudLit: { value: new THREE.Vector3() },
    uCloudShade: { value: new THREE.Vector3() },
    uCloudCover: { value: 0.5 },
    uCloudGap: { value: 0 },
    uCloudSun: { value: 0 },
    uCloudWarm: { value: 1 },
    uCloudSpeed: { value: 1 },
    uSunDisk: { value: 100 },
  };
  const material = new THREE.ShaderMaterial({
    name: 'cine-sky',
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
  });
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;

  function applyLook(look, sunDir) {
    const s = look.sky,
      u = uniforms;
    u.uSunDir.value.copy(sunDir);
    u.uSunCol.value.fromArray(look.sun.color);
    u.uZen.value.fromArray(s.zenith);
    u.uMid.value.fromArray(s.mid);
    u.uMidSun.value.fromArray(s.midSun);
    u.uHor.value.fromArray(s.horizon);
    u.uHorAway.value.fromArray(s.horizonAway);
    u.uGlow.value.fromArray(s.glow);
    u.uGround.value.fromArray(s.ground);
    u.uCloudLit.value.fromArray(s.cloudLit);
    u.uCloudShade.value.fromArray(s.cloudShade);
    u.uCloudCover.value = s.cloudCover;
    u.uCloudGap.value = s.cloudGap;
    u.uCloudSun.value = s.cloudSun;
    u.uCloudWarm.value = s.cloudWarm;
    u.uCloudSpeed.value = s.cloudSpeed;
    u.uSunDisk.value = s.sunDisk;
  }

  // Bake the same sky (without the sun disk) into a PMREM environment: image-based light always matches the sky.
  let pmrem = null,
    envRT = null;
  function captureEnvironment(renderer) {
    if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer);
    const m = material.clone();
    for (const k in uniforms) m.uniforms[k].value = uniforms[k].value;
    m.uniforms.uEnv = { value: 1 };
    const scene = new THREE.Scene();
    const box = new THREE.Mesh(geometry, m);
    box.frustumCulled = false;
    scene.add(box);
    const rt = pmrem.fromScene(scene, 0, 0.1, 100);
    m.dispose();
    if (envRT) envRT.dispose();
    envRT = rt;
    return rt.texture;
  }

  return { mesh, material, uniforms, applyLook, captureEnvironment };
}
