// Authored camera rig. Framing constants are exposed (no magic offsets);
// transitions use a critically damped spring and remain interruptible;
// reduced-motion mode snaps instead of swooping. The camera never affects
// raycast truth — picking always uses the live camera.

import * as THREE from 'three';

export const FRAME = Object.freeze({
  fov: 35,
  theta0: Math.PI * 0.25, // azimuth
  phi0: 1.02, // polar angle from +Y
  fitPadding: 1.12, // breathing room around the framed board
  minRadius: 4.5,
  maxRadius: 60,
  minPhi: 0.3,
  maxPhi: 1.5,
  omega: 6.5, // spring stiffness
  dragSpeed: 0.0062, // radians per pixel
});

function springStep(v, omega, dt) {
  // v: {x, v, goal} — critically damped, frame-rate independent.
  const x0 = v.x - v.goal;
  const expTerm = Math.exp(-omega * dt);
  const temp = (v.v + omega * x0) * dt;
  const nx = v.goal + (x0 + temp) * expTerm;
  const nv = (v.v - omega * temp) * expTerm;
  v.x = nx;
  v.v = nv;
}

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3(0, 0, 0);
    this.theta = { x: FRAME.theta0, v: 0, goal: FRAME.theta0 };
    this.phi = { x: FRAME.phi0, v: 0, goal: FRAME.phi0 };
    this.radius = { x: 12, v: 0, goal: 12 };
    this.reducedMotion = false;
    this._dragAccum = 0;
    this.apply();
  }

  setReducedMotion(on) {
    this.reducedMotion = !!on;
  }

  // Frame a board of `extent` (world half-extent of the assembly). The fit is
  // aspect-aware: narrow (portrait) viewports need more distance for the same
  // horizontal span, so the board is never cropped by the screen edges.
  frameExtent(extent) {
    const vHalf = (FRAME.fov * Math.PI) / 180 / 2;
    const aspect = this.camera.aspect || 1;
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const fitHalf = Math.max(0.1, Math.min(vHalf, hHalf));
    const span = extent + 0.7; // cube faces reach past the lattice point
    const radius = (span / Math.tan(fitHalf)) * FRAME.fitPadding;
    this.radius.goal = Math.max(FRAME.minRadius, Math.min(FRAME.maxRadius, radius));
    if (this.reducedMotion) this.snap();
  }

  rotate(dTheta, dPhi) {
    this.theta.goal += dTheta;
    this.phi.goal = Math.max(FRAME.minPhi, Math.min(FRAME.maxPhi, this.phi.goal + dPhi));
    this._dragAccum += Math.abs(dTheta) + Math.abs(dPhi);
  }

  // Returns true when accumulated drag rotation crosses one discrete
  // "camera rotation" for scoring purposes (about 60 degrees).
  consumeRotationCredit() {
    if (this._dragAccum >= 1.05) {
      this._dragAccum = 0;
      return true;
    }
    return false;
  }

  quarter(dirSign) {
    this.theta.goal += (Math.PI / 2) * dirSign;
  }

  reset() {
    this.theta.goal = FRAME.theta0;
    this.phi.goal = FRAME.phi0;
  }

  snap() {
    for (const s of [this.theta, this.phi, this.radius]) {
      s.x = s.goal;
      s.v = 0;
    }
  }

  update(dt) {
    if (this.reducedMotion) {
      this.snap();
    } else {
      springStep(this.theta, FRAME.omega, dt);
      springStep(this.phi, FRAME.omega, dt);
      springStep(this.radius, FRAME.omega, dt);
    }
    this.apply();
  }

  apply() {
    const { theta, phi, radius } = this;
    const sinPhi = Math.sin(phi.x);
    this.camera.position.set(
      this.target.x + radius.x * sinPhi * Math.sin(theta.x),
      this.target.y + radius.x * Math.cos(phi.x),
      this.target.z + radius.x * sinPhi * Math.cos(theta.x),
    );
    this.camera.lookAt(this.target);
  }

  worldToScreen(v3, width, height) {
    const p = v3.clone().project(this.camera);
    return {
      x: ((p.x + 1) / 2) * width,
      y: ((1 - p.y) / 2) * height,
      visible: p.z < 1,
    };
  }
}
