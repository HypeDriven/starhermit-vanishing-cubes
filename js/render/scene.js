// Three.js scene: the floating impossible sculpture in a pale sky. PBR
// lighting with one dominant key, soft hemisphere fill, contact shadows
// between cubes; authored camera; deterministic decorative seed; explicit
// disposal on scene changes. The no-post baseline must remain readable, so
// hierarchy comes from lighting, tint, outline and shape — never bloom.

import * as THREE from 'three';
import { Rng } from '../rules/rng.js';
import { CubeViews, SPACING } from './cubeviews.js';
import { CameraRig, FRAME } from './camera.js';
import { Vfx, Motes } from './vfx.js';
import { detectPreset, describe, resolve, SHADOW_MAP } from './gfx.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const FIXED_STEP = 1 / 60;

// Colour grade + vignette (display-space in, display-space out). Gentle
// S-curve and a touch of saturation; never lowers the contrast of pieces.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.16 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.3);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.97, 0.99, 1.04), vec3(1.03, 1.0, 0.97), smoothstep(0.25, 0.85, l));
      c = mix(c, s, uAmount);
      float d = length(vUv - 0.5);
      c *= 1.0 - uVignette * smoothstep(0.4, 0.9, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

// Pale sky: vertical gradient, a warm sun glow toward the key light and soft
// procedural cloud banks that drift when the background is animated.
function skyDome(theme) {
  const geo = new THREE.SphereGeometry(220, 32, 20);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(theme.sky.top) },
      horizon: { value: new THREE.Color(theme.sky.horizon) },
      sunColor: { value: new THREE.Color(theme.light.key) },
      sunDir: { value: new THREE.Vector3(6, 10, 4).normalize() },
      uTime: { value: 0 },
      uClouds: { value: 1 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 sunColor;
      uniform vec3 sunDir;
      uniform float uTime;
      uniform float uClouds;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y * 1.6 + 0.25, 0.0, 1.0);
        vec3 col = mix(horizon, top, h);
        float sun = max(dot(d, normalize(sunDir)), 0.0);
        col += sunColor * (pow(sun, 64.0) * 0.35 + pow(sun, 6.0) * 0.12);
        if (uClouds > 0.0) {
          vec2 uv = d.xz / (0.35 + abs(d.y)) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
          float c = smoothstep(0.52, 0.8, fbm(uv));
          float band = smoothstep(-0.25, 0.05, d.y) * (1.0 - smoothstep(0.35, 0.8, d.y));
          col = mix(col, mix(horizon, vec3(1.0), 0.55), c * band * 0.45 * uClouds);
        }
        // Pre-compensate the filmic curve's desaturation so the tone-mapped
        // sky keeps the theme's authored hue.
        col = max(mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 1.45), 0.0);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.raycast = () => {};
  return mesh;
}

