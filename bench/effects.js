import * as THREE from 'three';
import { mulberry32 } from '../engine/index.js';

// Gas bubbles forming on a solid and rising through a liquid. One instanced draw call for every bubble on the bench.
// A bubble is born on a source's surface, clings and grows for a moment, lets go, rises, sits at the surface, pops.
export function createBubbles(max = 320, seed = 3) {
  const rng = mulberry32(seed);
  const geometry = new THREE.SphereGeometry(1, 10, 7);
  // bright beads: inside a transmissive liquid only opaque things are refracted, so bubbles are drawn opaque
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.12, metalness: 0, emissive: 0xaab4bc });
  const mesh = new THREE.InstancedMesh(geometry, material, max);
  mesh.name = 'bubbles';
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.count = 0;
  const B = [];
  for (let i = 0; i < max; i++) B.push({ on: false, x: 0, y: 0, z: 0, r: 0, r1: 0, age: 0, stick: 0, vy: 0, ph: 0, top: 0, pool: null });
  const m4 = new THREE.Matrix4();

  // sources: [{ position: Vector3, radius }] ; pool: { x, z, radius, level } of the liquid they sit in
  function emit(dt, rate, sources, pool) {
    if (!sources.length || rate <= 0) return;
    pool.bubbleDebt = (pool.bubbleDebt || 0) + rate * dt;
    while (pool.bubbleDebt >= 1) {
      pool.bubbleDebt -= 1;
      const b = B.find((q) => !q.on);
      if (!b) return;
      const s = sources[Math.floor(rng() * sources.length)];
      // a point on the upper two thirds of the source
      const th = rng() * Math.PI * 2,
        cy = -0.25 + rng() * 1.25,
        sr = Math.sqrt(Math.max(0, 1 - Math.min(1, cy) ** 2));
      b.on = true;
      b.x = s.position.x + Math.cos(th) * sr * s.radius;
      b.z = s.position.z + Math.sin(th) * sr * s.radius;
      b.y = s.position.y + Math.min(1, cy) * s.radius * 0.8;
      b.r1 = 0.011 + rng() * rng() * 0.022; // 1 - 3 mm
      b.r = b.r1 * 0.25;
      b.age = 0;
      b.stick = 0.08 + rng() * 0.55;
      b.vy = 0.55 + b.r1 * 28 + rng() * 0.25;
      b.ph = rng() * 6.28;
      b.top = 0.12 + rng() * 0.5;
      b.pool = pool;
    }
  }

  function update(dt) {
    let n = 0;
    for (const b of B) {
      if (!b.on) continue;
      b.age += dt;
      const p = b.pool;
      if (b.age < b.stick) b.r = b.r1 * (0.25 + 0.75 * (b.age / b.stick));
      else {
        b.r = b.r1;
        const surface = p.level - b.r * 0.35;
        if (b.y < surface) {
          b.y = Math.min(surface, b.y + b.vy * dt);
          b.x += Math.sin(b.age * 9 + b.ph) * 0.06 * dt;
          b.z += Math.cos(b.age * 7.3 + b.ph) * 0.06 * dt;
        } else {
          // at the surface: drift outward a little, then pop
          b.top -= dt;
          if (b.top <= 0) {
            b.on = false;
            continue;
          }
          b.x += (b.x - p.x) * 0.5 * dt;
          b.z += (b.z - p.z) * 0.5 * dt;
        }
        const dx = b.x - p.x,
          dz = b.z - p.z,
          d = Math.hypot(dx, dz),
          lim = p.radius - b.r - 0.004;
        if (d > lim) {
          b.x = p.x + (dx / d) * lim;
          b.z = p.z + (dz / d) * lim;
        }
      }
      m4.makeScale(b.r, b.r, b.r).setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(n++, m4);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }
  // pool given: only the bubbles in that vessel
  function clear(pool = null) {
    for (const b of B) if (!pool || b.pool === pool) b.on = false;
    if (pool) pool.bubbleDebt = 0;
  }
  return { mesh, emit, update, clear, get alive() { return mesh.count; } };
}

