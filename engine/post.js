import * as THREE from 'three';
import { GLSL_NOISE, GLSL_SKY_COMMON } from './noise.js';

export const POST_TAG = '// CINE_POST';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const COMMON = /* glsl */ `
varying vec2 vUv;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

const EXPOSURE = /* glsl */ `
uniform sampler2D tAdapt; uniform float uExposure, uKey, uMinE, uMaxE, uAuto;
float slExposure(){ float a = texture2D(tAdapt, vec2(0.5)).r; return uExposure * mix(1.0, clamp(pow(uKey / max(a, 1e-4), 0.85), uMinE, uMaxE), uAuto); }
`;

// full-res hardware depth -> half-res linear view depth (metres)
const F_DEPTH_HALF = /* glsl */ `${COMMON}
uniform sampler2D tDepth; uniform float uNear, uFar;
void main(){
  // exact texel fetch: sampling at a texel corner would pick rows unpredictably and band the AO on grazing floors
  ivec2 p = min(ivec2(gl_FragCoord.xy) * 2, textureSize(tDepth, 0) - 1);
  float d = texelFetch(tDepth, p, 0).r;
  float z = (uNear * uFar) / (uFar - d * (uFar - uNear));
  gl_FragColor = vec4(z, 0.0, 0.0, 1.0);
}`;

// ambient occlusion from depth only (normals reconstructed from the nearer depth neighbours)
const F_AO = /* glsl */ `${COMMON}
uniform sampler2D tDepthHalf; uniform vec2 uTanHalf, uTexel; uniform float uRadius, uIntensity, uAspect;
vec3 vpos(vec2 uv, float z){ return vec3((uv * 2.0 - 1.0) * uTanHalf * z, -z); }
void main(){
  float z0 = texture2D(tDepthHalf, vUv).r;
  if (z0 > 140.0) { gl_FragColor = vec4(1.0); return; }
  vec3 P = vpos(vUv, z0);
  vec2 ox = vec2(uTexel.x, 0.0), oy = vec2(0.0, uTexel.y);
  float zl = texture2D(tDepthHalf, vUv - ox).r, zr = texture2D(tDepthHalf, vUv + ox).r;
  float zd = texture2D(tDepthHalf, vUv - oy).r, zu = texture2D(tDepthHalf, vUv + oy).r;
  vec3 dx = abs(zl - z0) < abs(zr - z0) ? P - vpos(vUv - ox, zl) : vpos(vUv + ox, zr) - P;
  vec3 dy = abs(zd - z0) < abs(zu - z0) ? P - vpos(vUv - oy, zd) : vpos(vUv + oy, zu) - P;
  vec3 n = normalize(cross(dx, dy));
  float R = uRadius * (0.6 + 0.4 * clamp(z0 / 12.0, 0.0, 1.0));
  float rUv = clamp(R / (2.0 * z0 * uTanHalf.y), 3.0 * uTexel.y, 0.14);
  float R2 = R * R;
  float rot = ign(gl_FragCoord.xy) * 6.2831853;
  float sum = 0.0;
  for (int i = 0; i < AO_TAPS; i++) {
    float a = (float(i) + 0.5) / float(AO_TAPS);
    float th = a * 6.2831853 * 3.0 + rot;
    vec2 o = vec2(cos(th), sin(th)) * a * rUv; o.x /= uAspect;
    vec2 uv2 = vUv + o;
    float z2 = texture2D(tDepthHalf, uv2).r;
    vec3 v = vpos(uv2, z2) - P;
    float vv = dot(v, v), vn = dot(v, n);
    float f = max(R2 - vv, 0.0);
    sum += f * f * f * max((vn - (0.015 + 0.004 * z0)) / (vv + 0.004), 0.0);
  }
  float ao = max(0.0, 1.0 - uIntensity * sum * 5.0 / (R2 * R2 * R2 * float(AO_TAPS)));
  ao = mix(ao, 1.0, smoothstep(70.0, 140.0, z0));
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}`;

// single-scattering volumetrics: march the view ray, test each step against the sun shadow map
const F_VOL = /* glsl */ `${COMMON}
uniform sampler2D tDepthHalf, tShadow;
uniform mat4 uShadowMatrix, uCamWorld;
uniform vec3 uCamPos, uSunRad, uAmb;
uniform vec2 uTanHalf, uMistWind;
uniform float uHasShadow, uMaxDist, uSigma, uFarZ, uFarHaze, uFloor, uFalloff, uBaseY, uNearBoost, uFarBoost;
uniform float uMist, uMistTop, uMistFalloff, uMistScale, uTime;
uniform vec2 uBoostRange;
${GLSL_NOISE}
${GLSL_SKY_COMMON}
float shape(float y){ return uFloor + (1.0 - uFloor) * exp(-max(y - uBaseY, 0.0) / uFalloff); }
float mistAt(vec3 p){
  float hgt = exp(-max(p.y - uBaseY - uMistTop, 0.0) / uMistFalloff);
  vec2 q = (p.xz - uMistWind * uTime) * uMistScale;
  float n = n2(q) * 0.65 + n2(q * 2.7 + 9.1) * 0.35;
  return uMist * hgt * (0.25 + 1.5 * smoothstep(0.3, 0.75, n));
}
float hg(float mu, float g){ float g2 = g * g; return (1.0 - g2) / (12.566371 * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5)); }
float sunVis(vec3 p){
  vec4 sc = uShadowMatrix * vec4(p, 1.0);
  if (sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 || sc.z < 0.0) return 1.0;
  float d = dot(texture2D(tShadow, sc.xy), vec4(0.99609375, 0.99609375 / 256.0, 0.99609375 / 65536.0, 1.0 / 16777216.0));
  return step(sc.z - 0.0006, d);
}
void main(){
  float z = texture2D(tDepthHalf, vUv).r;
  vec3 vd = vec3((vUv * 2.0 - 1.0) * uTanHalf, -1.0);
  float rl = length(vd);
  vec3 rd = normalize(mat3(uCamWorld) * vd);
  float dist = z * rl;
  bool isSky = z > uFarZ * 0.97;
  float maxD = min(dist, isSky ? uMaxDist * 0.55 : uMaxDist);
  float mu = dot(rd, uSunDir);
  // two-lobe phase: tight forward lobe for the glow toward the sun + a broad lobe so side-lit shafts stay visible
  float ph = min(hg(mu, 0.78) * 0.55 + hg(mu, 0.25) * 0.45, 1.15);
  float j = ign(gl_FragCoord.xy);
  vec3 acc = vec3(0.0); float T = 1.0; float tPrev = 0.0;
  for (int i = 0; i < VOL_STEPS; i++) {
    float f = (float(i) + 1.0) / float(VOL_STEPS);
    float t1 = maxD * f * (0.35 + 0.65 * f);              // denser sampling near the eye
    float ds = t1 - tPrev;
    float tm = tPrev + ds * j;
    vec3 p = uCamPos + rd * tm;
    float sh = uHasShadow > 0.5 ? sunVis(p) : 1.0;
    float ext = uSigma * shape(p.y);
    if (uMist > 0.0) ext += mistAt(p);
    float Ti = exp(-ext * ds);
    // art direction: beams near the eye read strongly (shafts between trunks), the far field stays a restrained veil
    float nearW = mix(uNearBoost, uFarBoost, smoothstep(uBoostRange.x, uBoostRange.y, tm));
    vec3 src = uSunRad * (ph * sh * nearW) + uAmb * (0.40 + 0.60 * sh);
    acc += T * src * (1.0 - Ti);
    T *= Ti; tPrev = t1;
  }
  // analytic continuation for far geometry: fades into the horizon colour of that direction
  if (!isSky && dist > uMaxDist) {
    float h1 = uCamPos.y + rd.y * uMaxDist, h2 = uCamPos.y + rd.y * dist;
    float tau = uSigma * uFarHaze * (dist - uMaxDist) * 0.5 * (shape(h1) + shape(h2));
    float Tf = exp(-tau);
    vec3 hc = horizonColor(rd) * 0.50 + uAmb * 0.6;
    acc += T * hc * (1.0 - Tf);
    T *= Tf;
  }
  gl_FragColor = vec4(acc, T);
}`;

// separable depth-aware blur for the half-res buffers
const F_BLUR = /* glsl */ `${COMMON}
uniform sampler2D tSrc, tDepthHalf; uniform vec2 uDir;
void main(){
  float z0 = texture2D(tDepthHalf, vUv).r;
  float zc = min(z0, 300.0);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = -3; i <= 3; i++) {
    vec2 uv = vUv + uDir * float(i);
    float z = min(texture2D(tDepthHalf, uv).r, 300.0);
    float w = (1.0 - abs(float(i)) * 0.22) * max(0.0, 1.0 - abs(z - zc) / (BLUR_TOL * zc + 0.02));
    acc += texture2D(tSrc, uv) * w; ws += w;
  }
  gl_FragColor = ws > 1e-4 ? acc / ws : texture2D(tSrc, vUv);
}`;

// HDR scene * AO, then the air in front of it
const F_COMPOSITE = /* glsl */ `${COMMON}
uniform sampler2D tColor, tDepth, tDepthHalf, tAO, tVol;
uniform vec2 uHalfRes; uniform float uNear, uFar, uAoOn, uVolOn, uAoStrength, uDebug;
${EXPOSURE}
void main(){
  vec3 col = max(texture2D(tColor, vUv).rgb, vec3(0.0));
  float d = texture2D(tDepth, vUv).r;
  float z = (uNear * uFar) / (uFar - d * (uFar - uNear));
  // joint bilateral upsample of the half-res buffers
  vec2 hp = vUv * uHalfRes - 0.5; vec2 f = fract(hp); vec2 base = (floor(hp) + 0.5) / uHalfRes; vec2 tx = 1.0 / uHalfRes;
  float ao = 0.0; vec4 vol = vec4(0.0); float ws = 0.0;
  float zc = min(z, 300.0);
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(float(k & 1), float(k >> 1));
    vec2 uv = base + o * tx;
    float zh = min(texture2D(tDepthHalf, uv).r, 300.0);
    float w = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y);
    w *= 1.0 / (0.015 + abs(zh - zc) / zc);
    w = max(w, 1e-5);
    ao += texture2D(tAO, uv).r * w; vol += texture2D(tVol, uv) * w; ws += w;
  }
  ao /= ws; vol /= ws;
  if (uAoOn > 0.5 && d < 0.99999) {
    // occlusion belongs to ambient light: fade it out on brightly lit pixels so sunlit surfaces never get dirty halos
    float lit = smoothstep(0.16, 0.85, luma(col) * slExposure());
    float a = mix(1.0, ao, uAoStrength * (1.0 - 0.8 * lit));
    col *= mix(vec3(a), vec3(1.0), vec3(0.0, 0.03, 0.07));      // faintly cool occlusion
  }
  if (uVolOn > 0.5) col = col * vol.a + vol.rgb;
  if (uDebug > 0.5) {
    float e = 1.0 / max(slExposure(), 1e-3);
    if (uDebug < 1.5) col = vec3(uAoOn > 0.5 ? ao : 1.0) * 0.5 * e;
    else if (uDebug < 2.5) col = vol.rgb;
    else col = vec3(vol.a) * 0.5 * e;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// camera motion blur from depth reprojection
const F_MOTION = /* glsl */ `${COMMON}
uniform sampler2D tColor, tDepth; uniform mat4 uInvViewProj, uPrevViewProj; uniform float uShutter; uniform vec2 uRes;
void main(){
  vec4 c0 = texture2D(tColor, vUv);
  float d = texture2D(tDepth, vUv).r;
  vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); wp /= wp.w;
  vec4 pc = uPrevViewProj * wp;
  vec2 puv = pc.xy / max(pc.w, 1e-4) * 0.5 + 0.5;
  vec2 vel = (vUv - puv) * uShutter;
  float len = length(vel);
  if (pc.w <= 0.0 || len * uRes.y < 0.75) { gl_FragColor = c0; return; }
  vel *= min(1.0, 0.018 / len);
  float j = ign(gl_FragCoord.xy) - 0.5;
  vec3 acc = c0.rgb; float ws = 1.0;
  for (int i = 0; i < 9; i++) {
    vec2 uv = vUv + vel * ((float(i) + 0.5 + j) / 9.0 - 0.5);
    acc += texture2D(tColor, uv).rgb; ws += 1.0;
  }
  gl_FragColor = vec4(acc / ws, 1.0);
}`;

// bloom pyramid: 13-tap downsample ...
const F_DOWN = /* glsl */ `${COMMON}
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFirst;
vec3 s(vec2 o){ return min(max(texture2D(tSrc, vUv + o * uTexel).rgb, vec3(0.0)), vec3(400.0)); }
float kw(vec3 c){ return 1.0 / (1.0 + luma(c) * 0.08); }
void main(){
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0, 0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 col;
  if (uFirst > 0.5) {
    // partial Karis average on the first downsample: tames fireflies without killing the sun
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = kw(g0) * 0.125, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.5;
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// ... and 9-tap tent upsample, blended level by level
const F_UP = /* glsl */ `${COMMON}
uniform sampler2D tLow, tHigh; uniform vec2 uTexel; uniform float uMix;
void main(){
  vec2 o = uTexel;
  vec3 t = texture2D(tLow, vUv).rgb * 4.0;
  t += (texture2D(tLow, vUv + vec2(o.x, 0.0)).rgb + texture2D(tLow, vUv - vec2(o.x, 0.0)).rgb + texture2D(tLow, vUv + vec2(0.0, o.y)).rgb + texture2D(tLow, vUv - vec2(0.0, o.y)).rgb) * 2.0;
  t += texture2D(tLow, vUv + o).rgb + texture2D(tLow, vUv - o).rgb + texture2D(tLow, vUv + vec2(o.x, -o.y)).rgb + texture2D(tLow, vUv + vec2(-o.x, o.y)).rgb;
  t *= 1.0 / 16.0;
  gl_FragColor = vec4(mix(texture2D(tHigh, vUv).rgb, t, uMix), 1.0);
}`;

// anamorphic streak: thresholded horizontal blur, two passes
const F_STREAK = /* glsl */ `${COMMON}
uniform sampler2D tSrc; uniform vec2 uDir; uniform float uThreshold;
${EXPOSURE}
void main(){
  float thr = uThreshold / max(slExposure(), 0.2);
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int i = -7; i <= 7; i++) {
    float x = float(i); float w = exp(-x * x / 18.0);
    vec3 c = texture2D(tSrc, vUv + uDir * x).rgb;
    c = max(c - vec3(thr), vec3(0.0));
    acc += c * w; ws += w;
  }
  gl_FragColor = vec4(acc / ws, 1.0);
}`;

// 1x1 buffer: r = adapted log-average luminance, g = smoothed sun visibility (for the flare)
const F_ADAPT = /* glsl */ `${COMMON}
uniform sampler2D tPrev, tLum, tDepth; uniform vec2 uSunUv; uniform float uSunOn, uRate, uVisRate, uAspect;
void main(){
  float ls = 0.0, ws = 0.0;
  for (int y = 0; y < 5; y++) for (int x = 0; x < 7; x++) {
    vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(7.0, 5.0);
    vec2 c = uv - 0.5;
    float w = 1.0 - 0.75 * smoothstep(0.1, 0.55, length(c));       // centre-weighted metering
    float l = luma(texture2D(tLum, uv).rgb);
    ls += log(max(l, 1e-4)) * w; ws += w;
  }
  float avg = clamp(exp(ls / ws), 0.002, 40.0);
  float vis = 0.0;
  for (int i = 0; i < 12; i++) {
    float r = sqrt((float(i) + 0.5) / 12.0) * 0.011; float th = float(i) * 2.39996323;
    vec2 uv = uSunUv + vec2(cos(th) / uAspect, sin(th)) * r;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) vis += 1.0;
    else vis += step(0.99999, texture2D(tDepth, uv).r);
  }
  vis = vis / 12.0 * uSunOn;
  vec4 prev = texture2D(tPrev, vec2(0.5));
  float a = mix(prev.r, avg, uRate);
  if (!(a > 0.0) || a > 1e4) a = avg;                                 // NaN / first-frame guard
  float v = mix(prev.g, vis, uVisRate);
  if (!(v >= 0.0)) v = vis;
  gl_FragColor = vec4(a, v, 0.0, 1.0);
}`;

// procedural lens dirt (rendered once)
const F_DIRT = /* glsl */ `${COMMON}
${GLSL_NOISE}
uniform float uAspect;
void main(){
  vec2 p = vUv * vec2(uAspect, 1.0);
  float acc = 0.0;
  for (int i = 0; i < 70; i++) {
    float fi = float(i);
    vec2 c = vec2(hash12(vec2(fi, 1.7)), hash12(vec2(fi, 9.2))) * vec2(uAspect, 1.0);
    float sz = mix(0.012, 0.085, pow(hash12(vec2(fi, 4.4)), 3.0));
    float r = length(p - c) / sz;
    float disc = smoothstep(1.0, 0.86, r) * (0.35 + 0.65 * smoothstep(0.35, 0.98, r));
    acc += disc * mix(0.15, 0.7, hash12(vec2(fi, 6.1)));
  }
  float smudge = fbm5(vUv * vec2(5.0, 9.0) + 3.0) * fbm3(vUv * 2.3 + 9.0);
  float streaks = pow(n2(vec2(vUv.x * 90.0, vUv.y * 2.0)), 4.0) * 0.25;
  float v = acc * 0.55 + smudge * 0.9 + streaks;
  v *= 0.45 + 0.9 * smoothstep(0.15, 0.75, length(vUv - 0.5));
  gl_FragColor = vec4(vec3(v) * vec3(1.0, 0.96, 0.9), 1.0);
}`;

// lens + exposure + filmic curve + grade -> display sRGB (alpha = luma for FXAA)
const F_GRADE = /* glsl */ `${COMMON}
uniform sampler2D tScene, tBloom, tStreak, tDirt;
${EXPOSURE}
uniform vec3 uSunCol, uShadowTint, uHighTint, uLift, uStreakTint;
uniform vec2 uSunUv;
uniform float uTime, uAspect, uBloom, uDirt, uStreak, uFlare, uCA, uVignette, uContrast;
uniform float uFlash, uFade, uSaturation, uSunOn, uAgxMix;

