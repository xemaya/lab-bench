import * as THREE from 'three';

// Room light: bake what the bench "sees" (the window, sunlit table, walls, ceiling) into the environment map, so
// reflections in glass are the actual window and the fill light respects the room. Two passes: the second one sees
// the room already lit by the first, which stands in for bounced light.
//
//   const bake = createRoomLight(cine, { hide: [apparatus], position });
//   bake();         after building the room, and again whenever the sun changes
//   bake(false);    plain sky instead (comparison / fallback)
//
// hide     : objects left out of the bake (the apparatus: it should not reflect itself, and it moves)
// position : where the probe stands, a little above the middle of the apparatus
export function createRoomLight(cine, { hide = [], position }) {
  const { renderer, scene } = cine;
  const pmrem = new THREE.PMREMGenerator(renderer);
  let roomEnv = null;
  return function bake(useRoom = true) {
    cine.refreshLook(true); // the sky; for a room bake it is what the first pass starts from
    if (!useRoom) return;
    const shown = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    const skyEnv = cine.sky.uniforms.uEnv.value;
    cine.sky.uniforms.uEnv.value = 1; // no sun disc: three's pre-filter would turn it into fireflies
    const prevTarget = renderer.getRenderTarget();
    try {
      for (let pass = 0; pass < 2; pass++) {
        renderer.shadowMap.needsUpdate = true;
        const rt = pmrem.fromScene(scene, 0, 0.2, 400, { size: 256, position });
        if (roomEnv) roomEnv.dispose();
        roomEnv = rt;
        scene.environment = rt.texture;
      }
    } catch (e) {
      console.error('[bench] room environment bake failed, keeping the sky: ' + ((e && e.stack) || e));
    }
    renderer.setRenderTarget(prevTarget);
    cine.sky.uniforms.uEnv.value = skyEnv;
    hide.forEach((o, i) => (o.visible = shown[i]));
    renderer.shadowMap.needsUpdate = true;
  };
}
