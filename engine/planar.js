import * as THREE from 'three';

// Planar reflection of the world about a horizontal plane (y = const). Registers itself as a pre-pass on the
// renderer: every frame the scene is rendered from the mirrored camera into a mip-mapped HDR target, with an
// oblique near plane so nothing below the surface leaks in. Materials sample it through `uniforms`:
//   uRefl, uReflMatrix (world -> reflection uv), uReflOn, uReflScale, uReflLod
export function createPlanarReflection(cine, { y = 0, hide = [], clipBias = 0.02 } = {}) {
  const cam = new THREE.PerspectiveCamera();
  cam.layers.set(0);
  const target = new THREE.WebGLRenderTarget(16, 16, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  });
  target.texture.name = 'planarReflection';
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;
  const uniforms = {
    uRefl: { value: black },
    uReflMatrix: { value: new THREE.Matrix4() },
    uReflOn: { value: 0 },
    uReflScale: { value: new THREE.Vector2(0.5, 0.5) },
    uReflLod: { value: 0 },
  };
  const pos = new THREE.Vector3(),
    look = new THREE.Vector3(),
    rot = new THREE.Matrix4(),
    res = new THREE.Vector2(),
    plane = new THREE.Plane(),
    clip = new THREE.Vector4(),
    q = new THREE.Vector4();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const vis = [];
  const state = { target, camera: cam, uniforms, enabled: true, active: false, hide, y, before: null, after: null };

  function pass(renderer, scene, view) {
    const scale = cine.quality.planar || 0;
    pos.setFromMatrixPosition(view.matrixWorld);
    if (!state.enabled || scale <= 0 || pos.y < state.y + 0.03) {
      uniforms.uReflOn.value = 0;
      state.active = false;
      return;
    }
    res.copy(cine.resolution);
    const w = Math.max(64, Math.round((res.x * scale) / 16) * 16),
      h = Math.max(32, Math.round((res.y * scale) / 8) * 8);
    if (target.width !== w || target.height !== h) target.setSize(w, h);

    // mirrored camera
    rot.extractRotation(view.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(pos);
    cam.position.set(pos.x, 2 * state.y - pos.y, pos.z);
    cam.up.set(0, 1, 0).applyMatrix4(rot);
    cam.up.y = -cam.up.y;
    look.y = 2 * state.y - look.y;
    cam.lookAt(look);
    cam.near = view.near;
    cam.far = view.far;
    cam.updateMatrixWorld(true);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    cam.projectionMatrix.copy(view.projectionMatrix);
    uniforms.uReflMatrix.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    // oblique near plane = the reflecting surface (Lengyel)
    plane.normal.set(0, 1, 0);
    plane.constant = -state.y + clipBias;
    plane.applyMatrix4(cam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = cam.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + pm[8]) / pm[0];
    q.y = (Math.sign(clip.y) + pm[9]) / pm[5];
    q.z = -1;
    q.w = (1 + pm[10]) / pm[14];
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x;
    pm[6] = clip.y;
    pm[10] = clip.z + 1;
    pm[14] = clip.w;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();

    const ve = view.projectionMatrix.elements;
    uniforms.uReflScale.value.set(ve[0] * 0.5, ve[5] * 0.5);
    uniforms.uReflLod.value = Math.log2(Math.max(h, 1) / 270);

    for (let i = 0; i < state.hide.length; i++) {
      vis[i] = state.hide[i].visible;
      state.hide[i].visible = false;
    }
    const softness = cine.sun.shadow.radius;
    cine.sun.shadow.radius = 0; // hard shadows are enough in a rippled mirror image
    try {
      if (state.before) state.before(cam); // host hook, e.g. switch the world to cheaper detail levels
      cine.renderWorld(cam, target);
    } finally {
      cine.sun.shadow.radius = softness;
      if (state.after) state.after(cam);
      for (let i = 0; i < state.hide.length; i++) state.hide[i].visible = vis[i];
    }
    uniforms.uRefl.value = target.texture;
    uniforms.uReflOn.value = 1;
    state.active = true;
  }
  state.pass = pass;
  cine.addPrePass(pass);
  return state;
}
