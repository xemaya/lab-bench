import * as THREE from 'three';
import { mulberry32 } from '../engine/index.js';

// The table, and a room that is never in view. World units are 10 cm; the table top is y = 0.
//
// The camera only ever sees the table (camera.js keeps it there), but glass is mostly what it reflects, and an
// outdoor sky in a beaker looks wrong. So the table stands in a closed room with one long window in the back wall:
// the sun through it lights the part of the table the camera can reach, and the room baked into the environment
// map gives every vessel a bright window and pale walls to reflect.
export const ROOM = { x0: -22, x1: 22, y0: -0.5, y1: 19, z0: -14, z1: 18 };
// the window opening; with the sun of look.js its light covers LIT on the table
const WINDOW = { x0: -20.5, x1: 15, sill: 4.5, head: 16.5 };
// what the camera may show: sunlit table, clear of the shadow lines of the sill, the lintel and the window's sides
export const LIT = { x0: -15.5, x1: 15.5, z0: -7.6, z1: 6.8 };

function canvasTexture(size, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

export function buildRoom() {
  const group = new THREE.Group();
  group.name = 'room';
  const rng = mulberry32(11);
  const R = ROOM;

  // table top: speckled grey resin. Light enough that coloured solutions read against it, dark enough that the
  // highlights and edges of clear glass do (on a near-white table an empty-looking beaker of acid disappears)
  const speckle = canvasTexture(
    256,
    (g, s) => {
      g.fillStyle = '#b4b4b0';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 2600; i++) {
        const v = 120 + Math.floor(rng() * 90);
        g.fillStyle = `rgba(${v},${v},${v - 6},${0.25 + rng() * 0.4})`;
        g.fillRect(rng() * s, rng() * s, 1 + rng() * 1.6, 1 + rng() * 1.6);
      }
    },
    [(R.x1 - R.x0) / 2, (R.z1 - R.z0) / 2],
  );
  const tiles = canvasTexture(256, (g, s) => {
    g.fillStyle = '#e9e9e4';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = '#b9bab4';
    g.lineWidth = 5;
    g.strokeRect(0, 0, s, s);
  });
  const M = {
    top: new THREE.MeshStandardMaterial({ map: speckle, roughness: 0.42, metalness: 0 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xe6e3da, roughness: 0.92 }),
    tile: new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.25 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0xf0efe9, roughness: 0.95 }),
  };
  const box = (mat, x0, x1, y0, y1, z0, z1, { uv = null } = {}) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    if (uv) {
      // world-sized texture coordinates (tiles are 1.5 units square)
      const a = g.attributes.uv,
        p = g.attributes.position;
      for (let i = 0; i < a.count; i++) a.setXY(i, (p.getX(i) + (x1 + x0) / 2) / uv, (p.getY(i) + (y1 + y0) / 2) / uv);
    }
    const m = new THREE.Mesh(g, mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // the table fills the room wall to wall: no edge for the camera to find
  box(M.top, R.x0, R.x1, -0.4, 0, R.z0, R.z1);

  // shell
  box(M.ceiling, R.x0 - 0.6, R.x1 + 0.6, R.y1, R.y1 + 0.6, R.z0 - 0.6, R.z1 + 0.6);
  box(M.wall, R.x0 - 0.6, R.x0, R.y0, R.y1, R.z0, R.z1);
  box(M.wall, R.x1, R.x1 + 0.6, R.y0, R.y1, R.z0, R.z1);
  box(M.wall, R.x0, R.x1, R.y0, R.y1, R.z1, R.z1 + 0.6);

  // back wall: tiles up to the sill, then the window, then the lintel
  const W = WINDOW,
    zb0 = R.z0 - 0.6,
    zb1 = R.z0;
  box(M.tile, R.x0, R.x1, R.y0, W.sill, zb0, zb1, { uv: 1.5 });
  box(M.wall, R.x0, R.x1, W.head, R.y1, zb0, zb1);
  box(M.wall, R.x0, W.x0, W.sill, W.head, zb0, zb1);
  box(M.wall, W.x1, R.x1, W.sill, W.head, zb0, zb1);

  return { group, materials: M };
}
