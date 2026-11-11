import { LOOKS, QUALITY, cloneLook } from '../engine/index.js';

// The engine is tuned in metres for landscapes: shadow bias (3 cm), penumbra limits and the ambient-occlusion shader
// all carry metre-sized constants. A bench is a 50 cm subject, so the lab is built ten times life size
// (1 world unit = 10 cm). Every one of those constants then lands at a sensible few millimetres without touching
// the engine. Write dimensions as `cm(7)`.
export const UNITS_PER_CM = 0.1;
export const cm = (v) => v * UNITS_PER_CM;

// Window light on a lab bench. Colours of solutions are exam content ("蓝色变为浅绿色"), so the grade is neutral:
// no split toning, little added saturation, almost no lens character.
export function makeBenchLook() {
  const L = cloneLook(LOOKS.clearNoon);
  L.sun = { azimuth: 258, elevation: 37, color: [1.0, 0.95, 0.88], intensity: 6.5 };
  L.sky.cloudCover = 0.28;
  L.env = { intensity: 1.4 };
  Object.assign(L.air, {
    color: [0.62, 0.64, 0.68],
    sigma: 0.0022, // per world unit: a faint haze across a 3 m room so the window shafts just show
    floor: 1,
    falloff: 50,
    baseY: -9,
    maxDist: 60,
    farHaze: 0,
    sunScale: 0.55,
    ambient: 0.08,
    nearBoost: 1.3,
    farBoost: 1.0,
    boostRange: [2, 30],
    mist: 0,
    aoRadius: 0.42, // ~3 cm of contact darkening around glassware
    aoIntensity: 1.5,
    aoStrength: 0.9,
  });
  Object.assign(L.grade, {
    key: 0.15,
    minExposure: 0.5,
    maxExposure: 3,
    agxMix: 0.5,
    lookSat: 1.06,
    shadowTint: [1, 1, 1],
    highlightTint: [1, 1, 1],
    contrast: 0.14,
    saturation: 1,
    vignette: 0.24,
    bloom: 0.045,
    dirt: 0.03,
    streak: 0,
    flare: 0.03,
    ca: 0.0003,
    grain: 0.008,
    sharpen: 0.35,
  });
  return L;
}

// The engine's quality tiers size the shadow map for a 100 m frustum. A bench covers one room, and small things
// on it (a zinc granule, a brush) need the shadow sharp, so the map and the filter are stepped up.
export function benchQuality(name) {
  const base = QUALITY[name] || QUALITY.high;
  return { ...base, shadow: name === 'low' ? 2048 : 4096, shadowTaps: name === 'low' ? 16 : 32 };
}
