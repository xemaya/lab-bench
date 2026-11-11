import * as THREE from 'three';
import { cm } from '../../bench/look.js';
import { makeCoatingMetal } from '../../bench/effects.js';

// The four metals as things you can pick up. Every piece is a `group` (its pose) holding a `body` (scaled as the
// metal is used up). `form` says how it behaves in a beaker:
//   lean  : long pieces (copper strip, iron nail) stand against the wall, partly above the liquid
//   sink  : zinc granules lie on the bottom
//   float : sodium rides on the surface
const UP = new THREE.Vector3(0, 1, 0);
const ALONG_X = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(1, 0, 0));
const TILTED = new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(0.3, 1, 0).normalize());

export const SOLIDS = {
  Na: { label: '钠块' },
  Zn: { label: '锌粒' },
  Fe: { label: '铁钉' },
  Cu: { label: '铜片' },
};

function shell(metal, form) {
  const group = new THREE.Group(),
    body = new THREE.Group();
  group.add(body);
  return { metal, form, group, body, coat: null, length: 0, floatRadius: 0, rest: new THREE.Quaternion(), hold: new THREE.Quaternion(), restOffset: new THREE.Vector3(), proxies: [], sources: () => {}, setDissolve: () => {}, setMolten: () => {} };
}
function finish(s) {
  s.group.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });
  // 0..1: fades the whole piece in (a refilled dish). Blended only while fading; it casts its shadow once it is
  // mostly there, since a shadow cannot fade.
  const meshes = [];
  s.group.traverse((o) => o.isMesh && meshes.push(o));
  s.setReveal = (k) => {
    for (const o of meshes) {
      const m = o.material;
      if (m.transparent !== k < 1) {
        m.transparent = k < 1;
        m.needsUpdate = true;
      }
      m.opacity = k;
      o.castShadow = k > 0.55;
    }
    s.group.visible = k > 0;
  };
  // generous invisible spheres to grab: fingers and projector pens are not precise (the raycaster ignores `visible`)
  const mat = new THREE.MeshBasicMaterial();
  s.picks = s.proxies.map(([x, y, z, r]) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat);
    m.visible = false;
    m.position.set(x, y, z);
    m.userData.solid = s;
    s.group.add(m);
    return m;
  });
  s.dispose = () => {
    s.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
  };
  return s;
}
// bubble sources along the wetted part of a long piece
function leanSources(s, radius) {
  const p = new THREE.Vector3();
  s.sources = (level, out) => {
    for (let i = 0; i < 6; i++) {
      p.set(0, s.length * (0.06 + 0.15 * i), 0);
      s.group.localToWorld(p);
      if (p.y < level - 0.03) out.push({ position: p.clone(), radius });
    }
  };
  s.setDissolve = (k) => s.body.scale.set(1 - 0.3 * k, 1, 1 - 0.3 * k);
}

function copperStrip() {
  const s = shell('Cu', 'lean');
  const L = (s.length = cm(8.5)),
    t = cm(0.12);
  const m = makeCoatingMetal({ color: 0xc8794e, roughness: 0.34 });
  s.coat = m.uniforms;
  const strip = new THREE.Mesh(new THREE.BoxGeometry(cm(1.4), L, t), m.material);
  strip.position.y = L / 2;
  s.body.add(strip);
  // lying flat: thickness up, length along x
  s.rest.setFromEuler(new THREE.Euler(Math.PI / 2, Math.PI / 2, 0, 'YXZ'));
  s.restOffset.set(-L / 2, t / 2 + cm(0.25), 0);
  s.hold.copy(TILTED);
  s.proxies = [0.15, 0.5, 0.85].map((k) => [0, L * k, 0, cm(1.5)]);
  leanSources(s, cm(0.5));
  return s;
}

function ironNail() {
  const s = shell('Fe', 'lean');
  const L = (s.length = cm(9));
  const m = makeCoatingMetal();
  s.coat = m.uniforms;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(cm(0.21), cm(0.21), L - cm(0.7), 14), m.material);
  shaft.position.y = cm(0.7) + (L - cm(0.7)) / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(cm(0.21), cm(0.7), 14), m.material);
  tip.rotation.x = Math.PI;
  tip.position.y = cm(0.35);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(cm(0.5), cm(0.5), cm(0.14), 18), m.material);
  head.position.y = L;
  s.body.add(shaft, tip, head);
  s.rest.copy(ALONG_X);
  s.restOffset.set(-L / 2, cm(0.6), 0);
  s.hold.copy(TILTED);
  s.proxies = [0.15, 0.5, 0.85].map((k) => [0, L * k, 0, cm(1.4)]);
  leanSources(s, cm(0.35));
  return s;
}

