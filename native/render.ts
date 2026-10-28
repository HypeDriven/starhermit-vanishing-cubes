// The floating impossible sculpture on starhermit:scene, as the browser
// build's js/render/scene.js, cubeviews.js, camera.js and vfx.js drew it with
// three.js r180: the pale sky dome (vertical gradient, sun glow toward the key
// light, drifting fbm cloud banks), exponential fog, the seeded ring of
// instanced staircases, floating arcs and tilted obelisks (bobbing), the cloud
// shadow disc; the board (rounded extruded cubes with panel textures, arrow /
// stone / core instanced meshes, direction chevrons, lock bands, path preview
// dots, the selection outline, lift and facing ring, hover / select / locked /
// key-pulse tints, release fly-outs, unlock flashes, invalid shakes), pooled
// spark bursts and ambient motes, and the authored orbit camera on critically
// damped springs, fitted to the playfield the HUD leaves free (a lens shift,
// setViewOffset, centres it there; picking uses the same camera).
//
// Engine minor 23 follows three.js r185's lights and shadows. The page was
// r180 (physically based lights), so its intensities are used as written (no
// ÷ π) with its own shadow box around the board, bias −0.0004 and normal bias
// 0.02. Reflections as the page set them: at Reflections on,
// RoomEnvironment through PMREM (sigma 0.04) as scene.environment at
// environmentIntensity 0.14 and the hemisphere at 0.8×. The old composer
// (RenderPass → GTAO → UnrealBloom 0.4 / 0.5 / 2.2 → OutputPass (ACES) → the
// display-space grade and vignette → SMAA / FXAA, or the target's MSAA) is the
// runtime's renderer.ao / bloom / grade / antialias.
//
// Differences: the sky's GLSL is WGSL; canvases are OffscreenCanvas.
import {
  ACESFilmicToneMapping, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry,
  DirectionalLight, DoubleSide, EdgesGeometry, ExtrudeGeometry, FogExp2, Group, HemisphereLight, InstancedMesh, LineBasicMaterial,
  LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, OctahedronGeometry,
  PMREMGenerator, PerspectiveCamera, Points, PointsMaterial, Quaternion, Raycaster, RepeatWrapping, RingGeometry, RoomEnvironment,
  SRGBColorSpace, ShaderMaterial, Shape, SphereGeometry, TorusGeometry, Vector2, Vector3, pointerToNdc, renderer, scene,
  type Material, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas } from "starhermit:canvas";
import { Engine, RngClass, type Cube, type RulesEvent, type State, type Theme, type Vec3i } from "./game.ts";
import type { Look } from "./quality.ts";

export const SPACING = 1.04;
const MAX_ARROWS = 168, MAX_STONES = 60, MAX_PATH_DOTS = 16;
const DIRS = Engine.DIRS;
const hexColor = (n: number): Color => new Color(n);

// ---------------------------------------------------------------- camera.js
export const FRAME = { fov: 35, theta0: Math.PI * 0.25, phi0: 1.02, fitPadding: 1.12, minRadius: 4.5, maxRadius: 60, minPhi: 0.3, maxPhi: 1.5, omega: 6.5 };
interface Spring { x: number; v: number; goal: number }
function springStep(s: Spring, omega: number, dt: number): void {
  const x0 = s.x - s.goal, e = Math.exp(-omega * dt), temp = (s.v + omega * x0) * dt;
  s.x = s.goal + (x0 + temp) * e;
  s.v = (s.v - omega * temp) * e;
}
const camera = new PerspectiveCamera(FRAME.fov, 1, 0.1, 500);
const rig = {
  theta: { x: FRAME.theta0, v: 0, goal: FRAME.theta0 } as Spring,
  phi: { x: FRAME.phi0, v: 0, goal: FRAME.phi0 } as Spring,
  radius: { x: 12, v: 0, goal: 12 } as Spring,
  dragAccum: 0,
};
let reducedMotion = false;
function snapRig(): void { for (const s of [rig.theta, rig.phi, rig.radius]) { s.x = s.goal; s.v = 0; } }
function frameExtent(extent: number): void {
  const vHalf = (FRAME.fov * Math.PI) / 180 / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * (camera.aspect || 1));
  const fitHalf = Math.max(0.1, Math.min(vHalf, hHalf));
  const radius = ((extent + 0.7) / Math.tan(fitHalf)) * FRAME.fitPadding;
  rig.radius.goal = Math.max(FRAME.minRadius, Math.min(FRAME.maxRadius, radius));
  if (reducedMotion) snapRig();
}
/** camera.js rotate (drag radians). */
export function rotate(dTheta: number, dPhi: number): void {
  rig.theta.goal += dTheta;
  rig.phi.goal = Math.max(FRAME.minPhi, Math.min(FRAME.maxPhi, rig.phi.goal + dPhi));
  rig.dragAccum += Math.abs(dTheta) + Math.abs(dPhi);
}
/** True when accumulated drag crosses one scored camera rotation (~60°). */
export function consumeRotationCredit(): boolean {
  if (rig.dragAccum >= 1.05) { rig.dragAccum = 0; return true; }
  return false;
}
export function quarter(sign: number): void { rig.theta.goal += (Math.PI / 2) * sign; }
export function resetCamera(): void { rig.theta.goal = FRAME.theta0; rig.phi.goal = FRAME.phi0; }
function applyRig(): void {
  const s = Math.sin(rig.phi.x);
  camera.position.set(rig.radius.x * s * Math.sin(rig.theta.x), rig.radius.x * Math.cos(rig.phi.x), rig.radius.x * s * Math.cos(rig.theta.x));
  camera.lookAt(new Vector3(0, 0, 0));
}
export function setReducedMotion(on: boolean): void { reducedMotion = on; }

