// Bounded pooled particle system. Particles never intercept raycasts and are
// event-tiered: small bursts for legal moves, denser accents for goals and
// round completion. Reduced-motion mode suppresses bursts while preserving
// event timing (logical events are unaffected).

import * as THREE from 'three';

const CAPACITY = 2048;

// Soft round sprite shared by bursts and ambient motes (square points read as
// placeholder art).
let spriteTex = null;
function softSprite() {
  if (spriteTex) return spriteTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  spriteTex = new THREE.CanvasTexture(c);
  spriteTex.colorSpace = THREE.SRGBColorSpace;
  return spriteTex;
}

export class Vfx {
  constructor(scene) {
    this.capacity = CAPACITY;
    this.positions = new Float32Array(CAPACITY * 3);
    this.colors = new Float32Array(CAPACITY * 3);
    this.velocities = new Float32Array(CAPACITY * 3);
    this.life = new Float32Array(CAPACITY); // remaining
    this.ttl = new Float32Array(CAPACITY); // total
    this.active = 0; // compact prefix [0, active)
    this.multiplier = 1;
    this.reducedMotion = false;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry = geo;
    this.material = new THREE.PointsMaterial({
      size: 0.2,
      map: softSprite(),
      alphaTest: 0.02,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
    this.points.renderOrder = 10;
    scene.add(this.points);
    this._deadPos = new THREE.Vector3(0, -9999, 0);
  }

  setQuality(multiplier) {
    this.multiplier = multiplier;
  }

  setReducedMotion(on) {
    this.reducedMotion = !!on;
  }

  _spawnOne(pos, color, speed, ttl) {
    if (this.active >= this.capacity) return;
    const i = this.active++;
    const i3 = i * 3;
    this.positions[i3] = pos.x;
    this.positions[i3 + 1] = pos.y;
    this.positions[i3 + 2] = pos.z;
    // random direction on sphere
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    this.velocities[i3] = r * Math.cos(th) * speed;
    this.velocities[i3 + 1] = u * speed + speed * 0.25;
    this.velocities[i3 + 2] = r * Math.sin(th) * speed;
    this.colors[i3] = color.r;
    this.colors[i3 + 1] = color.g;
    this.colors[i3 + 2] = color.b;
    this.life[i] = ttl;
    this.ttl[i] = ttl;
  }

  burst(pos, colorHex, { count = 24, speed = 3.2, ttl = 0.7 } = {}) {
    if (this.reducedMotion) return;
    const n = Math.round(count * this.multiplier);
    const color = new THREE.Color(colorHex);
    for (let i = 0; i < n; i++) this._spawnOne(pos, color, speed * (0.6 + Math.random() * 0.8), ttl * (0.7 + Math.random() * 0.6));
  }

  _kill(i) {
    const last = this.active - 1;
    if (i !== last) {
      const i3 = i * 3;
      const l3 = last * 3;
      for (let k = 0; k < 3; k++) {
        this.positions[i3 + k] = this.positions[l3 + k];
        this.velocities[i3 + k] = this.velocities[l3 + k];
        this.colors[i3 + k] = this.colors[l3 + k];
      }
      this.life[i] = this.life[last];
      this.ttl[i] = this.ttl[last];
    }
    this.active = last;
  }

  update(dt) {
    if (this.active === 0) return;
    for (let i = this.active - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this._kill(i);
        continue;
      }
      const i3 = i * 3;
      this.positions[i3] += this.velocities[i3] * dt;
      this.positions[i3 + 1] += this.velocities[i3 + 1] * dt;
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;
      this.velocities[i3 + 1] -= 2.2 * dt; // light gravity
      const fade = this.life[i] / this.ttl[i];
      this.colors[i3] *= 0.995;
      this.colors[i3 + 1] *= 0.995;
      this.colors[i3 + 2] *= 0.995;
      void fade;
    }
    // park unused slots far away so the draw range can stay at capacity
    for (let i = this.active; i < this.capacity; i++) {
      const i3 = i * 3;
      if (this.positions[i3 + 1] > -9000) {
        this.positions[i3] = this._deadPos.x;
        this.positions[i3 + 1] = this._deadPos.y;
        this.positions[i3 + 2] = this._deadPos.z;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  dispose(scene) {
    scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}

// Ambient light motes drifting slowly around the sculpture: purely decorative,
// never pickable, frozen under reduced motion or a static background.
const MOTE_MAX = 90;

export class Motes {
  constructor(scene) {
    this.positions = new Float32Array(MOTE_MAX * 3);
    this.seeds = new Float32Array(MOTE_MAX * 4);
    let s = 1337;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < MOTE_MAX; i++) {
      const r = 5.5 + rnd() * 8;
      const a = rnd() * Math.PI * 2;
      this.seeds[i * 4] = r;
      this.seeds[i * 4 + 1] = a;
      this.seeds[i * 4 + 2] = -3 + rnd() * 7; // base height
      this.seeds[i * 4 + 3] = 0.3 + rnd() * 0.7; // speed
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry = geo;
    this.material = new THREE.PointsMaterial({
      size: 0.09,
      map: softSprite(),
      color: 0xfff6e0,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.raycast = () => {};
    this.points.renderOrder = 9;
    scene.add(this.points);
    this.time = 0;
    this.moving = true;
    this.setCount(40);
    this._write();
  }

  setCount(n) {
    this.count = Math.max(0, Math.min(MOTE_MAX, n));
    this.geometry.setDrawRange(0, this.count);
    this.points.visible = this.count > 0;
  }

  setMoving(on) {
    this.moving = !!on;
  }

  setColor(hex) {
    this.material.color.set(hex);
  }

  _write() {
    const t = this.time;
    for (let i = 0; i < this.count; i++) {
      const r = this.seeds[i * 4];
      const a = this.seeds[i * 4 + 1] + t * 0.05 * this.seeds[i * 4 + 3];
      const y = this.seeds[i * 4 + 2] + Math.sin(t * 0.4 * this.seeds[i * 4 + 3] + i) * 0.5;
      this.positions[i * 3] = Math.cos(a) * r;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = Math.sin(a) * r;
    }
    this.geometry.attributes.position.needsUpdate = true;
  }

  update(dt) {
    if (!this.moving || !this.count) return;
    this.time += dt;
    this._write();
  }

  dispose(scene) {
    scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}