function zincGranules(rng) {
  const s = shell('Zn', 'sink');
  const m = makeCoatingMetal({ color: 0xb4b8be, roughness: 0.44 });
  s.coat = m.uniforms;
  const grains = [];
  for (let i = 0; i < 3; i++) {
    const r = cm(0.6 + rng() * 0.2);
    const g = new THREE.SphereGeometry(1, 14, 10);
    const p = g.attributes.position,
      seed = rng() * 20;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k),
        y = p.getY(k),
        z = p.getZ(k);
      const d = 1 + 0.2 * Math.sin(x * 4.1 + seed) * Math.sin(y * 3.3 + seed * 1.7) + 0.14 * Math.sin(z * 6.2 + seed * 0.6) * Math.sin(x * 5.4 - seed);
      p.setXYZ(k, x * d * r, y * d * r * 0.74, z * d * r);
    }
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, m.material);
    const a = (i / 3) * Math.PI * 2 + 0.4;
    mesh.position.set(Math.cos(a) * cm(1.15), r * 0.66, Math.sin(a) * cm(1.15));
    mesh.rotation.set(rng() * 6, rng() * 6, rng() * 0.6);
    s.body.add(mesh);
    grains.push({ mesh, r });
  }
  s.proxies = [[0, cm(0.5), 0, cm(2.3)]];
  const p = new THREE.Vector3();
  s.sources = (level, out) => {
    for (const g of grains) out.push({ position: g.mesh.getWorldPosition(p).clone(), radius: g.r * s.body.scale.x });
  };
  s.setDissolve = (k) => s.body.scale.setScalar(1 - 0.35 * k);
  return s;
}

function sodiumPiece(rng) {
  const s = shell('Na', 'float');
  const a = cm(0.95);
  s.floatRadius = cm(0.55);
  // a freshly cut block: soft, so the faces are a little uneven
  const g = new THREE.BoxGeometry(a, a * 0.8, a * 0.9, 2, 2, 2);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k),
      y = p.getY(k),
      z = p.getZ(k);
    const h = Math.sin(x * 37 + y * 19 + z * 11) * 0.5 + 0.5; // same value at coincident vertices: no cracks
    p.setXYZ(k, x * (0.93 + 0.1 * h), y * (0.95 + 0.08 * h), z * (0.93 + 0.1 * (1 - h)));
  }
  g.computeVertexNormals();
  const block = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xd6d7d9, roughness: 0.4, metalness: 1 }));
  block.position.y = a * 0.4;
  block.rotation.y = rng() * 0.6;
  // what it becomes on water: a bright molten bead
  const beadMat = new THREE.MeshStandardMaterial({ color: 0xf2f3f5, roughness: 0.08, metalness: 1, emissive: 0xffc070, emissiveIntensity: 0 });
  const bead = new THREE.Mesh(new THREE.SphereGeometry(s.floatRadius, 20, 14), beadMat);
  bead.position.y = s.floatRadius;
  bead.scale.setScalar(0.001);
  s.body.add(block, bead);
  s.proxies = [[0, a * 0.4, 0, cm(1.7)]];
  let molten = 0,
    used = 0;
  const apply = () => {
    block.scale.setScalar(Math.max(0.001, (1 - molten) * (1 - used)));
    bead.scale.setScalar(Math.max(0.001, molten * Math.pow(1 - used, 0.6)));
  };
  s.setMolten = (k) => {
    molten = k;
    apply();
  };
  s.setDissolve = (k) => {
    used = k;
    apply();
  };
  s.setGlow = (v) => (beadMat.emissiveIntensity = v);
  s.radiusNow = () => s.floatRadius * Math.pow(1 - used, 0.6);
  return s;
}

export function makeSolid(metal, rng) {
  const s = metal === 'Cu' ? copperStrip() : metal === 'Fe' ? ironNail() : metal === 'Zn' ? zincGranules(rng) : sodiumPiece(rng);
  return finish(s);
}
