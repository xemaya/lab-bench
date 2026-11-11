// A single-coil permanent-magnet DC motor with a split-ring commutator: the classroom model. No rendering, no DOM:
// this file runs under plain node (see motor.test.js) and the 3D bench only draws what it returns.
//
// Frame (the same one the bench uses): the shaft is the z axis and points at the viewer, the commutator sits at
// that end. The magnets stand left and right of the coil, so the field B runs along x. y is up.
//
//   params  what the student controls
//     closed  the switch
//     supply  +1: the left brush is connected to the positive pole;  -1: the two leads are swapped
//     magnet  +1: N pole on the left (B points +x, left to right);    -1: the magnets are swapped
//     current 0..1 relative current (the rheostat)
//     field   0..1 relative field strength (how close the magnets are)
//     turns   number of turns of the coil
//   angle   rotor angle about +z. At 0 the coil lies flat (its plane contains B): side A is on the right, side B
//           on the left, the lever arm is longest. At 90 degrees the coil stands upright: the dead point.
//
// The two long sides of the coil, A and B, run parallel to the shaft. Each end of the coil is soldered to one half
// of the split ring; the half belonging to the side that is currently on the right touches the right brush.

export const TURNS_FULL = 10; // the coil the relative scales are normalised to
export const GAP = 0.105; // half-width, in radians, of the stretch where a brush sits on an insulating gap (6 degrees)

const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

// The current in side A as a signed fraction of full current: positive flows toward the viewer (+z).
// Side B always carries the opposite. Zero when the switch is open or the brushes are on the gaps.
export function coilCurrent(p, angle) {
  if (!p.closed || p.current <= 0) return 0;
  const c = Math.cos(angle);
  if (Math.abs(c) < Math.sin(GAP)) return 0;
  // Conventional current enters through the positive brush, runs away from the viewer along the side on that
  // brush's side, turns at the back, and returns toward the viewer along the other side. With supply = +1 the
  // positive brush is the left one, so the side on the right carries +z.
  return p.supply * sign(c) * p.current;
}

// Which side is on the right-hand brush, i.e. the state of the commutator: 'A', 'B' or null on a gap.
export function onRightBrush(angle) {
  const c = Math.cos(angle);
  return Math.abs(c) < Math.sin(GAP) ? null : c > 0 ? 'A' : 'B';
}

// F = I L x B for both sides, in the bench frame. Lengths are relative: 1 is one side of the full coil at full
// current in the full field. `at` is where the side is (unit radius), `current` its direction along z.
export function sideForces(p, angle) {
  const iA = coilCurrent(p, angle);
  const bx = p.magnet * p.field; // B = (bx, 0, 0)
  const n = p.turns / TURNS_FULL;
  const side = (i, s) => {
    // I L = (0, 0, i),  B = (bx, 0, 0)  =>  I L x B = (0, i * bx, 0): always straight up or straight down
    const fy = n * i * bx;
    const at = [s * Math.cos(angle), s * Math.sin(angle)];
    return { at, current: sign(i), force: [0, fy], torque: at[0] * fy }; // torque about +z = x Fy - y Fx
  };
  const a = side(iA, 1),
    b = side(-iA, -1);
  return { a, b, torque: a.torque + b.torque };
}

// Instantaneous torque about +z, relative: 1 is the full coil lying flat at full current in the full field.
export const torque = (p, angle) => sideForces(p, angle).torque / 2;

// How hard the motor is driven, 0..1: what the "relative torque" read-out shows.
export const drive = (p) => (p.closed ? (p.turns / TURNS_FULL) * p.current * p.field : 0);

// Which way it turns, seen from the commutator end: +1 anticlockwise, -1 clockwise, 0 not driven.
// Swapping the leads reverses it, swapping the magnets reverses it, doing both leaves it as it was.
export const direction = (p) => (drive(p) > 0 ? p.supply * p.magnet : 0);

// ---- motion ----
// J dw/dt = K torque - C w. The drag is viscous, so a rotor that is turning fast enough coasts through the dead
// point on its inertia. A rotor at rest needs the torque to beat static friction, which it cannot do at the dead
// point; and one that creeps into the dead point too slowly stops there.
export const MOTION = { K: 8.8, C: 0.8, STICTION: 0.12, REST: 0.02 };

export function createRotor(angle = 0.45) {
  return { angle, omega: 0 };
}

// Advances the rotor by dt seconds. Returns why it is not turning, if it is not:
//   null         turning
//   'open'       no current: the switch is open or the rheostat is at zero
//   'no-field'   current but no field
//   'dead-point' stopped where the brushes sit on the gaps or the lever arm is too short
//   'too-weak'   the torque cannot beat friction anywhere
export function step(rotor, p, dt) {
  const M = MOTION;
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(left, 1 / 240);
    left -= h;
    const t = M.K * torque(p, rotor.angle);
    const held = Math.abs(t) <= M.STICTION; // too little torque here to move a rotor that is not moving
    if (rotor.omega === 0 && held) continue;
    rotor.omega += (t - M.C * rotor.omega) * h;
    rotor.angle += rotor.omega * h;
    if (held && Math.abs(rotor.omega) < M.REST) rotor.omega = 0;
  }
  if (rotor.omega !== 0) return null;
  if (!p.closed || p.current <= 0) return 'open';
  if (p.field <= 0) return 'no-field';
  return M.K * drive(p) > M.STICTION ? 'dead-point' : 'too-weak';
}

// below this drive the rotor stalls at the first dead point it meets (found by running the model; motor.test.js
// checks both sides of it)
export const CARRIES_THROUGH = 0.05;

// a flick of the finger: enough to carry a stopped rotor past the dead point
export function nudge(rotor, way = 1) {
  rotor.omega += way * 2.2;
}

// the speed the rotor settles at, in revolutions per second (mean torque is 2/pi of the peak)
export const settledSpeed = (p) => ((MOTION.K * drive(p) * (2 / Math.PI)) / MOTION.C / (2 * Math.PI)) * direction(p);

// ---- words ----
const WAY = { 1: '逆时针', '-1': '顺时针' };
const STOPPED = {
  open: '电路没有接通，线圈中没有电流',
  'no-field': '没有磁场，通电线圈不受力',
  'dead-point': '线圈停在平衡位置附近：电刷压在换向器的绝缘缝上，或力臂太短。用手拨一下线圈就能转起来',
  'too-weak': '转矩太小，克服不了摩擦',
};

// What a student would write down, for the status line and the experiment record.
export function describe(p, rotor, stopped) {
  const d = direction(p);
  // a weakly driven rotor has too little inertia to coast through the dead point: a flick only buys half a turn
  if (stopped === 'dead-point' && drive(p) < CARRIES_THROUGH) return { turning: false, way: 0, text: '转矩太小，线圈靠惯性转不过平衡位置' };
  if (stopped) return { turning: false, way: 0, text: STOPPED[stopped] };
  if (!d) return { turning: true, way: sign(rotor.omega), text: '电源断开，线圈靠惯性继续转动，逐渐慢下来' };
  const against = sign(rotor.omega) !== d;
  return {
    turning: true,
    way: d,
    text: against ? `受到${WAY[d]}方向的转矩，正在减速并反转` : `线圈${WAY[d]}转动（从换向器一端看）`,
  };
}
