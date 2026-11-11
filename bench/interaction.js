import * as THREE from 'three';

// Pointer handling for the bench. Two ways to put a metal into a vessel, because a mouse, a finger on a tablet and
// a pen on a classroom touch wall are good at different things:
//   drag   : press a metal, carry it over a vessel, let go
//   select : tap a metal (it lifts and waits), then tap a vessel
// Anything else is the camera, within the limits in `orbit.limits`: drag on empty table turns the view a little,
// the wheel or a two-finger pinch moves closer and further. Zooming in keeps the spot under the pointer in place,
// so it goes to the vessel you point at; zooming all the way out re-centres the bench.
//
// The host supplies the scene knowledge through callbacks:
//   solidAt(ray) / vesselAt(ray)   what is under the pointer
//   vesselNear(point)              the vessel a carried metal is hovering over, or null
//   grab(solid)                    a metal leaves its tray
//   carry(solid, point, vessel)    it follows the pointer, or snaps over the vessel being aimed at
//   release(solid, vessel | null)  drop it in, or send it back
//   aim(vessel | null)             which vessel to light up as the target
//   tapVessel(vessel)              a vessel tapped with empty hands
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createInteraction({ canvas, camera, orbit, holdY, bounds, solidAt, vesselAt, vesselNear, grab, carry, release, aim, tapVessel }) {
  const ray = new THREE.Raycaster(),
    ndc = new THREE.Vector2(),
    plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -holdY),
    focus = new THREE.Plane(new THREE.Vector3(0, 1, 0), -orbit.home.y),
    point = new THREE.Vector3();
  const pointers = new Map(); // every finger on the glass
  let mode = null, // 'solid' | 'orbit' | 'pinch'
    owner = null, // pointer id of the gesture in progress
    cand = null, // the metal under the press
    dragging = false,
    selected = null, // a metal lifted by a tap, waiting for a vessel
    last = null,
    moved = 0,
    spread = 0;
  const TAP = 6; // pixels a press may wander and still count as a tap

  const aimRay = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray;
  };
  // where the pointer is on the horizontal plane metals are carried in, kept over the bench
  const carryPoint = (e) => {
    if (!aimRay(e).ray.intersectPlane(plane, point)) return null;
    point.x = clamp(point.x, bounds.x0, bounds.x1);
    point.z = clamp(point.z, bounds.z0, bounds.z1);
    return point;
  };
  // The vessel a carried metal is meant for. People aim at the picture of the beaker, and from a raised camera
  // that picture is not below the carried metal, so the pointer itself is tested first; the position of the metal
  // over the bench is the fallback (pointer just above a rim).
  const vesselFor = (e, p) => vesselAt(aimRay(e)) || (p ? vesselNear(p) : null);

  function zoomBy(factor, e) {
    const L = orbit.limits,
      z0 = orbit.zoom,
      z1 = clamp(z0 * factor, L.zoom[0], L.zoom[1]);
    if (z1 === z0) return;
    if (e && aimRay(e).ray.intersectPlane(focus, point)) {
      orbit.target.x = point.x + (orbit.target.x - point.x) * (z1 / z0);
      orbit.target.z = point.z + (orbit.target.z - point.z) * (z1 / z0);
    }
    orbit.zoom = z1;
    // the closer the view, the further it may sit from the middle of the bench
    const free = clamp((1 - z1) / (1 - L.zoom[0]), 0, 1);
    orbit.target.x = clamp(orbit.target.x, orbit.home.x - L.panX * free, orbit.home.x + L.panX * free);
    orbit.target.z = clamp(orbit.target.z, orbit.home.z + L.panZ[0] * free, orbit.home.z + L.panZ[1] * free);
  }
  const fingers = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
  };

  function finish(e, cancelled) {
    const was = mode;
    mode = owner = null;
    canvas.classList.remove('carry');
    if (was === 'solid') {
      if (dragging) {
        release(cand, cancelled ? null : vesselFor(e, carryPoint(e)));
        aim(null);
      } else if (!cancelled) {
        // a tap on a metal: lift it, or put it back if it was the one already lifted
        if (selected === cand) {
          release(cand, null);
          selected = null;
        } else {
          if (selected) release(selected, null);
          selected = cand;
          grab(cand);
        }
      }
    } else if (was === 'orbit' && moved < TAP && !cancelled) {
      const v = vesselAt(aimRay(e));
      if (selected) {
        release(selected, v);
        selected = null;
      } else if (v) tapVessel(v);
    }
    cand = null;
    dragging = false;
  }

  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {} // not every source of pointer events can be captured
    if (pointers.size === 2) {
      // a second finger turns whatever was happening into a pinch; a metal in the air goes back to its dish
      if (mode && mode !== 'pinch') finish(e, true);
      mode = 'pinch';
      spread = fingers().d;
      return;
    }
    if (mode) return;
    owner = e.pointerId;
    last = { x: e.clientX, y: e.clientY };
    moved = 0;
    dragging = false;
    cand = solidAt(aimRay(e));
    mode = cand ? 'solid' : 'orbit';
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pinch') {
      if (pointers.size < 2) return;
      const f = fingers();
      if (spread > 0 && f.d > 0) zoomBy(spread / f.d, f);
      spread = f.d;
      return;
    }
    if (!mode) {
      canvas.classList.toggle('pick', !!solidAt(aimRay(e)) || (!!selected && !!vesselAt(ray)));
      return;
    }
    if (e.pointerId !== owner) return;
    const dx = e.clientX - last.x,
      dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved < TAP) return;
    if (mode === 'orbit') {
      const L = orbit.limits;
      orbit.yaw = clamp(orbit.yaw - dx * 0.004, -L.yaw, L.yaw);
      // the view may be showing a steeper angle than was asked for (see camera.js): tilt from what is on screen
      const from = dy > 0 ? Math.max(orbit.pitch, orbit.shown) : orbit.pitch;
      orbit.pitch = clamp(Math.max(from + dy * 0.004, orbit.shown - 0.03), L.pitch[0], L.pitch[1]);
      return;
    }
    if (!dragging) {
      dragging = true;
      if (selected && selected !== cand) release(selected, null);
      if (selected !== cand) grab(cand);
      selected = null;
      canvas.classList.add('carry');
    }
    const p = carryPoint(e),
      v = vesselFor(e, p);
    if (p) carry(cand, p, v);
    aim(v);
  });

  const lift = (e, cancelled) => {
    pointers.delete(e.pointerId);
    if (mode === 'pinch') {
      if (pointers.size < 2) mode = null; // the finger that stays down does not start anything
    } else if (mode && e.pointerId === owner) finish(e, cancelled);
  };
  canvas.addEventListener('pointerup', (e) => lift(e, false));
  canvas.addEventListener('pointercancel', (e) => lift(e, true));
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomBy(Math.exp(e.deltaY * 0.0012), e);
    },
    { passive: false },
  );

  return {
    get selected() {
      return selected;
    },
    get busy() {
      return !!selected || dragging;
    },
    // the host calls this when it takes a metal away by other means (reset)
    forget() {
      selected = null;
    },
  };
}