// Weathered stone for the floating sculpture: deterministic mottling and
// fine strata so large flat faces are not a single flat tone.
function stoneTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  let s = 99;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    const v = rnd();
    g.fillStyle = v < 0.6 ? `rgba(40,50,60,${0.03 + v * 0.05})` : `rgba(255,255,255,${0.1 + (v - 0.6) * 0.2})`;
    const r = 1 + rnd() * 5;
    g.beginPath();
    g.arc(rnd() * 128, rnd() * 128, r, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(40,50,60,0.08)';
  for (let y = 6; y < 128; y += 11 + rnd() * 6) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(128, y + (rnd() - 0.5) * 4);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function isMobile() {
  try {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
      || (navigator.maxTouchPoints > 1 && matchMedia('(pointer: coarse)').matches);
  } catch {
    return false;
  }
}

export class GameScene {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    // No canvas MSAA: anti-aliasing is a post pass (or MSAA on the composer
    // target), so the Low preset stays a single cheap direct render.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // filtered PCF; the soft variant is deprecated in r18x
    this.gpu = GameScene._gpuName(this.renderer);
    this.detected = detectPreset(this.gpu, { mobile: isMobile() });
    this.size = [0, 0];
    this.pixelRatio = 1;
    this.adaptiveScale = 1;
    this._frames = [];
    this.fps = 0;
    this.composer = null;
    this.postKey = null;
    this.postFailed = false;
    this._envMap = null;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FRAME.fov, 1, 0.1, 500);
    this.rig = new CameraRig(this.camera);
    this.rig.setReducedMotion(settings.accessibility.reducedMotion);

    // Lighting: one dominant key + soft environment fill.
    this.key = new THREE.DirectionalLight(0xfff2dd, 2.6);
    this.key.position.set(6, 10, 4);
    this.key.castShadow = false;
    this.key.shadow.mapSize.setScalar(1024);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.keyDir = new THREE.Vector3(6, 10, 4).normalize();
    this.hemi = new THREE.HemisphereLight(0xcfe0f2, 0x9a8f80, 0.9);
    this.scene.add(this.key, this.key.target, this.hemi);
    this._fitShadow(4);

    this.envGroup = new THREE.Group();
    this.envGroup.name = 'environment';
    this.scene.add(this.envGroup);
    this.sky = null;
    this.cubeViews = null;
    this.vfx = new Vfx(this.scene);
    this.vfx.setReducedMotion(settings.accessibility.reducedMotion);
    this.motes = new Motes(this.scene);
    this.reducedMotion = !!settings.accessibility.reducedMotion;

    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._accum = 0;
    this._lastT = 0;
    this._raf = 0;
    this._running = false;
    this._phase = 0;
    this._envAnimated = [];
    this.onFrame = null; // optional callback each rAF (used by main for timers)

    this.setGraphics(settings.graphics);
    this.resize();
  }

  static _gpuName(r) {
    try {
      const gl = r.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    } catch {
      return '';
    }
  }

  // ---------- graphics settings ----------

  /** Apply saved graphics settings live (no reload). */
  setGraphics(saved) {
    const g = resolve(saved, this.detected);
    const prev = this.q;
    this.q = g;
    const size = SHADOW_MAP[g.shadows];
    const shadowsChanged = !prev || prev.shadows !== g.shadows;
    this.renderer.shadowMap.enabled = size > 0;
    this.key.castShadow = size > 0;
    if (size > 0 && this.key.shadow.mapSize.x !== size) {
      this.key.shadow.mapSize.set(size, size);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    // Image-based lighting: a PMREM-filtered room environment for PBR
    // reflections; the hemisphere fill drops so the total stays balanced.
    if (g.reflections === 'on') {
      if (!this._envMap) {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const room = new RoomEnvironment();
        this._envMap = pmrem.fromScene(room, 0.04).texture;
        room.dispose?.();
        pmrem.dispose();
      }
      this.scene.environment = this._envMap;
      this.scene.environmentIntensity = 0.14;
    } else {
      this.scene.environment = null;
    }
    this._applyLightBalance();
    this.envDetail = g.detail === 'detailed' ? 1 : 0.55;
    this.vfx.setQuality(g.particles === 'high' ? 1 : 0.35);
    this.motes.setCount(g.particles === 'high' ? 70 : 0);
    this._applyMotion();
    this.cubeViews?.applyGfx({ detail: g.detail, reflections: g.reflections });
    this.cubeViews?.setCoreGlow(g.bloom === 'on' ? 1.8 : 1);
    this.adaptiveScale = 1;
    this._frames = [];
    this.postKey = null; // rebuild the post chain on the next frame
    this.postFailed = false;
    this._fpsVisible(g.showFps);
    if (shadowsChanged) {
      this.scene.traverse((o) => {
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) m.needsUpdate = true;
      });
    }
    this.resize();
    return g;
  }

  _applyLightBalance() {
    const t = this._theme;
    const hemi = t ? t.light.hemiIntensity : 0.9;
    this.hemi.intensity = this.q?.reflections === 'on' ? hemi * 0.8 : hemi;
  }

  _applyMotion() {
    const moving = !this.reducedMotion && this.q?.background === 'animated';
    this.motes.setMoving(moving);
    if (this.sky) this.sky.material.uniforms.uClouds.value = this.q?.detail === 'detailed' ? 1 : 0;
    this._bgMoving = moving;
  }

  /** What the Graphics panel shows: GPU, auto choice, resolved tiers, cost. */
  graphicsInfo(words) {
    const parent = this.canvas.parentElement;
    let w = parent?.clientWidth || 0;
    let h = parent?.clientHeight || 0;
    if (!w || !h) {
      w = window.innerWidth;
      h = window.innerHeight;
    }
    const ratio = this._ratio();
    const px = [Math.round(w * ratio), Math.round(h * ratio)];
    return {
      gpu: this.gpu || '',
      detected: this.detected,
      resolved: this.q,
      summary: describe(this.q, px, words),
      fps: Math.round(this.fps || 0),
      adaptiveScale: Math.round(this.adaptiveScale * 100) / 100,
      postFailed: !!this.postFailed,
    };
  }

  _fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      (this.canvas.parentElement || document.body).append(el);
    }
    if (el) {
      el.hidden = !on;
      if (on && !el.textContent) el.textContent = '… fps';
    }
  }

  _ratio() {
    const q = this.q;
    return Math.min(window.devicePixelRatio || 1, q.dprCap) * q.scale * this.adaptiveScale;
  }

  // Fit the key light's orthographic shadow box tightly around the board.
  _fitShadow(extent) {
    const r = extent * 1.75 + 1; // covers the board's bounding sphere from any light angle
    const cam = this.key.shadow.camera;
    this.key.target.position.set(0, 0, 0);
    this.key.position.copy(this.keyDir).multiplyScalar(r + 12);
    Object.assign(cam, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 2 * r + 26 });
    cam.updateProjectionMatrix();
  }

  _postKey(w, h) {
    const g = this.q;
    return g.post && !this.postFailed ? [g.ao, g.bloom, g.grade, g.antialias, w, h, this.pixelRatio].join('|') : 'none';
  }

  _buildPost(w, h) {
    const g = this.q;
    this.composer?.renderTarget1?.dispose();
    this.composer?.renderTarget2?.dispose();
    for (const p of this.composer?.passes || []) p.dispose?.();
    this.composer = null;
    if (!g.post || this.postFailed) return;
    const pw = Math.max(1, Math.round(w * this.pixelRatio));
    const ph = Math.max(1, Math.round(h * this.pixelRatio));
    try {
      const target = new THREE.WebGLRenderTarget(pw, ph, {
        type: THREE.HalfFloatType,
        samples: g.antialias === 'msaa' ? 4 : 0,
      });
      const composer = new EffectComposer(this.renderer, target);
      composer.setPixelRatio(this.pixelRatio);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (g.ao !== 'off') {
        const ao = new GTAOPass(this.scene, this.camera, pw, ph);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.85;
        ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: g.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ao === 'high' ? 6 : 4, rings: 2, samples: g.ao === 'high' ? 16 : 8 });
        composer.addPass(ao);
      }
      if (g.bloom === 'on') {
        // Scene-linear HDR input: only emissive cores, the sun glow and hot
        // specular highlights exceed this threshold; lit white faces do not.
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.4, 0.5, 2.2));
      }
      composer.addPass(new OutputPass());
      if (g.grade === 'on') {
        const grade = new ShaderPass(GradeShader);
        composer.addPass(grade);
      }
      if (g.antialias === 'smaa') composer.addPass(new SMAAPass(pw, ph));
      if (g.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
        composer.addPass(fxaa);
      }
      this.composer = composer;
    } catch {
      // Post-processing is an enhancement: render directly and let the
      // Graphics panel say so (no console output — QA treats it as a failure).
      this.postFailed = true;
      this.composer = null;
    }
  }

  // Adaptive resolution: average ~90 frames; step down when slow, up when fast.
  _adapt(dtMs) {
    const f = this._frames;
    f.push(dtMs);
    if (f.length < 90) return false;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = `${Math.round(this.fps)} fps · ${Math.round(this.pixelRatio * 100) / 100}×`;
    if (!this.q.adaptive) return false;
    const before = this.adaptiveScale;
    if (avg > 26) this.adaptiveScale = Math.max(0.6, Math.round((this.adaptiveScale - 0.1) * 100) / 100);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, Math.round((this.adaptiveScale + 0.05) * 100) / 100);
    return before !== this.adaptiveScale;
  }

  _render(dt) {
    if (this._adapt(dt * 1000)) this.resize();
    const key = this._postKey(this.size[0], this.size[1]);
    if (key !== this.postKey) {
      this.postKey = key;
      this._buildPost(this.size[0], this.size[1]);
    }
    if (this.composer) {
      try {
        this.composer.render(dt);
        return;
      } catch {
        this.postFailed = true;
        this.postKey = null;
        this.composer = null;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- environment ----------

  buildEnvironment(seed, theme) {
    // Clear previous environment.
    for (const child of [...this.envGroup.children]) {
      this.envGroup.remove(child);
      child.traverse?.((o) => {
        o.geometry?.dispose?.();
        if (o.material && o.material._ownByEnv) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
    }
    this._envAnimated = [];

    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky.geometry.dispose();
      this.sky.material.dispose();
    }
    this._theme = theme;
    this.sky = skyDome(theme);
    this.sky.material.uniforms.sunDir.value.copy(this.keyDir);
    this.scene.add(this.sky);
    this.motes.setColor(theme.light.key);
    this.scene.fog = new THREE.FogExp2(theme.sky.fog, theme.sky.fogDensity);

    const rng = new Rng('decor:' + seed);
    const detail = this.envDetail ?? 1;
    const stoneTex = detail >= 1 ? stoneTexture() : null;
    const structMat = new THREE.MeshStandardMaterial({
      color: theme.env.structure,
      roughness: 0.85,
      metalness: 0.0,
      map: stoneTex,
    });
    structMat._ownByEnv = true;
    const accentMat = new THREE.MeshStandardMaterial({
      color: theme.env.accent,
      roughness: 0.55,
      metalness: 0.25,
      map: stoneTex,
    });
    accentMat._ownByEnv = true;

    // The impossible sculpture: a broken ring of staircases to nowhere,
    // floating arcs, and obelisks at impossible angles — dense enough that
    // several modules always read inside the authored camera frame.
    const modules = Math.max(10, Math.round(26 * detail));
    const ringRadius = 13 + rng.next() * 3.5;
    // The camera orbits at radius ≤ ~10 for every board size; modules are
    // pushed outside 14 units so one can never crowd the board or camera.
    const keepClear = (v) => {
      const d = Math.hypot(v.x, v.z);
      if (d < 14) {
        const k = 14 / Math.max(d, 0.001);
        v.x *= k;
        v.z *= k;
      }
      return v;
    };

    // Instanced staircase steps — one draw call for every staircase.
    const stepsPerStair = 8;
    const stairCount = modules;
    const stepGeo = new THREE.BoxGeometry(1.35, 0.42, 1.35);
    const steps = new THREE.InstancedMesh(stepGeo, structMat, stairCount * stepsPerStair);
    let stepIndex = 0;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let s = 0; s < stairCount; s++) {
      const angle = (s / stairCount) * Math.PI * 2 + rng.next() * 0.5;
      const base = keepClear(new THREE.Vector3(
        Math.cos(angle) * (ringRadius + rng.next() * 6),
        -3.5 + rng.next() * 8,
        Math.sin(angle) * (ringRadius + rng.next() * 6),
      ));
      // Staircases run tangentially around the ring so they can never
      // stretch inward toward the camera or board.
      const heading = angle + Math.PI / 2 + (rng.next() - 0.5) * 0.4;
      const dir = new THREE.Vector3(Math.cos(heading), 0, Math.sin(heading));
      for (let i = 0; i < stepsPerStair; i++) {
        const p = base.clone().addScaledVector(dir, i * 1.4);
        p.y += i * 0.58;
        q.setFromAxisAngle(up, heading + Math.PI / 4);
        m4.compose(p, q, new THREE.Vector3(1, 1, 1));
        steps.setMatrixAt(stepIndex++, m4);
      }
    }
    steps.count = stepIndex;
    steps.raycast = () => {};
    this.envGroup.add(steps);

    // Floating arcs.
    const arcCount = Math.ceil(modules * 0.8);
    for (let i = 0; i < arcCount; i++) {
      const radius = 4 + rng.next() * 3.5;
      const arc = Math.PI * (0.4 + rng.next() * 0.6);
      const geo = new THREE.TorusGeometry(radius, 0.22 + rng.next() * 0.14, 8, 32, arc);
      const mesh = new THREE.Mesh(geo, rng.next() < 0.5 ? structMat : accentMat);
      const angle = rng.next() * Math.PI * 2;
      keepClear(mesh.position.set(
        Math.cos(angle) * (ringRadius * 0.9 + rng.next() * 5),
        -2 + rng.next() * 9,
        Math.sin(angle) * (ringRadius * 0.9 + rng.next() * 5),
      ));
      mesh.rotation.set(rng.next() * Math.PI, rng.next() * Math.PI, rng.next() * Math.PI);
      mesh.raycast = () => {};
      this.envGroup.add(mesh);
      this._envAnimated.push({
        obj: mesh,
        baseY: mesh.position.y,
        amp: 0.3 + rng.next() * 0.4,
        speed: 0.2 + rng.next() * 0.3,
        phase: rng.next() * Math.PI * 2,
        spin: (rng.next() - 0.5) * 0.05,
      });
    }

    // Obelisks.
    const obeliskCount = Math.ceil(modules * 0.6);
    const obGeo = new THREE.ConeGeometry(0.8, 6, 4);
    for (let i = 0; i < obeliskCount; i++) {
      const mesh = new THREE.Mesh(obGeo, accentMat);
      const angle = rng.next() * Math.PI * 2;
      keepClear(mesh.position.set(
        Math.cos(angle) * (ringRadius * 1.1 + rng.next() * 4),
        -4 + rng.next() * 8,
        Math.sin(angle) * (ringRadius * 1.1 + rng.next() * 4),
      ));
      mesh.rotation.z = (rng.next() - 0.5) * 0.8; // impossible tilt
      mesh.rotation.y = rng.next() * Math.PI;
      mesh.raycast = () => {};
      this.envGroup.add(mesh);
      this._envAnimated.push({
        obj: mesh,
        baseY: mesh.position.y,
        amp: 0.2 + rng.next() * 0.3,
        speed: 0.15 + rng.next() * 0.25,
        phase: rng.next() * Math.PI * 2,
        spin: (rng.next() - 0.5) * 0.03,
      });
    }

    // Soft cloud-shadow disc far below.
    const discGeo = new THREE.CircleGeometry(9, 40);
    const discMat = new THREE.MeshBasicMaterial({
      color: theme.sky.fog,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    discMat._ownByEnv = true;
    const disc = new THREE.Mesh(discGeo, discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -9;
    disc.raycast = () => {};
    this.envGroup.add(disc);

    // Lighting from theme.
    this.key.color.set(theme.light.key);
    this.key.intensity = theme.light.keyIntensity;
    this.hemi.color.set(theme.light.hemiSky);
    this.hemi.groundColor.set(theme.light.hemiGround);
    this.hemi.intensity = theme.light.hemiIntensity;
    this._applyLightBalance();
    this._applyMotion();
    for (const child of this.envGroup.children) {
      child.castShadow = false;
      child.receiveShadow = false;
    }
  }

  // ---------- board ----------

  buildBoard(state, theme) {
    if (this.cubeViews) this.cubeViews.dispose();
    this.cubeViews = new CubeViews(this.scene, theme, { detail: this.q.detail, reflections: this.q.reflections });
    this.cubeViews.setCoreGlow(this.q.bloom === 'on' ? 1.8 : 1);
    this.cubeViews.build(state);
    let extent = 1;
    for (const c of state.cubes) {
      extent = Math.max(extent, Math.abs(c.pos[0]), Math.abs(c.pos[1]), Math.abs(c.pos[2]));
    }
    this.boardExtent = extent * SPACING;
    this.rig.frameExtent(this.boardExtent);
    this._fitShadow(this.boardExtent);
  }

  syncBoard(state, events, vfxHooks = true) {
    if (!this.cubeViews) return;
    this.cubeViews.syncState(state, events);
    if (vfxHooks) {
      for (const ev of events) {
        if (ev.type === 'release') {
          const p = new THREE.Vector3(ev.pos[0] * SPACING, ev.pos[1] * SPACING, ev.pos[2] * SPACING);
          this.vfx.burst(p, this.cubeViews.theme.cube.path, { count: 18, speed: 2.6, ttl: 0.6 });
        } else if (ev.type === 'unlock') {
          const rec = this.cubeViews.records.get(ev.cubeId);
          if (rec) {
            const p = new THREE.Vector3(rec.pos[0] * SPACING, rec.pos[1] * SPACING, rec.pos[2] * SPACING);
            this.vfx.burst(p, 0x7dffb0, { count: 26, speed: 2.2, ttl: 0.7 });
          }
        } else if (ev.type === 'complete') {
          this.vfx.burst(new THREE.Vector3(0, 0, 0), 0xffd27a, { count: 90, speed: 4.5, ttl: 1.2 });
        }
      }
    }
  }

  // ---------- picking ----------

  pick(clientX, clientY) {
    if (!this.cubeViews) return null;
    const rect = this.canvas.getBoundingClientRect();
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.cubeViews.pickables(), false);
    if (!hits.length) return null;
    const hit = hits[0];
    return this.cubeViews.cubeIdFor(hit.object, hit.instanceId);
  }

  // ---------- loop ----------

  start() {
    if (this._running) return;
    this._running = true;
    this._lastT = performance.now();
    const loop = (t) => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(loop);
      let dt = (t - this._lastT) / 1000;
      this._lastT = t;
      if (dt > 0.25) dt = 0.25; // background-tab guard
      this._accum += dt;
      while (this._accum >= FIXED_STEP) {
        this._accum -= FIXED_STEP;
        this._phase += FIXED_STEP;
        this._fixedUpdate(FIXED_STEP);
      }
      this.rig.update(dt);
      this._render(dt);
      if (this.onFrame) this.onFrame(dt);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _fixedUpdate(dt) {
    if (this.cubeViews) this.cubeViews.update(dt, this.camera);
    this.vfx.update(dt);
    this.motes.update(dt);
    if (this._bgMoving && this.sky) this.sky.material.uniforms.uTime.value += dt;
    if (this._bgMoving) {
      for (const a of this._envAnimated) {
        a.obj.position.y = a.baseY + Math.sin(this._phase * a.speed + a.phase) * a.amp;
        a.obj.rotation.y += a.spin * dt;
      }
    }
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    const dpr = this._ratio();
    this.size = [w, h];
    this.pixelRatio = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.boardExtent) this.rig.frameExtent(this.boardExtent); // aspect-aware fit
  }

  setReducedMotion(on) {
    this.reducedMotion = !!on;
    this.rig.setReducedMotion(on);
    this.vfx.setReducedMotion(on);
    this._applyMotion();
  }

  dispose() {
    this.stop();
    this.cubeViews?.dispose();
    this.vfx.dispose(this.scene);
    this.motes.dispose(this.scene);
    this.composer = null;
    this._envMap?.dispose();
    this.renderer.dispose();
  }
}
