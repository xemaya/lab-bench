import * as THREE from 'three';
import { LIT } from './room.js';

// The view of a bench: looks down at the apparatus from a limited range of angles. It may turn a little and come
// closer, but it never shows anything except sunlit table (LIT in room.js): the room is for light, not for show.
//
//   const view = createBenchCamera(camera, { home, halfWidth });
//   view.orbit     yaw / pitch / zoom / target, edited by interaction.js within view.orbit.limits
//   view.update()  once per frame, before rendering
//
// home      : the point looked at when the view is centred (a little above the table, among the apparatus)
// halfWidth : half the width of the apparatus in world units; all of it stays in frame at zoom 1 whatever the
//             shape of the window
// limits    : yaw (± radians), pitch [low, high], zoom [near, far] as multiples of the fitted distance,
//             panX / panZ: how far the view centre may leave `home` when fully zoomed in
export function createBenchCamera(camera, { home, halfWidth, yaw = 0, pitch = 0.5, zoom = 1, limits = {} }) {
  const orbit = {
    yaw,
    pitch,
    zoom,
    shown: pitch, // the pitch actually used this frame: the asked-for one, raised if it would show the room
    home,
    target: home.clone(),
    limits: { yaw: 0.5, pitch: [0.3, 1.1], zoom: [0.45, 1.2], panX: halfWidth * 0.7, panZ: [-0.5, 0.9], ...limits },
  };
  const NARROW = Math.tan((30 * Math.PI) / 360); // the lens used whenever the window is wide enough
  const f = new THREE.Vector3(),
    r = new THREE.Vector3(),
    u = new THREE.Vector3(),
    d = new THREE.Vector3(),
    p = new THREE.Vector3();

  // does every corner of the frame land on the sunlit table when the camera sits at this pitch?
  function framesTable(pitchNow, dist, tanV, tanH) {
    const cp = Math.cos(pitchNow),
      sy = Math.sin(orbit.yaw),
      cy = Math.cos(orbit.yaw);
    p.set(orbit.target.x + sy * cp * dist, orbit.target.y + Math.sin(pitchNow) * dist, orbit.target.z + cy * cp * dist);
    f.set(-sy * cp, -Math.sin(pitchNow), -cy * cp);
    r.set(cy, 0, -sy);
    u.crossVectors(r, f);
    for (const sx of [-1, 1])
      for (const sv of [-1, 1]) {
        d.copy(f).addScaledVector(r, sx * tanH).addScaledVector(u, sv * tanV);
        if (d.y > -0.02) return false; // at or above the horizon
        const t = p.y / -d.y,
          x = p.x + d.x * t,
          z = p.z + d.z * t;
        if (x < LIT.x0 || x > LIT.x1 || z < LIT.z0 || z > LIT.z1) return false;
      }
    return true;
  }

  function update() {
    // fit the apparatus across the view: back the camera off, and on a tall phone screen widen the lens instead of
    // backing off for ever
    const base = Math.min(12, Math.max(5.2, halfWidth / (NARROW * camera.aspect)));
    const tanV = Math.max(NARROW, halfWidth / (base * camera.aspect));
    const fov = (Math.atan(tanV) * 360) / Math.PI;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    const dist = base * orbit.zoom;
    // the lowest angle asked for is raised until the frame holds nothing but table
    let shown = orbit.pitch;
    while (shown < 1.35 && !framesTable(shown, dist, tanV, tanV * camera.aspect)) shown += 0.015;
    orbit.shown = shown; // interaction.js starts vertical drags from what is shown, so there is no dead travel
    const cp = Math.cos(shown);
    camera.position.set(orbit.target.x + Math.sin(orbit.yaw) * cp * dist, orbit.target.y + Math.sin(shown) * dist, orbit.target.z + Math.cos(orbit.yaw) * cp * dist);
    camera.lookAt(orbit.target);
  }

  return { orbit, update };
}
