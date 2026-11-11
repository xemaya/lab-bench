import * as THREE from 'three';
import { cm } from '../../bench/look.js';
import { GAP } from './physics/motor.js';

// The apparatus on the table, as a school lab has it: a demonstration motor with everything in the open (two
// magnets, a coil on a shaft, a split-ring commutator, two brushes), a two-cell battery holder, a knife switch, a
// sliding rheostat, and leads with banana plugs joining them into one loop.
//
// Frame: the shaft is the z axis and points at the viewer; the magnets stand left and right (the field runs along
// x); y is up. Same frame as physics/motor.js, so an angle or a force from there can be used here unchanged.
// Sizes are written in centimetres through cm().
//
// Everything that moves is driven from outside through the setters on the returned object. Nothing here knows
// why a part moves.

export const AXIS_Y = cm(8); // height of the shaft above the table
const COIL = { r: cm(2.6), z0: cm(-3.4), z1: cm(2.4), wire: cm(0.075), pitch: cm(0.16) }; // r: shaft to a long side
const MAGNET = { w: cm(3), h: cm(6.4), d: cm(6), near: cm(4.0), far: cm(8.3) }; // near/far: inner face to shaft at full / no field
const POST = { x: cm(7.5), y: cm(2.5), z: cm(5.4) }; // the motor's two binding posts (left is -x)

