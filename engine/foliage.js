import * as THREE from 'three';

// Vertex wind. Geometry may carry `aWind` (vec3): x = how far the vertex follows the slow bend of the whole plant
// (metres at full gust), y = leaf / needle flutter weight, z = random phase. Missing attribute = rigid.
const WIND_PARS = /* glsl */ `
attribute vec3 aWind;
uniform float uTime, uWindStrength; uniform vec2 uWindDir, uFadeDist;
`;
const WIND_VERT = /* glsl */ `
{
  #ifdef USE_INSTANCING
    vec3 wRoot = instanceMatrix[3].xyz;
  #else
    vec3 wRoot = modelMatrix[3].xyz;
  #endif
  #ifdef CINE_FADE
    // small plants shrink into the ground with distance instead of popping
    transformed *= 1.0 - smoothstep(uFadeDist.x, uFadeDist.y, distance(cameraPosition, (modelMatrix * vec4(wRoot, 1.0)).xyz));
  #endif
  float wPh = dot(wRoot.xz, vec2(0.131, 0.173));
  float wGust = 0.55 + 0.45 * sin(uTime * 0.31 + wPh * 0.37);                // slow gusts travelling over the land
  float wBend = (sin(uTime * 0.9 + wPh) * 0.6 + sin(uTime * 2.1 + wPh * 1.7) * 0.25 + 0.35) * uWindStrength * wGust;
  transformed.xz += uWindDir * (wBend * aWind.x);
  float wFl = uTime * 4.7 + aWind.z * 6.2831853 + wPh;
  transformed += vec3(sin(wFl), cos(wFl * 1.31) * 0.6, sin(wFl * 0.83 + 1.7)) * (aWind.y * uWindStrength * wGust * 0.035);
}
`;

// Light passing through thin leaves: an extra diffuse lobe when the light is behind the surface, strongest when the
// camera looks toward the light. It reuses the shadowed light colour, so it costs no extra shadow lookups.
const TRANSLUCENCY = /* glsl */ `
uniform vec3 uTransCol;
void RE_Direct_Foliage( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float back = saturate( dot( - geometryNormal, directLight.direction ) * 0.6 + 0.4 );
  float toward = pow( saturate( dot( - geometryViewDir, directLight.direction ) ), 4.0 );
  reflectedLight.directDiffuse += directLight.color * uTransCol * material.diffuseColor * RECIPROCAL_PI * back * ( 0.35 + 1.5 * toward );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Foliage
`;

let keyId = 0;

