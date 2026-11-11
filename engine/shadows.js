import * as THREE from 'three';

export const SHADOW_TAG = '// CINE_SHADOW';
let stockChunk = null;

// Replace three's directional/spot getShadow() with percentage-closer soft shadows: a blocker search estimates how
// far the occluder is, the filter radius (penumbra) grows with that distance, and a receiver-plane depth bias keeps
// the wide kernel free of acne. `frustum` is the size of the shadow camera in metres.
export function installSoftShadows(frustum, { taps = 16, searchTaps = 8 } = {}) {
  const chunks = THREE.ShaderChunk;
  if (stockChunk === null) stockChunk = chunks.shadowmap_pars_fragment;
  const src = stockChunk;
  const a = src.indexOf('float getShadow(');
  const cube = src.indexOf('vec2 cubeToUV');
  let b = src.lastIndexOf('// cubeToUV()', cube);
  if (b < a) b = cube;
  if (a < 0 || cube < 0 || cube < a) {
    console.warn('[cine] soft shadows: unexpected three.js shader chunk layout, keeping stock PCF');
    return false;
  }
  const code = /* glsl */ `
	${SHADOW_TAG}
	const vec2 SL_FRUSTUM = vec2( ${frustum.width.toFixed(3)}, ${frustum.height.toFixed(3)} );   // metres across the shadow map
	const float SL_DEPTH = ${frustum.depth.toFixed(3)};                                          // metres across the depth range
	float slIGN( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
	vec2 slVogel( int i, int n, float phi ) {
		float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
		float th = float( i ) * 2.39996323 + phi;
		return r * vec2( cos( th ), sin( th ) );
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		shadowCoord.xyz /= shadowCoord.w;
		vec3 sc = shadowCoord.xyz;
		vec3 dx = dFdx( sc ), dy = dFdy( sc );
		bool inFrustum = sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0;
		if ( ! ( inFrustum && sc.z <= 1.0 ) ) return 1.0;
		// receiver plane depth bias: depth gradient of the receiver in shadow-map uv space
		float det = dx.x * dy.y - dx.y * dy.x;
		vec2 dz = vec2( 0.0 );
		if ( abs( det ) > 1e-12 ) dz = vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det;
		vec2 texel = 1.0 / shadowMapSize;
		float maxSlope = 0.0030 / max( texel.x, texel.y );
		dz = clamp( dz, vec2( - maxSlope ), vec2( maxSlope ) );
		float zr = sc.z + shadowBias - ( abs( dz.x ) * texel.x + abs( dz.y ) * texel.y ) * 0.35;
		float phi = slIGN( gl_FragCoord.xy ) * 6.2831853;
		vec2 edgeD = min( sc.xy, 1.0 - sc.xy );
		float edgeFade = smoothstep( 0.0, 0.02, min( edgeD.x, edgeD.y ) );
		#ifdef CINE_SHADOW_LITE
		{
			// heavily overdrawn cut-out surfaces (foliage): a fixed 4-tap filter instead of the full search
			vec2 r4 = max( vec2( 0.06 * shadowRadius ) / SL_FRUSTUM, texel * 1.5 );
			float l4 = 0.0;
			for ( int i = 0; i < 4; i ++ ) {
				vec2 o = slVogel( i, 4, phi ) * r4;
				l4 += step( zr + dot( o, dz ), unpackRGBAToDepth( texture2D( shadowMap, sc.xy + o ) ) );
			}
			return mix( 1.0, mix( 1.0, l4 * 0.25, edgeFade ), shadowIntensity );
		}
		#endif
		if ( shadowRadius < 0.01 ) {
			// radius 0 = hard single tap (secondary views such as planar reflections)
			float l1 = step( zr, unpackRGBAToDepth( texture2D( shadowMap, sc.xy ) ) );
			return mix( 1.0, mix( 1.0, l1, edgeFade ), shadowIntensity );
		}
		// --- blocker search ---
		vec2 searchR = ( 0.55 * shadowRadius ) / SL_FRUSTUM;     // metres -> uv
		float blk = 0.0, nb = 0.0;
		for ( int i = 0; i < ${searchTaps}; i ++ ) {
			vec2 o = slVogel( i, ${searchTaps}, phi ) * searchR;
			float d = unpackRGBAToDepth( texture2D( shadowMap, sc.xy + o ) );
			float z = zr + dot( o, dz );
			if ( d < z ) { blk += d; nb += 1.0; }
		}
		if ( nb < 0.5 ) return 1.0;
		float avg = blk / nb;
		// --- penumbra: grows with blocker distance (sun half-angle scaled up for look) ---
		float distM = max( zr - avg, 0.0 ) * SL_DEPTH;
		float penM = clamp( distM * 0.022 * shadowRadius, 0.012 * shadowRadius, 0.60 * shadowRadius );
		vec2 filtR = max( vec2( penM ) / SL_FRUSTUM, texel * 1.25 );
		float lit = 0.0;
		for ( int i = 0; i < ${taps}; i ++ ) {
			vec2 o = slVogel( i, ${taps}, phi + 1.7 ) * filtR;
			float d = unpackRGBAToDepth( texture2D( shadowMap, sc.xy + o ) );
			lit += step( zr + dot( o, dz ), d );
		}
		lit /= float( ${taps} );
		// fade to lit at the very edge of the map so the frustum border never shows
		lit = mix( 1.0, lit, edgeFade );
		return mix( 1.0, lit, shadowIntensity );
	}

	`;
  chunks.shadowmap_pars_fragment = src.slice(0, a) + code + src.slice(b);
  return true;
}

