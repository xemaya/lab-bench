import * as THREE from 'three';

// Acts out one outcome of the rule engine (chem/judge.js) in one vessel. It reads nothing but `outcome.phenomena`:
//   none          nothing happens, and after a few seconds the vessel says so
//   gas           bubbles leave the metal, at a rate set by `vigor`
//   dissolve      the metal slowly gets smaller
//   solutionColor the solution drifts from one colour to another
//   deposit       the wetted metal grows a coat of the displaced metal
//   floatAndDart  the metal melts into a bead that skates over the surface until it is used up
//   precipitate   flecks form under that bead and settle on the bottom
// A new kind of experiment needs new phenomena here, not new cases.

const smooth = (t) => {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
};

// colour keys of the rule engine -> what the liquid material needs (colour after crossing the vessel, strength)
export const SOLUTION = {
  colorless: { color: [0.96, 0.98, 1.0], density: 0.05 },
  blue: { color: [0.08, 0.42, 0.92], density: 1.0 },
  paleGreen: { color: [0.6, 0.86, 0.58], density: 0.6 },
};
const DEPOSIT = {
  red: { rgb: [0.62, 0.2, 0.09], roughness: 0.8 },
  darkGrey: { rgb: [0.06, 0.06, 0.07], roughness: 0.92 },
};
const FLOC = {
  blue: [[0, [0.2, 0.48, 0.95]]],
  white: [[0, [0.93, 0.94, 0.91]]],
};
// iron(II) hydroxide in air: white for a moment, then grey-green, finally red-brown
const FLOC_AGEING = [
  [0, [0.93, 0.94, 0.91]],
  [2.5, [0.93, 0.94, 0.91]],
  [7, [0.4, 0.52, 0.4]],
  [16, [0.5, 0.19, 0.07]],
];
const GAS_RATE = { slow: 40, steady: 150, violent: 230 }; // bubbles per second
const SLOW_CHANGE = 22; // seconds for a colour change or a deposit to complete at speed 1
const QUIET = 3; // seconds of nothing before "无明显现象" is declared

export function createReaction({ vessel, solid, outcome, fx, rng }) {
  const P = {};
  for (const p of outcome.phenomena) P[p.type] = p;
  const pool = vessel.pool;
  let t = 0,
    ended = false;
  const sources = [];
  const at = new THREE.Vector3();

  if (P.deposit && solid.coat) {
    const d = DEPOSIT[P.deposit.color] || DEPOSIT.darkGrey;
    solid.coat.coat.value.setRGB(d.rgb[0], d.rgb[1], d.rgb[2]);
    solid.coat.coatRough.value = d.roughness;
  }
  const float = P.floatAndDart
    ? {
        x: solid.group.position.x - pool.x,
        z: solid.group.position.z - pool.z,
        heading: rng() * Math.PI * 2,
        // with an acid the bead is gone in seconds; on a salt solution it lasts long enough to watch the precipitate
        life: outcome.family === 'metal-acid' ? 5.5 : 11,
        speed: outcome.family === 'metal-acid' ? 1.9 : 1.25,
        palette: P.precipitate ? (P.precipitate.ages ? FLOC_AGEING : FLOC[P.precipitate.color] || FLOC.white) : null,
      }
    : null;

  // dt moves things; rdt is dt scaled by the reaction-speed control and advances the chemistry
  function update(dt, rdt) {
    t += rdt;
    if (float) return skate(dt, rdt);
    const k = smooth(t / SLOW_CHANGE);
    if (P.solutionColor) vessel.setMix(P.solutionColor.from, P.solutionColor.to, k);
    if (P.deposit && solid.coat) solid.coat.progress.value = Math.min(1, t / SLOW_CHANGE);
    if (P.dissolve) solid.setDissolve(smooth(t / 50));
    if (P.gas) {
      sources.length = 0;
      solid.sources(pool.level, sources);
      // builds up, then eases off as the surface of the metal is used
      fx.bubbles.emit(dt, GAS_RATE[P.gas.vigor] * smooth(t / 2.5) * (1 - 0.55 * smooth(t / 80)), sources, pool);
    }
  }

  function skate(dt, rdt) {
    if (ended) return;
    const used = Math.min(1, t / float.life);
    solid.setMolten(smooth(t / 0.7));
    solid.setDissolve(used);
    if (solid.setGlow) solid.setGlow(outcome.family === 'metal-acid' ? 1.2 + 0.8 * Math.sin(t * 31) : 0.25);
    if (used >= 1) {
      ended = true;
      solid.group.visible = false;
      return;
    }
    const r = solid.radiusNow();
    float.heading += (rng() - 0.5) * 9 * dt;
    float.x += Math.cos(float.heading) * float.speed * dt;
    float.z += Math.sin(float.heading) * float.speed * dt;
    const d = Math.hypot(float.x, float.z),
      lim = pool.radius - r - 0.012;
    if (d > lim) {
      // bounce off the glass, back toward the middle, at a random angle
      float.x *= lim / d;
      float.z *= lim / d;
      float.heading = Math.atan2(-float.z, -float.x) + (rng() - 0.5) * 1.7;
    }
    solid.group.position.set(pool.x + float.x, pool.level - r * 0.55 + Math.sin(t * 17) * 0.004, pool.z + float.z);
    solid.group.rotation.set(0, float.heading, 0);
    sources.length = 0;
    sources.push({ position: at.set(pool.x + float.x, pool.level - 0.03, pool.z + float.z), radius: r * 1.2 });
    fx.bubbles.emit(dt, GAS_RATE.violent * 0.6, sources, pool);
    if (float.palette) fx.flocs.emit(rdt, 30, { x: pool.x + float.x, y: pool.level - 0.07, z: pool.z + float.z }, float.palette, pool);
  }

  return {
    outcome,
    update,
    get status() {
      if (!outcome.reacts) return t < QUIET ? '观察中…' : '无明显现象';
      return ended ? '反应结束' : '反应中';
    },
    get settled() {
      return !outcome.reacts ? t >= QUIET : float ? ended : t >= SLOW_CHANGE;
    },
  };
}
