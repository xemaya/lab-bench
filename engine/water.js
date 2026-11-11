import * as THREE from 'three';

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : v.toFixed(5));

// Directional ripple trains [dirX, dirZ, wavelength m, amplitude m]. Slopes are evaluated analytically per pixel.
const WAVES_BROAD = [
  [-0.92, 0.39, 9.5, 0.018],
  [-0.75, -0.66, 5.7, 0.012],
  [-0.99, 0.12, 3.3, 0.009],
  [-0.5, 0.87, 2.0, 0.006],
];
const WAVES_FINE = [
  [-0.8, 0.6, 1.31, 0.008],
  [-0.95, -0.31, 0.83, 0.0056],
  [-0.35, -0.94, 0.57, 0.004],
  [-0.6, 0.8, 0.39, 0.0028],
  [-1, 0.05, 0.27, 0.002],
  [0.3, 0.95, 0.47, 0.0024],
  [-0.86, -0.51, 0.21, 0.0014],
];
function slopeCode(list, name) {
  return list
    .map((w) => {
      const l = Math.hypot(w[0], w[1]),
        dx = w[0] / l,
        dz = w[1] / l,
        k = (2 * Math.PI) / w[2],
        om = Math.sqrt(9.81 * k);
      return `  ${name} += vec2(${f(dx)}, ${f(dz)}) * (${f(w[3] * k)} * cos(${f(k)} * dot(vec2(${f(dx)}, ${f(dz)}), xz) - ${f(om)} * uTime));`;
    })
    .join('\n');
}

const PARS = /* glsl */ `
uniform float uTime, uWaterY, uChop, uDistort, uReflOn, uReflLod, uAbsorb, uHasBed;
uniform sampler2D uDetail, uDetailN, uRefl, uBedMap;
uniform vec3 uDeepCol, uShallowCol, uBedRect;
uniform mat4 uReflMatrix; uniform vec2 uReflScale;
varying vec3 vWPos;
float wRough; vec2 wNxz; float wBody; float wSpark; float wDist; float wFoam;
`;

const SURFACE = /* glsl */ `
{
  vec2 xz = vWPos.xz;
  wDist = length(cameraPosition - vWPos);
  vec2 slopeA = vec2(0.0), slopeB = vec2(0.0);
${slopeCode(WAVES_BROAD, 'slopeA')}
${slopeCode(WAVES_FINE, 'slopeB')}
  float nearB = 1.0 - smoothstep(25.0, 110.0, wDist);
  vec2 t1 = texture2D(uDetailN, xz * 0.113 + uTime * vec2(-0.021, 0.009)).ba - 0.5;
  vec2 t2 = texture2D(uDetailN, xz * 0.031 + uTime * vec2(-0.007, -0.004)).ba - 0.5;
  vec2 t3 = texture2D(uDetailN, xz.yx * 0.39 + uTime * vec2(0.031, -0.027)).rg - 0.5;
  // wind structure: broad cat's-paw patches (ruffled, duller) between glassy slicks
  vec4 fn2 = texture2D(uDetail, xz * 0.0093 + uTime * vec2(0.004, 0.003));
  vec4 fn3 = texture2D(uDetail, xz * 0.0023 + uTime * vec2(0.0016, 0.0011));
  float gust = smoothstep(0.38, 0.62, fn2.g * 0.45 + fn3.g * 0.75 - 0.1);
  wNxz = (slopeA + slopeB * nearB + t1 * 0.2 + t2 * 0.24 + t3 * 0.1 * nearB) * uChop * mix(0.3, 1.25, gust);
  // water column over the bed: shallow water is clear, deep water takes the body colour
  float depth = 4.0;
  if (uHasBed > 0.5) {
    vec2 buv = (xz - uBedRect.xy) * uBedRect.z;
    float inb = step(0.0, buv.x) * step(buv.x, 1.0) * step(0.0, buv.y) * step(buv.y, 1.0);
    depth = mix(8.0, max(uWaterY - texture2D(uBedMap, buv).r, 0.0), inb);
  }
  // looking along the surface the light path through the water is longer
  float path = depth * (1.0 + 2.5 * (1.0 - clamp(normalize(cameraPosition - vWPos).y, 0.0, 1.0)));
  wBody = 1.0 - exp(-path * uAbsorb);
  // a thin, broken line of froth and wet glare where the water meets the shore
  vec4 fn = texture2D(uDetail, xz * 0.37 + uTime * vec2(-0.012, 0.007));
  float lap = 0.5 + 0.5 * sin(uTime * 0.9 + fn2.a * 6.0 + xz.x * 0.3);
  wFoam = (1.0 - smoothstep(0.0, 0.035 + 0.05 * lap, depth)) * smoothstep(0.35, 0.7, fn.a + fn.r * 0.4) * 0.6;
  vec3 alb = mix(uShallowCol, uDeepCol, smoothstep(0.0, 2.2, depth));
  alb = mix(alb, vec3(0.32, 0.33, 0.31), wFoam);
  diffuseColor.rgb *= alb;
  wSpark = mix(1.0, 0.6, gust);
  wRough = mix(0.045, 0.16, smoothstep(12.0, 380.0, wDist)) * mix(0.7, 1.6, gust);
  wRough = mix(wRough, 0.5, wFoam);
  wNxz *= 1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.25, depth));      // ripples die out on the beach
}
`;

