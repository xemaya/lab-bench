import * as THREE from 'three';
import { QUALITY, QUALITY_ORDER, LOOKS, cloneLook, sunDirection } from './looks.js';
import { makeNoiseTexture } from './noise.js';
import { createSky, SKY_TAG } from './sky.js';
import { installSoftShadows, uninstallSoftShadows, fitShadowToBox, createShadowFollower, SHADOW_TAG } from './shadows.js';
import { createPostChain, POST_TAG } from './post.js';

export { QUALITY, LOOKS, cloneLook } from './looks.js';
export { createPlanarReflection } from './planar.js';
export { createWater } from './water.js';
export { makeFoliageMaterial, foliageMeshes } from './foliage.js';
export { makeDetailTextures, mulberry32, vnoise, fbm, ridged } from './noise.js';

// createCineRenderer: a three.js scene + camera + sun wired to the cinematic pipeline.
//
//   const cine = createCineRenderer({ canvas, look: LOOKS.dawnMist, quality: 'high' });
//   cine.scene.add(myWorld);                 // any three.js meshes; standard materials get the soft shadows + IBL
//   cine.frame(dt);                          // once per animation frame
//
// options
//   look     : one of LOOKS or your own object of the same shape (sun / sky / env / air / grade)
//   quality  : 'low' | 'medium' | 'high' | 'ultra' or a quality object
//   shadow   : { mode: 'follow', size, depth }               sun shadow tracks the camera (open worlds), or
//              { mode: 'box', min: [x,y,z], max: [x,y,z] }   fitted once to a fixed box (small scenes)
//              optional in both: softness (penumbra scale), searchTaps (blocker-search samples, 8; raise it when
//              wide penumbrae fall on plain, close-up surfaces and the grain shows)
//   fov, near, far, maxPixelRatio
//   dynamicResolution, targetFps : the governor scales the internal resolution (then drops a quality tier) to hold
//              this frame rate; 60 by default, 30 suits slow cinematic cameras on mid-range GPUs
export function createCineRenderer(opts = {}) {
  const { canvas, fov = 50, near = 0.1, far = 1500, maxPixelRatio = 2, dynamicResolution = true, onError = null } = opts;
  let targetFps = opts.targetFps || 60;
  const shadowOpt = { mode: 'follow', size: 110, depth: 600, softness: 1, ...(opts.shadow || {}) };
  let quality = typeof opts.quality === 'object' ? { ...opts.quality } : { ...(QUALITY[opts.quality] || QUALITY.high) };
  let look = cloneLook(opts.look || LOOKS.dawnMist);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, depth: true, stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.setClearColor(0, 1);

  // classify shader compile errors so one broken stage degrades gracefully instead of blanking the frame
  const failed = { post: false, shadow: false, sky: false, other: 0 };
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    let src = '',
      log = '';
    try {
      src = gl.getShaderSource(fs) || '';
      log = (gl.getShaderInfoLog(fs) || '') + ' ' + (gl.getShaderInfoLog(vs) || '') + ' ' + (gl.getProgramInfoLog(program) || '');
    } catch {}
    let where = 'material';
    if (src.includes(POST_TAG)) {
      failed.post = true;
      where = 'post pass ' + (src.match(/CINE_POST (\S+)/) || [])[1];
    } else if (src.includes(SKY_TAG)) {
      failed.sky = true;
      where = 'sky';
    } else if (src.includes(SHADOW_TAG)) {
      failed.shadow = true;
      where = 'material (soft shadow chunk active)';
    } else failed.other++;
    const msg = `[cine] shader error in ${where}: ${log.trim().slice(0, 900)}`;
    console.error(msg);
    if (onError) onError(msg);
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 16 / 9, near, far);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  const sunDir = sunDirection(look.sun, new THREE.Vector3());
  const uniforms = {
    time: { value: 0 },
    sunDir: { value: sunDir },
    sunColor: { value: new THREE.Vector3().fromArray(look.sun.color) },
    windDir: { value: new THREE.Vector2(0.8, 0.6) },
    windStrength: { value: 1 },
  };

  const noiseTex = makeNoiseTexture();
  const sky = createSky(noiseTex);
  scene.add(sky.mesh);

  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.name = 'sun';
  sun.castShadow = true;
  const shadowSize = () => Math.min(quality.shadow || 2048, renderer.capabilities.maxTextureSize);
  sun.shadow.mapSize.set(shadowSize(), shadowSize());
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = shadowOpt.softness;
  sun.shadow.autoUpdate = true;
  scene.add(sun, sun.target);

  let follower = null,
    frustum;
  if (shadowOpt.mode === 'box') {
    const mn = new THREE.Vector3().fromArray(shadowOpt.min),
      mx = new THREE.Vector3().fromArray(shadowOpt.max);
    frustum = fitShadowToBox(sun, sunDir, mn, mx);
  } else {
    follower = createShadowFollower(sun, shadowOpt);
    frustum = follower.frustum;
    follower.update(camera, sunDir, shadowOpt.focusY ?? null);
  }
  sun.shadow.bias = -0.03 / frustum.depth; // ~3 cm
  let softShadows = false;
  try {
    softShadows = installSoftShadows(frustum, { taps: quality.shadowTaps || 16, searchTaps: shadowOpt.searchTaps || 8 });
  } catch (e) {
    console.warn('[cine] soft shadows unavailable: ' + e);
  }

  function applyLook() {
    sunDirection(look.sun, sunDir);
    uniforms.sunColor.value.fromArray(look.sun.color);
    sun.color.setRGB(look.sun.color[0], look.sun.color[1], look.sun.color[2]);
    sun.intensity = look.sun.intensity;
    sky.applyLook(look, sunDir);
    scene.environmentIntensity = look.env.intensity;
    if (shadowOpt.mode === 'box') fitShadowToBox(sun, sunDir, new THREE.Vector3().fromArray(shadowOpt.min), new THREE.Vector3().fromArray(shadowOpt.max));
    renderer.shadowMap.needsUpdate = true;
  }
  function bakeEnvironment() {
    try {
      const prev = renderer.getRenderTarget();
      scene.environment = sky.captureEnvironment(renderer);
      renderer.setRenderTarget(prev);
    } catch (e) {
      console.error('[cine] environment capture failed: ' + ((e && e.stack) || e));
    }
  }
  applyLook();
  bakeEnvironment();

  // HDR scene target (optionally multisampled) with a readable depth texture
  const depthTex = new THREE.DepthTexture(4, 4);
  depthTex.type = THREE.UnsignedIntType;
  depthTex.minFilter = depthTex.magFilter = THREE.NearestFilter;
  const hdr = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture: depthTex,
    samples: quality.msaa | 0,
    generateMipmaps: false,
  });

  const ctx = {
    get quality() {
      return quality;
    },
    get look() {
      return look;
    },
    sunDir,
    noiseTex,
  };
  let post = null,
    advanced = opts.post !== false;
  if (advanced) {
    try {
      post = createPostChain(renderer, ctx);
    } catch (e) {
      advanced = false;
      console.error('[cine] post chain failed to initialise, using forward fallback: ' + ((e && e.stack) || e));
    }
  }

  // ---- dynamic resolution: keep the frame time near 60 Hz by scaling the internal resolution, then the tier ----
  const dyn = { scale: 1, enabled: dynamicResolution, acc: 0, n: 0, settle: 3.5, upWait: 4, upDelay: 4, floorHits: 0 };
  function governor(ms) {
    if (!dyn.enabled || !advanced || ms > 1500) return;
    // browsers throttle unfocused / hidden windows: those frame times say nothing about the GPU
    if (typeof document !== 'undefined' && (document.hidden || (document.hasFocus && !document.hasFocus()))) {
      dyn.acc = 0;
      dyn.n = 0;
      return;
    }
    dyn.settle -= ms / 1000;
    dyn.upWait -= ms / 1000;
    if (dyn.settle > 0) {
      dyn.acc = 0;
      dyn.n = 0;
      return;
    }
    dyn.acc += ms;
    dyn.n++;
    if (dyn.n < 45 && dyn.acc < 900) return;
    const avg = dyn.acc / dyn.n;
    dyn.acc = 0;
    dyn.n = 0;
    let s = dyn.scale;
    const budget = 1000 / targetFps; // 16.7 ms at 60 Hz
    if (avg > budget * 1.29 && s > 0.6) {
      s = avg > budget * 2.7 ? 0.6 : Math.max(0.6, s - (avg > budget * 1.8 ? 0.2 : 0.1));
      dyn.upDelay = Math.min(60, dyn.upDelay * 2);
      dyn.upWait = dyn.upDelay;
    } else if (avg < budget * 1.04 && s < 1 && dyn.upWait <= 0) {
      s = Math.min(1, s + 0.1);
      dyn.upWait = 2;
    } else if (avg < budget * 1.04 && s >= 1) dyn.upDelay = 4;
    s = Math.round(s * 10) / 10;
    if (s <= 0.6 && avg > budget * 1.56) {
      dyn.floorHits++;
      const next = QUALITY_ORDER[QUALITY_ORDER.indexOf(quality.name) + 1];
      if (dyn.floorHits >= 2 && next) {
        dyn.floorHits = 0;
        dyn.scale = 0.8;
        dyn.settle = 2;
        dyn.upDelay = 4;
        console.log(`[cine] frame time ${avg.toFixed(0)} ms at minimum scale: dropping quality to ${next}`);
        api.setQuality(next);
        if (api.onQualityChange) api.onQualityChange(next);
        return;
      }
    } else dyn.floorHits = 0;
    if (s !== dyn.scale) {
      dyn.scale = s;
      dyn.settle = 1;
      api.resize();
    }
  }

  const prePasses = [];
  const warned = {};
  const warnOnce = (k, msg) => {
    if (!warned[k]) {
      warned[k] = 1;
      console.error(msg);
    }
  };
  let lastStats = { calls: 0, tris: 0 },
    frameNo = 0,
    lastNow = 0;

  function updateShadowFit() {
    const every = quality.name === 'ultra' || api.still;
    if (every || (frameNo & 1) === 0 || !sun.shadow.map) {
      if (follower) follower.update(camera, sunDir, shadowOpt.focusY ?? null);
      renderer.shadowMap.needsUpdate = true;
    }
  }

  function renderForward() {
    if (renderer.toneMapping !== THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6 * look.grade.exposure * (1 - Math.min(1, Math.max(0, api.post.fade)));
    renderer.setRenderTarget(null);
    renderer.clear();
    updateShadowFit();
    renderer.render(scene, camera);
  }
  function renderAdvanced(dt) {
    if (renderer.toneMapping !== THREE.NoToneMapping) renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setRenderTarget(hdr);
    renderer.clear(true, true, false);
    updateShadowFit();
    renderer.render(scene, camera);
    post.run({ hdr, camera, sun, dt, time: uniforms.time.value, fast: api.still, post: api.post });
    renderer.setRenderTarget(null);
    if (failed.post) throw new Error('a post shader failed to compile');
  }

  const api = {
    renderer,
    scene,
    camera,
    sun,
    sky,
    sunDir,
    uniforms,
    noiseTex,
    resolution: new THREE.Vector2(4, 4),
    // per-frame controls for the host application
    post: { fade: 0, flash: 0, saturation: 1, exposure: 1, letterbox: 0 },
    still: false, // true = no temporal smoothing (screenshots)
    onQualityChange: null,
    get quality() {
      return quality;
    },
    get look() {
      return look;
    },
    get advanced() {
      return advanced;
    },
    get softShadows() {
      return softShadows;
    },
    get postChain() {
      return post;
    },
    get dynamicScale() {
      return dyn.scale;
    },
    set dynamicResolution(v) {
      dyn.enabled = !!v;
      if (!v && dyn.scale !== 1) {
        dyn.scale = 1;
        api.resize();
      }
    },
    get dynamicResolution() {
      return dyn.enabled;
    },
    get targetFps() {
      return targetFps;
    },
    set targetFps(v) {
      targetFps = Math.max(10, +v || 60);
      dyn.settle = 1;
    },

    // a pre-pass runs before the main scene render: fn(renderer, scene, camera)
    addPrePass(fn) {
      prePasses.push(fn);
    },
    // render the world from another camera into a target (reflections, probes) without touching the shadow map
    renderWorld(cam, target) {
      const prevTarget = renderer.getRenderTarget(),
        prevShadow = renderer.shadowMap.needsUpdate,
        prevTM = renderer.toneMapping,
        prevExp = renderer.toneMappingExposure;
      renderer.shadowMap.needsUpdate = false;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1;
      try {
        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(scene, cam);
      } finally {
        renderer.setRenderTarget(prevTarget);
        renderer.shadowMap.needsUpdate = prevShadow;
        renderer.toneMapping = prevTM;
        renderer.toneMappingExposure = prevExp;
      }
    },
    // change the look. Pass rebake=false while dragging sliders that do not affect the sky (air, grade).
    setLook(next, rebake = true) {
      look = next === look ? look : cloneLook(next);
      applyLook();
      if (rebake) bakeEnvironment();
      return look;
    },
    refreshLook(rebake = true) {
      applyLook();
      if (rebake) bakeEnvironment();
    },
    setQuality(q) {
      quality = typeof q === 'object' ? { ...q } : { ...(QUALITY[q] || QUALITY.high) };
      const s = shadowSize();
      if (sun.shadow.mapSize.x !== s) {
        sun.shadow.mapSize.set(s, s);
        if (sun.shadow.map) {
          sun.shadow.map.dispose();
          sun.shadow.map = null;
        }
      }
      const samples = quality.msaa | 0;
      if (hdr.samples !== samples) {
        hdr.samples = samples;
        hdr.dispose();
      }
      if (post) post.applyQuality();
      api.resize();
    },
    resize() {
      const cw = Math.max(2, canvas.clientWidth || window.innerWidth),
        ch = Math.max(2, canvas.clientHeight || window.innerHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
      const qs = quality.scale || 1;
      if (advanced) {
        renderer.setPixelRatio(dpr);
        renderer.setSize(cw, ch, false);
        let s = qs * dyn.scale;
        const budget = quality.pixels || 2.3e6,
          px = cw * dpr * ch * dpr * s * s;
        if (px > budget) s *= Math.sqrt(budget / px);
        const w = Math.max(16, Math.round(cw * dpr * s)),
          h = Math.max(16, Math.round(ch * dpr * s));
        hdr.setSize(w, h);
        if (depthTex.image.width !== w || depthTex.image.height !== h) {
          depthTex.image.width = w;
          depthTex.image.height = h;
          depthTex.needsUpdate = true;
        }
        if (post) post.resize(w, h);
        api.resolution.set(w, h);
      } else {
        renderer.setPixelRatio(dpr * qs);
        renderer.setSize(cw, ch, false);
        api.resolution.set(Math.round(cw * dpr * qs), Math.round(ch * dpr * qs));
      }
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
    },
    // compile every program up front (call once the world is built) so the first frames do not hitch
    async warmup() {
      renderer.shadowMap.needsUpdate = true;
      try {
        if (advanced) renderer.setRenderTarget(hdr);
        await renderer.compileAsync(scene, camera);
      } catch {}
      renderer.setRenderTarget(null);
      dyn.settle = 3.5;
      dyn.acc = 0;
      dyn.n = 0;
    },
    frame(dt, time) {
      const now = performance.now();
      if (lastNow) governor(now - lastNow);
      lastNow = now;
      frameNo++;
      renderer.info.reset();
      uniforms.time.value = time !== undefined ? time : uniforms.time.value + dt;
      sky.uniforms.uTime.value = uniforms.time.value;
      camera.updateMatrixWorld(true);
      for (const fn of prePasses) {
        try {
          fn(renderer, scene, camera);
        } catch (e) {
          warnOnce('pre', '[cine] pre-pass threw: ' + ((e && e.stack) || e));
        }
      }
      if (advanced) {
        try {
          renderAdvanced(dt);
        } catch (e) {
          advanced = false;
          try {
            renderer.setRenderTarget(null);
          } catch {}
          console.error('[cine] advanced pipeline disabled, falling back to forward rendering: ' + ((e && e.stack) || e));
          if (onError) onError('advanced pipeline disabled: ' + ((e && e.message) || e));
          api.resize();
        }
      }
      if (!advanced) renderForward();
      lastStats = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    },
    // readback = true also reads the auto-exposure state from the GPU (a synchronous stall: debugging only)
    stats(readback = false) {
      const info = renderer.info;
      return {
        calls: lastStats.calls,
        tris: lastStats.tris,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs ? info.programs.length : 0,
        res: [api.resolution.x, api.resolution.y],
        scale: dyn.scale,
        quality: quality.name,
        advanced,
        softShadows,
        shaderErrors: failed.other + (failed.post ? 1 : 0) + (failed.sky ? 1 : 0),
        adapt: post && readback ? post.readAdapt() : null,
      };
    },
    dispose() {
      if (post) post.dispose();
      hdr.dispose();
      uninstallSoftShadows();
      renderer.dispose();
    },
  };

  api.resize();
  window.addEventListener('resize', () => api.resize());

  // ---- self test: render one lit, shadowed cube through the whole chain and see which shaders the driver accepts ----
  try {
    const m = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);
    cube.castShadow = cube.receiveShadow = true;
    cube.position.set(0, 0.5, -3);
    scene.add(cube);
    const once = () => {
      camera.updateMatrixWorld(true);
      if (advanced) renderAdvanced(0.016);
      else renderForward();
    };
    try {
      once();
    } catch (e) {
      if (advanced) {
        advanced = false;
        console.error('[cine] advanced pipeline failed its self test, using forward fallback: ' + ((e && e.message) || e));
      }
    }
    if (failed.shadow && softShadows) {
      uninstallSoftShadows();
      softShadows = false;
      failed.shadow = false;
      sun.shadow.radius = 2;
      cube.material = new THREE.MeshStandardMaterial({ color: 0x808081 });
      console.warn('[cine] soft shadow chunk rejected by the driver, using stock PCF');
      try {
        once();
      } catch {
        advanced = false;
      }
    }
    if (failed.sky) console.error('[cine] sky shader failed to compile');
    scene.remove(cube);
    cube.geometry.dispose();
    m.dispose();
    if (cube.material !== m) cube.material.dispose();
    if (!advanced) {
      try {
        renderer.setRenderTarget(null);
      } catch {}
      api.resize();
    }
    frameNo = 0;
  } catch (e) {
    console.error('[cine] self test threw: ' + ((e && e.stack) || e));
  }
  return api;
}

