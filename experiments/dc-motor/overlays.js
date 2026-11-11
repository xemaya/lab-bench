import * as THREE from 'three';
import { cm } from '../../bench/look.js';
import { AXIS_Y } from './apparatus.js';
import { coilCurrent, sideForces, direction, onRightBrush } from './physics/motor.js';

// The things a teacher draws on the board, drawn on the apparatus instead: which way the current runs, the field
// between the magnets, the force on each side of the coil, which way it turns, and the three directions of the
// left-hand rule. They are diagrams, not objects: flat colour, no shadows, and every one can be switched off.
// All directions come from physics/motor.js; nothing here decides anything.
export const COLORS = { field: 0x2f7dff, current: 0xff6a1a, force: 0x18b85a, turn: 0xf0aa14 };

const UP = new THREE.Vector3(0, 1, 0);
const flat = (color) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });

// an arrow that can be re-aimed every frame
function makeArrow(material, radius) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 10).translate(0, 0.5, 0), material);
  const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.6, radius * 7, 14).translate(0, radius * 3.5, 0), material);
  g.add(shaft, head);
  const tip = new THREE.Vector3();
  return {
    group: g,
    tip, // world position of the point, for a letter next to it
    set(from, dir, length) {
      g.visible = length > 1e-4;
      if (!g.visible) return;
      const body = Math.max(1e-4, length - radius * 7);
      shaft.scale.y = body;
      head.position.y = body;
      g.position.copy(from);
      g.quaternion.setFromUnitVectors(UP, dir);
      tip.copy(from).addScaledVector(dir, length + radius * 4);
    },
  };
}

