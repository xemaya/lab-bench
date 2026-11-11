// Metal activity: four reagents in beakers, four metals on dishes. Carry a metal into a beaker and watch.
// What happens is decided by the rule engine (chem/judge.js); reaction.js acts its phenomena out. Nothing in this
// file knows any chemistry beyond which bottles and metals are on the bench.
import * as THREE from 'three';
import GUI from 'lil-gui';
import { createCineRenderer, QUALITY, mulberry32 } from '../../engine/index.js';
import { makeBenchLook, cm } from '../../bench/look.js';
import { buildRoom, ROOM } from '../../bench/room.js';
import { createBenchCamera } from '../../bench/camera.js';
import { createRoomLight } from '../../bench/environment.js';
import { makeBeaker, makeLiquid, makeDish, makeGlassMaterial } from '../../bench/glassware.js';
import { createBubbles, createFlocs } from '../../bench/effects.js';
import { createInteraction } from '../../bench/interaction.js';
import { makeSolid, SOLIDS } from './solids.js';
import { createReaction, SOLUTION } from './reaction.js';
import { judge } from './chem/judge.js';
import { DATA } from './chem/data.js';
import { pretty } from './chem/formula.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) && Number.isFinite(+q.get(k)) ? +q.get(k) : d);
const errBox = document.getElementById('err');
const showError = (m) => {
  errBox.style.display = 'block';
  errBox.textContent += m + '\n';
};
window.addEventListener('error', (e) => showError(String(e.message || e)));

const smooth = (t) => {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
};
const UP = new THREE.Vector3(0, 1, 0);

// left to right; the metals follow the activity series, most active first
const REAGENT_ORDER = ['HCl', 'H2SO4', 'CuSO4', 'FeSO4'];
const METAL_ORDER = ['Na', 'Zn', 'Fe', 'Cu'];
const SPACING = cm(17);
const LEVEL = cm(5.6); // liquid surface above the bench
const HOLD_Y = cm(13.5); // height metals are carried at: clear of every rim

// the engine's tiers size the shadow map for a 100 m frustum; here it covers one room, and small solids need it sharp
function benchQuality(name) {
  const base = QUALITY[name] || QUALITY.high;
  return { ...base, shadow: name === 'low' ? 2048 : 4096, shadowTaps: name === 'low' ? 16 : 32 };
}

