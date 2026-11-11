// DC motor: a demonstration motor, a battery, a switch and a rheostat on the bench, wired into one loop.
// Tap the switch, the magnets, the motor's terminals or the coil; change current, field and turns in the panel.
// Which way things point and how the rotor moves comes from physics/motor.js; content.js holds the lesson.
import * as THREE from 'three';
import { createCineRenderer } from '../../engine/index.js';
import { makeBenchLook, benchQuality, cm } from '../../bench/look.js';
import { buildRoom, ROOM } from '../../bench/room.js';
import { createBenchCamera } from '../../bench/camera.js';
import { createRoomLight } from '../../bench/environment.js';
import { createInteraction } from '../../bench/interaction.js';
import { buildApparatus } from './apparatus.js';
import { createOverlays } from './overlays.js';
import { createUI, speak } from './ui.js';
import { CHAPTERS, EXPERIMENTS, QUIZ, PART_NAMES } from './content.js';
import { createRotor, step, nudge, drive, direction, coilCurrent, describe } from './physics/motor.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) && Number.isFinite(+q.get(k)) ? +q.get(k) : d);
const errBox = document.getElementById('err');
const showError = (m) => {
  errBox.style.display = 'block';
  errBox.textContent += m + '\n';
};
window.addEventListener('error', (e) => showError(String(e.message || e)));

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => t * t * (3 - 2 * t);
const toward = (v, target, rate, dt) => v + clamp(target - v, -rate * dt, rate * dt);
const settled = (k) => k < 0.02 || k > 0.98;

