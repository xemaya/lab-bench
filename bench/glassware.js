import * as THREE from 'three';
import { cm } from './look.js';

// Glass and liquids.
//
// three.js draws transmissive materials against a copy of the opaque scene only, so two transmissive surfaces
// cannot see each other: a transmissive beaker would hide the transmissive liquid inside it. Hence the split:
//   glass  = an ordinary alpha-blended shell whose reflections are exempt from the opacity (thin glass is almost
//            invisible except for what it reflects),
//   liquid = the one transmissive body per vessel: it refracts the metal, the bubbles and the bench behind it and
//            takes its colour from absorption (attenuationColor), which is what a coloured solution really does.
// `liquidMode: 'simple'` swaps the liquid for the same alpha-blended trick: no refraction, but no second scene pass.

// Alpha-blended material whose specular light is added at full strength instead of being scaled by the opacity.
// `edge` darkens and thickens the body where the surface turns away from the eye, the way a glass wall seen
// edge-on does: it is what draws the outline of a clear vessel against a pale bench.
function keepSpecular(material, edge = 0) {
  material.transparent = true;
  material.premultipliedAlpha = true;
  material.depthWrite = false;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      /* glsl */ `
      float labEdge = ${edge.toFixed(3)} * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
      float labA0 = mix(diffuseColor.a, 1.0, labEdge);
      totalDiffuse *= mix(1.0, 0.22, labEdge);
      float labSpec = clamp(max(totalSpecular.r, max(totalSpecular.g, totalSpecular.b)), 0.0, 1.0);
      float labA = labA0 + labSpec * (1.0 - labA0);
      // premultiplied output: tinted body at its own opacity, reflections on top, the rest of the pixel shows through
      gl_FragColor = vec4((totalDiffuse * labA0 + totalSpecular) / max(labA, 1e-3), labA);`,
    );
  };
  material.customProgramCacheKey = () => 'lab-keep-specular-' + edge;
  return material;
}

export function makeGlassMaterial() {
  return keepSpecular(
    new THREE.MeshPhysicalMaterial({ color: 0xf4fbff, roughness: 0.03, metalness: 0, ior: 1.5, opacity: 0.06, specularIntensity: 1, envMapIntensity: 1.25 }),
    0.55,
  );
}

// A low-form beaker as one closed lathe profile: outer wall, pouring lip, inner wall, inner floor.
export function makeBeaker({ radius = cm(3.6), height = cm(9.5), wall = cm(0.22), glass = makeGlassMaterial() } = {}) {
  const R = radius,
    H = height,
    c = cm(0.5); // corner radius
  const pts = [];
  const arc = (cx, cy, r, a0, a1, n = 6) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  };
  pts.push(new THREE.Vector2(0, 0));
  arc(R - c, c, c, -Math.PI / 2, 0); // outer bottom corner
  pts.push(new THREE.Vector2(R, H - cm(0.5)));
  pts.push(new THREE.Vector2(R + cm(0.28), H)); // flared lip
  pts.push(new THREE.Vector2(R + cm(0.28) - wall, H + cm(0.02)));
  pts.push(new THREE.Vector2(R - wall, H - cm(0.55)));
  const ci = c - wall * 0.5;
  arc(R - wall - ci, wall + ci, ci, 0, -Math.PI / 2); // inner bottom corner
  pts.push(new THREE.Vector2(0, wall));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 72), glass);
  mesh.name = 'beaker';
  mesh.renderOrder = 20; // after every liquid
  mesh.castShadow = false; // clear glass barely shades; the liquid casts for it
  mesh.receiveShadow = false;
  return { mesh, innerRadius: R - wall, floorY: wall, height: H, corner: ci };
}

// The liquid body that fills a beaker up to `level` (measured from the bench).
export function makeLiquid(beaker, level, { mode = 'transmission', color = [1, 1, 1], density = 0 } = {}) {
  const r = beaker.innerRadius - cm(0.03),
    y0 = beaker.floorY + cm(0.02),
    c = beaker.corner;
  const pts = [new THREE.Vector2(0, y0)];
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / 6);
    pts.push(new THREE.Vector2(r - c + Math.cos(a) * c, y0 + c + Math.sin(a) * c));
  }
  pts.push(new THREE.Vector2(r, level - cm(0.04)));
  pts.push(new THREE.Vector2(r - cm(0.04), level));
  pts.push(new THREE.Vector2(0, level));
  const geometry = new THREE.LatheGeometry(pts, 64);
  let material;
  if (mode === 'transmission') {
    // three bends the view ray once, by `thickness`, with no idea of the vessel's shape: at the true thickness a
    // nail in the beaker turns into an S. A thin virtual slab keeps a hint of refraction and solids stay readable.
    material = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0, transmission: 1, ior: 1.333, thickness: beaker.innerRadius * 0.3, specularIntensity: 1 });
  } else {
    material = keepSpecular(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0, ior: 1.333, opacity: 0.5 }));
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'liquid';
  mesh.renderOrder = 10;
  // Neither glass nor liquid casts a sun shadow: a solid one is far too heavy, and a dithered caster (the usual trick
  // for translucency) shows its pattern through the soft-shadow filter. Contact darkening comes from the
  // ambient-occlusion pass, which sees the liquid body in the depth buffer.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const api = {
    mesh,
    material,
    mode,
    level,
    radius: r,
    floorY: y0,
    // colour = what white light looks like after crossing the vessel; density 0 = water-clear, 1 = strong solution
    setColor(rgb, dens) {
      if (mode === 'transmission') {
        material.attenuationColor.setRGB(rgb[0], rgb[1], rgb[2]);
        material.attenuationDistance = dens <= 0.001 ? Infinity : (material.thickness * 0.65) / dens;
      } else {
        material.color.setRGB(rgb[0], rgb[1], rgb[2]);
        material.opacity = 0.04 + 0.62 * Math.min(1, dens);
      }
    },
  };
  api.setColor(color, density);
  return api;
}

// A shallow white porcelain dish for solids waiting to be used.
export function makeDish({ radius = cm(4.2), height = cm(1.1) } = {}) {
  const t = cm(0.25);
  const pts = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(radius * 0.72, 0),
    new THREE.Vector2(radius, height),
    new THREE.Vector2(radius - t * 0.6, height + cm(0.05)),
    new THREE.Vector2(radius * 0.72 - t * 0.2, t),
    new THREE.Vector2(0, t),
  ];
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), new THREE.MeshPhysicalMaterial({ color: 0xf6f5f0, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.15 }));
  mesh.castShadow = mesh.receiveShadow = true;
  return { mesh, floorY: t, innerRadius: radius * 0.7 };
}