export function createOverlays(apparatus) {
  const { motor, knife, rheostat, leads } = apparatus;
  const group = new THREE.Group();
  group.name = 'overlays';
  const M = { field: flat(COLORS.field), current: flat(COLORS.current), force: flat(COLORS.force), turn: flat(COLORS.turn) };
  // The beads ride on copper and on red leads, where plain orange disappears. Brighter than white, they pick up a
  // little bloom from the lens and read as lit from inside.
  const glow = new THREE.MeshBasicMaterial();
  glow.color.setRGB(2.1, 0.8, 0.16);

  // ---- field: straight lines from the N face to the S face, more of them the stronger the field
  const field = new THREE.Group();
  field.position.y = AXIS_Y;
  group.add(field);
  const lineGeo = new THREE.CylinderGeometry(cm(0.045), cm(0.045), 1, 6).rotateZ(Math.PI / 2);
  const coneGeo = new THREE.ConeGeometry(cm(0.2), cm(0.7), 10).rotateZ(-Math.PI / 2); // points +x
  const lines = [];
  for (const y of [0, 1.5, -1.5, 3, -3])
    for (const z of [-0.5, -2.7, 1.7]) {
      const line = new THREE.Mesh(lineGeo, M.field);
      line.position.set(0, cm(y * 0.9), cm(z));
      const cone = new THREE.Mesh(coneGeo, M.field);
      cone.position.copy(line.position);
      field.add(line, cone);
      lines.push({ line, cone });
    }

  // ---- forces on the two long sides, the turning direction, the left-hand triad
  const forceA = makeArrow(M.force, cm(0.13)),
    forceB = makeArrow(M.force, cm(0.13));
  const hand = { B: makeArrow(M.field, cm(0.12)), I: makeArrow(M.current, cm(0.12)), F: makeArrow(M.force, cm(0.15)) };
  group.add(forceA.group, forceB.group, hand.B.group, hand.I.group, hand.F.group);
  const turn = new THREE.Group(); // drawn for anticlockwise; mirrored for clockwise
  {
    const R = cm(1.7),
      arc = Math.PI * 1.5;
    turn.add(new THREE.Mesh(new THREE.TorusGeometry(R, cm(0.1), 8, 48, arc), M.turn));
    const head = new THREE.Mesh(new THREE.ConeGeometry(cm(0.3), cm(0.85), 12), M.turn);
    head.position.set(R * Math.cos(arc), R * Math.sin(arc), 0);
    head.rotation.z = arc;
    turn.add(head);
    turn.position.z = cm(8.3);
  }
  group.add(turn);

  // ---- current: beads running the way conventional current flows, round the whole loop
  const BEAD = cm(1.7); // spacing
  const beads = new THREE.InstancedMesh(new THREE.SphereGeometry(cm(0.27), 10, 8), glow, 420); // fatter than a lead
  beads.frustumCulled = false;
  beads.count = 0;
  group.add(beads);
  // in order from the positive pole; `back` runs the curve end to start, `frame` is the object the curve turns with
  const circuit = (p, iA) => {
    const inLeft = p.supply > 0; // the positive lead is on the left post
    return [
      { curve: leads.supply.curve },
      { curve: knife.path },
      { curve: leads.feed.curve },
      { curve: inLeft ? motor.feeds.left : motor.feeds.right },
      { curve: motor.coilPath, frame: motor.rotor, back: iA < 0 },
      { curve: inLeft ? motor.feeds.right : motor.feeds.left, back: true },
      { curve: leads.drain.curve },
      { curve: rheostat.path() },
      { curve: leads.back.curve },
    ];
  };
  const m4 = new THREE.Matrix4(),
    v = new THREE.Vector3(),
    a = new THREE.Vector3(),
    dir = new THREE.Vector3();
  let phase = 0;

  // p: the parameters in force right now (physics/motor.js); angle: rotor angle; layers: which overlays are on;
  // parts: { gapHalf, lift } where the magnets and the rotor currently are
  function update(dt, p, angle, layers, parts) {
    const iA = coilCurrent(p, angle),
      f = sideForces(p, angle),
      assembled = parts.lift < 1e-3;

    // field
    field.visible = layers.field && assembled && p.field > 0;
    if (field.visible) {
      field.scale.x = p.magnet; // mirrored when the poles are swapped: the arrowheads turn round
      const shown = Math.round(lines.length * (0.25 + 0.75 * p.field));
      lines.forEach(({ line, cone }, i) => {
        line.visible = cone.visible = i < shown;
        line.scale.x = parts.gapHalf * 2;
      });
    }

    // forces: always straight up or down; longer the stronger
    const drawForce = (arrow, anchor, side, on) => {
      const fy = side.force[1];
      if (!on || !assembled || Math.abs(fy) < 1e-4) return arrow.set(a, UP, 0);
      anchor.getWorldPosition(a);
      dir.set(0, Math.sign(fy), 0);
      arrow.set(a.addScaledVector(dir, cm(0.55)), dir, cm(1.3) + cm(3.4) * Math.abs(fy));
    };
    const right = onRightBrush(angle); // the side the triad is drawn on
    drawForce(forceA, motor.anchors.sideA, f.a, layers.force && !(layers.hand && right === 'A'));
    drawForce(forceB, motor.anchors.sideB, f.b, layers.force && !(layers.hand && right === 'B'));

    // left-hand rule: B, I and F drawn from one point on the right-hand side
    const side = right === 'A' ? f.a : right === 'B' ? f.b : null;
    const handOn = layers.hand && assembled && !!side && side.current !== 0 && p.field > 0;
    if (handOn) {
      (right === 'A' ? motor.anchors.sideA : motor.anchors.sideB).getWorldPosition(a);
      hand.B.set(v.copy(a), dir.set(p.magnet, 0, 0), cm(3.6));
      hand.I.set(v.copy(a), dir.set(0, 0, side.current), cm(3.6));
      hand.F.set(v.copy(a), dir.set(0, Math.sign(side.force[1]), 0), cm(3.6));
    } else for (const k in hand) hand[k].set(a, UP, 0);

    // turning direction
    const way = direction(p);
    turn.visible = layers.rotation && assembled && way !== 0;
    turn.position.y = AXIS_Y;
    turn.scale.x = way || 1;

    // current
    let n = 0;
    if (layers.current && assembled && iA !== 0) {
      phase += (dt * cm(7) * (0.3 + 0.7 * p.current)) / BEAD;
      for (const part of circuit(p, iA)) {
        const count = Math.max(1, Math.round(part.curve.getLength() / BEAD));
        for (let j = 0; j < count && n < beads.instanceMatrix.count; j++) {
          const u = (((j + phase) / count) % 1 + 1) % 1;
          part.curve.getPointAt(part.back ? 1 - u : u, v);
          if (part.frame) v.applyMatrix4(part.frame.matrixWorld);
          beads.setMatrixAt(n++, m4.makeTranslation(v.x, v.y, v.z));
        }
      }
    }
    beads.count = n;
    beads.instanceMatrix.needsUpdate = true;

    return { hand: handOn ? { B: hand.B.tip, I: hand.I.tip, F: hand.F.tip } : null, forceA: forceA.group.visible ? forceA.tip : null, forceB: forceB.group.visible ? forceB.tip : null };
  }

  return { group, update };
}