const std = (color, roughness, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const MAT = {
  bakelite: std(0x2b1e18, 0.38),
  black: std(0x17181b, 0.55),
  steel: std(0xb4b8be, 0.32, 1),
  darkSteel: std(0x55585e, 0.45, 1),
  brass: std(0xc8a24a, 0.3, 1),
  copper: std(0xc9794c, 0.3, 1),
  enamel: std(0xb4581f, 0.36, 1),
  carbon: std(0x1c1c1f, 0.85),
  ivory: std(0xe6e1d2, 0.6),
  red: std(0xc3271b, 0.5),
  white: std(0xf2f0ea, 0.55),
  ceramic: std(0xdad6cb, 0.5),
  insulator: std(0x3a2a22, 0.6),
};

function mesh(geometry, material, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
const box = (w, h, d, material, parent, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), material, parent, x, y, z);
// a cylinder along 'x', 'y' or 'z'
function rod(radius, length, axis, material, parent, x, y, z, segments = 20) {
  const g = new THREE.CylinderGeometry(radius, radius, length, segments);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  return mesh(g, material, parent, x, y, z);
}
// a flat plate with rounded corners and softened edges, lying on the table: its top is at y = h
function slab(w, h, d, radius, material, parent, x = 0, z = 0) {
  const s = new THREE.Shape(),
    a = w / 2,
    b = d / 2;
  s.moveTo(-a + radius, -b);
  s.lineTo(a - radius, -b);
  s.quadraticCurveTo(a, -b, a, -b + radius);
  s.lineTo(a, b - radius);
  s.quadraticCurveTo(a, b, a - radius, b);
  s.lineTo(-a + radius, b);
  s.quadraticCurveTo(-a, b, -a, b - radius);
  s.lineTo(-a, -b + radius);
  s.quadraticCurveTo(-a, -b, -a + radius, -b);
  const bevel = Math.min(h * 0.18, cm(0.15));
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); // extrusion along +y
  return mesh(g, material, parent, x, bevel, z);
}
// paint with a letter or a mark on it, the same colour as the plain faces around it
function lettered(color, text, size = 0.62) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#' + new THREE.Color(color).getHexString();
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f4f1ea';
  g.font = `700 ${Math.round(128 * size)}px "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.45 });
}
// an invisible box to click on: never drawn, casts nothing (the raycaster ignores visibility)
function hitBox(w, h, d, parent, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT.black);
  m.position.set(x, y, z);
  m.visible = false;
  parent.add(m);
  return m;
}
// a binding post: a brass stud with a coloured knurled cap. Returns the point a plug goes into.
function bindingPost(parent, x, y, z, capMaterial) {
  rod(cm(0.28), cm(0.9), 'y', MAT.brass, parent, x, y + cm(0.45), z, 12);
  rod(cm(0.5), cm(0.55), 'y', capMaterial, parent, x, y + cm(0.95), z, 14);
  return new THREE.Vector3(x, y + cm(1.22), z);
}

// ---------------------------------------------------------------------------------------------------- the motor
function buildMotor(root) {
  const motor = new THREE.Group();
  motor.name = 'motor';
  root.add(motor);
  const baseTop = cm(1.6);
  slab(cm(21), baseTop, cm(14), cm(1.2), MAT.bakelite, motor, 0, cm(0.6));

  // bearings: two brass uprights with a bush the shaft runs in
  for (const z of [cm(-5.6), cm(6.5)]) {
    box(cm(1.3), AXIS_Y - baseTop + cm(0.2), cm(0.45), MAT.brass, motor, 0, (AXIS_Y + baseTop) / 2 - cm(0.3), z);
    rod(cm(0.48), cm(0.7), 'z', MAT.brass, motor, 0, AXIS_Y, z, 18);
  }

  // ---- magnets: two painted blocks on sliding pedestals. The pair lifts and turns half round to swap poles.
  const magnets = new THREE.Group(); // lifts and turns
  motor.add(magnets);
  const pedestals = [];
  const blocks = [];
  for (const side of [-1, 1]) {
    const color = side < 0 ? 0xc5241c : 0x1c4fb5,
      letter = side < 0 ? 'N' : 'S';
    const plain = std(color, 0.45),
      face = lettered(color, letter);
    // BoxGeometry faces: +x, -x, +y, -y, +z, -z. The inner face (toward the coil) stays plain.
    const mats = side < 0 ? [plain, face, face, plain, face, face] : [face, plain, face, plain, face, face];
    const block = mesh(new THREE.BoxGeometry(MAGNET.w, MAGNET.h, MAGNET.d), mats, magnets, 0, AXIS_Y, cm(-0.5));
    block.userData.side = side;
    blocks.push(block);
    const ped = box(MAGNET.w, AXIS_Y - MAGNET.h / 2 - baseTop, MAGNET.d - cm(1.2), MAT.darkSteel, motor, 0, (AXIS_Y - MAGNET.h / 2 + baseTop) / 2, cm(-0.5));
    pedestals.push(ped);
  }

  // ---- rotor: shaft, coil on two cross arms, split ring. Turns about z.
  const carrier = new THREE.Group(); // at the shaft: lifts with the rotor when the motor is pulled apart, never turns
  carrier.position.y = AXIS_Y;
  motor.add(carrier);
  const rotor = new THREE.Group();
  carrier.add(rotor);
  rod(cm(0.2), cm(14.8), 'z', MAT.steel, rotor, 0, 0, cm(0.6), 16);
  for (const z of [COIL.z0 + cm(0.5), COIL.z1 - cm(0.5)]) {
    box(COIL.r * 2 - cm(0.3), cm(0.42), cm(0.5), MAT.ivory, rotor, 0, 0, z);
    rod(cm(0.42), cm(0.7), 'z', MAT.ivory, rotor, 0, 0, z, 14);
  }
  const winding = new THREE.Group();
  rotor.add(winding);
  // one turn: a rounded rectangle in the coil's own plane (x across, z along the shaft)
  function loopPoints(dy, grow) {
    const r = COIL.r + grow,
      z0 = COIL.z0 - grow,
      z1 = COIL.z1 + grow,
      c = cm(0.45);
    const p = [];
    const corner = (cx, cz, a0) => {
      for (let i = 0; i <= 4; i++) {
        const a = a0 + (i / 4) * (Math.PI / 2);
        p.push(new THREE.Vector3(cx + Math.cos(a) * c, dy, cz + Math.sin(a) * c));
      }
    };
    corner(r - c, z1 - c, 0); // front right
    corner(-r + c, z1 - c, Math.PI / 2); // front left
    corner(-r + c, z0 + c, Math.PI); // back left
    corner(r - c, z0 + c, Math.PI * 1.5); // back right
    return p;
  }
  // The path charge takes round the coil when the current in side A is positive: toward the viewer (+z) along
  // side A at +x, across the front, away along side B, across the back.
  const coilPath = new THREE.CatmullRomCurve3(loopPoints(0, 0), true, 'catmullrom', 0.1);
  function setTurns(n) {
    for (const m of [...winding.children]) {
      winding.remove(m);
      m.geometry.dispose();
    }
    for (let i = 0; i < n; i++) {
      const dy = (i - (n - 1) / 2) * COIL.pitch;
      const curve = new THREE.CatmullRomCurve3(loopPoints(dy, (i % 2) * cm(0.05)), true, 'catmullrom', 0.1);
      mesh(new THREE.TubeGeometry(curve, 72, COIL.wire, 6, true), MAT.enamel, winding);
    }
    // a band of tape round each long side: red marks side A, white side B, so a side can be followed round
    const thick = n * COIL.pitch + cm(0.32);
    for (const [x, mat] of [
      [COIL.r, MAT.red],
      [-COIL.r, MAT.white],
    ])
      box(cm(0.42), thick, cm(1.1), mat, winding, x, 0, (COIL.z0 + COIL.z1) / 2);
  }
  // split ring: two copper halves on an insulating hub. Half A faces +x at angle 0 (so does side A).
  const ringZ = cm(4.25),
    ringLen = cm(1.3),
    ringR = cm(0.72);
  rod(cm(0.56), ringLen + cm(0.3), 'z', MAT.insulator, rotor, 0, 0, ringZ, 20);
  const halves = [];
  for (const [start, mat] of [
    [GAP, std(0xd4824f, 0.26, 1)],
    [Math.PI + GAP, std(0xcda455, 0.26, 1)],
  ]) {
    // a cylinder sector: its angle runs from +z toward +x before the turn onto the shaft, which puts
    // thetaStart = GAP .. PI - GAP on the +x side afterwards
    const g = new THREE.CylinderGeometry(ringR, ringR, ringLen, 28, 1, false, start, Math.PI - 2 * GAP);
    g.rotateX(Math.PI / 2);
    halves.push(mesh(g, mat, rotor, 0, 0, ringZ));
  }
  // the two wire ends, from the front of the coil to the halves
  for (const s of [-1, 1]) {
    const a = new THREE.Vector3(s * cm(0.5), 0, COIL.z1),
      b = new THREE.Vector3(s * cm(0.62), 0, ringZ - ringLen / 2);
    const g = new THREE.CylinderGeometry(COIL.wire, COIL.wire, a.distanceTo(b), 6);
    g.rotateX(Math.PI / 2);
    const lead = mesh(g, MAT.enamel, rotor, (a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    lead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize());
  }

  // ---- brushes: carbon blocks on brass arms, pressing on the ring from left and right
  const brushes = new THREE.Group();
  motor.add(brushes);
  const posts = {};
  for (const s of [-1, 1]) {
    box(cm(0.62), cm(0.6), cm(0.95), MAT.carbon, brushes, s * (ringR + cm(0.31)), AXIS_Y, ringZ);
    box(cm(1.5), cm(0.14), cm(0.7), MAT.brass, brushes, s * (ringR + cm(1.3)), AXIS_Y, ringZ); // spring arm
    box(cm(0.5), AXIS_Y - baseTop + cm(0.5), cm(0.7), MAT.brass, brushes, s * (ringR + cm(2.0)), (AXIS_Y + baseTop) / 2 + cm(0.25), ringZ); // upright
    // a strip on the base from the upright to the binding post
    const from = new THREE.Vector3(s * (ringR + cm(2.0)), baseTop + cm(0.06), ringZ),
      to = new THREE.Vector3(s * POST.x, baseTop + cm(0.06), POST.z);
    const strip = box(from.distanceTo(to), cm(0.1), cm(0.5), MAT.brass, brushes, (from.x + to.x) / 2, from.y, (from.z + to.z) / 2);
    strip.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x);
    posts[s < 0 ? 'left' : 'right'] = bindingPost(motor, s * POST.x, baseTop, POST.z, s < 0 ? MAT.red : MAT.black);
  }
  // how charge travels inside the motor from the left post to the left brush (the right side mirrors it)
  const feed = (s) =>
    new THREE.CatmullRomCurve3(
      [new THREE.Vector3(s * POST.x, baseTop + cm(0.3), POST.z), new THREE.Vector3(s * (ringR + cm(2.0)), baseTop + cm(0.3), ringZ), new THREE.Vector3(s * (ringR + cm(2.0)), AXIS_Y, ringZ), new THREE.Vector3(s * (ringR + cm(0.3)), AXIS_Y, ringZ)],
      false,
      'catmullrom',
      0.02,
    );

  // state: field 0..1 slides the magnets in and out, swap 0..1 lifts the pair and turns it half round,
  // explode 0..1 pulls the parts apart
  const pose = { field: 1, swap: 0, explode: 0 };
  const ease = (t) => t * t * (3 - 2 * t);
  function layout() {
    const half = MAGNET.near + (1 - pose.field) * (MAGNET.far - MAGNET.near) + pose.explode * cm(5);
    blocks.forEach((b) => (b.position.x = b.userData.side * (half + MAGNET.w / 2)));
    pedestals.forEach((p, i) => (p.position.x = (i ? 1 : -1) * (half + MAGNET.w / 2)));
    // swap: up, round, down
    const lift = Math.min(1, pose.swap * 3, (1 - pose.swap) * 3);
    magnets.position.y = ease(lift) * cm(9);
    magnets.rotation.y = ease(Math.min(1, Math.max(0, (pose.swap - 1 / 3) * 3))) * Math.PI;
    carrier.position.y = AXIS_Y + pose.explode * cm(8);
    brushes.position.z = pose.explode * cm(4.5);
  }
  setTurns(10);
  layout();

  const marks = (x, y, z, parent) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  return {
    group: motor,
    rotor,
    posts,
    coilPath,
    feeds: { left: feed(-1), right: feed(1) },
    setTurns,
    set(next) {
      Object.assign(pose, next);
      layout();
    },
    get gapHalf() {
      return MAGNET.near + (1 - pose.field) * (MAGNET.far - MAGNET.near);
    },
    // things to name and to click
    anchors: {
      magnetN: marks(0, MAGNET.h / 2 + cm(0.4), 0, blocks[0]),
      magnetS: marks(0, MAGNET.h / 2 + cm(0.4), 0, blocks[1]),
      coil: marks(0, COIL.r + cm(0.6), COIL.z0 + cm(0.5), carrier),
      commutator: marks(0, cm(1.3), ringZ, carrier),
      brush: marks(ringR + cm(1.6), AXIS_Y + cm(0.7), ringZ, brushes),
      shaft: marks(0, cm(0.6), cm(-6.4), carrier),
      sideA: marks(COIL.r, 0, (COIL.z0 + COIL.z1) / 2, rotor),
      sideB: marks(-COIL.r, 0, (COIL.z0 + COIL.z1) / 2, rotor),
      ring: marks(0, 0, ringZ, rotor),
      shaftTip: marks(0, 0, cm(7.6), rotor),
    },
    hits: {
      magnets: blocks,
      coil: [hitBox(COIL.r * 2 + cm(1), cm(2.4), COIL.z1 - COIL.z0 + cm(1), rotor, 0, 0, (COIL.z0 + COIL.z1) / 2)],
      posts: [-1, 1].map((s) => hitBox(cm(2.6), cm(4.5), cm(2.6), motor, s * POST.x, baseTop + cm(2), POST.z)),
    },
    coil: COIL,
  };
}

// ---------------------------------------------------------------------------------------------- battery holder
function buildBattery(root, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  root.add(g);
  const len = cm(13.4),
    r = cm(1.65);
  slab(len + cm(1.6), cm(1.1), cm(4.4), cm(0.5), MAT.black, g);
  for (const s of [-1, 1]) {
    box(cm(0.5), cm(3.4), cm(3.8), MAT.black, g, s * (len / 2 + cm(0.45)), cm(1.7), 0);
    box(cm(0.12), cm(1.6), cm(1.6), MAT.steel, g, s * (len / 2 + cm(0.15)), cm(1.1) + r, 0); // contact plate
  }
  // two D cells end to end, positive caps toward -x
  const wrap = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 256; // v runs along the cell
    const k = c.getContext('2d');
    k.fillStyle = '#1b1c20';
    k.fillRect(0, 0, 64, 256);
    k.fillStyle = '#d98a1c';
    k.fillRect(0, 0, 64, 96);
    k.fillStyle = '#e9e6dd';
    k.fillRect(0, 96, 64, 6);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.35, metalness: 0.2 });
  })();
  for (const cx of [-len / 4, len / 4]) {
    const cell = new THREE.CylinderGeometry(r, r, len / 2 - cm(0.7), 28);
    cell.rotateZ(Math.PI / 2); // the texture's top (the orange end) points to -x
    mesh(cell, wrap, g, cx + cm(0.1), cm(1.1) + r, 0);
    rod(cm(0.48), cm(0.28), 'x', MAT.steel, g, cx - len / 4 + cm(0.32), cm(1.1) + r, 0, 14); // positive cap
    rod(r * 0.96, cm(0.06), 'x', MAT.steel, g, cx + len / 4 - cm(0.24), cm(1.1) + r, 0, 28);
  }
  const plus = bindingPost(g, -len / 2 - cm(0.45), cm(3.4), 0, MAT.red),
    minus = bindingPost(g, len / 2 + cm(0.45), cm(3.4), 0, MAT.black);
  g.updateMatrixWorld(true);
  const anchor = new THREE.Object3D();
  anchor.position.set(0, cm(5), 0);
  g.add(anchor);
  return { group: g, plus: plus.applyMatrix4(g.matrixWorld), minus: minus.applyMatrix4(g.matrixWorld), anchor };
}

// ------------------------------------------------------------------------------------------------ knife switch
function buildSwitch(root, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  root.add(g);
  const top = cm(1.0);
  slab(cm(10.4), top, cm(4), cm(0.6), MAT.bakelite, g);
  const hingeX = cm(3),
    clipX = cm(-3);
  // hinge and clip: pairs of brass cheeks the blade sits between
  for (const [px, h] of [
    [hingeX, cm(1.5)],
    [clipX, cm(1.3)],
  ])
    for (const dz of [-1, 1]) box(cm(0.9), h, cm(0.12), MAT.brass, g, px, top + h / 2, dz * cm(0.22));
  const blade = new THREE.Group();
  blade.position.set(hingeX, top + cm(1.0), 0);
  g.add(blade);
  box(cm(7.2), cm(0.7), cm(0.16), MAT.copper, blade, cm(-3.2), 0, 0);
  rod(cm(0.42), cm(2.2), 'y', MAT.black, blade, cm(-6.4), cm(1.0), 0, 14); // handle
  rod(cm(0.2), cm(0.7), 'z', MAT.steel, blade, 0, 0, 0, 10); // pivot pin
  // terminals at the front edge, clear of the blade: one wired to the clip, one to the hinge
  const tIn = bindingPost(g, cm(-4.4), top, cm(1.35), MAT.brass),
    tOut = bindingPost(g, cm(4.4), top, cm(1.35), MAT.brass);
  g.updateMatrixWorld(true);
  const anchor = new THREE.Object3D();
  anchor.position.set(0, cm(4.6), 0);
  g.add(anchor);
  const hit = hitBox(cm(10.4), cm(7), cm(4.4), g, 0, cm(3.5), 0);
  return {
    group: g,
    in: tIn.applyMatrix4(g.matrixWorld),
    out: tOut.applyMatrix4(g.matrixWorld),
    anchor,
    hit,
    // 0 closed (blade in the clip) .. 1 open (blade swung up)
    setOpen(k) {
      blade.rotation.z = -k * 0.95;
    },
    // across the blade, from the in terminal to the out terminal
    path: new THREE.LineCurve3(new THREE.Vector3(x + clipX, top + cm(1.0), z), new THREE.Vector3(x + hingeX, top + cm(1.0), z)),
  };
}

// --------------------------------------------------------------------------------------------- sliding rheostat
function buildRheostat(root, x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  root.add(g);
  const half = cm(6.5),
    tubeY = cm(2.0),
    rodY = cm(4.7);
  for (const s of [-1, 1]) slab(cm(1.0), cm(5.6), cm(3.4), cm(0.3), MAT.black, g, s * half, 0); // end brackets
  // resistance wire wound on a ceramic tube: fine turns, drawn as stripes
  const turns = (() => {
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 512;
    const k = c.getContext('2d');
    for (let i = 0; i < 512; i += 4) {
      k.fillStyle = i % 8 ? '#8f8c86' : '#b9b6ae';
      k.fillRect(0, i, 8, 4);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, metalness: 0.6 });
  })();
  const tube = new THREE.CylinderGeometry(cm(1.25), cm(1.25), half * 2 - cm(1.0), 32);
  tube.rotateZ(Math.PI / 2);
  mesh(tube, turns, g, 0, tubeY, 0);
  rod(cm(1.05), half * 2 - cm(0.6), 'x', MAT.ceramic, g, 0, tubeY, 0, 24);
  rod(cm(0.22), half * 2 + cm(0.6), 'x', MAT.steel, g, 0, rodY, 0, 12); // the bar the slider rides on
  const slider = new THREE.Group();
  g.add(slider);
  box(cm(1.3), cm(1.2), cm(1.5), MAT.brass, slider, 0, rodY - cm(0.1), 0);
  box(cm(0.5), rodY - tubeY - cm(1.6), cm(0.9), MAT.brass, slider, 0, (rodY + tubeY + cm(1.25)) / 2 - cm(0.4), 0); // contact
  rod(cm(0.55), cm(0.9), 'y', MAT.black, slider, 0, rodY + cm(0.95), 0, 14); // knob
  const run = [-half + cm(1.4), half - cm(1.4)]; // slider travel; the wire terminal is at the -x end
  box(cm(1.0), cm(0.5), cm(1.3), MAT.brass, g, -half, cm(0.25), cm(2.3)); // foot of the wire-end terminal
  const a = bindingPost(g, -half, cm(0.5), cm(2.4), MAT.black); // wire end
  const c = bindingPost(g, half, cm(5.6), 0, MAT.brass); // bar end, on top of the bracket
  g.updateMatrixWorld(true);
  const anchor = new THREE.Object3D();
  anchor.position.set(0, cm(7), 0);
  g.add(anchor);
  let at = run[0];
  return {
    group: g,
    a: a.applyMatrix4(g.matrixWorld),
    c: c.applyMatrix4(g.matrixWorld),
    anchor,
    // full current: slider at the wire end (no resistance wire in the loop). Less current: further along.
    setCurrent(fraction) {
      at = run[0] + (1 - Math.min(1, Math.max(0, fraction))) * (run[1] - run[0]);
      slider.position.x = at;
    },
    // from the wire end along the tube to the slider, up the contact, along the bar to the far end
    path() {
      const p = (px, py) => new THREE.Vector3(x + px, py, z);
      return new THREE.CatmullRomCurve3([p(-half, tubeY + cm(1.3)), p(at, tubeY + cm(1.3)), p(at, rodY), p(half, rodY)], false, 'catmullrom', 0.02);
    },
  };
}

// ------------------------------------------------------------------------------------------------------- leads
// A lead is a flexible wire with a banana plug at each end. `route(k)` gives the points it passes through; k lets
// one end move from one post to another (swapping the leads at the motor).
function buildLead(root, color, route) {
  const wireMat = std(color, 0.5),
    plugMat = std(color, 0.4);
  const g = new THREE.Group();
  root.add(g);
  const tube = mesh(new THREE.BufferGeometry(), wireMat, g);
  const plugs = [0, 1].map(() => rod(cm(0.34), cm(1.5), 'y', plugMat, g, 0, 0, 0, 12));
  let curve = null;
  function shape(k) {
    const pts = route(k);
    // a plug stands on its post; the wire leaves the top of the plug
    const up = cm(1.5);
    plugs[0].position.copy(pts[0]).y += up / 2;
    plugs[1].position.copy(pts[pts.length - 1]).y += up / 2;
    const all = [pts[0].clone().setY(pts[0].y + up), ...pts.slice(1, -1), pts[pts.length - 1].clone().setY(pts[pts.length - 1].y + up)];
    curve = new THREE.CatmullRomCurve3(all, false, 'catmullrom', 0.35);
    tube.geometry.dispose();
    tube.geometry = new THREE.TubeGeometry(curve, 56, cm(0.19), 7, false);
  }
  shape(0);
  return {
    shape,
    get curve() {
      return curve;
    },
  };
}

// ============================================================================================================
export function buildApparatus() {
  const root = new THREE.Group();
  root.name = 'apparatus';
  const motor = buildMotor(root);
  const battery = buildBattery(root, cm(-21), cm(-7.5));
  const knife = buildSwitch(root, cm(-22.5), cm(8.5));
  const rheostat = buildRheostat(root, cm(22.5), cm(7.5));
  root.updateMatrixWorld(true);

  const V = (x, y, z) => new THREE.Vector3(cm(x), cm(y), cm(z));
  const table = 0.45; // cm: a wire lying on the table
  const L = motor.posts.left,
    R = motor.posts.right;
  // an end that moves between the two motor posts: straight across, lifted clear of the motor on the way
  const hop = (from, to, k) => {
    const e = k * k * (3 - 2 * k);
    return new THREE.Vector3().lerpVectors(from, to, e).add(new THREE.Vector3(0, Math.sin(e * Math.PI) * cm(3.5), Math.sin(e * Math.PI) * cm(4.5)));
  };
  const mix = (a, b, k) => a.clone().lerp(b, k * k * (3 - 2 * k));

  const leads = {
    // battery + to the switch, down the left side of the table
    supply: buildLead(root, 0xc3271b, () => [battery.plus, V(-30.5, table, -4), V(-30, table, 4), knife.in]),
    // switch to the motor: to the left post, or (leads swapped) along the front to the right post
    feed: buildLead(root, 0xc3271b, (k) => [knife.out, mix(V(-14.5, table, 11), V(-10, table, 12.5), k), mix(V(-10.5, table, 8.5), V(4, table, 11.5), k), hop(L, R, k)]),
    // motor to the rheostat: from the right post, or (swapped) from the left post round the front
    drain: buildLead(root, 0x17181b, (k) => [hop(R, L, k), mix(V(10.5, table, 9.5), V(-3, table, 14.5), k), mix(V(13, table, 11.5), V(11, table, 14), k), rheostat.a]),
    // rheostat back to battery -, round the back of the table
    back: buildLead(root, 0x17181b, () => [rheostat.c, V(31.5, 3, 5), V(32, table, -3), V(26, table, -12), V(6, table, -14), V(-8, table, -12.5), V(-13.5, table, -11), battery.minus]),
  };

  return {
    group: root,
    motor,
    battery,
    knife,
    rheostat,
    leads,
    // 0: red lead on the left post; 1: the two leads have changed places
    setSwap(k) {
      leads.feed.shape(k);
      leads.drain.shape(k);
    },
    anchors: { ...motor.anchors, battery: battery.anchor, switch: knife.anchor, rheostat: rheostat.anchor },
  };
}
