// Quality tiers and lighting "looks". A look is everything that used to be hard-coded for one location and one
// time of day: sun, sky palette, cloud deck, air (fog / mist), lens and grade. All colours are linear, HDR.

export const QUALITY = {
  low: { name: 'low', scale: 0.7, msaa: 0, shadow: 2048, shadowTaps: 10, volSteps: 12, ao: false, aoTaps: 8, planar: 0.35, bloom: true, motionBlur: false, pixels: 1.0e6 },
  medium: { name: 'medium', scale: 0.85, msaa: 2, shadow: 2048, shadowTaps: 12, volSteps: 16, ao: true, aoTaps: 12, planar: 0.5, bloom: true, motionBlur: false, pixels: 1.5e6 },
  high: { name: 'high', scale: 1, msaa: 4, shadow: 2048, shadowTaps: 16, volSteps: 24, ao: true, aoTaps: 12, planar: 0.5, bloom: true, motionBlur: false, pixels: 2.3e6 },
  ultra: { name: 'ultra', scale: 1, msaa: 4, shadow: 4096, shadowTaps: 16, volSteps: 40, ao: true, aoTaps: 16, planar: 1, bloom: true, motionBlur: false, pixels: 3.7e6 },
};
export const QUALITY_ORDER = ['ultra', 'high', 'medium', 'low'];

const GRADE_BASE = {
  exposure: 1,
  key: 0.12, // auto-exposure target (scene log-average luminance is driven toward this)
  minExposure: 0.6,
  maxExposure: 2,
  adaptTau: 1.5,
  agxMix: 0.25, // 0 = ACES (punchy), 1 = AgX (soft highlight roll-off)
  lookPower: 1.18,
  lookSat: 1.22,
  shadowTint: [0.8, 1.01, 1.13], // split tone: teal shadows ...
  highlightTint: [1.07, 1.0, 0.9], // ... warm highlights
  contrast: 0.22,
  lift: [0.006, 0.0085, 0.011],
  saturation: 1,
  vignette: 0.3,
  bloom: 0.065,
  bloomMix: 0.62,
  dirt: 0.1,
  streak: 0.03,
  streakThreshold: 2.2,
  streakTint: [0.45, 0.62, 1.0],
  flare: 0.16,
  ca: 0.0013,
  grain: 0.02,
  sharpen: 0.3,
};

const AIR_BASE = {
  color: [0.42, 0.47, 0.52], // ambient in-scatter colour
  sigma: 0.0034, // extinction per metre at the fog base height
  floor: 0.3, // fraction of the density that never falls off with height
  falloff: 5.5, // metres: e-folding height of the rest
  baseY: 0,
  maxDist: 170, // ray-marched range; beyond it an analytic haze takes over
  farHaze: 0.42,
  sunScale: 0.85, // how strongly the sun lights the air (shafts)
  ambient: 0.2,
  nearBoost: 2.3, // art direction: shafts near the eye read stronger than the far veil
  farBoost: 0.55,
  boostRange: [4, 85], // metres over which nearBoost fades to farBoost
  mist: 0, // extra ground-hugging, drifting mist layer (extinction per metre)
  mistTop: 2.5, // metres above baseY where the mist starts thinning
  mistFalloff: 2.0,
  mistScale: 0.012, // world -> noise scale of the mist patches
  mistWind: [0.25, 0.08], // m/s drift
  aoRadius: 0.9,
  aoIntensity: 1.6,
  aoStrength: 0.95,
};