// ---------------------------------------------------------------- textures
function softSprite(): CanvasTexture {
  const c = new OffscreenCanvas(64, 64);
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.85)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
/** scene.js stoneTexture: deterministic mottling and fine strata. */
function stoneTexture(size: number): CanvasTexture {
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext("2d")!;
  g.scale(size / 128, size / 128);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 128, 128);
  let s = 99;
  const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    const v = rnd();
    g.fillStyle = v < 0.6 ? `rgba(40,50,60,${0.03 + v * 0.05})` : `rgba(255,255,255,${0.1 + (v - 0.6) * 0.2})`;
    const r = 1 + rnd() * 5;
    g.beginPath();
    g.arc(rnd() * 128, rnd() * 128, r, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = "rgba(40,50,60,0.08)";
  for (let y = 6; y < 128; y += 11 + rnd() * 6) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(128, y + (rnd() - 0.5) * 4);
    g.stroke();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}
/** cubeviews.js panelTexture, drawn in 128-unit space at the budget's size. */
function panelTexture(o: { base?: string; frame?: string; speckle?: number; grain?: number; px: number }): CanvasTexture {
  const base = o.base ?? "#f6f8fa", frame = o.frame ?? "rgba(30,45,70,0.35)", speckle = o.speckle ?? 0;
  const size = (o.grain ?? 0) > 0 ? o.px : Math.min(128, o.px);
  const k = size / 128;
  const grain = Math.round((o.grain ?? 0) * (size / 256) ** 2);
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  const grad = g.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(0,0,0,0.12)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  let seed = 7;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  if (grain > 0) {
    for (let i = 0; i < grain; i++) {
      const v = rnd();
      g.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.012 + v * 0.025})` : `rgba(255,255,255,${0.04 + (v - 0.5) * 0.06})`;
      const r = 0.6 + rnd() * 1.4;
      g.fillRect(rnd() * size, rnd() * size, r * k, r * k);
    }
    g.strokeStyle = "rgba(255,255,255,0.45)";
    g.lineWidth = 2 * k;
    g.strokeRect(14 * k, 14 * k, 100 * k, 100 * k);
  }
  g.strokeStyle = frame;
  g.lineWidth = 6 * k;
  g.strokeRect(8 * k, 8 * k, 112 * k, 112 * k);
  if (speckle > 0) {
    g.fillStyle = "rgba(0,0,0,0.18)";
    for (let i = 0; i < speckle; i++) g.fillRect((rnd() * 120 + 4) * k, (rnd() * 120 + 4) * k, 3 * k, 3 * k);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const texCache = new Map<string, CanvasTexture>();
function cachedPanel(key: string, make: () => CanvasTexture): CanvasTexture {
  let t = texCache.get(key);
  if (!t) { t = make(); texCache.set(key, t); }
  return t;
}

// ---------------------------------------------------------------- geometry
function roundedBoxGeometry(size: number, radius: number, smooth: boolean, bevel: [number, number]): BufferGeometry {
  const s = size - radius * 2, h = s / 2;
  const shape = new Shape();
  shape.moveTo(-h + radius, -h);
  shape.lineTo(h - radius, -h);
  shape.absarc(h - radius, -h + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(h, h - radius);
  shape.absarc(h - radius, h - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(-h + radius, h);
  shape.absarc(-h + radius, h - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(-h, -h + radius);
  shape.absarc(-h + radius, -h + radius, radius, Math.PI, Math.PI * 1.5, false);
  const geo = new ExtrudeGeometry(shape, {
    depth: s, bevelEnabled: true, bevelThickness: radius, bevelSize: radius,
    bevelSegments: smooth ? bevel[0] : Math.min(2, bevel[0]), curveSegments: smooth ? bevel[1] : Math.min(4, bevel[1]),
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------- the world
let built = false;
let look: Look | null = null;
let theme: Theme | null = null;
let keyLight: DirectionalLight;
let hemi: HemisphereLight;
const keyDir = new Vector3(6, 10, 4).normalize();
let envRoom: Texture | null = null;
let sky: Mesh | null = null;
let skyU: Record<string, { value: unknown }> = {};
const envGroup = new Group();
let envAnimated: { obj: Mesh; baseY: number; amp: number; speed: number; phase: number; spin: number }[] = [];
let envArgs: [string, Theme] | null = null;
let phase = 0;
let sprite: CanvasTexture;

function build(): void {
  built = true;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  keyLight = new DirectionalLight(hexColor(0xfff2dd), 2.6);
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.02;
  hemi = new HemisphereLight(hexColor(0xcfe0f2), hexColor(0x9a8f80), 0.9);
  scene.add(keyLight, keyLight.target, hemi);
  scene.add(envGroup);
  sprite = softSprite();
  fitShadow(4);
  buildVfx();
  renderer.camera = camera;
  applyRig();
}
/** scene.js _fitShadow: the key light's orthographic box around the board's bounding sphere. */
function fitShadow(extent: number): void {
  const r = extent * 1.75 + 1;
  keyLight.target.position.set(0, 0, 0);
  keyLight.position.copy(keyDir).multiplyScalar(r + 12);
  const cam = keyLight.shadow.camera as unknown as { left: number; right: number; top: number; bottom: number; near: number; far: number; updateProjectionMatrix(): void };
  Object.assign(cam, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 2 * r + 26 });
  cam.updateProjectionMatrix();
}

const SKY_WGSL = `
fn hash2(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn noise2(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2f(1.0, 0.0)), u.x), mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn fbm(q: vec2f) -> f32 {
  var p = q; var v = 0.0; var a = 0.5;
  for (var i = 0; i < 4; i++) { v += a * noise2(p); p *= 2.03; a *= 0.5; }
  return v;
}
fn fragment(f: Fragment) -> vec4f {
  let d = normalize(f.world - camera_position());
  let h = clamp(d.y * 1.6 + 0.25, 0.0, 1.0);
  var col = mix(uniforms.horizon, uniforms.top, h);
  let sun = max(dot(d, normalize(uniforms.sunDir)), 0.0);
  col += uniforms.sunColor * (pow(sun, 64.0) * 0.35 + pow(sun, 6.0) * 0.12);
  if (uniforms.uClouds > 0.0) {
    let uv = d.xz / (0.35 + abs(d.y)) * 1.6 + vec2f(uniforms.uTime * 0.012, uniforms.uTime * 0.004);
    let c = smoothstep(0.52, 0.8, fbm(uv));
    let band = smoothstep(-0.25, 0.05, d.y) * (1.0 - smoothstep(0.35, 0.8, d.y));
    col = mix(col, mix(uniforms.horizon, vec3f(1.0), 0.55), c * band * 0.45 * uniforms.uClouds);
  }
  col = max(mix(vec3f(dot(col, vec3f(0.2126, 0.7152, 0.0722))), col, 1.45), vec3f(0.0));
  return vec4f(col, 1.0);
}`;

/** scene.js buildEnvironment: the sky, fog, the seeded sculpture ring and the cloud-shadow disc. */
export function buildEnvironment(seed: string, t: Theme): void {
  if (!built || !look) { envArgs = [seed, t]; return; }
  for (const child of [...envGroup.children]) envGroup.remove(child);
  envAnimated = [];
  if (sky) scene.remove(sky);
  theme = t;
  envArgs = [seed, t];
  const B = look.budget;
  skyU = {
    top: { value: hexColor(t.sky.top) }, horizon: { value: hexColor(t.sky.horizon) }, sunColor: { value: hexColor(t.light.key) },
    sunDir: { value: keyDir.clone() }, uTime: { value: 0 }, uClouds: { value: look.detailed ? 1 : 0 },
  };
  const seg = (n: number, min: number): number => Math.max(min, Math.round(n * B.segments));
  sky = new Mesh(new SphereGeometry(220, seg(32, 16), seg(20, 10)), new ShaderMaterial({
    side: BackSide, depthWrite: false, fog: false, uniforms: skyU as never, fragmentShader: SKY_WGSL,
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);
  scene.fog = new FogExp2(hexColor(t.sky.fog), t.sky.fogDensity);

  const rng = new RngClass("decor:" + seed);
  const detail = look.detailed ? 1 : 0.55;
  const stoneTex = detail >= 1 ? cachedPanel("stone:" + Math.min(256, B.texture), () => stoneTexture(Math.min(256, B.texture))) : null;
  const envMat = (color: number, roughness: number, metalness: number): Material => {
    const p = { color: hexColor(color), map: stoneTex };
    return B.material === "lambert" ? new MeshLambertMaterial(p) : new MeshStandardMaterial({ ...p, roughness, metalness });
  };
  const structMat = envMat(t.env.structure, 0.85, 0);
  const accentMat = envMat(t.env.accent, 0.55, 0.25);
  const modules = Math.max(8, Math.round(26 * detail * B.sculpture));
  const ringRadius = 13 + rng.next() * 3.5;
  const keepClear = (v: Vector3): Vector3 => {
    const d = Math.hypot(v.x, v.z);
    if (d < 14) { const k = 14 / Math.max(d, 0.001); v.x *= k; v.z *= k; }
    return v;
  };
  const stepsPerStair = 8;
  const steps = new InstancedMesh(new BoxGeometry(1.35, 0.42, 1.35), structMat, modules * stepsPerStair);
  let stepIndex = 0;
  const m4 = new Matrix4(), q = new Quaternion(), up = new Vector3(0, 1, 0), one = new Vector3(1, 1, 1);
  for (let s = 0; s < modules; s++) {
    const angle = (s / modules) * Math.PI * 2 + rng.next() * 0.5;
    const base = keepClear(new Vector3(Math.cos(angle) * (ringRadius + rng.next() * 6), -3.5 + rng.next() * 8, Math.sin(angle) * (ringRadius + rng.next() * 6)));
    const heading = angle + Math.PI / 2 + (rng.next() - 0.5) * 0.4;
    const dir = new Vector3(Math.cos(heading), 0, Math.sin(heading));
    for (let i = 0; i < stepsPerStair; i++) {
      const p = base.clone().addScaledVector(dir, i * 1.4);
      p.y += i * 0.58;
      q.setFromAxisAngle(up, heading + Math.PI / 4);
      m4.compose(p, q, one);
      steps.setMatrixAt(stepIndex++, m4);
    }
  }
  steps.count = stepIndex;
  steps.instanceMatrix.needsUpdate = true;
  envGroup.add(steps);
  const arcCount = Math.ceil(modules * 0.8);
  for (let i = 0; i < arcCount; i++) {
    const radius = 4 + rng.next() * 3.5;
    const arc = Math.PI * (0.4 + rng.next() * 0.6);
    const geo = new TorusGeometry(radius, 0.22 + rng.next() * 0.14, Math.max(4, Math.round(8 * B.segments)), Math.max(12, Math.round(32 * B.segments)), arc);
    const mesh = new Mesh(geo, rng.next() < 0.5 ? structMat : accentMat);
    const angle = rng.next() * Math.PI * 2;
    keepClear(mesh.position.set(Math.cos(angle) * (ringRadius * 0.9 + rng.next() * 5), -2 + rng.next() * 9, Math.sin(angle) * (ringRadius * 0.9 + rng.next() * 5)));
    mesh.rotation.set(rng.next() * Math.PI, rng.next() * Math.PI, rng.next() * Math.PI);
    envGroup.add(mesh);
    envAnimated.push({ obj: mesh, baseY: mesh.position.y, amp: 0.3 + rng.next() * 0.4, speed: 0.2 + rng.next() * 0.3, phase: rng.next() * Math.PI * 2, spin: (rng.next() - 0.5) * 0.05 });
  }
  const obeliskCount = Math.ceil(modules * 0.6);
  const obGeo = new ConeGeometry(0.8, 6, 4);
  for (let i = 0; i < obeliskCount; i++) {
    const mesh = new Mesh(obGeo, accentMat);
    const angle = rng.next() * Math.PI * 2;
    keepClear(mesh.position.set(Math.cos(angle) * (ringRadius * 1.1 + rng.next() * 4), -4 + rng.next() * 8, Math.sin(angle) * (ringRadius * 1.1 + rng.next() * 4)));
    mesh.rotation.z = (rng.next() - 0.5) * 0.8;
    mesh.rotation.y = rng.next() * Math.PI;
    envGroup.add(mesh);
    envAnimated.push({ obj: mesh, baseY: mesh.position.y, amp: 0.2 + rng.next() * 0.3, speed: 0.15 + rng.next() * 0.25, phase: rng.next() * Math.PI * 2, spin: (rng.next() - 0.5) * 0.03 });
  }
  const disc = new Mesh(new CircleGeometry(9, Math.max(20, Math.round(40 * B.segments))),
    new MeshBasicMaterial({ color: hexColor(t.sky.fog), transparent: true, opacity: 0.55, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -9;
  envGroup.add(disc);
  keyLight.color = hexColor(t.light.key);
  keyLight.intensity = t.light.keyIntensity;
  hemi.color = hexColor(t.light.hemiSky);
  hemi.groundColor = hexColor(t.light.hemiGround);
  applyLightBalance();
  motesMat.color = hexColor(t.light.key);
}
function applyLightBalance(): void {
  const h = theme ? theme.light.hemiIntensity : 0.9;
  hemi.intensity = look?.reflections ? h * 0.8 : h;
}

// ---------------------------------------------------------------- the look (scene.js setGraphics)
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const prev = look;
  look = next;
  if (!built) build();
  const g = look;
  renderer.shadowMap.enabled = g.shadows > 0;
  keyLight.castShadow = g.shadows > 0;
  if (g.shadows > 0) keyLight.shadow.mapSize = g.shadows;
  if (g.reflections) {
    if (!envRoom) {
      try {
        const pmrem = new PMREMGenerator(renderer);
        envRoom = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
        pmrem.dispose();
      } catch (e) { console.warn(`environment: ${String(e)}`); }
    }
    scene.environment = envRoom;
    scene.environmentIntensity = 0.14;
  } else scene.environment = null;
  if (theme) applyLightBalance();
  vfxMultiplier = (g.particles === "high" ? 1 : 0.35) * g.budget.sparks;
  moteCount = g.particles === "high" ? Math.min(MOTE_MAX, g.budget.motes) : 0;
  motes.geometry.setDrawRange(0, moteCount);
  motes.visible = moteCount > 0;
  if (envArgs && (!prev || prev.preset !== g.preset)) buildEnvironment(...envArgs);
  else if (skyU.uClouds) skyU.uClouds.value = g.detailed ? 1 : 0;
  if (board) rebuildBoardLook();
  renderer.ao = g.ao === "off" ? null : {
    blendIntensity: 0.85, radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: g.ao === "high" ? 16 : 8, resolution: g.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ao === "high" ? 6 : 4, rings: 2, samples: g.ao === "high" ? 16 : 8 },
  };
  renderer.bloom = g.bloom ? { strength: 0.4, radius: 0.5, threshold: 2.2, resolution: g.budget.bloomRes } : null;
  // GradeShader (display space): a 0.3-weight smoothstep S-curve (slope 0.15), saturation 1.1, cool shadows /
  // warm highlights by a smoothstep of luma 0.25–0.85, a 0.16 vignette from 0.4 to 0.9
  renderer.grade = g.grade ? {
    space: "display", contrast: 0.15, saturation: 1.1, split: [0.25, 0.85], shadows: [0.97, 0.99, 1.04], highlights: [1.03, 1.0, 0.97],
    vignette: { amount: 0.16, inner: 0.4, outer: 0.9 },
  } : null;
  renderer.antialias = g.antialias;
}

// ---------------------------------------------------------------- vfx.js
const CAPACITY = 2048, MOTE_MAX = 240;
let vfxPoints: Points, vfxPos: Float32Array, vfxCol: Float32Array, vfxVel: Float32Array, vfxLife: Float32Array, vfxActive = 0, vfxMultiplier = 1;
let motes: Points, motesMat: PointsMaterial, motePos: Float32Array, moteSeeds: Float32Array, moteCount = 0, moteTime = 0;
let visible3d = false;
function buildVfx(): void {
  vfxPos = new Float32Array(CAPACITY * 3).fill(-9999);
  vfxCol = new Float32Array(CAPACITY * 3);
  vfxVel = new Float32Array(CAPACITY * 3);
  vfxLife = new Float32Array(CAPACITY);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(vfxPos, 3));
  geo.setAttribute("color", new BufferAttribute(vfxCol, 3));
  vfxPoints = new Points(geo, new PointsMaterial({ size: 0.2, map: sprite, alphaTest: 0.02, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true }));
  vfxPoints.frustumCulled = false;
  vfxPoints.renderOrder = 10;
  scene.add(vfxPoints);
  motePos = new Float32Array(MOTE_MAX * 3);
  moteSeeds = new Float32Array(MOTE_MAX * 4);
  let s = 1337;
  const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < MOTE_MAX; i++) {
    moteSeeds[i * 4] = 5.5 + rnd() * 8; moteSeeds[i * 4 + 1] = rnd() * Math.PI * 2; moteSeeds[i * 4 + 2] = -3 + rnd() * 7; moteSeeds[i * 4 + 3] = 0.3 + rnd() * 0.7;
  }
  const mg = new BufferGeometry();
  mg.setAttribute("position", new BufferAttribute(motePos, 3));
  motesMat = new PointsMaterial({ size: 0.09, map: sprite, color: hexColor(0xfff6e0), transparent: true, opacity: 0.8, depthWrite: false, sizeAttenuation: true });
  motes = new Points(mg, motesMat);
  motes.frustumCulled = false;
  motes.renderOrder = 9;
  scene.add(motes);
  writeMotes();
}
let fx = 0x2545f491;
const frand = (): number => { fx ^= fx << 13; fx ^= fx >>> 17; fx ^= fx << 5; return ((fx >>> 0) % 1000000) / 1000000; };
function burst(pos: Vector3, colorHex: number, count: number, speed: number, ttl: number): void {
  if (reducedMotion) return;
  const n = Math.round(count * vfxMultiplier), c = hexColor(colorHex);
  for (let k = 0; k < n && vfxActive < CAPACITY; k++) {
    const i = vfxActive++, i3 = i * 3;
    const sp = speed * (0.6 + frand() * 0.8), u = frand() * 2 - 1, th = frand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    vfxPos[i3] = pos.x; vfxPos[i3 + 1] = pos.y; vfxPos[i3 + 2] = pos.z;
    vfxVel[i3] = r * Math.cos(th) * sp; vfxVel[i3 + 1] = u * sp + sp * 0.25; vfxVel[i3 + 2] = r * Math.sin(th) * sp;
    vfxCol[i3] = c.r; vfxCol[i3 + 1] = c.g; vfxCol[i3 + 2] = c.b;
    vfxLife[i] = ttl * (0.7 + frand() * 0.6);
  }
}
function updateVfx(dt: number): void {
  if (vfxActive === 0) return;
  for (let i = vfxActive - 1; i >= 0; i--) {
    vfxLife[i]! -= dt;
    const i3 = i * 3;
    if (vfxLife[i]! <= 0) {
      const l = --vfxActive, l3 = l * 3;
      if (i !== l) {
        for (let k = 0; k < 3; k++) { vfxPos[i3 + k] = vfxPos[l3 + k]!; vfxVel[i3 + k] = vfxVel[l3 + k]!; vfxCol[i3 + k] = vfxCol[l3 + k]!; }
        vfxLife[i] = vfxLife[l]!;
      }
      vfxPos[l3] = 0; vfxPos[l3 + 1] = -9999; vfxPos[l3 + 2] = 0;
      continue;
    }
    vfxPos[i3]! += vfxVel[i3]! * dt; vfxPos[i3 + 1]! += vfxVel[i3 + 1]! * dt; vfxPos[i3 + 2]! += vfxVel[i3 + 2]! * dt;
    vfxVel[i3 + 1]! -= 2.2 * dt;
    vfxCol[i3]! *= 0.995; vfxCol[i3 + 1]! *= 0.995; vfxCol[i3 + 2]! *= 0.995;
  }
  (vfxPoints.geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
  (vfxPoints.geometry.getAttribute("color") as BufferAttribute).needsUpdate = true;
}
function writeMotes(): void {
  const t = moteTime;
  for (let i = 0; i < moteCount; i++) {
    const r = moteSeeds[i * 4]!, a = moteSeeds[i * 4 + 1]! + t * 0.05 * moteSeeds[i * 4 + 3]!;
    motePos[i * 3] = Math.cos(a) * r;
    motePos[i * 3 + 1] = moteSeeds[i * 4 + 2]! + Math.sin(t * 0.4 * moteSeeds[i * 4 + 3]! + i) * 0.5;
    motePos[i * 3 + 2] = Math.sin(a) * r;
  }
  (motes.geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
}

// ---------------------------------------------------------------- cubeviews.js
interface Rec { id: string; kind: "arrow" | "stone" | "core" | "ghost"; slot: number; pos: Vec3i; dir: number; locked?: boolean; isKey?: boolean }
interface Board {
  geo: BufferGeometry; arrowMat: Material; stoneMat: Material; coreMat: Material; chevMat: Material; bandMat: Material;
  arrow: InstancedMesh; stone: InstancedMesh; core: InstancedMesh; chev: InstancedMesh; band: InstancedMesh; dots: InstancedMesh;
  dotMat: MeshBasicMaterial; outline: LineSegments; ring: Mesh; group: Group;
  records: Map<string, Rec>; arrowSlots: string[]; stoneSlots: string[]; coreSlots: string[];
  flyouts: { id: string; pos: Vec3i; dir: number; t: number; dur: number; slot: number }[];
  flashes: Map<string, { t: number; dur: number }>; shakes: Map<string, { t: number; dur: number }>;
  hoverId: string | null; selectedId: string | null; time: number; theme: Theme; extent: number; lookKey: string;
}
let board: Board | null = null;
const Y_AXIS = new Vector3(0, 1, 0);
const tMat = new Matrix4(), tPos = new Vector3(), tQuat = new Quaternion(), tScale = new Vector3(), tDir = new Vector3(), tOff = new Vector3();
function cubeMaterials(t: Theme): Pick<Board, "arrowMat" | "stoneMat" | "coreMat" | "chevMat" | "bandMat"> {
  const B = look!.budget, kind = B.material, px = B.texture, detailed = look!.detailed, coat = look!.reflections;
  const mat = (p: Record<string, unknown>, glossy: boolean): Material => {
    const q = { ...p };
    for (const k of ["color", "emissive"]) if (typeof q[k] === "number") q[k] = hexColor(q[k] as number);
    if (kind === "lambert") { delete q.roughness; delete q.metalness; delete q.clearcoat; delete q.clearcoatRoughness; return new MeshLambertMaterial(q); }
    if (kind === "physical" && glossy) return new MeshPhysicalMaterial(q);
    delete q.clearcoat; delete q.clearcoatRoughness;
    return new MeshStandardMaterial(q);
  };
  const glow = look!.bloom ? 1.8 : 1;
  return {
    arrowMat: mat({ map: cachedPanel(`arrow:${px}:${detailed}`, () => panelTexture({ base: "#f6f8fa", grain: detailed ? 1400 : 0, px })),
      roughness: coat ? 0.42 : 0.55, metalness: 0, clearcoat: coat ? 0.65 : 0, clearcoatRoughness: 0.28 }, true),
    stoneMat: mat({ map: cachedPanel(`stone-cube:${px}:${detailed}`, () => panelTexture({ base: "#9aa0a8", frame: "rgba(0,0,0,0.4)", speckle: 60, grain: detailed ? 3200 : 0, px })),
      roughness: 0.9, metalness: 0 }, false),
    coreMat: mat({ color: t.cube.core, emissive: t.cube.core, emissiveIntensity: 0.55 * glow, roughness: 0.3, metalness: 0.2, clearcoat: coat ? 1 : 0, clearcoatRoughness: 0.15 }, true),
    chevMat: mat({ color: t.cube.chevron, roughness: 0.45, metalness: 0.1, clearcoat: coat ? 0.8 : 0, clearcoatRoughness: 0.2 }, true),
    bandMat: mat({ color: 0x3a3f47, roughness: 0.4, metalness: 0.6 }, false),
  };
}
function boardLookKey(): string { const g = look!; return [g.budget.material, g.budget.texture, String(g.budget.bevel), g.detailed, g.reflections, g.bloom].join("|"); }
function rebuildBoardLook(): void {
  const b = board!;
  const key = boardLookKey();
  if (key === b.lookKey) return;
  b.lookKey = key;
  b.geo = roundedBoxGeometry(0.92, 0.14, look!.detailed, look!.budget.bevel);
  Object.assign(b, cubeMaterials(b.theme));
  b.arrow.geometry = b.geo; b.stone.geometry = b.geo; b.core.geometry = b.geo;
  b.arrow.material = b.arrowMat; b.stone.material = b.stoneMat; b.core.material = b.coreMat; b.chev.material = b.chevMat; b.band.material = b.bandMat;
}
export function clearBoard(): void {
  if (board) scene.remove(board.group);
  board = null;
}
/** scene.js buildBoard: the cube views for a fresh state, the camera fitted and the shadow box sized. */
export function buildBoard(state: State, t: Theme): void {
  clearBoard();
  const geo = roundedBoxGeometry(0.92, 0.14, look!.detailed, look!.budget.bevel);
  const mats = cubeMaterials(t);
  const inst = (m: Material, n: number, cast: boolean, recv: boolean): InstancedMesh => {
    const im = new InstancedMesh(geo, m, n);
    im.castShadow = cast; im.receiveShadow = recv; im.count = 0; im.frustumCulled = false;
    return im;
  };
  const chevGeo = new ConeGeometry(0.2, 0.3, 4);
  chevGeo.rotateY(Math.PI / 4);
  const chev = new InstancedMesh(chevGeo, mats.chevMat, MAX_ARROWS);
  chev.count = 0; chev.frustumCulled = false;
  const band = new InstancedMesh(new BoxGeometry(1.1, 0.16, 1.1), mats.bandMat, 40);
  band.count = 0; band.frustumCulled = false;
  const dotMat = new MeshBasicMaterial({ color: hexColor(t.cube.path), transparent: true, opacity: 0.75, depthWrite: false });
  const dots = new InstancedMesh(new OctahedronGeometry(0.12), dotMat, MAX_PATH_DOTS);
  dots.count = 0; dots.frustumCulled = false;
  const outline = new LineSegments(new EdgesGeometry(new BoxGeometry(1.06, 1.06, 1.06)), new LineBasicMaterial({ color: hexColor(t.cube.path) }));
  outline.visible = false;
  const ring = new Mesh(new RingGeometry(0.42, 0.52, 32), new MeshBasicMaterial({ color: hexColor(t.cube.path), transparent: true, opacity: 0.85, side: DoubleSide }));
  ring.visible = false;
  const group = new Group();
  const b: Board = {
    geo, ...mats, arrow: inst(mats.arrowMat, MAX_ARROWS, true, true), stone: inst(mats.stoneMat, MAX_STONES, true, true), core: inst(mats.coreMat, 8, true, false),
    chev, band, dots, dotMat, outline, ring, group, records: new Map(), arrowSlots: [], stoneSlots: [], coreSlots: [],
    flyouts: [], flashes: new Map(), shakes: new Map(), hoverId: null, selectedId: null, time: 0, theme: t, extent: 1, lookKey: boardLookKey(),
  };
  group.add(b.arrow, b.stone, b.core, chev, band, dots, outline, ring);
  scene.add(group);
  board = b;
  syncBoard(state, [], false);
  let extent = 1;
  for (const c of state.cubes) extent = Math.max(extent, Math.abs(c.pos[0]), Math.abs(c.pos[1]), Math.abs(c.pos[2]));
  b.extent = extent * SPACING;
  frameExtent(b.extent);
  fitShadow(b.extent);
}
function writeCube(mesh: InstancedMesh, slot: number, pos: Vec3i, dir: number, lift: number, extra: { offset?: Vector3; spin?: number; scale?: number } | null = null): void {
  tPos.set(pos[0] * SPACING, pos[1] * SPACING, pos[2] * SPACING);
  const d = DIRS[dir]!;
  if (lift) { tPos.x += d[0] * lift; tPos.y += d[1] * lift; tPos.z += d[2] * lift; }
  if (extra?.offset) tPos.add(extra.offset);
  tQuat.identity();
  if (extra?.spin) tQuat.setFromAxisAngle(tDir.set(d[0], d[1], d[2]), extra.spin);
  tScale.setScalar(extra?.scale ?? 1);
  tMat.compose(tPos, tQuat, tScale);
  mesh.setMatrixAt(slot, tMat);
}
function writeOriented(mesh: InstancedMesh, slot: number, pos: Vec3i, dir: number, ahead: number): void {
  const d = DIRS[dir]!;
  tPos.set((pos[0] + d[0] * ahead) * SPACING, (pos[1] + d[1] * ahead) * SPACING, (pos[2] + d[2] * ahead) * SPACING);
  tQuat.setFromUnitVectors(Y_AXIS, tDir.set(d[0], d[1], d[2]));
  tScale.setScalar(1);
  tMat.compose(tPos, tQuat, tScale);
  mesh.setMatrixAt(slot, tMat);
}
/** cubeviews.js syncState + scene.js syncBoard's bursts. */
export function syncBoard(state: State, events: RulesEvent[], vfx = true): void {
  const b = board;
  if (!b) return;
  const arrows: Cube[] = [], stones: Cube[] = [], cores: Cube[] = [];
  for (const c of state.cubes) (c.kind === "arrow" ? arrows : c.kind === "stone" ? stones : cores).push(c);
  b.records.clear();
  b.arrowSlots = arrows.map((c) => c.id); b.stoneSlots = stones.map((c) => c.id); b.coreSlots = cores.map((c) => c.id);
  const keyIds = new Set<string>(), lockedIds = new Set<string>();
  for (const c of state.cubes) if (c.lock && !c.lock.open) { lockedIds.add(c.id); keyIds.add(c.lock.keyId); }
  arrows.forEach((c, i) => {
    b.records.set(c.id, { id: c.id, kind: "arrow", slot: i, pos: c.pos, dir: c.dir, locked: lockedIds.has(c.id), isKey: keyIds.has(c.id) });
    writeCube(b.arrow, i, c.pos, c.dir, 0);
    writeOriented(b.chev, i, c.pos, c.dir, 0.56);
  });
  stones.forEach((c, i) => { b.records.set(c.id, { id: c.id, kind: "stone", slot: i, pos: c.pos, dir: c.dir }); writeCube(b.stone, i, c.pos, c.dir, 0); });
  cores.forEach((c, i) => { b.records.set(c.id, { id: c.id, kind: "core", slot: i, pos: c.pos, dir: c.dir }); writeCube(b.core, i, c.pos, c.dir, 0); });
  for (const ev of events) {
    if (ev.type === "release" && ev.cubeId && ev.pos) b.flyouts.push({ id: ev.cubeId, pos: ev.pos, dir: ev.dir ?? 0, t: 0, dur: 0.5, slot: -1 });
    else if (ev.type === "unlock" && ev.cubeId) b.flashes.set(ev.cubeId, { t: 0, dur: 0.6 });
    else if (ev.type === "invalid" && ev.cubeId) b.shakes.set(ev.cubeId, { t: 0, dur: 0.3 });
  }
  const maxGhosts = Math.max(0, MAX_ARROWS - arrows.length);
  if (b.flyouts.length > maxGhosts) b.flyouts.splice(0, b.flyouts.length - maxGhosts);
  let ghost = arrows.length;
  for (const f of b.flyouts) { f.slot = ghost++; b.records.set(f.id, { id: f.id, kind: "ghost", slot: f.slot, pos: f.pos, dir: f.dir }); }
  b.arrow.count = ghost; b.stone.count = stones.length; b.core.count = cores.length; b.chev.count = arrows.length;
  let bands = 0;
  for (const id of lockedIds) { const r = b.records.get(id); if (r) writeOriented(b.band, bands++, r.pos, r.dir, 0); }
  b.band.count = bands;
  for (const m of [b.arrow, b.stone, b.core, b.chev, b.band]) m.instanceMatrix.needsUpdate = true;
  refreshColors();
  refreshSelection();
  if (!vfx) return;
  for (const ev of events) {
    if (ev.type === "release" && ev.pos) burst(new Vector3(ev.pos[0] * SPACING, ev.pos[1] * SPACING, ev.pos[2] * SPACING), b.theme.cube.path, 18, 2.6, 0.6);
    else if (ev.type === "unlock" && ev.cubeId) {
      const r = b.records.get(ev.cubeId);
      if (r) burst(new Vector3(r.pos[0] * SPACING, r.pos[1] * SPACING, r.pos[2] * SPACING), 0x7dffb0, 26, 2.2, 0.7);
    } else if (ev.type === "complete") burst(new Vector3(0, 0, 0), 0xffd27a, 90, 4.5, 1.2);
  }
}
const tColor = new Color(), tFlash = new Color();
function colorFor(r: Rec): Color {
  const t = board!.theme.cube;
  if (r.kind === "ghost") return tColor.setHex(t.arrow).multiplyScalar(0.6);
  if (r.id === board!.selectedId) return tColor.setHex(t.select);
  if (r.id === board!.hoverId) return tColor.setHex(t.hover);
  if (r.locked) return tColor.setHex(t.locked);
  if (r.isKey) return tColor.setHex(0xffd27a).multiplyScalar(0.75 + 0.25 * Math.sin(board!.time * 4));
  return tColor.setHex(t.arrow);
}
function refreshColors(): void {
  const b = board!;
  for (const [id, r] of b.records) {
    if (r.kind === "stone" || r.kind === "core") continue;
    let c = colorFor(r);
    const f = b.flashes.get(id);
    if (f) c = tFlash.setHex(0x7dffb0).lerp(c, f.t / f.dur);
    b.arrow.setColorAt(r.slot, c);
  }
  if (b.arrow.instanceColor) b.arrow.instanceColor.needsUpdate = true;
}
function refreshSelection(): void {
  const b = board!;
  const r = b.selectedId ? b.records.get(b.selectedId) : null;
  if (!r || r.kind !== "arrow") { b.outline.visible = false; b.ring.visible = false; b.dots.count = 0; return; }
  b.outline.position.set(r.pos[0] * SPACING, r.pos[1] * SPACING, r.pos[2] * SPACING);
  b.outline.visible = true;
  b.ring.position.copy(b.outline.position);
  b.ring.visible = true;
}
export function setHover(id: string | null): void { if (board && board.hoverId !== id) { board.hoverId = id; refreshColors(); } }
export function hovered(): string | null { return board?.hoverId ?? null; }
export function setSelected(id: string | null): void { if (!board) return; board.selectedId = id; refreshColors(); refreshSelection(); }
/** cubeviews.js showPathFor: the dots along the selected cube's ray. */
export function showPathFor(state: State, id: string | null): void {
  const b = board;
  if (!b) return;
  const r = id ? b.records.get(id) : null;
  const cube = r && r.kind === "arrow" ? state.cubes.find((c) => c.id === id) : null;
  if (!cube) { b.dots.count = 0; return; }
  const { cells } = Engine.rayCells(state, cube, MAX_PATH_DOTS);
  cells.forEach((cell, i) => {
    tPos.set(cell[0] * SPACING, cell[1] * SPACING, cell[2] * SPACING);
    tQuat.identity();
    tScale.setScalar(1 - (i / MAX_PATH_DOTS) * 0.5);
    tMat.compose(tPos, tQuat, tScale);
    b.dots.setMatrixAt(i, tMat);
  });
  b.dots.count = cells.length;
  b.dots.instanceMatrix.needsUpdate = true;
}
/** cubeviews.js applyTheme (palette changes keep the board). */
export function applyTheme(t: Theme): void {
  const b = board;
  if (!b) return;
  b.theme = t;
  (b.chevMat as MeshStandardMaterial).color = hexColor(t.cube.chevron);
  (b.coreMat as MeshStandardMaterial).color = hexColor(t.cube.core);
  (b.coreMat as MeshStandardMaterial).emissive = hexColor(t.cube.core);
  b.dotMat.color = hexColor(t.cube.path);
  (b.outline.material as LineBasicMaterial).color = hexColor(t.cube.path);
  (b.ring.material as MeshBasicMaterial).color = hexColor(t.cube.path);
  refreshColors();
}
function updateBoard(dt: number): void {
  const b = board!;
  b.time += dt;
  let dirty = false;
  for (let i = b.flyouts.length - 1; i >= 0; i--) {
    const f = b.flyouts[i]!;
    f.t += dt;
    const k = Math.min(1, f.t / f.dur), ease = k * k * (3 - 2 * k);
    if (k >= 1) { writeCube(b.arrow, f.slot, f.pos, f.dir, 0, { scale: 0 }); b.flyouts.splice(i, 1); b.records.delete(f.id); }
    else {
      const d = DIRS[f.dir]!;
      tOff.set(d[0], d[1], d[2]).multiplyScalar(ease * 5.5);
      writeCube(b.arrow, f.slot, f.pos, f.dir, 0, { offset: tOff.clone(), spin: ease * 2.2, scale: 1 - ease * 0.35 });
    }
    dirty = true;
  }
  for (const [id, s] of b.shakes) {
    s.t += dt;
    const r = b.records.get(id);
    if (!r || s.t >= s.dur) { if (r && r.kind === "arrow") writeCube(b.arrow, r.slot, r.pos, r.dir, 0); b.shakes.delete(id); }
    else if (r.kind === "arrow") {
      const amp = 0.06 * (1 - s.t / s.dur);
      writeCube(b.arrow, r.slot, r.pos, r.dir, 0, { offset: new Vector3(Math.sin(s.t * 55) * amp, Math.cos(s.t * 47) * amp, 0) });
    }
    dirty = true;
  }
  let colorDirty = b.flashes.size > 0;
  for (const [id, f] of b.flashes) { f.t += dt; if (f.t >= f.dur) b.flashes.delete(id); }
  for (const r of b.records.values()) if (r.isKey) { colorDirty = true; break; }
  if (colorDirty) refreshColors();
  const r = b.selectedId ? b.records.get(b.selectedId) : null;
  if (r && r.kind === "arrow") {
    writeCube(b.arrow, r.slot, r.pos, r.dir, 0.08 + 0.03 * Math.sin(b.time * 3));
    dirty = true;
    b.ring.position.set(r.pos[0] * SPACING, r.pos[1] * SPACING, r.pos[2] * SPACING);
    b.ring.quaternion.copy(camera.quaternion);
    b.ring.scale.setScalar(1 + 0.06 * Math.sin(b.time * 3));
  }
  if (dirty) b.arrow.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- picking and the view
const raycaster = new Raycaster();
const ndc = new Vector2();
/** The cube under a window point (physical pixels), or null. */
export function pick(x: number, y: number): string | null {
  const b = board;
  if (!b || !visible3d) return null;
  pointerToNdc(x, y, ndc);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects([b.arrow, b.stone, b.core], false);
  const hit = hits[0];
  if (!hit || hit.instanceId == null) return null;
  if (hit.object === b.arrow) return b.arrowSlots[hit.instanceId] ?? null;
  if (hit.object === b.stone) return b.stoneSlots[hit.instanceId] ?? null;
  if (hit.object === b.core) return b.coreSlots[hit.instanceId] ?? null;
  return null;
}
export interface Rect { x: number; y: number; width: number; height: number }
let viewKey = "";
/** The playfield rectangle in window pixels (null: no 3D, the menus' backdrop is the UI's). */
export function setView(w: number, h: number, field: Rect | null): void {
  visible3d = !!field && !!board;
  renderer.camera = visible3d ? camera : null;
  if (!field || !visible3d) return;
  const k = `${w}:${h}:${Math.round(field.x)}:${Math.round(field.y)}:${Math.round(field.width)}:${Math.round(field.height)}`;
  if (k === viewKey) return;
  viewKey = k;
  const pw = Math.max(1, field.width), ph = Math.max(1, field.height);
  camera.aspect = pw / ph;
  camera.setViewOffset(pw, ph, -field.x, -field.y, w, h);
  camera.updateProjectionMatrix();
  frameExtent(board!.extent);
}
/** A cube's projected box in window pixels (for ui.target names). */
export function cubeRect(id: string, w: number, h: number): Rect | null {
  const r = board?.records.get(id);
  if (!r || r.kind === "ghost" || !visible3d) return null;
  const v = new Vector3(r.pos[0] * SPACING, r.pos[1] * SPACING, r.pos[2] * SPACING).project(camera);
  if (v.z > 1) return null;
  const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h;
  const dist = camera.position.distanceTo(new Vector3(r.pos[0] * SPACING, r.pos[1] * SPACING, r.pos[2] * SPACING));
  const s = Math.max(8, (0.5 / (dist * Math.tan((FRAME.fov * Math.PI) / 360))) * (camera.view ? camera.view.fullHeight : h) * 0.8);
  return { x: x - s / 2, y: y - s / 2, width: s, height: s };
}

/** Each frame: the camera springs, fixed-step motion (old FIXED_STEP 1/60), the sky and the sculpture's bob. */
let accum = 0;
export function update(dt: number): void {
  if (!built) return;
  const d = Math.min(0.25, dt);
  if (reducedMotion) snapRig();
  else { springStep(rig.theta, FRAME.omega, d); springStep(rig.phi, FRAME.omega, d); springStep(rig.radius, FRAME.omega, d); }
  applyRig();
  if (!visible3d) return;
  accum += d;
  const moving = !reducedMotion && !!look?.animated;
  while (accum >= 1 / 60) {
    accum -= 1 / 60;
    const s = 1 / 60;
    phase += s;
    if (board) updateBoard(s);
    updateVfx(s);
    if (moving && moteCount) { moteTime += s; writeMotes(); }
    if (moving && skyU.uTime) skyU.uTime.value = (skyU.uTime.value as number) + s;
    if (moving) for (const a of envAnimated) { a.obj.position.y = a.baseY + Math.sin(phase * a.speed + a.phase) * a.amp; a.obj.rotation.y += a.spin * s; }
  }
}