export function uninstallSoftShadows() {
  if (stockChunk !== null) THREE.ShaderChunk.shadowmap_pars_fragment = stockChunk;
}

// Fixed fit: wrap the orthographic shadow camera tightly around a world-space box (small, bounded scenes).
// `casterMin/Max` may be a larger box whose contents only need to be inside the depth range.
export function fitShadowToBox(light, sunDir, min, max, casterMin = min, casterMax = max) {
  const centre = min.clone().add(max).multiplyScalar(0.5);
  light.target.position.copy(centre);
  light.position.copy(centre).addScaledVector(sunDir, 200);
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);
  const view = new THREE.Matrix4().lookAt(light.position, centre, new THREE.Vector3(0, 1, 0));
  view.setPosition(light.position);
  view.invert();
  const p = new THREE.Vector3();
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity;
  const corners = (a, b, fn) => {
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? b.x : a.x, i & 2 ? b.y : a.y, i & 4 ? b.z : a.z).applyMatrix4(view);
      fn(p);
    }
  };
  corners(min, max, (q) => {
    x0 = Math.min(x0, q.x);
    x1 = Math.max(x1, q.x);
    y0 = Math.min(y0, q.y);
    y1 = Math.max(y1, q.y);
    z0 = Math.min(z0, -q.z);
    z1 = Math.max(z1, -q.z);
  });
  corners(casterMin, casterMax, (q) => {
    z0 = Math.min(z0, -q.z);
  });
  const cam = light.shadow.camera;
  cam.left = x0 - 1;
  cam.right = x1 + 1;
  cam.bottom = y0 - 1;
  cam.top = y1 + 1;
  cam.near = Math.max(1, z0 - 4);
  cam.far = z1 + 4;
  cam.updateProjectionMatrix();
  return { width: cam.right - cam.left, height: cam.top - cam.bottom, depth: cam.far - cam.near };
}

// Follow fit: a square shadow frustum of constant size that tracks the view camera (large / open scenes). The
// centre is snapped to whole shadow texels in light space, so the shadow edges do not crawl while the camera moves.
export function createShadowFollower(light, { size = 110, depth = 600, lead = 0.32 } = {}) {
  const cam = light.shadow.camera;
  cam.left = -size / 2;
  cam.right = size / 2;
  cam.bottom = -size / 2;
  cam.top = size / 2;
  cam.near = 1;
  cam.far = depth;
  cam.updateProjectionMatrix();
  const right = new THREE.Vector3(),
    up = new THREE.Vector3(),
    fwd = new THREE.Vector3(),
    c = new THREE.Vector3(),
    q = new THREE.Vector3();
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  function update(viewCamera, sunDir, focusY = null) {
    viewCamera.getWorldPosition(c);
    viewCamera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-6) fwd.normalize();
    c.addScaledVector(fwd, size * lead);
    if (focusY !== null) c.y = focusY;
    // light-space basis (must match DirectionalLightShadow: lookAt(position -> target, up = +Y))
    right.crossVectors(WORLD_UP, sunDir).normalize();
    up.crossVectors(sunDir, right).normalize();
    const texel = size / light.shadow.mapSize.x;
    const cx = Math.round(c.dot(right) / texel) * texel,
      cy = Math.round(c.dot(up) / texel) * texel,
      cz = c.dot(sunDir);
    q.set(0, 0, 0).addScaledVector(right, cx).addScaledVector(up, cy).addScaledVector(sunDir, cz);
    light.target.position.copy(q);
    light.position.copy(q).addScaledVector(sunDir, depth * 0.5);
    light.updateMatrixWorld(true);
    light.target.updateMatrixWorld(true);
  }
  return { update, frustum: { width: size, height: size, depth: depth - 1 } };
}