function start() {
  const canvas = document.getElementById('view');
  const still = q.get('still') === '1';
  const state = {
    quality: q.get('q') || 'high',
    liquid: q.get('liquid') === 'simple' ? 'simple' : 'transmission',
    env: q.get('env') === 'sky' ? 'sky' : 'room',
    speed: num('speed', 1),
  };

  const cine = createCineRenderer({
    canvas,
    look: makeBenchLook(),
    quality: benchQuality(state.quality),
    fov: 30,
    near: 0.3,
    far: 600,
    shadow: { mode: 'box', min: [ROOM.x0 - 0.6, ROOM.y0 - 0.5, ROOM.z0 - 0.6], max: [ROOM.x1 + 0.6, ROOM.y1 + 0.6, ROOM.z1 + 0.6], softness: 0.6, searchTaps: 16 },
    dynamicResolution: !still && q.get('dynres') !== '0',
    targetFps: num('fps', 60),
    onError: showError,
  });
  cine.still = still;
  if (still) document.body.classList.add('still'); // screenshots: no fades to be caught half-way
  window.__cine = cine;
  const { scene, camera, renderer } = cine;

  scene.add(buildRoom().group);
  const stage = new THREE.Group();
  stage.name = 'apparatus';
  scene.add(stage);
  const rng = mulberry32(21);
  const fx = { bubbles: createBubbles(700), flocs: createFlocs(900) };
  stage.add(fx.bubbles.mesh, fx.flocs.mesh);

  // ---- vessels: one beaker per reagent ----
  const glass = makeGlassMaterial();
  const ringGeo = new THREE.RingGeometry(cm(4.3), cm(5.1), 48).rotateX(-Math.PI / 2);
  const hitMat = new THREE.MeshBasicMaterial();
  const vessels = REAGENT_ORDER.map((id, i) => {
    const reagent = DATA.reagents[id];
    const x = (i - (REAGENT_ORDER.length - 1) / 2) * SPACING;
    const beaker = makeBeaker({ glass });
    beaker.mesh.position.set(x, 0, 0);
    // target marker on the bench, lit while a metal hovers over this vessel
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffb640, transparent: true, opacity: 0, depthWrite: false }));
    ring.position.set(x, 0.006, 0);
    ring.renderOrder = 5;
    ring.visible = false;
    // what the pointer hits when it is "on" the vessel: the beaker and the air above its mouth, a little fat
    // (never drawn; the raycaster ignores visibility)
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(cm(4.6), cm(4.6), HOLD_Y + cm(2), 12), hitMat);
    hit.position.set(x, (HOLD_Y + cm(2)) / 2, 0);
    hit.visible = false;
    stage.add(beaker.mesh, ring, hit);
    const first = reagent.kind === 'salt' ? DATA.metals[reagent.metal].ionColor : 'colorless';
    const v = { id, reagent, beaker, x, z: 0, ring, hit, liquid: null, pool: null, startColor: first, mix: { from: first, to: first, k: 0 }, solid: null, reaction: null, aimed: 0 };
    hit.userData.vessel = v;
    v.setMix = (from, to, k) => {
      v.mix = { from, to, k };
      const a = SOLUTION[from],
        b = SOLUTION[to];
      v.liquid.setColor(
        a.color.map((c, n) => c + (b.color[n] - c) * k),
        a.density + (b.density - a.density) * k,
      );
    };
    return v;
  });
  function buildLiquids() {
    for (const v of vessels) {
      if (v.liquid) {
        stage.remove(v.liquid.mesh);
        v.liquid.mesh.geometry.dispose();
        v.liquid.material.dispose();
      }
      v.liquid = makeLiquid(v.beaker, LEVEL, { mode: state.liquid });
      v.liquid.mesh.position.set(v.x, 0, v.z);
      stage.add(v.liquid.mesh);
      // the same object across rebuilds: bubbles and precipitate already in the vessel keep pointing at it
      v.pool = Object.assign(v.pool || {}, { x: v.x, z: v.z, radius: v.liquid.radius, level: LEVEL, floorY: v.liquid.floorY });
      v.setMix(v.mix.from, v.mix.to, v.mix.k);
    }
  }
  buildLiquids();

  // ---- the supply: one dish per metal, always holding a fresh piece ----
  const TRAY_Z = cm(14.5);
  const slots = METAL_ORDER.map((metal, i) => {
    const x = (i - (METAL_ORDER.length - 1) / 2) * SPACING;
    const dish = makeDish({ radius: metal === 'Zn' || metal === 'Na' ? cm(4.4) : cm(5.8) });
    dish.mesh.position.set(x, 0, TRAY_Z);
    stage.add(dish.mesh);
    return { metal, x, z: TRAY_Z, floorY: dish.floorY, piece: null };
  });
  const solids = []; // every piece on the bench: on a dish, in the air, or in a vessel
  const restPose = (s) => ({ p: new THREE.Vector3(s.slot.x, s.slot.floorY, s.slot.z).add(s.restOffset), q: s.rest });
  // A dish refills after its piece has gone into a vessel. The new piece must not look like the old one snapping
  // back: it waits until the old one is in the liquid, then fades in. `appear` runs from -wait to 1.
  const APPEAR = { wait: 1.3, fade: 1.1 };
  function stock(slot, later = true) {
    const s = makeSolid(slot.metal, rng);
    Object.assign(s, { slot, vessel: null, state: 'tray', t: 0, vy: 0, appear: later ? -APPEAR.wait / APPEAR.fade : 1, to: null, from: { p: new THREE.Vector3(), q: new THREE.Quaternion() }, target: new THREE.Vector3() });
    const r = restPose(s);
    s.group.position.copy(r.p);
    s.group.quaternion.copy(r.q);
    if (later) s.setReveal(0);
    stage.add(s.group);
    solids.push(s);
    slot.piece = s;
    return s;
  }
  slots.forEach((slot) => stock(slot, false));
  function discard(s) {
    stage.remove(s.group);
    s.dispose();
    solids.splice(solids.indexOf(s), 1);
  }

  // where a piece ends up in a vessel, and the point above the rim it passes through on the way
  function posesIn(v, s) {
    const b = v.beaker;
    if (s.form !== 'lean') {
      const over = new THREE.Vector3(v.x + (rng() - 0.5) * cm(1.6), b.height + cm(2.2), v.z + (rng() - 0.5) * cm(1.6));
      return { over: { p: over, q: new THREE.Quaternion() }, inside: null };
    }
    const ri = b.innerRadius - cm(0.3);
    const a = 0.5; // lean toward the right and a little toward the viewer, so the wetted length faces the camera
    const lx = Math.cos(a),
      lz = Math.sin(a);
    const run = ri * 1.9,
      rise = Math.sqrt(Math.max(0.01, s.length * s.length - run * run));
    return {
      over: { p: new THREE.Vector3(v.x - lx * ri * 0.5, b.height + cm(2.5), v.z - lz * ri * 0.5), q: new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(lx * 0.35, 1, lz * 0.35).normalize()) },
      inside: { p: new THREE.Vector3(v.x - lx * ri * 0.92, b.floorY + cm(0.3), v.z - lz * ri * 0.92), q: new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(lx * run, rise, lz * run).normalize()) },
    };
  }
  const leave = (s, next) => {
    s.from.p.copy(s.group.position);
    s.from.q.copy(s.group.quaternion);
    s.state = next;
    s.t = 0;
  };
  function putIn(s, v) {
    v.solid = s;
    s.vessel = v;
    s.to = posesIn(v, s);
    leave(s, 'over');
    if (s.slot.piece === s) stock(s.slot); // the dish is never empty
    showVessel(v);
  }
  function sendBack(s) {
    s.to = restPose(s);
    leave(s, 'return');
  }
  function react(s) {
    const v = s.vessel;
    s.state = 'in';
    v.reaction = createReaction({ vessel: v, solid: s, outcome: judge(s.metal, v.id), fx, rng });
    if (shown === v) showVessel(v);
  }
  function empty(v) {
    if (v.solid) discard(v.solid);
    v.solid = v.reaction = null;
    fx.bubbles.clear(v.pool);
    fx.flocs.clear(v.pool);
    v.setMix(v.startColor, v.startColor, 0);
    if (shown === v) showVessel(null);
  }
  function reset() {
    for (const s of solids) if (s.state === 'held') sendBack(s);
    vessels.forEach(empty);
    hands.forget();
    say(null);
  }

  function updateSolids(dt) {
    for (const s of solids) {
      const g = s.group;
      if (s.appear < 1) {
        s.appear = Math.min(1, s.appear + dt / APPEAR.fade);
        s.setReveal(smooth(s.appear));
      }
      if (s.state === 'held') {
        const k = 1 - Math.exp(-16 * dt);
        g.position.lerp(s.target, k);
        g.quaternion.slerp(s.hold, k);
      } else if (s.state === 'return') {
        s.t += dt / 0.4;
        const u = smooth(s.t);
        g.position.lerpVectors(s.from.p, s.to.p, u);
        g.position.y += Math.sin(Math.min(1, s.t) * Math.PI) * cm(2);
        g.quaternion.slerpQuaternions(s.from.q, s.to.q, u);
        if (s.t >= 1) s.state = 'tray';
      } else if (s.state === 'over') {
        s.t += dt / 0.32;
        const u = smooth(s.t);
        g.position.lerpVectors(s.from.p, s.to.over.p, u);
        g.quaternion.slerpQuaternions(s.from.q, s.to.over.q, u);
        if (s.t >= 1) {
          leave(s, 'enter');
          s.vy = 0;
          if (s.coat) s.coat.level.value = LEVEL; // only what goes under the surface can be coated
          // nothing inside a vessel casts a sun shadow (see glassware.js): a nail's shadow leaving a beaker whose
          // glass and liquid cast none reads as dirt on the table
          g.traverse((o) => (o.castShadow = false));
        }
      } else if (s.state === 'enter') {
        const v = s.vessel;
        if (s.form === 'lean') {
          s.t += dt / 0.85;
          const u = smooth(s.t);
          g.position.lerpVectors(s.from.p, s.to.inside.p, u);
          g.quaternion.slerpQuaternions(s.from.q, s.to.inside.q, u);
          if (s.t >= 1) react(s);
        } else {
          // free fall (slowed for readability), then either drag down to the bottom or stay on the surface
          const stop = s.form === 'float' ? LEVEL - s.floatRadius * 0.4 : v.beaker.floorY + cm(0.05);
          if (g.position.y > LEVEL || s.form === 'float') s.vy -= 60 * dt;
          else s.vy = Math.max(-1.3, s.vy * Math.exp(-9 * dt) - 5 * dt);
          g.position.y += s.vy * dt;
          if (g.position.y <= stop) {
            g.position.y = stop;
            react(s);
          }
        }
      }
    }
  }

  // ---- labels and caption ----
  const labelRoot = document.getElementById('labels');
  const tags = [];
  const addTag = (html, anchor, cls = '') => {
    const el = document.createElement('div');
    el.className = 'tag ' + cls;
    el.innerHTML = html;
    labelRoot.appendChild(el);
    const t = { el, anchor, below: cls === 'metal' };
    tags.push(t);
    return t;
  };
  for (const v of vessels) {
    v.tag = addTag(`<span>${v.reagent.name}</span><small>${pretty(v.id)}</small><i class="status"></i><button type="button" class="clear" hidden>清空</button>`, new THREE.Vector3(v.x, v.beaker.height + cm(1.8), v.z), 'vessel');
    v.statusEl = v.tag.el.querySelector('.status');
    v.clearEl = v.tag.el.querySelector('.clear');
    v.clearEl.setAttribute('aria-label', `清空${v.reagent.name}`);
    v.clearEl.addEventListener('click', () => empty(v));
  }
  // metal names sit on the bench in front of their dishes, clear of the beakers behind
  for (const slot of slots) addTag(`${SOLIDS[slot.metal].label}<small>${slot.metal}</small>`, new THREE.Vector3(slot.x, 0, slot.z + cm(7.2)), 'metal');

  const capEl = document.getElementById('caption');
  const capParts = { title: capEl.querySelector('b'), sub: capEl.querySelector('span'), note: capEl.querySelector('em') };
  let shown = null, // the vessel the caption is about
    sayTimer = 0;
  function writeCaption(title, sub = '', note = '') {
    capEl.classList.toggle('on', !!title);
    if (!title) return;
    capParts.title.textContent = title;
    capParts.sub.textContent = sub;
    capParts.note.textContent = note;
    capParts.note.hidden = !note;
  }
  function showVessel(v) {
    shown = v;
    sayTimer = 0;
    if (!v || !v.solid) return writeCaption(null);
    const o = judge(v.solid.metal, v.id),
      name = `${DATA.metals[o.metal].name} + ${v.reagent.name}`;
    // until the metal has settled, and while "nothing happens" is still being watched, the caption only names the
    // experiment: the result is for the eyes first
    if (!v.reaction || (!o.reacts && v.reaction.status !== '无明显现象')) return writeCaption(name, v.reaction ? '观察中…' : '');
    writeCaption(`${name}：${o.observations.join('，')}`, [o.equations.map((e) => e.text).join('　'), o.conclusion].filter(Boolean).join(' · '), o.caution ? `注意：${o.caution}` : '');
  }
  // a short message that is not about a vessel (a refused drop); the vessel caption returns afterwards
  function say(text) {
    if (!text) return showVessel(null);
    writeCaption(text);
    sayTimer = 2.6;
  }
  const v3 = new THREE.Vector3();
  function placeTags() {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    for (const t of tags) {
      v3.copy(t.anchor).project(camera);
      const on = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
      t.el.style.display = on ? '' : 'none';
      if (on) t.el.style.transform = `translate(-50%, ${t.below ? '0' : '-100%'}) translate(${((v3.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-v3.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
    }
  }
  function updateVessels(dt) {
    let changed = false;
    for (const v of vessels) {
      if (v.reaction) v.reaction.update(dt, dt * state.speed);
      const status = v.reaction ? v.reaction.status : v.solid ? '放入中' : '';
      if (v.statusEl.textContent !== status) {
        v.statusEl.textContent = status;
        v.statusEl.classList.toggle('quiet', status === '无明显现象');
        if (v === shown) changed = true;
      }
      v.clearEl.hidden = !v.solid;
      // target ring: bright under the vessel being aimed at, faint under the others a carried metal could go to
      const want = hands.busy && !v.solid ? (aimed === v ? 0.95 : 0.22) : 0;
      v.aimed += (want - v.aimed) * (1 - Math.exp(-14 * dt));
      v.ring.material.opacity = v.aimed;
      v.ring.visible = v.aimed > 0.01;
      v.tag.el.classList.toggle('hint', aimed === v && !v.solid);
    }
    if (sayTimer > 0) {
      if ((sayTimer -= dt) <= 0) showVessel(shown);
    } else if (changed) showVessel(shown);
  }

  // ---- light and view (both from bench/) ----
  const bakeLight = createRoomLight(cine, { hide: [stage], position: new THREE.Vector3(0, cm(14), cm(6)) });
  const bakeEnvironment = () => bakeLight(state.env === 'room');
  bakeEnvironment();
  const view = createBenchCamera(camera, {
    home: new THREE.Vector3(0, cm(4.2), cm(5.5)),
    halfWidth: SPACING * 1.5 + cm(11), // the outer vessels and dishes, with a margin
    yaw: num('yaw', 0),
    pitch: num('pitch', 0.5),
    zoom: num('zoom', 1),
    limits: { panX: SPACING * 1.6, panZ: [-cm(5), cm(9)] },
  });
  const orbit = view.orbit;
  const updateCamera = view.update;

  // ---- hands ----
  let aimed = null;
  const hitVessels = vessels.map((v) => v.hit);
  const hands = createInteraction({
    canvas,
    camera,
    orbit,
    holdY: HOLD_Y,
    bounds: { x0: -SPACING * 2.2, x1: SPACING * 2.2, z0: -cm(12), z1: cm(26) },
    solidAt(ray) {
      // only pieces still in the supply or in the hand can be taken; what is in a vessel stays there
      // (and a piece still fading in on its dish is not there yet)
      const picks = solids.filter((s) => (s.state === 'tray' && s.appear > 0.6) || s.state === 'held').flatMap((s) => s.picks);
      const h = ray.intersectObjects(picks, false)[0];
      return h ? h.object.userData.solid : null;
    },
    vesselAt(ray) {
      const h = ray.intersectObjects(hitVessels, false)[0];
      return h ? h.object.userData.vessel : null;
    },
    vesselNear(p) {
      let best = null,
        d = cm(7);
      for (const v of vessels) {
        const k = Math.hypot(p.x - v.x, p.z - v.z);
        if (k < d) {
          d = k;
          best = v;
        }
      }
      return best;
    },
    grab(s) {
      s.state = 'held';
      s.target.set(s.slot.x, cm(5), s.slot.z); // just clear of its dish until the pointer says otherwise
    },
    // over a vessel the metal jumps to its mouth: that is where it will go if released
    carry: (s, p, v) => (v && !v.solid ? s.target.set(v.x, HOLD_Y, v.z) : s.target.copy(p)),
    aim: (v) => (aimed = v),
    release(s, v) {
      aimed = null;
      if (v && !v.solid) return putIn(s, v);
      if (v) say(`${v.reagent.name}里已经有金属了，先点“清空”`);
      sendBack(s);
    },
    tapVessel: showVessel,
  });
  addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === 'r') reset();
    else if (k === 'h') document.body.classList.toggle('clean');
  });
  document.getElementById('reset').addEventListener('click', reset);

  // put a metal into a reagent without the pointer: ?put=Fe:CuSO4,Na:FeSO4, and checks from a background tab
  function put(metal, reagentId) {
    const v = vessels.find((k) => k.id === reagentId),
      slot = slots.find((k) => k.metal === metal);
    if (!v || !slot || v.solid || slot.piece.state !== 'tray') return false;
    slot.piece.appear = 1;
    slot.piece.setReveal(1);
    putIn(slot.piece, v);
    return true;
  }

  function simulate(dt) {
    updateSolids(dt);
    updateVessels(dt);
    fx.bubbles.update(dt);
    fx.flocs.update(dt, dt * state.speed);
  }

  // ---- panel ----
  const hud = document.getElementById('hud');
  if (q.get('gui') !== '0') {
    const gui = new GUI({ title: '画面', width: 250 });
    const ui = { 画质: state.quality, 液体: state.liquid === 'simple' ? '简化（无折射）' : '透射（折射）', 环境光: state.env === 'room' ? '房间烘焙' : '天空', 调试视图: '成片' };
    gui.add(state, 'speed', 0.25, 8, 0.25).name('反应速度');
    gui.add(ui, '画质', ['low', 'medium', 'high', 'ultra']).onChange((v) => {
      state.quality = v;
      cine.setQuality(benchQuality(v));
    });
    cine.onQualityChange = (name) => {
      ui.画质 = state.quality = name;
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
    };
    gui.add(ui, '液体', ['透射（折射）', '简化（无折射）']).onChange((v) => {
      state.liquid = v.startsWith('简化') ? 'simple' : 'transmission';
      buildLiquids();
    });
    gui.add(ui, '环境光', ['房间烘焙', '天空']).onChange((v) => {
      state.env = v === '天空' ? 'sky' : 'room';
      bakeEnvironment();
    });
    const L = cine.look,
      f = gui.addFolder('光照与镜头');
    f.add(L.sun, 'elevation', 15, 60, 0.5).name('太阳高度').onChange(() => cine.refreshLook(false)).onFinishChange(bakeEnvironment);
    f.add(L.sun, 'azimuth', 225, 300, 0.5).name('太阳方位').onChange(() => cine.refreshLook(false)).onFinishChange(bakeEnvironment);
    f.add(L.sun, 'intensity', 0, 14, 0.1).name('太阳强度').onChange(() => cine.refreshLook(false)).onFinishChange(bakeEnvironment);
    f.add(L.env, 'intensity', 0, 4, 0.05).name('环境光强度').onChange(() => cine.refreshLook(false));
    f.add(L.air, 'sigma', 0, 0.012, 0.0002).name('空气浑浊度');
    f.add(L.air, 'aoStrength', 0, 1, 0.01).name('环境遮蔽');
    f.add(L.grade, 'exposure', 0.3, 3, 0.01).name('曝光');
    f.add(L.grade, 'bloom', 0, 0.2, 0.005).name('泛光');
    f.close();
    if (cine.postChain) {
      const s = gui.addFolder('开关'),
        en = cine.postChain.enable;
      s.add(en, 'volumetrics').name('体积光');
      s.add(en, 'ao').name('环境遮蔽');
      s.add(en, 'bloom').name('泛光');
      s.add(cine, 'dynamicResolution').name('动态分辨率');
      s.close();
      gui.add(ui, '调试视图', ['成片', '环境遮蔽', '散射光', '透射率']).onChange((v) => (cine.postChain.debug = ['成片', '环境遮蔽', '散射光', '透射率'].indexOf(v)));
    }
    gui.close(); // the bench is the page; the picture controls stay out of the way until asked for
  }
  if (q.get('hud') === '0') document.body.classList.add('clean');

  // ---- loop ----
  let last = performance.now(),
    time = 0,
    frames = 0,
    fpsAcc = 0,
    fpsN = 0;
  // ?put=Fe:CuSO4,Zn:H2SO4 starts with those metals dropped in; ?t=12 runs the bench forward that many seconds
  for (const pair of (q.get('put') || '').split(',').filter(Boolean)) put(...pair.split(':'));
  for (let i = 0, n = Math.round(num('t', 0) * 30); i < n; i++) simulate(1 / 30);
  updateCamera();
  cine.warmup().then(() => document.getElementById('boot').classList.add('gone'));
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!still) {
      time += dt;
      simulate(dt);
    }
    updateCamera();
    cine.frame(dt, time);
    placeTags();
    frames++;
    fpsAcc += dt;
    fpsN++;
    if (fpsAcc > 0.5) {
      const s = cine.stats();
      hud.textContent = `${(fpsN / fpsAcc).toFixed(0)} fps · ${s.res[0]}×${s.res[1]} · ${s.quality}${s.advanced ? '' : ' · 前向回退'} · ${(s.tris / 1e3).toFixed(0)}k 三角 · ${s.calls} 次绘制`;
      fpsAcc = 0;
      fpsN = 0;
    }
    if (frames === 12) window.__ready = true;
  }
  requestAnimationFrame(tick);

  // Synchronous cost of one frame in milliseconds (GPU included): renders n frames back to back and waits for each.
  window.__bench = (n = 40) => {
    const gl = renderer.getContext(),
      px = new Uint8Array(4),
      dyn = cine.dynamicResolution;
    cine.dynamicResolution = false;
    for (let i = 0; i < 5; i++) cine.frame(1 / 60);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      simulate(1 / 60);
      cine.frame(1 / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    const ms = (performance.now() - t0) / n;
    cine.dynamicResolution = dyn;
    return { ms: +ms.toFixed(2), ...cine.stats() };
  };
  // advance the bench and draw without waiting for animation frames (checks from a background tab)
  window.__step = (seconds = 1, fps = 30) => {
    for (let i = 0, n = Math.round(seconds * fps); i < n; i++) {
      time += 1 / fps;
      simulate(1 / fps);
    }
    updateCamera();
    for (let i = 0; i < 3; i++) cine.frame(1 / fps, time);
    placeTags();
  };
  window.__lab = { cine, state, vessels, slots, solids, fx, orbit, hands, put, empty, reset, buildLiquids, bakeEnvironment };
}

// let the loading card paint before the scene is built; the timer covers a page opened in a background tab,
// where animation frames never arrive
let started = false;
const boot = () => {
  if (started) return;
  started = true;
  try {
    start();
  } catch (e) {
    showError((e && e.stack) || String(e));
  }
};
requestAnimationFrame(() => setTimeout(boot, 30));
setTimeout(boot, 800);
