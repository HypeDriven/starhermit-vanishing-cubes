// Bounded pooled particle system. Particles never intercept raycasts and are
// event-tiered: small bursts for legal moves, denser accents for goals and
// round completion. Reduced-motion mode suppresses bursts while preserving
// event timing (logical events are unaffected).

import * as THREE from 'three';

const CAPACITY = 2048;

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
      size: 0.14,
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