const REFLECT = /* glsl */ `
{
  vec3 wV = normalize(cameraPosition - vWPos);
  vec4 rc = uReflMatrix * vec4(vWPos.x, uWaterY, vWPos.z, 1.0);
  vec2 ruv = rc.xy / max(rc.w, 1e-4);
  vec2 gf = normalize(-wV.xz + vec2(1e-5)); vec2 gs = vec2(-gf.y, gf.x);
  float sinE = clamp(wV.y, 0.03, 1.0);
  float dk = uDistort / (1.0 + wDist * 0.07);
  vec2 tilt = vec2(dot(wNxz, gs) * sinE, dot(wNxz, gf)) * dk;
  tilt = clamp(tilt, vec2(-0.12), vec2(0.12));
  ruv += tilt * uReflScale;
  float r = material.roughness;
  float lod = clamp(r * 9.0 - 0.3, 0.0, 6.0) + 0.5 + uReflLod;
  vec2 st = vec2(0.0, r * 0.11 + 0.012);                       // reflections smear vertically on rippled water
  vec2 lo = vec2(0.002), hi = vec2(0.998);
  vec3 pr = textureLod(uRefl, clamp(ruv, lo, hi), lod).rgb * 0.5
          + textureLod(uRefl, clamp(ruv + st, lo, hi), lod + 0.6).rgb * 0.25
          + textureLod(uRefl, clamp(ruv - st * 0.6, lo, hi), lod + 0.6).rgb * 0.25;
  pr = min(pr, vec3(48.0));
  radiance = mix(radiance, pr, uReflOn);
}
`;

// A water surface for lakes / ponds / calm sea. Optional inputs:
//   reflection : the object returned by createPlanarReflection (otherwise the sky environment is reflected)
//   bed        : { texture, x0, z0, size } height map (metres, red channel) of the ground under the water
export function createWater(cine, opts = {}) {
  const {
    y = 0,
    size = 4000,
    detail,
    detailN,
    reflection = null,
    bed = null,
    deepColor = [0.006, 0.02, 0.018],
    shallowColor = [0.05, 0.06, 0.035],
    chop = 0.55,
    distort = 1,
    absorb = 0.9,
  } = opts;
  const uniforms = {
    uTime: cine.uniforms.time,
    uWaterY: { value: y },
    uChop: { value: chop },
    uDistort: { value: distort },
    uAbsorb: { value: absorb },
    uDetail: { value: detail },
    uDetailN: { value: detailN },
    uDeepCol: { value: new THREE.Vector3().fromArray(deepColor) },
    uShallowCol: { value: new THREE.Vector3().fromArray(shallowColor) },
    uHasBed: { value: bed ? 1 : 0 },
    uBedMap: { value: bed ? bed.texture : null },
    uBedRect: { value: bed ? new THREE.Vector3(bed.x0, bed.z0, 1 / bed.size) : new THREE.Vector3() },
    ...(reflection
      ? reflection.uniforms
      : { uRefl: { value: null }, uReflMatrix: { value: new THREE.Matrix4() }, uReflOn: { value: 0 }, uReflScale: { value: new THREE.Vector2() }, uReflLod: { value: 0 } }),
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0, transparent: true, depthWrite: true });
  material.name = 'cine-water';
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader =
      'varying vec3 vWPos;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace('#include <map_fragment>', SURFACE)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = wRough;')
      .replace(
        '#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\n  normal = normalize(mat3(viewMatrix) * normalize(vec3(-wNxz.x, 1.0, -wNxz.y)));',
      )
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n  material.specularColor = vec3(0.028);')
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + REFLECT)
      .replace(
        '#include <lights_fragment_end>',
        '#include <lights_fragment_end>\n  reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(40.0)) * wSpark;',
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `{
    // what is seen = light scattered back by the water body (wBody) + mirror reflection (Fresnel) + the bed behind
    float wF = 0.028 + 0.972 * pow(1.0 - clamp(dot(normal, geometryViewDir), 0.0, 1.0), 5.0);
    float body = max(wBody, wFoam);
    float wA = 1.0 - (1.0 - body) * (1.0 - wF);
    outgoingLight = (totalDiffuse * body + totalSpecular) / max(wA, 1e-3);
    diffuseColor.a = wA;
  }
#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'cine-water-1';
  const geometry = new THREE.PlaneGeometry(size, size, 1, 1).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = y;
  mesh.name = 'water';
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  if (reflection) reflection.hide.push(mesh);
  return { mesh, material, uniforms };
}