// Alpha-tested vegetation material set: wind, translucency, coverage that survives mip-mapping, the matching depth
// material for the shadow pass, and (for cut-outs) a depth pre-pass material. Use foliageMeshes() to build meshes.
//   fixedNormals : keep the authored normals on both faces (cards shaded as part of one soft crown volume)
export function makeFoliageMaterial(cine, opts = {}) {
  const { map = null, color = 0xffffff, roughness = 0.8, alphaTest = 0.4, translucency = [0, 0, 0], fixedNormals = true, wind = true, side = THREE.DoubleSide, vertexColors = false, name = 'foliage' } = opts;
  const cutout = opts.cutout ?? !!map;
  const fade = opts.fadeDistance || null; // [start, end] metres
  const mipBoost = opts.mipBoost ?? 0.35; // alpha gain per mip level (dense cards); lower it for sparse pictures
  const specular = opts.specular ?? 0.25; // cards have made-up normals: full grazing-angle sun glints would be wrong
  const uniforms = {
    uTime: cine.uniforms.time,
    uWindStrength: cine.uniforms.windStrength,
    uWindDir: cine.uniforms.windDir,
    uTransCol: { value: new THREE.Vector3().fromArray(translucency) },
    uMapSize: { value: map && map.image ? map.image.width : 256 },
    uFadeDist: { value: new THREE.Vector2(fade ? fade[0] : 1e6, fade ? fade[1] : 1e6 + 1) },
  };
  const hasTrans = translucency[0] + translucency[1] + translucency[2] > 0;
  const prepass = cutout && opts.prepass !== false;
  const key = 'cine-foliage-' + keyId++;
  // pass: 'single' = classic alpha test; 'pre' = depth only; 'color' = lit, drawn where depth equals the pre-pass
  const build = (pass) => {
    const test = cutout && pass !== 'color';
    const m = new THREE.MeshStandardMaterial({ map, color, roughness, metalness: 0, side, alphaTest: test ? alphaTest : 0, alphaToCoverage: test, vertexColors });
    m.name = name + (pass === 'single' ? '' : '-' + pass);
    m.defines = { ...(m.defines || {}), CINE_SHADOW_LITE: '' };
    if (fade) m.defines.CINE_FADE = '';
    if (pass === 'pre') {
      m.defines.CINE_DEPTH_ONLY = '';
      m.colorWrite = false;
    }
    if (pass === 'color') {
      m.depthFunc = THREE.EqualDepth;
      m.depthWrite = false;
    }
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      // both passes must produce bit-identical positions
      sh.vertexShader = 'invariant gl_Position;\n' + (wind ? WIND_PARS + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_VERT) : sh.vertexShader);
      let fs = sh.fragmentShader;
      if (cutout)
        fs = fs.replace('#include <common>', '#include <common>\nuniform float uMapSize;').replace(
          '#include <map_fragment>',
          /* glsl */ `#include <map_fragment>
  { // minified cut-outs lose coverage in the mips: boost alpha with the mip level so distant crowns stay full
    vec2 tc = vMapUv * uMapSize;
    float lod = max(0.0, 0.5 * log2(max(dot(dFdx(tc), dFdx(tc)), dot(dFdy(tc), dFdy(tc)))));
    diffuseColor.a *= 1.0 + lod * ${mipBoost.toFixed(3)};
  }`,
        );
      fs = fs.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n#ifdef CINE_DEPTH_ONLY\n  gl_FragColor = vec4( 0.0, 0.0, 0.0, diffuseColor.a ); return; // alpha drives alpha-to-coverage\n#endif');
      if (fixedNormals) fs = fs.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize( vNormal ); nonPerturbedNormal = normal;');
      fs = fs.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n  material.specularColor *= ${specular.toFixed(3)}; material.specularF90 *= ${specular.toFixed(3)};`);
      if (hasTrans) fs = fs.replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + TRANSLUCENCY);
      sh.fragmentShader = fs;
    };
    m.customProgramCacheKey = () => key + '-' + pass;
    return m;
  };
  // Overlapping cut-out cards are the most expensive thing in a forest: without a pre-pass every hidden layer is
  // fully lit and then overwritten. With it, a trivial shader lays down depth first and lighting runs once per pixel.
  const material = build(prepass ? 'color' : 'single');
  const prepassMaterial = prepass ? build('pre') : null;

  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: cutout ? map : null, alphaTest: cutout ? alphaTest : 0, side });
  depthMaterial.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    if (wind) sh.vertexShader = WIND_PARS + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_VERT);
  };
  depthMaterial.customProgramCacheKey = () => key + '-depth';
  return { material, prepassMaterial, depthMaterial, uniforms };
}

// Build the mesh(es) for a foliage material set. `make(material)` must return a new Mesh / InstancedMesh each call.
// Returns [prepassMesh?, colourMesh]; add all of them to the scene.
export function foliageMeshes(set, make, { cast = true, receive = true } = {}) {
  const main = make(set.material);
  main.receiveShadow = receive;
  if (!set.prepassMaterial) {
    main.castShadow = cast;
    if (cast && set.depthMaterial) main.customDepthMaterial = set.depthMaterial;
    return [main];
  }
  // the pre-pass mesh is the shadow caster: three.js copies the caster material's alpha test onto the depth material
  const pre = make(set.prepassMaterial);
  main.castShadow = false;
  pre.castShadow = cast;
  if (cast && set.depthMaterial) pre.customDepthMaterial = set.depthMaterial;
  pre.receiveShadow = false;
  pre.renderOrder = main.renderOrder - 1;
  if (main.isInstancedMesh) {
    pre.instanceMatrix = main.instanceMatrix; // one buffer for both
    pre.count = main.count;
  }
  return [pre, main];
}