export const LOOKS = {
  // Low morning sun through thin mist: long soft shadows, shafts between trunks, pale warm horizon.
  dawnMist: {
    sun: { azimuth: 62, elevation: 13, color: [1.0, 0.7, 0.4], intensity: 9 },
    sky: {
      zenith: [0.07, 0.15, 0.33],
      mid: [0.2, 0.32, 0.5],
      midSun: [0.95, 0.62, 0.36],
      horizon: [1.0, 0.62, 0.32],
      horizonAway: [0.3, 0.4, 0.54],
      glow: [2.6, 1.45, 0.62],
      ground: [0.05, 0.06, 0.05],
      cloudCover: 0.4,
      cloudGap: 0.25,
      cloudLit: [0.34, 0.36, 0.44],
      cloudShade: [0.12, 0.14, 0.2],
      cloudSun: 0,
      cloudWarm: 1.5,
      cloudSpeed: 1,
      sunDisk: 100,
    },
    env: { intensity: 1.7 },
    air: {
      ...AIR_BASE,
      color: [0.5, 0.56, 0.66],
      sigma: 0.0026,
      floor: 0.22,
      falloff: 9,
      maxDist: 190,
      farHaze: 0.32,
      sunScale: 0.8,
      nearBoost: 3.4,
      farBoost: 0.42,
      boostRange: [3, 50],
      ambient: 0.2,
      mist: 0.0035,
      mistTop: 0.8,
      mistFalloff: 1.6,
    },
    grade: {
      ...GRADE_BASE,
      key: 0.13,
      minExposure: 0.35,
      agxMix: 0.3,
      shadowTint: [0.84, 1.0, 1.12],
      highlightTint: [1.08, 1.0, 0.88],
      saturation: 1.12,
      vignette: 0.28,
      bloom: 0.075,
      flare: 0.14,
      streak: 0.022,
    },
  },
  // The look of the original harbour demo: sun just above the sea under a heavy cloud deck with a burning gap.
  goldenDusk: {
    sun: { azimuth: 19.9, elevation: 13, color: [1.0, 0.72, 0.42], intensity: 9 },
    sky: {
      zenith: [0.085, 0.145, 0.24],
      mid: [0.15, 0.24, 0.36],
      midSun: [0.72, 0.5, 0.34],
      horizon: [0.95, 0.55, 0.28],
      horizonAway: [0.16, 0.22, 0.3],
      glow: [3.4, 2.04, 0.816],
      ground: [0.06, 0.064, 0.07],
      cloudCover: 0.8,
      cloudGap: 1,
      cloudLit: [0.155, 0.195, 0.255],
      cloudShade: [0.03, 0.042, 0.064],
      cloudSun: 0,
      cloudWarm: 1.15,
      cloudSpeed: 1,
      sunDisk: 110,
    },
    env: { intensity: 2 },
    air: { ...AIR_BASE },
    grade: { ...GRADE_BASE },
  },
  // High, slightly hazy sun: the neutral reference look.
  clearNoon: {
    sun: { azimuth: 62, elevation: 52, color: [1.0, 0.96, 0.9], intensity: 7 },
    sky: {
      zenith: [0.1, 0.24, 0.6],
      mid: [0.24, 0.42, 0.78],
      midSun: [0.36, 0.52, 0.82],
      horizon: [0.7, 0.8, 0.9],
      horizonAway: [0.5, 0.64, 0.84],
      glow: [1.3, 1.25, 1.15],
      ground: [0.07, 0.08, 0.06],
      cloudCover: 0.36,
      cloudGap: 0,
      cloudLit: [0.62, 0.66, 0.74],
      cloudShade: [0.22, 0.26, 0.34],
      cloudSun: 0.5,
      cloudWarm: 0,
      cloudSpeed: 1,
      sunDisk: 60,
    },
    env: { intensity: 1.5 },
    air: { ...AIR_BASE, color: [0.5, 0.6, 0.74], sigma: 0.0016, floor: 0.35, falloff: 30, farHaze: 0.6, sunScale: 0.5, ambient: 0.28 },
    grade: {
      ...GRADE_BASE,
      key: 0.14,
      agxMix: 0.45,
      shadowTint: [0.92, 1.0, 1.06],
      highlightTint: [1.03, 1.0, 0.96],
      flare: 0.08,
      streak: 0.012,
      bloom: 0.05,
    },
  },
};

export function cloneLook(look) {
  return JSON.parse(JSON.stringify(look));
}

// azimuth: degrees in the XZ plane measured from +X toward +Z; elevation: degrees above the horizon.
export function sunDirection(sun, out) {
  if (sun.dir) return out.set(sun.dir[0], sun.dir[1], sun.dir[2]).normalize();
  const az = (sun.azimuth * Math.PI) / 180,
    el = (sun.elevation * Math.PI) / 180;
  return out.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
}