// ---- AgX (Filament/Blender fit, as in three.js) ----
const mat3 SL_REC2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
const mat3 SL_SRGB_TO_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
vec3 slAgxContrast(vec3 x){ vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 slAgx(vec3 color){
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float minEv = -12.47393, maxEv = 4.026069;
  color = inset * (SL_SRGB_TO_REC2020 * color);
  color = clamp((log2(max(color, 1e-10)) - minEv) / (maxEv - minEv), 0.0, 1.0);
  color = slAgxContrast(color);
  // "punchy"-style look: a little more contrast and chroma than the base AgX rendering
  float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = pow(max(color, vec3(0.0)), vec3(LOOK_POWER));
  color = l + (color - l) * LOOK_SAT;
  color = outset * color;
  color = pow(max(color, vec3(0.0)), vec3(2.2));
  return clamp(SL_REC2020_TO_SRGB * color, 0.0, 1.0);
}
vec3 slRRTODT(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 slAces(vec3 c){
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(outM * slRRTODT(inM * (c * 1.3)), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }

vec3 flare(vec2 uv, vec2 sun, float vis){
  vec2 asp = vec2(uAspect, 1.0);
  vec2 p = (uv - 0.5) * asp, s = (sun - 0.5) * asp;
  vec2 dv = p - s; float r = length(dv);
  vec3 c = vec3(0.0);
  // veiling glare + a few soft diffraction spikes
  float ang = atan(dv.y, dv.x);
  float spikes = pow(abs(cos(ang * 3.0 + 0.4)), 24.0) + 0.6 * pow(abs(cos(ang * 4.0 - 1.1)), 40.0);
  c += uSunCol * (0.020 / (r * r * 9.0 + 0.010) + 0.10 * exp(-r * 3.2));
  c += uSunCol * spikes * 0.30 * exp(-r * 5.5);
  // ghosts along the sun -> centre axis
  vec3 g = vec3(0.0);
  float k0 = length(p + s * 0.38);  g += vec3(0.30, 0.75, 0.55) * smoothstep(0.085, 0.06, k0) * 0.050;
  float k1 = length(p + s * 0.82);  g += vec3(0.85, 0.45, 0.25) * smoothstep(0.045, 0.030, k1) * 0.075;
  float k2 = length(p + s * 1.35);  g += vec3(0.35, 0.50, 0.95) * smoothstep(0.17, 0.12, k2) * (0.4 + 0.6 * smoothstep(0.05, 0.16, k2)) * 0.040;
  float k3 = length(p - s * 0.45);  g += vec3(0.80, 0.70, 0.35) * smoothstep(0.030, 0.018, k3) * 0.060;
  // halo ring opposite the sun
  float hr = length(p + s * 0.15);
  g += vec3(0.45, 0.55, 0.85) * exp(-pow((hr - 0.52) * 16.0, 2.0)) * 0.035 * smoothstep(0.1, 0.5, length(s));
  c += g * uSunCol * 2.4;
  return c * vis;
}

void main(){
  vec2 c = vUv - 0.5;
  float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0)) / (0.25 * (uAspect * uAspect + 1.0));   // 0 centre .. 1 corner
  vec4 ad = texture2D(tAdapt, vec2(0.5));
  // radial chromatic aberration (tiny)
  vec2 off = c * r2 * uCA;
  vec3 col = vec3(texture2D(tScene, vUv + off).r, texture2D(tScene, vUv).g, texture2D(tScene, vUv - off).b);
  // bloom (energy conserving mix), lens dirt, anamorphic streak
  vec3 bloom = texture2D(tBloom, vUv).rgb;
  vec3 dirt = texture2D(tDirt, vUv).rgb;
  col = mix(col, bloom, uBloom);
  col += bloom * dirt * uDirt;
  col += texture2D(tStreak, vUv).rgb * uStreakTint * uStreak;
  // sun glare + flare (occlusion-tested)
  float vis = ad.g * uSunOn;
  if (vis > 0.002) { vec3 fl = flare(vUv, uSunUv, vis) * uFlare; col += fl * (1.0 + dirt * 1.5); }
  // exposure: manual * eye adaptation
  col *= slExposure();
  col += vec3(1.0, 0.97, 0.9) * uFlash * 2.5;
  // filmic curve: ACES (Hill fit) for punch and burning oranges, pulled toward AgX so highlights roll off to white
  col = mix(slAces(col), slAgx(col), uAgxMix);

  // ---- grade (display-linear) ----
  float l = luma(col);
  col *= mix(uShadowTint, uHighTint, smoothstep(0.03, 0.55, l));          // split tone
  col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);              // gentle S-curve
  col = col * 0.988 + uLift;                                             // lifted, slightly tinted blacks
  l = luma(col);
  col = mix(vec3(l), col, uSaturation);
  float vr = smoothstep(0.15, 1.05, r2);
  col *= 1.0 - uVignette * vr * vr * (3.0 - 2.0 * vr);
  col *= 1.0 - uFade;
  col = toSRGB(clamp(col, 0.0, 1.0));
  gl_FragColor = vec4(col, dot(col, vec3(0.299, 0.587, 0.114)));
}`;

// FXAA + unsharp mask + film grain + dither + optional letterbox
const F_FINAL = /* glsl */ `${COMMON}
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uTime, uGrain, uSharpen, uFxaa, uBar;
void main(){
  vec4 M = texture2D(tSrc, vUv);
  vec3 col = M.rgb;
  vec4 NW = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel), NE = texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel);
  vec4 SW = texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel), SE = texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel);
  float lMin = min(M.a, min(min(NW.a, NE.a), min(SW.a, SE.a)));
  float lMax = max(M.a, max(max(NW.a, NE.a), max(SW.a, SE.a)));
  float contrast = lMax - lMin;
  if (uFxaa > 0.5 && contrast > max(0.0312, lMax * 0.10)) {
    vec2 dir = vec2(-((NW.a + NE.a) - (SW.a + SE.a)), (NW.a + SW.a) - (NE.a + SE.a));
    float dirReduce = max((NW.a + NE.a + SW.a + SE.a) * 0.03125, 0.0078125);
    float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
    vec4 A = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)) + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)));
    vec4 B = A * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5) + texture2D(tSrc, vUv + dir * 0.5));
    col = (B.a < lMin || B.a > lMax) ? A.rgb : B.rgb;
  }
  // light unsharp mask, backed off on strong edges (those belong to FXAA)
  vec3 blur = (NW.rgb + NE.rgb + SW.rgb + SE.rgb) * 0.25;
  col += (M.rgb - blur) * uSharpen * (1.0 - smoothstep(0.04, 0.22, contrast));
  // animated, luminance-weighted film grain
  vec2 seed = gl_FragCoord.xy + fract(uTime * vec2(7.31, 3.17)) * vec2(311.7, 173.3);
  float g = hash12(seed) + hash12(seed + 57.3) - 1.0;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col += g * uGrain * mix(1.0, 0.30, smoothstep(0.25, 0.9, l)) * (0.35 + 0.65 * smoothstep(0.0, 0.08, l));
  // dither against banding in the sky gradients
  col += (hash12(gl_FragCoord.xy * 1.37 + 11.0) + hash12(gl_FragCoord.xy * 0.71 + 3.0) - 1.0) / 255.0;
  // letterbox
  col *= step(abs(vUv.y - 0.5), uBar);
  gl_FragColor = vec4(col, 1.0);
}`;

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);

// The post chain. `ctx` supplies live state: { quality, look, sunDir, noiseTex }.
export function createPostChain(renderer, ctx) {
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  tri.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const quad = new THREE.Mesh(tri, null);
  quad.frustumCulled = false;
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const materials = [];
  const mat = (name, frag, uniforms, extra = {}) => {
    const m = new THREE.ShaderMaterial({
      name: 'post-' + name,
      vertexShader: VERT,
      fragmentShader: `${POST_TAG} ${name}\n${frag}`,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
      ...extra,
    });
    materials.push(m);
    return m;
  };
  function pass(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quad, fsCam);
  }

  const HF = THREE.HalfFloatType,
    U8 = THREE.UnsignedByteType,
    LIN = THREE.LinearFilter,
    NEAR = THREE.NearestFilter;
  const rt = (type = HF, filter = LIN, extra = {}) => {
    const t = new THREE.WebGLRenderTarget(4, 4, {
      type,
      format: THREE.RGBAFormat,
      minFilter: filter,
      magFilter: filter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      ...extra,
    });
    t.texture.generateMipmaps = false;
    return t;
  };
  let floatRT = false;
  try {
    floatRT = !!renderer.extensions.has('EXT_color_buffer_float');
  } catch {
    floatRT = false;
  }
  const LEVELS = 6;
  const T = {
    scene: rt(HF, LIN),
    motion: rt(HF, LIN),
    ldr: rt(U8, LIN),
    depthHalf: floatRT ? rt(THREE.FloatType, NEAR, { format: THREE.RedFormat }) : rt(HF, NEAR),
    aoA: rt(U8, NEAR),
    aoB: rt(U8, NEAR),
    volA: rt(HF, NEAR),
    volB: rt(HF, NEAR),
    down: [],
    up: [],
    streakA: rt(HF, LIN),
    streakB: rt(HF, LIN),
    adapt: [rt(HF, NEAR), rt(HF, NEAR)],
    dirt: rt(U8, LIN),
  };
  for (let i = 0; i < LEVELS; i++) T.down.push(rt(HF, LIN));
  for (let i = 0; i < LEVELS - 1; i++) T.up.push(rt(HF, LIN));
  T.adapt[0].setSize(1, 1);
  T.adapt[1].setSize(1, 1);
  T.dirt.setSize(512, 288);

  let adaptIdx = 0,
    frames = 0,
    dirtDone = false,
    havePrev = false;
  const size = { w: 4, h: 4, hw: 2, hh: 2 };
  const V2 = () => new THREE.Vector2(),
    V3 = () => new THREE.Vector3(),
    M4 = () => new THREE.Matrix4();

  const expo = { tAdapt: { value: null }, uExposure: { value: 1 }, uKey: { value: 0.12 }, uMinE: { value: 0.6 }, uMaxE: { value: 2 }, uAuto: { value: 1 } };
  const skyU = () => ({ uSunDir: { value: V3() }, uZen: { value: V3() }, uHor: { value: V3() }, uHorAway: { value: V3() }, uSunCol: { value: V3() }, uGlow: { value: V3() } });

  const mDepthHalf = mat('depthhalf', F_DEPTH_HALF, { tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 1000 } });
  const mAO = mat(
    'ao',
    F_AO,
    { tDepthHalf: { value: T.depthHalf.texture }, uTanHalf: { value: V2() }, uTexel: { value: V2() }, uRadius: { value: 0.9 }, uIntensity: { value: 1.6 }, uAspect: { value: 1 } },
    { defines: { AO_TAPS: 12 } },
  );
  const mVol = mat(
    'vol',
    F_VOL,
    {
      tDepthHalf: { value: T.depthHalf.texture },
      tShadow: { value: null },
      tNoise: { value: ctx.noiseTex },
      uShadowMatrix: { value: M4() },
      uCamWorld: { value: M4() },
      uCamPos: { value: V3() },
      uSunRad: { value: V3() },
      uAmb: { value: V3() },
      uTanHalf: { value: V2() },
      uMistWind: { value: V2() },
      uBoostRange: { value: new THREE.Vector2(4, 85) },
      uHasShadow: { value: 0 },
      uMaxDist: { value: 170 },
      uSigma: { value: 0.0034 },
      uFarZ: { value: 1000 },
      uFarHaze: { value: 0.42 },
      uFloor: { value: 0.3 },
      uFalloff: { value: 5.5 },
      uBaseY: { value: 0 },
      uNearBoost: { value: 2.3 },
      uFarBoost: { value: 0.55 },
      uMist: { value: 0 },
      uMistTop: { value: 2 },
      uMistFalloff: { value: 2 },
      uMistScale: { value: 0.012 },
      uTime: { value: 0 },
      ...skyU(),
    },
    { defines: { VOL_STEPS: 16 } },
  );
  const blurU = () => ({ tSrc: { value: null }, tDepthHalf: { value: T.depthHalf.texture }, uDir: { value: V2() } });
  const mBlurAO = mat('blur-ao', F_BLUR, blurU(), { defines: { BLUR_TOL: '0.04' } });
  const mBlurVol = mat('blur-vol', F_BLUR, blurU(), { defines: { BLUR_TOL: '0.30' } });
  const mComposite = mat('composite', F_COMPOSITE, {
    tColor: { value: null },
    tDepth: { value: null },
    tDepthHalf: { value: T.depthHalf.texture },
    tAO: { value: T.aoA.texture },
    tVol: { value: T.volA.texture },
    uHalfRes: { value: V2() },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uAoOn: { value: 1 },
    uVolOn: { value: 1 },
    uAoStrength: { value: 0.95 },
    uDebug: { value: 0 },
    ...expo,
  });
  const mMotion = mat('motion', F_MOTION, {
    tColor: { value: T.scene.texture },
    tDepth: { value: null },
    uInvViewProj: { value: M4() },
    uPrevViewProj: { value: M4() },
    uShutter: { value: 0.5 },
    uRes: { value: V2() },
  });
  const mDown = mat('down', F_DOWN, { tSrc: { value: null }, uTexel: { value: V2() }, uFirst: { value: 0 } });
  const mUp = mat('up', F_UP, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: V2() }, uMix: { value: 0.62 } });
  const mStreak = mat('streak', F_STREAK, { tSrc: { value: null }, uDir: { value: V2() }, uThreshold: { value: 0 }, ...expo });
  const mAdapt = mat('adapt', F_ADAPT, {
    tPrev: { value: null },
    tLum: { value: null },
    tDepth: { value: null },
    uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
    uSunOn: { value: 0 },
    uRate: { value: 1 },
    uVisRate: { value: 1 },
    uAspect: { value: 1 },
  });
  const mDirt = mat('dirt', F_DIRT, { tNoise: { value: ctx.noiseTex }, uAspect: { value: 16 / 9 } });
  const mGrade = mat(
    'grade',
    F_GRADE,
    {
      tScene: { value: null },
      tBloom: { value: T.up[0].texture },
      tStreak: { value: T.streakB.texture },
      tDirt: { value: T.dirt.texture },
      ...expo,
      uSunCol: { value: V3() },
      uShadowTint: { value: V3() },
      uHighTint: { value: V3() },
      uLift: { value: V3() },
      uStreakTint: { value: V3() },
      uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uBloom: { value: 0 },
      uDirt: { value: 0 },
      uStreak: { value: 0 },
      uFlare: { value: 0 },
      uCA: { value: 0 },
      uVignette: { value: 0 },
      uContrast: { value: 0.22 },
      uFlash: { value: 0 },
      uFade: { value: 0 },
      uSaturation: { value: 1 },
      uSunOn: { value: 0 },
      uAgxMix: { value: 0.25 },
    },
    { defines: { LOOK_POWER: '1.180', LOOK_SAT: '1.220' } },
  );
  const mFinal = mat('final', F_FINAL, {
    tSrc: { value: T.ldr.texture },
    uTexel: { value: V2() },
    uTime: { value: 0 },
    uGrain: { value: 0.02 },
    uSharpen: { value: 0.3 },
    uFxaa: { value: 1 },
    uBar: { value: 1 },
  });

  const viewProj = M4(),
    prevViewProj = M4(),
    invViewProj = M4(),
    sunNdc = V3(),
    tmp = V3();

  function applyQuality() {
    const q = ctx.quality;
    const steps = Math.max(6, q.volSteps | 0),
      taps = q.aoTaps | 0 || 12;
    if (mVol.defines.VOL_STEPS !== steps) {
      mVol.defines.VOL_STEPS = steps;
      mVol.needsUpdate = true;
    }
    if (mAO.defines.AO_TAPS !== taps) {
      mAO.defines.AO_TAPS = taps;
      mAO.needsUpdate = true;
    }
  }
  function applyLookDefines() {
    const g = ctx.look.grade;
    const p = g.lookPower.toFixed(3),
      s = g.lookSat.toFixed(3);
    if (mGrade.defines.LOOK_POWER !== p || mGrade.defines.LOOK_SAT !== s) {
      mGrade.defines.LOOK_POWER = p;
      mGrade.defines.LOOK_SAT = s;
      mGrade.needsUpdate = true;
    }
  }

  function resize(w, h) {
    w = Math.max(8, w | 0);
    h = Math.max(8, h | 0);
    size.w = w;
    size.h = h;
    size.hw = Math.max(4, Math.ceil(w / 2));
    size.hh = Math.max(4, Math.ceil(h / 2));
    T.scene.setSize(w, h);
    T.motion.setSize(w, h);
    T.ldr.setSize(w, h);
    for (const t of [T.depthHalf, T.aoA, T.aoB, T.volA, T.volB]) t.setSize(size.hw, size.hh);
    let lw = size.hw,
      lh = size.hh;
    for (let i = 0; i < LEVELS; i++) {
      T.down[i].setSize(lw, lh);
      if (i < LEVELS - 1) T.up[i].setSize(lw, lh);
      lw = Math.max(2, lw >> 1);
      lh = Math.max(2, lh >> 1);
    }
    T.streakA.setSize(T.down[2].width, T.down[2].height);
    T.streakB.setSize(T.down[2].width, T.down[2].height);
    havePrev = false;
    applyQuality();
  }

  // hdr: render target with a depth texture; camera: the view camera; sun: the DirectionalLight
  function run({ hdr, camera, sun, dt, time, fast, post }) {
    const q = ctx.quality,
      look = ctx.look,
      g = look.grade,
      air = look.air;
    const pe = camera.projectionMatrix.elements;
    const tanX = 1 / pe[0],
      tanY = 1 / pe[5],
      aspect = tanX / tanY;
    const depthTex = hdr.depthTexture;
    applyLookDefines();

    expo.tAdapt.value = T.adapt[adaptIdx].texture;
    expo.uExposure.value = g.exposure * (post.exposure ?? 1);
    expo.uAuto.value = api.autoExposure ? 1 : 0;
    expo.uKey.value = g.key;
    expo.uMinE.value = g.minExposure;
    expo.uMaxE.value = g.maxExposure;

    if (!dirtDone) {
      pass(mDirt, T.dirt);
      dirtDone = true;
    }

    // ---- half-res linear depth ----
    mDepthHalf.uniforms.tDepth.value = depthTex;
    mDepthHalf.uniforms.uNear.value = camera.near;
    mDepthHalf.uniforms.uFar.value = camera.far;
    pass(mDepthHalf, T.depthHalf);
    const tx = 1 / size.hw,
      ty = 1 / size.hh;

    // ---- ambient occlusion ----
    const aoOn = !!q.ao && api.enable.ao;
    if (aoOn) {
      const u = mAO.uniforms;
      u.uTanHalf.value.set(tanX, tanY);
      u.uTexel.value.set(tx, ty);
      u.uAspect.value = aspect;
      u.uRadius.value = air.aoRadius;
      u.uIntensity.value = air.aoIntensity;
      pass(mAO, T.aoA);
      mBlurAO.uniforms.tSrc.value = T.aoA.texture;
      mBlurAO.uniforms.uDir.value.set(tx, 0);
      pass(mBlurAO, T.aoB);
      mBlurAO.uniforms.tSrc.value = T.aoB.texture;
      mBlurAO.uniforms.uDir.value.set(0, ty);
      pass(mBlurAO, T.aoA);
    }

    // ---- volumetric light ----
    const volOn = (q.volSteps | 0) > 0 && api.enable.volumetrics;
    if (volOn) {
      const u = mVol.uniforms,
        s = look.sky;
      const shadowTex = sun.castShadow && sun.shadow && sun.shadow.map ? sun.shadow.map.texture : null;
      u.tShadow.value = shadowTex;
      u.uHasShadow.value = shadowTex ? 1 : 0;
      if (shadowTex) u.uShadowMatrix.value.copy(sun.shadow.matrix);
      u.uCamWorld.value.copy(camera.matrixWorld);
      u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
      u.uTanHalf.value.set(tanX, tanY);
      u.uFarZ.value = camera.far;
      const k = sun.intensity * air.sunScale;
      u.uSunRad.value.set(sun.color.r * k, sun.color.g * k, sun.color.b * k);
      u.uAmb.value.fromArray(air.color).multiplyScalar(air.ambient);
      u.uMaxDist.value = air.maxDist;
      u.uSigma.value = air.sigma;
      u.uFarHaze.value = air.farHaze;
      u.uFloor.value = air.floor;
      u.uFalloff.value = air.falloff;
      u.uBaseY.value = air.baseY;
      u.uNearBoost.value = air.nearBoost;
      u.uFarBoost.value = air.farBoost;
      u.uBoostRange.value.fromArray(air.boostRange);
      u.uMist.value = air.mist;
      u.uMistTop.value = air.mistTop;
      u.uMistFalloff.value = air.mistFalloff;
      u.uMistScale.value = air.mistScale;
      u.uMistWind.value.fromArray(air.mistWind);
      u.uTime.value = time;
      u.uSunDir.value.copy(ctx.sunDir);
      u.uSunCol.value.fromArray(look.sun.color);
      u.uZen.value.fromArray(s.zenith);
      u.uHor.value.fromArray(s.horizon);
      u.uHorAway.value.fromArray(s.horizonAway);
      u.uGlow.value.fromArray(s.glow);
      pass(mVol, T.volA);
      mBlurVol.uniforms.tSrc.value = T.volA.texture;
      mBlurVol.uniforms.uDir.value.set(tx, 0);
      pass(mBlurVol, T.volB);
      mBlurVol.uniforms.tSrc.value = T.volB.texture;
      mBlurVol.uniforms.uDir.value.set(0, ty);
      pass(mBlurVol, T.volA);
    }

    // ---- composite ----
    {
      const u = mComposite.uniforms;
      u.tColor.value = hdr.texture;
      u.tDepth.value = depthTex;
      u.uHalfRes.value.set(size.hw, size.hh);
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      u.uAoOn.value = aoOn ? 1 : 0;
      u.uVolOn.value = volOn ? 1 : 0;
      u.uAoStrength.value = air.aoStrength;
      u.uDebug.value = api.debug | 0;
      pass(mComposite, T.scene);
    }
    let sceneTex = T.scene.texture;

    // ---- motion blur ----
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (q.motionBlur && api.enable.motionBlur && havePrev && dt > 0) {
      const u = mMotion.uniforms;
      u.tDepth.value = depthTex;
      u.uInvViewProj.value.copy(invViewProj.copy(viewProj).invert());
      u.uPrevViewProj.value.copy(prevViewProj);
      u.uShutter.value = Math.min(0.5, 1 / 190 / Math.max(dt, 0.001));
      u.uRes.value.set(size.w, size.h);
      pass(mMotion, T.motion);
      sceneTex = T.motion.texture;
    }
    prevViewProj.copy(viewProj);
    havePrev = true;

    // ---- bloom pyramid + streak ----
    const bloomOn = !!q.bloom && api.enable.bloom;
    if (bloomOn) {
      let src = sceneTex,
        sw = size.w,
        sh = size.h;
      for (let i = 0; i < LEVELS; i++) {
        mDown.uniforms.tSrc.value = src;
        mDown.uniforms.uTexel.value.set(1 / sw, 1 / sh);
        mDown.uniforms.uFirst.value = i === 0 ? 1 : 0;
        pass(mDown, T.down[i]);
        src = T.down[i].texture;
        sw = T.down[i].width;
        sh = T.down[i].height;
      }
      let low = T.down[LEVELS - 1];
      mUp.uniforms.uMix.value = g.bloomMix;
      for (let i = LEVELS - 2; i >= 0; i--) {
        mUp.uniforms.tLow.value = low.texture;
        mUp.uniforms.tHigh.value = T.down[i].texture;
        mUp.uniforms.uTexel.value.set(1 / low.width, 1 / low.height);
        pass(mUp, T.up[i]);
        low = T.up[i];
      }
      const sx = 1 / T.streakA.width;
      mStreak.uniforms.tSrc.value = T.down[2].texture;
      mStreak.uniforms.uDir.value.set(sx * 1.5, 0);
      mStreak.uniforms.uThreshold.value = g.streakThreshold;
      pass(mStreak, T.streakA);
      mStreak.uniforms.tSrc.value = T.streakA.texture;
      mStreak.uniforms.uDir.value.set(sx * 5, 0);
      mStreak.uniforms.uThreshold.value = 0;
      pass(mStreak, T.streakB);
    }

    // ---- sun position on screen (flare + occlusion test) ----
    sunNdc.copy(ctx.sunDir).multiplyScalar(500).add(tmp.setFromMatrixPosition(camera.matrixWorld)).project(camera);
    camera.getWorldDirection(tmp);
    const facing = tmp.dot(ctx.sunDir) > 0.05;
    const edge = Math.max(Math.abs(sunNdc.x), Math.abs(sunNdc.y));
    const sunOn = facing ? 1 - Math.min(1, Math.max(0, (edge - 1) / 0.3)) : 0;
    const sunU = sunNdc.x * 0.5 + 0.5,
      sunV = sunNdc.y * 0.5 + 0.5;

    // ---- eye adaptation ----
    {
      const u = mAdapt.uniforms,
        cur = T.adapt[adaptIdx],
        next = T.adapt[1 - adaptIdx];
      u.tPrev.value = cur.texture;
      u.tLum.value = bloomOn ? T.down[LEVELS - 1].texture : sceneTex;
      u.tDepth.value = depthTex;
      u.uSunUv.value.set(sunU, sunV);
      u.uSunOn.value = sunOn;
      u.uAspect.value = aspect;
      const snap = frames < 2 || fast;
      u.uRate.value = snap ? (frames < 2 ? 1 : 0.6) : 1 - Math.exp(-dt / g.adaptTau);
      u.uVisRate.value = snap ? 1 : 1 - Math.exp(-dt / 0.12);
      pass(mAdapt, next);
      adaptIdx = 1 - adaptIdx;
      frames++;
    }

    // ---- lens + grade ----
    {
      const u = mGrade.uniforms;
      u.tScene.value = sceneTex;
      expo.tAdapt.value = T.adapt[adaptIdx].texture;
      u.uSunUv.value.set(sunU, sunV);
      u.uSunOn.value = sunOn;
      u.uSunCol.value.fromArray(look.sun.color);
      u.uAspect.value = aspect;
      u.uTime.value = time;
      u.uBloom.value = bloomOn ? g.bloom : 0;
      u.uDirt.value = bloomOn ? g.dirt : 0;
      u.uStreak.value = bloomOn ? g.streak : 0;
      u.uStreakTint.value.fromArray(g.streakTint);
      u.uFlare.value = api.enable.flare ? g.flare : 0;
      u.uAgxMix.value = g.agxMix;
      u.uCA.value = g.ca;
      u.uVignette.value = g.vignette;
      u.uContrast.value = g.contrast;
      u.uShadowTint.value.fromArray(g.shadowTint);
      u.uHighTint.value.fromArray(g.highlightTint);
      u.uLift.value.fromArray(g.lift);
      u.uFlash.value = clamp01(post.flash || 0);
      u.uFade.value = clamp01(post.fade || 0);
      u.uSaturation.value = g.saturation * (Number.isFinite(post.saturation) ? post.saturation : 1);
      pass(mGrade, T.ldr);
    }

    // ---- final: AA, sharpen, grain, letterbox -> screen ----
    {
      const u = mFinal.uniforms;
      u.uTexel.value.set(1 / size.w, 1 / size.h);
      u.uTime.value = time;
      u.uGrain.value = g.grain;
      u.uSharpen.value = g.sharpen;
      const lb = post.letterbox || 0; // target aspect, e.g. 2.39; 0 = off
      u.uBar.value = lb > 0 ? 0.5 * Math.min(1, aspect / lb) : 1;
      pass(mFinal, null);
    }
  }

  function dispose() {
    for (const m of materials) m.dispose();
    for (const t of [T.scene, T.motion, T.ldr, T.depthHalf, T.aoA, T.aoB, T.volA, T.volB, T.streakA, T.streakB, T.dirt, ...T.down, ...T.up, ...T.adapt]) t.dispose();
  }

  const px = new Uint16Array(4);
  function readAdapt() {
    try {
      renderer.readRenderTargetPixels(T.adapt[adaptIdx], 0, 0, 1, 1, px);
      const lum = THREE.DataUtils.fromHalfFloat(px[0]);
      const g = ctx.look.grade;
      const auto = Math.min(g.maxExposure, Math.max(g.minExposure, Math.pow(g.key / Math.max(lum, 1e-4), 0.85)));
      return { lum: +lum.toFixed(4), auto: +auto.toFixed(3), sunVis: +THREE.DataUtils.fromHalfFloat(px[1]).toFixed(2) };
    } catch {
      return null;
    }
  }

  const api = {
    run,
    resize,
    applyQuality,
    dispose,
    readAdapt,
    pass,
    quad,
    fsCam,
    materials,
    rt: T,
    size,
    autoExposure: true,
    debug: 0, // 0 final image, 1 AO, 2 in-scattered light, 3 transmittance
    enable: { ao: true, volumetrics: true, bloom: true, flare: true, motionBlur: true },
  };
  return api;
}
