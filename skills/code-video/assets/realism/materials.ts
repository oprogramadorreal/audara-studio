// Procedural surfaces inside three.js's own PBR materials. patch() injects GLSL into a MeshStandardMaterial or
// MeshPhysicalMaterial, so the surface keeps three's lights, shadows and environment light, and adds the Env's
// aerial perspective (env.ts) and a shadow filter that doesn't crawl. Adapted from golden-temple's
// src/core/materials.js and its pagoda-mat.js footprint filtering (MIT, Leon Lin: see LICENSE), scoped to the
// material: nothing here edits three's shared shader chunks, so other scenes in the video are untouched.
//
// Supported: fresh MeshStandardMaterial / MeshPhysicalMaterial on Mesh and InstancedMesh, static geometry
// (no vertex displacement: three's shadow pass draws the undisplaced shape). A material's existing
// onBeforeCompile runs first. Not with scene.fog: the aerial perspective replaces three's fog in these materials.
import * as THREE from 'three';
import { NOISE } from './noise';
import { aerialGLSL, type Env } from './env';

/** GLSL statements run at points of three's shader; each may use vWPos, vWNrm, the n_ noise and helpers below. */
export interface Hooks {
  /** Declarations: globals the other hooks share (`float g_h;`), functions, uniforms. */
  fragHead?: string;
  /** After <color_fragment>: change `diffuseColor` (vec4, linear). */
  fragColor?: string;
  /** After <roughnessmap_fragment>: change `roughnessFactor`. */
  fragRough?: string;
  /** After <metalnessmap_fragment>: change `metalnessFactor`. */
  fragMetal?: string;
  /** After <normal_fragment_maps>: change `normal` (view space, normalized), e.g. with n_bumpView. */
  fragNormal?: string;
  /** After <emissivemap_fragment>: change `totalEmissiveRadiance` (HDR: a lit window, a flame). */
  fragEmissive?: string;
  /** Extra uniforms (objects shared by reference: change `.value` from render()). */
  uniforms?: Record<string, THREE.IUniform>;
}

const VERT_HEAD = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNrm;`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNrm;
${NOISE}
// a height field h as a bump on the view-space normal n (p: view position), by screen derivatives
vec3 n_bumpView(vec3 p, vec3 n, float h, float strength){
  vec3 dpdx = dFdx(p), dpdy = dFdy(p);
  float dhdx = dFdx(h), dhdy = dFdy(h);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
  return normalize(abs(det) * n - strength * grad);
}
// 1 while a feature of this period (m) is resolved, fading to 0 as it shrinks below a pixel: multiply every
// fine term by it, or it shimmers from frame to frame in a moving shot (golden-temple's pagoda-mat.js)
float n_aa(float period){ return 1.0 - smoothstep(0.16, 0.45, max(length(fwidth(vWPos)), 1e-6) / period); }
// specular anti-aliasing: a roughness raised where the normal turns fast across a pixel (no sparkling rims)
float n_specAA(float r){ vec3 dn = fwidth(normalize(vWNrm)); return sqrt(clamp(r * r + min(dot(dn, dn) * 1.6, 0.35), 0.0, 1.0)); }`;

// world position and normal for the fragment hooks, after three's own vertex code (instancing, batching and
// non-uniform scale included: the normal comes from three's transformedNormal, already inverse-transposed)
const VERT_WORLD = /* glsl */ `
{
  vec4 _wp = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
    _wp = batchingMatrix * _wp;
  #endif
  #ifdef USE_INSTANCING
    _wp = instanceMatrix * _wp;
  #endif
  vWPos = (modelMatrix * _wp).xyz;
  vWNrm = inverseTransformDirection(transformedNormal, viewMatrix);
}`;

// three turns its PCF taps by screen-space noise, which crawls when the camera moves; a fixed turn is stable,
// and the soft edge comes from the sun's jitter across sub-frames instead (light.ts, sampling.ts)
const SHADOW_PARS = THREE.ShaderChunk.shadowmap_pars_fragment
  .split('float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;').join('float phi = 0.785;');

/** FNV-1a, twice with different seeds: a program cache key from everything this patch injects. */
function hashKey(s: string) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}

/**
 * Inject `hooks` into a three.js PBR material and return it. `env`: the scene's light and air, for the aerial
 * perspective (null leaves it out: a material seen only up close, or one you haze yourself). Two materials
 * with the same hooks and Env share a compiled program; an edited hook, or an edited helper here, makes a new
 * one (the cache key is a hash of all the GLSL this adds), so a hot-reloaded scene never gets a stale shader.
 */
