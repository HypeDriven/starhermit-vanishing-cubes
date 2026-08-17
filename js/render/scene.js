// Three.js scene: the floating impossible sculpture in a pale sky. PBR
// lighting with one dominant key, soft hemisphere fill, contact shadows
// between cubes; authored camera; deterministic decorative seed; explicit
// disposal on scene changes. The no-post baseline must remain readable, so
// hierarchy comes from lighting, tint, outline and shape — never bloom.

import * as THREE from 'three';
import { Rng } from '../rules/rng.js';
import { CubeViews, SPACING } from './cubeviews.js';
import { CameraRig, FRAME } from './camera.js';
import { Vfx } from './vfx.js';
import { TIERS } from './quality.js';

const FIXED_STEP = 1 / 60;

function skyDome(theme) {
  const geo = new THREE.SphereGeometry(220, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(theme.sky.top) },
      horizon: { value: new THREE.Color(theme.sky.horizon) },
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
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y * 1.6 + 0.25, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, top, h), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.raycast = () => {};
  return mesh;
}

export class GameScene {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.tier = TIERS[settings.graphics.tier] || TIERS.medium;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.tier.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = this.tier.shadowMapSize > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FRAME.fov, 1, 0.1, 500);
    this.rig = new CameraRig(this.camera);
    this.rig.setReducedMotion(settings.accessibility.reducedMotion);

    // Lighting: one dominant key + soft environment fill.
    this.key = new THREE.DirectionalLight(0xfff2dd, 2.6);
    this.key.position.set(6, 10, 4);
    this.key.castShadow = this.tier.shadowMapSize > 0;
    this.key.shadow.mapSize.setScalar(Math.max(512, this.tier.shadowMapSize));
    this.key.shadow.camera.left = -8;
    this.key.shadow.camera.right = 8;
    this.key.shadow.camera.top = 8;
    this.key.shadow.camera.bottom = -8;
    this.key.shadow.bias = -0.0004;
    this.hemi = new THREE.HemisphereLight(0xcfe0f2, 0x9a8f80, 0.9);
    this.scene.add(this.key, this.hemi);

    this.envGroup = new THREE.Group();
    this.envGroup.name = 'environment';
    this.scene.add(this.envGroup);
    this.sky = null;
    this.cubeViews = null;
    this.vfx = new Vfx(this.scene);
    this.vfx.setQuality(this.tier.particleMultiplier);
    this.vfx.setReducedMotion(settings.accessibility.reducedMotion);

    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._accum = 0;
    this._lastT = 0;
    this._raf = 0;
    this._running = false;
    this._phase = 0;
    this._envAnimated = [];
    this.onFrame = null; // optional callback each rAF (used by main for timers)

    this.resize();
  }

  // ---------- environment ----------

  buildEnvironment(seed, theme) {
    // Clear previous environment.
    for (const child of [...this.envGroup.children]) {
      this.envGroup.remove(child);
      child.traverse?.((o) => {
        o.geometry?.dispose?.();
        if (o.material && o.material._ownByEnv) o.material.dispose();
      });
    }
    this._envAnimated = [];

    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky.geometry.dispose();
      this.sky.material.dispose();
    }
    this.sky = skyDome(theme);
    this.scene.add(this.sky);
    this.scene.fog = new THREE.FogExp2(theme.sky.fog, theme.sky.fogDensity);

    const rng = new Rng('decor:' + seed);
    const detail = this.tier.envDetail;
    const structMat = new THREE.MeshStandardMaterial({
      color: theme.env.structure,
      roughness: 0.85,
      metalness: 0.0,
    });
    structMat._ownByEnv = true;
    const accentMat = new THREE.MeshStandardMaterial({
      color: theme.env.accent,
      roughness: 0.7,
      metalness: 0.1,
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
  }

  // ---------- board ----------

  buildBoard(state, theme) {
    if (this.cubeViews) this.cubeViews.dispose();
    this.cubeViews = new CubeViews(this.scene, theme);
    this.cubeViews.build(state);
    let extent = 1;
    for (const c of state.cubes) {
      extent = Math.max(extent, Math.abs(c.pos[0]), Math.abs(c.pos[1]), Math.abs(c.pos[2]));
    }
    this.boardExtent = extent * SPACING;
    this.rig.frameExtent(this.boardExtent);
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
      this.renderer.render(this.scene, this.camera);
      if (this.onFrame) this.onFrame(dt);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _fixedUpdate(dt) {
    if (this.cubeViews) this.cubeViews.update(dt, this.camera);
    this.vfx.update(dt);
    if (!this.settings.accessibility.reducedMotion) {
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
    const dpr = Math.min(window.devicePixelRatio || 1, this.tier.dprCap) * this.tier.renderScale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.boardExtent) this.rig.frameExtent(this.boardExtent); // aspect-aware fit
  }

  applyQuality(tierId) {
    this.tier = TIERS[tierId] || TIERS.medium;
    this.renderer.shadowMap.enabled = this.tier.shadowMapSize > 0;
    this.key.castShadow = this.tier.shadowMapSize > 0;
    if (this.tier.shadowMapSize > 0) {
      this.key.shadow.mapSize.setScalar(this.tier.shadowMapSize);
      if (this.key.shadow.map) {
        this.key.shadow.map.dispose();
        this.key.shadow.map = null;
      }
    }
    this.vfx.setQuality(this.tier.particleMultiplier);
    this.resize();
  }

  setReducedMotion(on) {
    this.rig.setReducedMotion(on);
    this.vfx.setReducedMotion(on);
  }

  dispose() {
    this.stop();
    this.cubeViews?.dispose();
    this.vfx.dispose(this.scene);
    this.renderer.dispose();
  }
}