// A precipitate forming in a solution: soft flecks that appear where two solutions meet, drift down and pile up on
// the bottom. `palette` is a list of [age in seconds, [r, g, b]] stops, so a precipitate can change colour as it
// ages (iron(II) hydroxide: white, grey-green, red-brown).
export function createFlocs(max = 900, seed = 9) {
  const rng = mulberry32(seed);
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 }), max);
  mesh.name = 'flocs';
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.count = 0;
  const F = [];
  for (let i = 0; i < max; i++) F.push({ on: false, x: 0, y: 0, z: 0, r: 0, vx: 0, vz: 0, vy: 0, restY: 0, age: 0, spin: 0, pool: null, palette: null });
  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    v = new THREE.Vector3(),
    sc = new THREE.Vector3(),
    col = new THREE.Color();
  mesh.setColorAt(0, col.setRGB(1, 1, 1));

  function sample(palette, age) {
    let a = palette[0];
    for (const b of palette) {
      if (age <= b[0]) {
        const t = b[0] === a[0] ? 0 : (age - a[0]) / (b[0] - a[0]);
        return col.setRGB(a[1][0] + (b[1][0] - a[1][0]) * t, a[1][1] + (b[1][1] - a[1][1]) * t, a[1][2] + (b[1][2] - a[1][2]) * t);
      }
      a = b;
    }
    return col.setRGB(a[1][0], a[1][1], a[1][2]);
  }

  // at: { x, y, z } where the precipitate is forming; pool: { x, z, radius, floorY } of the vessel
  function emit(dt, rate, at, palette, pool) {
    pool.flocDebt = (pool.flocDebt || 0) + rate * dt;
    while (pool.flocDebt >= 1) {
      pool.flocDebt -= 1;
      const f = F.find((k) => !k.on);
      if (!f) return;
      f.on = true;
      f.r = 0.012 + rng() * 0.02;
      f.x = at.x + (rng() - 0.5) * 0.06;
      f.z = at.z + (rng() - 0.5) * 0.06;
      f.y = at.y - rng() * 0.03;
      f.vx = (rng() - 0.5) * 0.12;
      f.vz = (rng() - 0.5) * 0.12;
      f.vy = 0.09 + rng() * 0.13;
      pool.flocPile = Math.min(0.1, (pool.flocPile || 0.01) + 0.00028); // the layer on the bottom grows
      f.restY = pool.floorY + f.r * 0.5 + rng() * pool.flocPile;
      f.age = 0;
      f.spin = rng() * 6.28;
      f.pool = pool;
      f.palette = palette;
    }
  }
  // ageDt: how much older the precipitate gets (follows the reaction-speed control); dt moves it
  function update(dt, ageDt = dt) {
    let n = 0;
    for (const f of F) {
      if (!f.on) continue;
      f.age += ageDt;
      if (f.y > f.restY) {
        f.y = Math.max(f.restY, f.y - f.vy * dt);
        f.x += f.vx * dt;
        f.z += f.vz * dt;
        f.vx *= Math.exp(-0.8 * dt);
        f.vz *= Math.exp(-0.8 * dt);
        const p = f.pool,
          dx = f.x - p.x,
          dz = f.z - p.z,
          d = Math.hypot(dx, dz),
          lim = p.radius - f.r - 0.01;
        if (d > lim) {
          f.x = p.x + (dx / d) * lim;
          f.z = p.z + (dz / d) * lim;
        }
      }
      const grow = Math.min(1, 0.3 + f.age * 1.4);
      q.setFromEuler(e.set(f.spin, f.spin * 1.7, 0));
      m4.compose(v.set(f.x, f.y, f.z), q, sc.set(f.r * grow, f.r * grow * 0.7, f.r * grow));
      mesh.setMatrixAt(n, m4);
      mesh.setColorAt(n, sample(f.palette, f.age));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }
  function clear(pool = null) {
    for (const f of F) if (!pool || f.pool === pool) f.on = false;
    if (pool) pool.flocDebt = pool.flocPile = 0;
  }
  return { mesh, emit, update, clear, get alive() { return mesh.count; } };
}

// Metal whose wetted part slowly grows a deposit of another metal (iron in copper sulfate turns copper red).
// `uniforms.progress` 0..1 drives it; only fragments below `uniforms.level` (world y) are coated.
export function makeCoatingMetal({ color = 0x8b8e93, roughness = 0.46, coat = [0.62, 0.2, 0.09], coatRoughness = 0.8 } = {}) {
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness: 1 });
  const uniforms = { progress: { value: 0 }, level: { value: -1e3 }, coat: { value: new THREE.Color().setRGB(coat[0], coat[1], coat[2]) }, coatRough: { value: coatRoughness } };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLabProgress = uniforms.progress;
    shader.uniforms.uLabLevel = uniforms.level;
    shader.uniforms.uLabCoat = uniforms.coat;
    shader.uniforms.uLabCoatRough = uniforms.coatRough;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vLabWorld;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\n vLabWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', /* glsl */ `varying vec3 vLabWorld; uniform float uLabProgress, uLabLevel, uLabCoatRough; uniform vec3 uLabCoat;
        float labHash(vec3 p){ return fract(sin(dot(floor(p), vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float labCoat(){
          // the deposit starts as specks and closes into a matte crust
          float n = labHash(vLabWorld * 260.0) * 0.6 + labHash(vLabWorld * 90.0) * 0.4;
          float wet = smoothstep(uLabLevel + 0.012, uLabLevel - 0.012, vLabWorld.y);
          return wet * smoothstep(n - 0.25, n + 0.1, uLabProgress * 1.35);
        }
        void main() {`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n float labK = labCoat(); diffuseColor.rgb = mix(diffuseColor.rgb, uLabCoat, labK);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, uLabCoatRough, labK);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = mix(metalnessFactor, 0.55, labK);');
  };
  material.customProgramCacheKey = () => 'lab-coating-metal';
  return { material, uniforms };
}