export function patch<M extends THREE.MeshStandardMaterial>(mat: M, hooks: Hooks, env: Env | null): M {
  const fragHead = `${FRAG_HEAD}\n${env ? aerialGLSL(env) : ''}\n${hooks.fragHead ?? ''}`;
  const steps: [string, string | undefined][] = [
    ['#include <color_fragment>', hooks.fragColor],
    ['#include <roughnessmap_fragment>', hooks.fragRough],
    ['#include <metalnessmap_fragment>', hooks.fragMetal],
    ['#include <normal_fragment_maps>', hooks.fragNormal],
    ['#include <emissivemap_fragment>', hooks.fragEmissive],
  ];
  const key = 'realism-' + mat.type + '-' + hashKey([VERT_HEAD, VERT_WORLD, fragHead, SHADOW_PARS, String(!!env), ...steps.map((s) => s[1] ?? '')].join('\u0001'));
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    if (hooks.uniforms) Object.assign(shader.uniforms, hooks.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_WORLD}`);
    let fs = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragHead}`)
      .replace('#include <shadowmap_pars_fragment>', SHADOW_PARS);
    for (const [at, code] of steps) if (code) fs = fs.replace(at, `${at}\n${code}`);
    if (env) fs = fs.replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyAerial(gl_FragColor.rgb, vWPos, cameraPosition);');
    shader.fragmentShader = fs;
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + key;
  mat.needsUpdate = true;
  return mat;
}

