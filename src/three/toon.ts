/**
 * Cel-shading toolkit.
 *
 * Everything on stage is drawn with a banded toon material plus an
 * inverted-hull outline, which is what gives the world its anime/cartoon read
 * rather than the plastic look of default PBR. Nothing here loads a file — the
 * gradient ramp and every sprite glyph are generated at runtime so the app
 * stays offline-first.
 */
import * as THREE from 'three';

/**
 * Textures owned by this module and reused across scenes. `disposeTree` skips
 * anything in here, so swapping worlds never frees the shared ramp out from
 * under a material that is still on stage.
 */
const shared = new Set<THREE.Texture>();

/** Shared N-step ramp. Two or three bands reads as anime; more reads as PBR. */
const rampCache = new Map<number, THREE.DataTexture>();

export function toonRamp(steps = 3): THREE.DataTexture {
  const cached = rampCache.get(steps);
  if (cached) return cached;

  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    // Bias the ramp bright: anime shading is mostly lit with a small shadow.
    // The floor is deep enough to read as a distinct band on a white coat.
    const t = i / (steps - 1);
    data[i] = Math.round(255 * (0.42 + 0.58 * t));
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  rampCache.set(steps, tex);
  shared.add(tex);
  return tex;
}

export interface ToonOptions {
  steps?: number;
  transparent?: boolean;
  opacity?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  side?: THREE.Side;
}

export function toon(color: THREE.ColorRepresentation, o: ToonOptions = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: toonRamp(o.steps ?? 3),
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
  });
  if (o.emissive != null) {
    m.emissive = new THREE.Color(o.emissive);
    m.emissiveIntensity = o.emissiveIntensity ?? 1;
  }
  return m;
}

/** Unlit flat colour — for eyes, glows and anything that must not shade. */
export function flat(color: THREE.ColorRepresentation, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
}

// --- outlines ---------------------------------------------------------------

const OUTLINE_VERT = /* glsl */ `
  uniform float thickness;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(normalMatrix * normal);
    // Scale the push by view depth so the outline keeps a near-constant
    // screen-space width instead of ballooning on close-up parts.
    // 0.0035 rad-per-unit keeps a thickness of 1.0 at roughly 2.5 screen pixels
    // for this camera's field of view, at any distance.
    mv.xyz += n * thickness * max(0.35, -mv.z) * 0.0035;
    gl_Position = projectionMatrix * mv;
  }
`;

const OUTLINE_FRAG = /* glsl */ `
  uniform vec3 lineColor;
  uniform float lineOpacity;
  void main() { gl_FragColor = vec4(lineColor, lineOpacity); }
`;

export interface OutlineHandle {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

/**
 * Adds an inverted-hull outline as a child of `mesh`, so it inherits every
 * transform the rig applies. Only works on smooth-normal geometry — which is
 * everything the cat and the worlds are built from.
 */
export function outline(
  mesh: THREE.Mesh,
  thickness = 1,
  color: THREE.ColorRepresentation = 0x2b2438,
  opacity = 1,
): OutlineHandle {
  const material = new THREE.ShaderMaterial({
    vertexShader: OUTLINE_VERT,
    fragmentShader: OUTLINE_FRAG,
    uniforms: {
      thickness: { value: thickness },
      lineColor: { value: new THREE.Color(color) },
      lineOpacity: { value: opacity },
    },
    side: THREE.BackSide,
    transparent: opacity < 1,
  });
  const hull = new THREE.Mesh(mesh.geometry, material);
  hull.frustumCulled = mesh.frustumCulled;
  hull.renderOrder = (mesh.renderOrder ?? 0) - 1;
  hull.castShadow = false;
  hull.receiveShadow = false;
  hull.userData.isOutline = true;
  mesh.add(hull);
  return { mesh: hull, material };
}

/** Mesh + toon material + outline, the combination used by nearly everything. */
export function inked(
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  opts: ToonOptions & { thickness?: number; lineColor?: THREE.ColorRepresentation; shadows?: boolean } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, toon(color, opts));
  if (opts.shadows !== false) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  if ((opts.thickness ?? 1) > 0) outline(mesh, opts.thickness ?? 1, opts.lineColor ?? 0x2b2438);
  return mesh;
}

// --- sky --------------------------------------------------------------------

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 top;
  uniform vec3 middle;
  uniform vec3 bottom;
  uniform float bandSteps;
  varying vec3 vDir;

  void main() {
    float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    // Quantise into soft bands so even the sky reads as painted cel art.
    float q = floor(h * bandSteps) / bandSteps;
    float b = mix(q, h, 0.45);
    vec3 c = b < 0.5 ? mix(bottom, middle, b * 2.0) : mix(middle, top, (b - 0.5) * 2.0);
    gl_FragColor = vec4(c, 1.0);
  }