function start() {
  const canvas = document.getElementById('view');
  const still = q.get('still') === '1';
  const cine = createCineRenderer({
    canvas,
    look: makeBenchLook(),
    quality: benchQuality(q.get('q') || 'high'),
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
  if (q.get('ui') === '0') document.body.classList.add('clean');
  window.__cine = cine;
  const { scene, camera, renderer } = cine;

  scene.add(buildRoom().group);
  const apparatus = buildApparatus();
  const overlays = createOverlays(apparatus);
  scene.add(apparatus.group, overlays.group);
  const { motor, knife, rheostat } = apparatus;

  // ---- what the student has set, and where the moving parts actually are on their way there
  const state = {
    chapter: clamp(Math.round(num('chapter', 1)) - 1, 0, CHAPTERS.length - 1),
    params: { closed: true, supply: 1, magnet: 1, current: 1, field: 1, turns: 10 },
    exploded: false,
    paused: false,
    speed: 1,
    layers: { ...CHAPTERS[0].layers },
    auto: false,
    voice: false,
    experiment: null,
    expectShown: false,
  };
  const anim = { open: 0, swap: 0, flip: 0, explode: 0, field: 1, current: 1 };
  const rotor = createRotor();
  let stopped = 'open',
    shownSwap = -1,
    lastCoil = 0;

  // The parameters in force this instant. A lead in mid-air or a lifted magnet is not connected / not there:
  // the circuit is open while the leads change places, the field is gone while the magnets do.
  const effective = () => ({
    closed: state.params.closed && anim.open < 0.08 && settled(anim.swap) && anim.explode < 0.02,
    supply: anim.swap > 0.5 ? -1 : 1,
    magnet: anim.flip > 0.5 ? -1 : 1,
    current: anim.current,
    field: settled(anim.flip) ? anim.field : 0,
    turns: state.params.turns,
  });

  // ---- light and view
  const bakeLight = createRoomLight(cine, { hide: [apparatus.group, overlays.group], position: new THREE.Vector3(0, cm(16), cm(6)) });
  bakeLight(q.get('env') !== 'sky');
  const V = (x, y, z) => new THREE.Vector3(cm(x), cm(y), cm(z));
  // (the bench spot sits a little right of centre: the panel on the right is wider than the one on the left)
  const SPOTS = { bench: V(3, 3, 7), motor: V(0, 7, 2.5), coil: V(0.5, 8.5, 0.5), commutator: V(0, 8.2, 4.3) };
  const view = createBenchCamera(camera, {
    home: SPOTS.bench.clone(),
    halfWidth: cm(46), // the apparatus is 64 cm across; the rest is room for the panels on either side
    limits: { yaw: 0.62, pitch: [0.28, 1.15], zoom: [0.1, 1.15], panX: cm(26), panZ: [-cm(12), cm(8)] },
  });
  const orbit = view.orbit;
  let camGoal = null; // where the camera is being taken (a chapter's view); any touch of the view cancels it
  const goTo = (v, jump) => {
    camGoal = { yaw: v.yaw, pitch: v.pitch, zoom: v.zoom, target: SPOTS[v.at] };
    if (!jump) return;
    Object.assign(orbit, { yaw: v.yaw, pitch: v.pitch, zoom: v.zoom });
    orbit.target.copy(camGoal.target);
    camGoal = null;
  };
  function moveCamera(dt) {
    if (!camGoal) return;
    const k = 1 - Math.exp(-3.4 * dt);
    orbit.yaw += (camGoal.yaw - orbit.yaw) * k;
    orbit.pitch += (camGoal.pitch - orbit.pitch) * k;
    orbit.zoom *= Math.pow(camGoal.zoom / orbit.zoom, k);
    orbit.target.lerp(camGoal.target, k);
    if (Math.abs(camGoal.zoom / orbit.zoom - 1) < 0.004 && orbit.target.distanceTo(camGoal.target) < 0.004) camGoal = null;
  }
  for (const type of ['pointerdown', 'wheel']) canvas.addEventListener(type, () => (camGoal = null), { passive: true });

  // ---- the lesson
  let stopVoice = () => {},
    autoTimer = 0;
  const say = () => {
    stopVoice();
    if (!state.voice) return;
    const c = CHAPTERS[state.chapter];
    stopVoice = speak(`${c.title}。${c.text}`, () => state.auto && (autoTimer = 12.5)); // then on to the next chapter
  };
  const act = {
    chapter(i, byHand) {
      const c = CHAPTERS[i];
      state.chapter = i;
      state.layers = { ...c.layers };
      state.params.closed = c.set.closed;
      state.exploded = c.set.exploded;
      state.speed = c.set.speed;
      state.paused = false;
      if (byHand) state.experiment = null;
      if (rotor.omega === 0) rotor.angle = 0.45; // a chapter never opens on a coil stuck at the dead point
      autoTimer = 0;
      goTo(c.view, false);
      say();
      ui.sync();
    },
    experiment(i) {
      const x = EXPERIMENTS[i];
      act.chapter(x.chapter, false);
      Object.assign(state.params, x.patch);
      motor.setTurns(state.params.turns);
      for (const k of x.layers) state.layers[k] = true;
      state.experiment = i;
      state.expectShown = false;
      state.speed = 1;
      ui.sync();
      ui.toast(`已布置好：${x.title}`);
    },
    toggleExpect() {
      state.expectShown = !state.expectShown;
      ui.sync();
    },
    toggleSwitch() {
      if (state.exploded) return ui.toast('电动机拆开着，先装回去');
      state.params.closed = !state.params.closed;
      ui.sync();
    },
    togglePause() {
      state.paused = !state.paused;
      ui.sync();
    },
    toggleExplode() {
      state.exploded = !state.exploded;
      ui.sync();
    },
    nudge() {
      if (state.exploded) return;
      nudge(rotor, direction(effective()) || 1);
    },
    swapSupply() {
      state.params.supply *= -1;
      ui.sync();
      ui.toast(state.params.supply < 0 ? '对调两根导线：电流从右边的电刷流入' : '导线接回原样：电流从左边的电刷流入');
    },
    swapMagnets() {
      state.params.magnet *= -1;
      ui.sync();
      ui.toast(state.params.magnet < 0 ? '对调磁极：N 极换到右边' : '磁极放回原样：N 极在左边');
    },
    speed(v) {
      state.speed = v;
      ui.sync();
    },
    param(k, v) {
      state.params[k] = v;
      if (k === 'turns') motor.setTurns(v);
      ui.sync();
    },
    layer(k) {
      state.layers[k] = !state.layers[k];
      ui.sync();
    },
    toggleAuto() {
      state.auto = !state.auto;
      autoTimer = 0;
      ui.sync();
      ui.toast(state.auto ? '自动讲解：每章停留一会儿，自动翻到下一章' : '已停止自动讲解');
    },
    toggleVoice() {
      state.voice = !state.voice;
      say();
      ui.sync();
    },
  };
  const ui = createUI({ state, chapters: CHAPTERS, experiments: EXPERIMENTS, quiz: QUIZ, act });

  // ---- hands: the apparatus is operated by tapping it
  const tap = (objects, fn) => objects.forEach((o) => (o.userData.tap = fn));
  tap([knife.hit], act.toggleSwitch);
  tap(motor.hits.magnets, act.swapMagnets);
  tap(motor.hits.posts, act.swapSupply);
  tap(motor.hits.coil, act.nudge);
  const hits = [knife.hit, ...motor.hits.magnets, ...motor.hits.posts, ...motor.hits.coil];
  createInteraction({
    canvas,
    camera,
    orbit,
    holdY: cm(10),
    bounds: { x0: -4, x1: 4, z0: -2, z1: 2 },
    tappable: true,
    solidAt: () => null, // nothing on this bench is carried
    vesselAt: (ray) => (ray.intersectObjects(hits, false)[0] || {}).object || null,
    vesselNear: () => null,
    grab() {},
    carry() {},
    release() {},
    aim() {},
    tapVessel: (o) => o.userData.tap(),
  });
  addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'ArrowRight') act.chapter((state.chapter + 1) % CHAPTERS.length, true);
    else if (e.key === 'ArrowLeft') act.chapter((state.chapter + CHAPTERS.length - 1) % CHAPTERS.length, true);
    else if (e.key === ' ') act.togglePause();
    else if (e.key.toLowerCase() === 'h') document.body.classList.toggle('clean');
  });

  // ---- names and letters pinned to the picture
  const labelRoot = document.getElementById('labels');
  const makeTag = (text, cls) => {
    const el = document.createElement('div');
    el.className = 'tag ' + cls;
    el.textContent = text;
    el.style.display = 'none';
    labelRoot.appendChild(el);
    return el;
  };
  const partTags = Object.keys(PART_NAMES).map((id) => ({ id, el: makeTag(PART_NAMES[id], 'part'), anchor: apparatus.anchors[id] }));
  const letterTags = { B: makeTag('B', 'letter field'), I: makeTag('I', 'letter current'), F: makeTag('F', 'letter force'), forceA: makeTag('F', 'letter force'), forceB: makeTag('F', 'letter force') };
  const v3 = new THREE.Vector3();
  function pin(el, world, shift) {
    if (!world) return (el.style.display = 'none');
    v3.copy(world).project(camera);
    const on = v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
    el.style.display = on ? '' : 'none';
    if (on) el.style.transform = `translate(-50%, ${shift}) translate(${((v3.x * 0.5 + 0.5) * canvas.clientWidth).toFixed(1)}px, ${((-v3.y * 0.5 + 0.5) * canvas.clientHeight).toFixed(1)}px)`;
  }
  let letters = { hand: null, forceA: null, forceB: null };
  const w3 = new THREE.Vector3();
  function placeTags() {
    const named = state.layers.labels ? CHAPTERS[state.chapter].labels : [];
    for (const t of partTags) pin(t.el, named.includes(t.id) ? t.anchor.getWorldPosition(w3) : null, '-100%');
    for (const k of ['B', 'I', 'F']) pin(letterTags[k], letters.hand && letters.hand[k], '-50%');
    pin(letterTags.forceA, letters.forceA, '-50%');
    pin(letterTags.forceB, letters.forceB, '-50%');
  }

  // ---- one step of the bench
  function simulate(dt) {
    const p = state.params;
    anim.open = toward(anim.open, p.closed ? 0 : 1, 5, dt);
    anim.swap = toward(anim.swap, p.supply < 0 ? 1 : 0, 1 / 1.1, dt);
    anim.flip = toward(anim.flip, p.magnet < 0 ? 1 : 0, 1 / 1.7, dt);
    anim.explode = toward(anim.explode, state.exploded ? 1 : 0, 1 / 0.9, dt);
    anim.field = toward(anim.field, p.field, 1.6, dt);
    anim.current = toward(anim.current, p.current, 3, dt);
    knife.setOpen(ease(anim.open));
    if (anim.swap !== shownSwap) apparatus.setSwap((shownSwap = anim.swap));
    motor.set({ field: anim.field, swap: anim.flip, explode: ease(anim.explode) });
    rheostat.setCurrent(anim.current);

    const eff = effective();
    if (anim.explode > 0.02) rotor.omega = 0;
    else if (!state.paused) stopped = step(rotor, eff, dt * state.speed);
    motor.rotor.rotation.z = rotor.angle;

    // the moment of commutation, called out in the chapter about it
    const coil = Math.sign(coilCurrent(eff, rotor.angle));
    if (coil && lastCoil && coil !== lastCoil && state.chapter === 7 && rotor.omega !== 0) ui.toast('换向：线圈中的电流反向了，转矩方向不变', 1.6);
    if (coil) lastCoil = coil;

    apparatus.group.updateMatrixWorld(true);
    letters = overlays.update(dt, eff, rotor.angle, state.layers, { gapHalf: motor.gapHalf, lift: anim.explode });

    if (state.auto && !state.paused) {
      autoTimer += dt;
      if (autoTimer > 14) act.chapter((state.chapter + 1) % CHAPTERS.length, false);
    }
    return eff;
  }

  function readout(eff, fps) {
    const way = Math.sign(rotor.omega),
      coil = coilCurrent(eff, rotor.angle),
      s = cine.stats();
    ui.readout({
      torque: Math.round(100 * drive(eff)),
      speed: (Math.abs(rotor.omega) / (2 * Math.PI)).toFixed(2),
      way: way > 0 ? '逆时针' : way < 0 ? '顺时针' : '—',
      coil: coil > 0 ? '朝向你' : coil < 0 ? '背向你' : '无',
      status: anim.explode > 0.02 ? '电动机已拆开，电路是断的' : state.paused ? '已暂停' : describe(eff, rotor, rotor.omega === 0 ? stopped : null).text,
      perf: `${fps.toFixed(0)} fps · ${s.res[0]}×${s.res[1]} · ${s.quality}${s.advanced ? '' : ' · 前向回退'}`,
    });
  }

  // ---- loop
  // ?chapter=6&t=3 opens on a chapter and runs the bench forward three seconds; ?still=1 then freezes it
  act.chapter(state.chapter, true);
  goTo(CHAPTERS[state.chapter].view, true);
  for (const k of ['yaw', 'pitch', 'zoom']) if (q.has(k)) orbit[k] = num(k, orbit[k]);
  let eff = effective();
  for (let i = 0, n = Math.round(num('t', 0) * 60); i < n; i++) eff = simulate(1 / 60);
  view.update();
  cine.warmup().then(() => document.getElementById('boot').classList.add('gone'));
  let last = performance.now(),
    time = 0,
    frames = 0,
    acc = 0,
    count = 0;
  readout(eff, 0);
  function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!still) {
      time += dt;
      eff = simulate(dt);
      moveCamera(dt);
    }
    view.update();
    cine.frame(dt, time);
    placeTags();
    acc += dt;
    count++;
    if (acc > 0.2) {
      readout(eff, count / acc);
      acc = count = 0;
    }
    if (++frames === 12) window.__ready = true;
  }
  requestAnimationFrame(tick);

  // advance the bench and draw without waiting for animation frames (checks from a background tab)
  window.__step = (seconds = 1, fps = 60) => {
    for (let i = 0, n = Math.round(seconds * fps); i < n; i++) {
      time += 1 / fps;
      eff = simulate(1 / fps);
      moveCamera(1 / fps);
    }
    view.update();
    for (let i = 0; i < 3; i++) cine.frame(1 / fps, time);
    placeTags();
    readout(eff, fps);
  };
  // synchronous cost of one frame in milliseconds (GPU included)
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
  window.__lab = { cine, state, anim, rotor, apparatus, overlays, orbit, act, effective };
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