// ------------------------------------------------------------------------------------------------ surfaces
// Each returns Hooks for patch(); a base colour is a GLSL vec3 (linear). Give the material a white `color`
// (the hooks multiply it) and the roughness, metalness and clearcoat named beside each. Values are tuned in
// metres at golden-temple's scale: change them for your subject. Fine terms fade with n_aa.
export const PROC = {
  /** Vermilion lacquered wood: sun-faded patches, worn edges, ground grime, grain. MeshPhysical, roughness 0.5, clearcoat 0.25 at 0.4. */
  lacquer: (base = 'vec3(0.50, 0.072, 0.028)'): Hooks => ({
    fragHead: `float g_h;`,
    fragColor: /* glsl */ `{
      vec3 wp = vWPos; vec3 wn = normalize(vWNrm);
      float big = n_fbm3(wp * 0.23, 3);
      float mid = n_fbm3(wp * vec3(1.6, 0.35, 1.6), 3);
      vec3 gs = mix(vec3(9.0, 9.0, 0.9), vec3(9.0, 0.7, 9.0), 1.0 - abs(wn.y)); // grain along the member
      float grain = (n_snoise3(wp * gs) * 0.5 + n_snoise3(wp * gs * 2.7) * 0.25) * n_aa(0.08);
      vec3 base = ${base};
      vec3 col = base * (0.88 + 0.16 * big + 0.05 * grain);
      col = mix(col, base * vec3(1.18, 1.5, 1.6) * 0.92, smoothstep(0.25, 0.75, mid * 0.6 + 0.5 + big * 0.3) * 0.18);
      float wear = smoothstep(0.62, 0.8, n_fbm3(wp * 2.6, 3) * 0.5 + 0.5);
      col = mix(col, vec3(0.09, 0.035, 0.02), wear * 0.55);
      col *= 1.0 - (1.0 - smoothstep(0.0, 1.4, wp.y)) * 0.25 * (0.6 + 0.4 * big);
      diffuseColor.rgb *= col;
      g_h = grain * 0.35 + wear * 0.4 + mid * 0.2;
    }`,
    fragRough: `roughnessFactor = clamp(roughnessFactor * (0.85 + 0.3 * (g_h + 0.3)), 0.12, 1.0);`,
    fragNormal: `normal = n_bumpView(-vViewPosition, normal, g_h, 0.0025);`,
  }),
  /** Gold leaf or gilt bronze, lightly tarnished. MeshStandard, metalness 1, roughness about 0.22. */
  gold: (base = 'vec3(1.0, 0.70, 0.30)'): Hooks => ({
    fragHead: `float g_h;`,
    fragColor: /* glsl */ `{
      vec3 wp = vWPos;
      float n = n_fbm3(wp * 3.1, 3);
      float tarnish = smoothstep(0.2, 0.75, n_fbm3(wp * 0.9 + 7.0, 3) * 0.5 + 0.5);
      vec3 base = ${base};
      diffuseColor.rgb *= mix(base * (0.92 + 0.12 * n), base * vec3(0.55, 0.42, 0.25), tarnish * 0.35);
      g_h = n * 0.5 + tarnish * 0.3;
    }`,
    fragRough: `roughnessFactor = n_specAA(clamp(roughnessFactor + g_h * 0.12, 0.05, 1.0));`,
    fragNormal: `normal = n_bumpView(-vViewPosition, normal, g_h, 0.0012);`,
  }),
  /** Cast bronze with a dark green patina. MeshStandard, metalness 1, roughness 0.4. */
  bronze: (): Hooks => ({
    fragHead: `float g_h; float g_pat;`,
    fragColor: /* glsl */ `{
      vec3 wp = vWPos;
      float n = n_fbm3(wp * 4.0, 4);
      g_pat = smoothstep(-0.1, 0.5, n_fbm3(wp * 1.7 + 3.0, 3));
      vec3 patina = mix(vec3(0.05, 0.045, 0.035), vec3(0.10, 0.16, 0.12), smoothstep(0.3, 0.8, n * 0.5 + 0.5));
      diffuseColor.rgb *= mix(vec3(0.55, 0.36, 0.16) * (0.85 + 0.2 * n), patina, g_pat * 0.7);
      g_h = n;
    }`,
    fragRough: `roughnessFactor = n_specAA(mix(0.32, 0.75, g_pat * 0.7));`,
    fragMetal: `metalnessFactor = mix(1.0, 0.25, g_pat * 0.7);`,
    fragNormal: `normal = n_bumpView(-vViewPosition, normal, g_h, 0.002);`,
  }),
  /** Granite: speckles, weathering streaks, lichen, moss on what faces up (`moss` 0..1). MeshStandard, roughness 0.8. */
  granite: (moss = 0.6): Hooks => ({
    fragHead: `float g_h; float g_moss;`,
    fragColor: /* glsl */ `{
      vec3 wp = vWPos; vec3 wn = normalize(vWNrm);
      float big = n_fbm3(wp * 0.45, 4);
      float speck = n_snoise3(wp * 38.0) * n_aa(0.03), speck2 = n_snoise3(wp * 61.0 + 5.0) * n_aa(0.02);
      vec3 col = vec3(0.34, 0.33, 0.31) * (0.82 + 0.25 * big);
      col = mix(col, vec3(0.06), smoothstep(0.55, 0.85, speck) * 0.8);
      col = mix(col, vec3(0.62, 0.60, 0.56), smoothstep(0.6, 0.9, speck2) * 0.6);
      col *= 1.0 - smoothstep(0.0, 0.6, n_fbm3(wp * vec3(2.2, 0.35, 2.2), 3)) * 0.3;
      col = mix(col, vec3(0.42, 0.42, 0.30), smoothstep(0.62, 0.78, n_fbm3(wp * 1.9 + 3.3, 4) * 0.5 + 0.5) * 0.45);
      float up = smoothstep(0.15, 0.85, wn.y), mn = n_fbm3(wp * 1.3 + 9.1, 5) * 0.5 + 0.5;
      const float MOSS = ${moss.toFixed(3)};
      g_moss = clamp(smoothstep(0.62 - 0.35 * up * MOSS, 0.82, mn + up * 0.15) * MOSS, 0.0, 1.0);
      col = mix(col, mix(vec3(0.045, 0.075, 0.012), vec3(0.12, 0.16, 0.03), n_snoise3(wp * 7.0) * 0.5 + 0.5), g_moss);
      diffuseColor.rgb *= col;
      g_h = big * 0.5 + speck * 0.08 + g_moss * 0.6 + n_snoise3(wp * 12.0) * 0.12 * n_aa(0.05);
    }`,
    fragRough: `roughnessFactor = mix(0.72, 0.95, g_moss);`,
    fragNormal: `normal = n_bumpView(-vViewPosition, normal, g_h, 0.01);`,
  }),
  /** Weathered timber; `axis` is the grain's direction. MeshStandard, roughness 0.8 (or MeshPhysical with clearcoat for a polished floor). */
  wood: (base = 'vec3(0.24, 0.15, 0.09)', axis: 'x' | 'y' | 'z' = 'x'): Hooks => {
    const sc = axis === 'x' ? 'vec3(0.4, 14.0, 14.0)' : axis === 'y' ? 'vec3(14.0, 0.4, 14.0)' : 'vec3(14.0, 14.0, 0.4)';
    return {
      fragHead: `float g_h;`,
      fragColor: /* glsl */ `{
        vec3 wp = vWPos;
        float g = n_fbm3(wp * ${sc}, 4);
        float rings = mix(sin(g * 18.0) * 0.5 + 0.5, 0.5, clamp(fwidth(g * 18.0) * 0.6, 0.0, 1.0));
        float big = n_fbm3(wp * 0.5, 3);
        diffuseColor.rgb *= ${base} * (0.75 + 0.35 * rings * (0.6 + 0.4 * big) + 0.15 * big);
        g_h = rings * 0.5 + g * 0.3;
      }`,
      fragRough: `roughnessFactor = clamp(roughnessFactor + (g_h - 0.4) * 0.15, 0.1, 1.0);`,
      fragNormal: `normal = n_bumpView(-vViewPosition, normal, g_h, 0.002);`,
    };
  },
  /** White lime plaster with rain streaks. MeshStandard, roughness 0.93. */
  plaster: (): Hooks => ({
    fragHead: `float g_h;`,
    fragColor: /* glsl */ `{
      vec3 wp = vWPos;
      float n = n_fbm3(wp * 0.8, 4);
      vec3 col = vec3(0.78, 0.75, 0.68) * (0.92 + 0.08 * n);
      col *= 1.0 - smoothstep(0.1, 0.7, n_fbm3(wp * vec3(3.0, 0.25, 3.0), 3)) * 0.18;
      diffuseColor.rgb *= col;
      g_h = n_snoise3(wp * 14.0) * 0.5 * n_aa(0.07) + n * 0.5;
    }`,
    fragNormal: `normal = n_bumpView(-vViewPosition, normal, g_h, 0.0015);`,
  }),
};