`;

export interface SkyColors {
  top: THREE.ColorRepresentation;
  middle: THREE.ColorRepresentation;
  bottom: THREE.ColorRepresentation;
}

export interface SkyHandle {
  mesh: THREE.Mesh;
  set(c: SkyColors): void;
}

/** Banded gradient dome. Rendered first, never writes depth. */
export function sky(colors: SkyColors, radius = 90, bands = 9): SkyHandle {
  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      top: { value: new THREE.Color(colors.top) },
      middle: { value: new THREE.Color(colors.middle) },
      bottom: { value: new THREE.Color(colors.bottom) },
      bandSteps: { value: bands },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), material);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return {
    mesh,
    set(c) {
      (material.uniforms.top.value as THREE.Color).set(c.top);
      (material.uniforms.middle.value as THREE.Color).set(c.middle);
      (material.uniforms.bottom.value as THREE.Color).set(c.bottom);
    },
  };
}

// --- runtime sprite glyphs --------------------------------------------------

const glyphCache = new Map<string, THREE.Texture>();

/**
 * Rasterises a character (emoji or drawn shape) into a texture. Used for the
 * heart/coin/star/Zzz bursts — sprites keep them readable at any camera angle.
 */
export function glyphTexture(glyph: string, size = 128): THREE.Texture {
  const key = `${glyph}@${size}`;
  const cached = glyphCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.font = `${Math.round(size * 0.74)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // A soft white rim keeps glyphs legible against dark scenes.
  ctx.shadowColor = 'rgba(255,255,255,0.9)';
  ctx.shadowBlur = size * 0.09;
  ctx.fillText(glyph, size / 2, size * 0.54);
  ctx.shadowBlur = 0;
  ctx.fillText(glyph, size / 2, size * 0.54);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  glyphCache.set(key, tex);
  shared.add(tex);
  return tex;
}

/** Radial soft dot — fireflies, dust motes, glows. */
export function dotTexture(color = '#ffffff', size = 64): THREE.Texture {
  const key = `dot:${color}@${size}`;
  const cached = glyphCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color);
  g.addColorStop(0.35, color);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  glyphCache.set(key, tex);
  shared.add(tex);
  return tex;
}

// --- disposal ---------------------------------------------------------------

/** Recursively frees geometries and materials under `root`. */
/**
 * Thin and warm every inverted-hull outline under `root`.
 *
 * The cat and its props are drawn with a hard ink line, which is right for a
 * cel-shaded world made of the same material. Against a painting it is the
 * loudest thing marking them as a different medium — the painted background
 * has no linework anywhere, so a black contour reads as a sticker edge.
 *
 * Softening rather than removing: with no outline at all the toon shading has
 * nothing to read against and the silhouette turns to mush. Tinting the line
 * towards the scene's own darks turns it from "linework" into "shadow".
 */
export function softenInk(root: THREE.Object3D, tint: THREE.ColorRepresentation, strength = 0.6): void {
  const target = new THREE.Color(tint);
  root.traverse((o) => {
    if (!o.userData.isOutline) return;
    const mat = (o as THREE.Mesh).material as THREE.ShaderMaterial;
    if (!mat?.uniforms?.thickness) return;
    if (mat.userData.baseThickness === undefined) {
      mat.userData.baseThickness = mat.uniforms.thickness.value;
      mat.userData.baseColor = (mat.uniforms.lineColor.value as THREE.Color).clone();
    }
    mat.uniforms.thickness.value = mat.userData.baseThickness * (1 - strength * 0.45);
    mat.uniforms.lineColor.value.copy(mat.userData.baseColor).lerp(target, strength);
    mat.uniforms.lineOpacity.value = 1 - strength * 0.45;
    mat.transparent = true;
  });
}

export function disposeTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as THREE.Mesh).material;
    if (Array.isArray(mat)) mat.forEach(disposeMaterial);
    else if (mat) disposeMaterial(mat);
  });
}

function disposeMaterial(m: THREE.Material): void {
  const anyMat = m as unknown as Record<string, unknown>;
  for (const key of ['map', 'alphaMap', 'gradientMap', 'emissiveMap']) {
    const tex = anyMat[key] as THREE.Texture | undefined;
    // The shared ramp and glyph caches outlive individual scenes.
    if (tex && !shared.has(tex)) tex.dispose();
  }
  m.dispose();
}
