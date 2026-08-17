// Semantic views for gameplay cubes. Bodies/chevrons/lock-bands/path dots are
// instanced meshes (bounded draw calls); selection combines lift, an outline
// edge box, and a facing marker ring. All cosmetic animation settles into the
// exact deterministic end state (released cubes end removed, scale zero).

import * as THREE from 'three';
import { DIRS, rayCells } from '../rules/engine.js';

export const SPACING = 1.04;
const MAX_ARROWS = 168; // 150 live cubes max + in-flight flyout ghosts
const MAX_STONES = 60;
const MAX_PATH_DOTS = 16;

function roundedBoxGeometry(size = 0.92, radius = 0.14) {
  const s = size - radius * 2;
  const shape = new THREE.Shape();
  const h = s / 2;
  shape.moveTo(-h + radius, -h);
  shape.lineTo(h - radius, -h);
  shape.absarc(h - radius, -h + radius, radius, -Math.PI / 2, 0);
  shape.lineTo(h, h - radius);
  shape.absarc(h - radius, h - radius, radius, 0, Math.PI / 2);
  shape.lineTo(-h + radius, h);
  shape.absarc(-h + radius, h - radius, radius, Math.PI / 2, Math.PI);
  shape.lineTo(-h, -h + radius);
  shape.absarc(-h + radius, -h + radius, radius, Math.PI, Math.PI * 1.5);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: s,
    bevelEnabled: true,
    bevelThickness: radius,
    bevelSize: radius,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

function panelTexture({ base = '#f6f8fa', frame = 'rgba(30,45,70,0.35)', speckle = 0 }) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  const grad = g.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = frame;
  g.lineWidth = 6;
  g.strokeRect(8, 8, 112, 112);
  if (speckle > 0) {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i < speckle; i++) {
      g.fillRect(rnd() * 120 + 4, rnd() * 120 + 4, 3, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmpMat = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpColor = new THREE.Color();
const tmpDir = new THREE.Vector3();
const tmpOffset = new THREE.Vector3();

export class CubeViews {
  constructor(scene, theme) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'board';
    scene.add(this.group);
    this.theme = theme;
    this.records = new Map(); // cubeId -> record
    this.flyouts = [];
    this.flashes = new Map(); // cubeId -> {t, dur, color}
    this.shakes = new Map(); // cubeId -> {t}
    this.hoverId = null;
    this.selectedId = null;
    this.time = 0;
    this._buildMeshes();
  }

  _buildMeshes() {
    const t = this.theme.cube;
    this.arrowGeo = roundedBoxGeometry(0.92, 0.14);
    this.arrowMat = new THREE.MeshStandardMaterial({
      map: panelTexture({ base: '#f6f8fa' }),
      roughness: 0.55,
      metalness: 0.05,
    });
    this.arrowMesh = new THREE.InstancedMesh(this.arrowGeo, this.arrowMat, MAX_ARROWS);
    this.arrowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arrowMesh.castShadow = true;
    this.arrowMesh.receiveShadow = true;
    this.arrowMesh.userData.pickKind = 'arrow';
    this.arrowMesh.count = 0;
    this.arrowSlots = [];

    this.stoneMat = new THREE.MeshStandardMaterial({
      map: panelTexture({ base: '#9aa0a8', frame: 'rgba(0,0,0,0.4)', speckle: 60 }),
      roughness: 0.9,
      metalness: 0.0,
    });
    this.stoneMesh = new THREE.InstancedMesh(this.arrowGeo, this.stoneMat, MAX_STONES);
    this.stoneMesh.castShadow = true;
    this.stoneMesh.receiveShadow = true;
    this.stoneMesh.userData.pickKind = 'stone';
    this.stoneMesh.count = 0;
    this.stoneSlots = [];

    this.coreMat = new THREE.MeshStandardMaterial({
      color: t.core,
      emissive: t.core,
      emissiveIntensity: 0.55,
      roughness: 0.3,
      metalness: 0.2,
    });
    this.coreMesh = new THREE.InstancedMesh(this.arrowGeo, this.coreMat, 8);
    this.coreMesh.castShadow = true;
    this.coreMesh.userData.pickKind = 'core';
    this.coreMesh.count = 0;
    this.coreSlots = [];

    // Direction chevrons: one instanced pyramid per arrow cube, mounted on
    // the face the cube exits through — direction is shape, not color.
    const chevGeo = new THREE.ConeGeometry(0.2, 0.3, 4);
    chevGeo.rotateY(Math.PI / 4);
    this.chevMat = new THREE.MeshStandardMaterial({ color: t.chevron, roughness: 0.5 });
    this.chevMesh = new THREE.InstancedMesh(chevGeo, this.chevMat, MAX_ARROWS);
    this.chevMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.chevMesh.count = 0;
    this.chevMesh.raycast = () => {}; // cosmetic: never intercepts picking

    // Lock bands: thin slabs wrapping locked cubes, perpendicular to travel.
    const bandGeo = new THREE.BoxGeometry(1.1, 0.16, 1.1);
    this.bandMat = new THREE.MeshStandardMaterial({
      color: 0x3a3f47,
      roughness: 0.4,
      metalness: 0.6,
    });
    this.bandMesh = new THREE.InstancedMesh(bandGeo, this.bandMat, 40);
    this.bandMesh.count = 0;
    this.bandMesh.raycast = () => {};

    // Path preview dots.
    const dotGeo = new THREE.OctahedronGeometry(0.12);
    this.dotMat = new THREE.MeshBasicMaterial({
      color: t.path,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    });
    this.dotMesh = new THREE.InstancedMesh(dotGeo, this.dotMat, MAX_PATH_DOTS);
    this.dotMesh.count = 0;
    this.dotMesh.raycast = () => {};

    // Selection: outline edge box + marker ring.
    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06, 1.06, 1.06));
    this.outline = new THREE.LineSegments(
      edgeGeo,
      new THREE.LineBasicMaterial({ color: t.path }),
    );
    this.outline.visible = false;
    this.outline.raycast = () => {};
    const ringGeo = new THREE.RingGeometry(0.42, 0.52, 32);
    this.ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: t.path, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    this.ring.visible = false;
    this.ring.raycast = () => {};

    this.group.add(
      this.arrowMesh, this.stoneMesh, this.coreMesh,
      this.chevMesh, this.bandMesh, this.dotMesh, this.outline, this.ring,
    );
  }

  applyTheme(theme) {
    this.theme = theme;
    const t = theme.cube;
    this.chevMat.color.set(t.chevron);
    this.coreMat.color.set(t.core);
    this.coreMat.emissive.set(t.core);
    this.dotMat.color.set(t.path);
    this.outline.material.color.set(t.path);
    this.ring.material.color.set(t.path);
    this._refreshColors();
  }

  build(state) {
    this.flyouts.length = 0;
    this.flashes.clear();
    this.shakes.clear();
    this.hoverId = null;
    this.selectedId = null;
    this.syncState(state, []);
  }

  // Reassign instance slots from the (immutable) state and process events.
  syncState(state, events) {
    const arrows = [];
    const stones = [];
    const cores = [];
    for (const c of state.cubes) {
      if (c.kind === 'arrow') arrows.push(c);
      else if (c.kind === 'stone') stones.push(c);
      else cores.push(c);
    }
    this.records.clear();
    this.arrowSlots = arrows.map((c) => c.id);
    this.stoneSlots = stones.map((c) => c.id);
    this.coreSlots = cores.map((c) => c.id);

    const keyIds = new Set();
    const lockedIds = new Set();
    for (const c of state.cubes) {
      if (c.lock) {
        if (!c.lock.open) {
          lockedIds.add(c.id);
          keyIds.add(c.lock.keyId);
        }
      }
    }

    arrows.forEach((c, i) => {
      this.records.set(c.id, {
        id: c.id, kind: 'arrow', slot: i, pos: c.pos, dir: c.dir,
        locked: lockedIds.has(c.id), isKey: keyIds.has(c.id),
      });
      this._writeCubeMatrix(this.arrowMesh, i, c.pos, c.dir, 0);
      this._writeChevron(i, c.pos, c.dir);
    });
    stones.forEach((c, i) => {
      this.records.set(c.id, { id: c.id, kind: 'stone', slot: i, pos: c.pos, dir: c.dir });
      this._writeCubeMatrix(this.stoneMesh, i, c.pos, c.dir, 0);
    });
    cores.forEach((c, i) => {
      this.records.set(c.id, { id: c.id, kind: 'core', slot: i, pos: c.pos, dir: c.dir });
      this._writeCubeMatrix(this.coreMesh, i, c.pos, c.dir, 0);
    });

    // Flyout ghosts keep living in arrow slots above the live range. Drop the
    // oldest if a release burst would overflow the instancing capacity.
    const maxGhosts = Math.max(0, MAX_ARROWS - arrows.length);
    if (this.flyouts.length > maxGhosts) {
      this.flyouts.splice(0, this.flyouts.length - maxGhosts);
    }
    let ghostSlot = arrows.length;
    for (const f of this.flyouts) {
      f.slot = ghostSlot++;
      this.records.set(f.id, { id: f.id, kind: 'ghost', slot: f.slot, pos: f.pos, dir: f.dir });
    }
    this.arrowMesh.count = ghostSlot;
    this.stoneMesh.count = stones.length;
    this.coreMesh.count = cores.length;
    this.chevMesh.count = arrows.length;

    // Lock bands.
    let bandCount = 0;
    for (const id of lockedIds) {
      const rec = this.records.get(id);
      if (!rec) continue;
      this._writeBand(bandCount++, rec.pos, rec.dir);
    }
    this.bandMesh.count = bandCount;

    for (const ev of events) {
      if (ev.type === 'release') {
        this.flyouts.push({ id: ev.cubeId, pos: ev.pos, dir: ev.dir, t: 0, dur: 0.5, slot: -1 });
      } else if (ev.type === 'unlock') {
        this.flashes.set(ev.cubeId, { t: 0, dur: 0.6 });
      } else if (ev.type === 'invalid' && ev.cubeId) {
        this.shakes.set(ev.cubeId, { t: 0, dur: 0.3 });
      }
    }
    this.arrowMesh.instanceMatrix.needsUpdate = true;
    this.stoneMesh.instanceMatrix.needsUpdate = true;
    this.coreMesh.instanceMatrix.needsUpdate = true;
    this.chevMesh.instanceMatrix.needsUpdate = true;
    this.bandMesh.instanceMatrix.needsUpdate = true;
    this._refreshColors();
    this._refreshSelection();
  }

  _writeCubeMatrix(mesh, slot, pos, dir, lift, extra = null) {
    tmpPos.set(pos[0] * SPACING, pos[1] * SPACING, pos[2] * SPACING);
    if (lift) {
      const d = DIRS[dir];
      tmpPos.x += d[0] * lift;
      tmpPos.y += d[1] * lift;
      tmpPos.z += d[2] * lift;
    }
    if (extra && extra.offset) tmpPos.add(extra.offset);
    tmpQuat.identity();
    if (extra && extra.spin) {
      const d = DIRS[dir];
      tmpQuat.setFromAxisAngle(tmpDir.set(d[0], d[1], d[2]), extra.spin);
    }
    tmpScale.setScalar(extra && extra.scale != null ? extra.scale : 1);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    mesh.setMatrixAt(slot, tmpMat);
  }

  _writeChevron(slot, pos, dir) {
    const d = DIRS[dir];
    tmpPos.set(
      (pos[0] + d[0] * 0.56) * SPACING,
      (pos[1] + d[1] * 0.56) * SPACING,
      (pos[2] + d[2] * 0.56) * SPACING,
    );
    tmpQuat.setFromUnitVectors(Y_AXIS, tmpDir.set(d[0], d[1], d[2]));
    tmpScale.setScalar(1);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    this.chevMesh.setMatrixAt(slot, tmpMat);
  }

  _writeBand(slot, pos, dir) {
    const d = DIRS[dir];
    tmpPos.set(pos[0] * SPACING, pos[1] * SPACING, pos[2] * SPACING);
    tmpQuat.setFromUnitVectors(Y_AXIS, tmpDir.set(d[0], d[1], d[2]));
    tmpScale.setScalar(1);
    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    this.bandMesh.setMatrixAt(slot, tmpMat);
  }

  _colorFor(rec) {
    const t = this.theme.cube;
    if (rec.kind === 'ghost') return tmpColor.set(t.arrow).multiplyScalar(0.6);
    if (rec.id === this.selectedId) return tmpColor.set(t.select);
    if (rec.id === this.hoverId) return tmpColor.set(t.hover);
    if (rec.locked) return tmpColor.set(t.locked);
    if (rec.isKey) {
      const pulse = 0.75 + 0.25 * Math.sin(this.time * 4);
      return tmpColor.set(0xffd27a).multiplyScalar(pulse);
    }
    return tmpColor.set(t.arrow);
  }

  _refreshColors() {
    for (const [id, rec] of this.records) {
      if (rec.kind === 'stone' || rec.kind === 'core') continue;
      const flash = this.flashes.get(id);
      let color = this._colorFor(rec);
      if (flash) {
        const k = 1 - flash.t / flash.dur;
        color = tmpColor.set(0x7dffb0).lerp(this._colorFor(rec), 1 - k);
      }
      this.arrowMesh.setColorAt(rec.slot, color);
    }
    if (this.arrowMesh.instanceColor) this.arrowMesh.instanceColor.needsUpdate = true;
  }

  setHover(cubeId) {
    if (this.hoverId === cubeId) return;
    this.hoverId = cubeId;
    this._refreshColors();
  }

  setSelected(cubeId) {
    this.selectedId = cubeId;
    this._refreshColors();
    this._refreshSelection();
  }

  _refreshSelection() {
    const rec = this.selectedId ? this.records.get(this.selectedId) : null;
    if (!rec || rec.kind !== 'arrow') {
      this.outline.visible = false;
      this.ring.visible = false;
      this.dotMesh.count = 0;
      return;
    }
    const p = rec.pos;
    this.outline.position.set(p[0] * SPACING, p[1] * SPACING, p[2] * SPACING);
    this.outline.visible = true;
    this.ring.position.copy(this.outline.position);
    this.ring.visible = true;
  }

  // Transparent path preview for the selected cube.
  showPathFor(state, cubeId) {
    const rec = cubeId ? this.records.get(cubeId) : null;
    if (!rec || rec.kind !== 'arrow') {
      this.dotMesh.count = 0;
      return { cells: [], blockedBy: null };
    }
    const cube = state.cubes.find((c) => c.id === cubeId);
    if (!cube) {
      this.dotMesh.count = 0;
      return { cells: [], blockedBy: null };
    }
    const { cells, blockedBy } = rayCells(state, cube, MAX_PATH_DOTS);
    cells.forEach((cell, i) => {
      tmpPos.set(cell[0] * SPACING, cell[1] * SPACING, cell[2] * SPACING);
      tmpQuat.identity();
      tmpScale.setScalar(1 - (i / MAX_PATH_DOTS) * 0.5);
      tmpMat.compose(tmpPos, tmpQuat, tmpScale);
      this.dotMesh.setMatrixAt(i, tmpMat);
    });
    this.dotMesh.count = cells.length;
    this.dotMesh.instanceMatrix.needsUpdate = true;
    return { cells, blockedBy };
  }

  update(dt, camera) {
    this.time += dt;
    let dirty = false;

    // Flyouts: deterministic duration, exact end state (scale 0, dropped).
    for (let i = this.flyouts.length - 1; i >= 0; i--) {
      const f = this.flyouts[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const ease = k * k * (3 - 2 * k);
      if (k >= 1) {
        this._writeCubeMatrix(this.arrowMesh, f.slot, f.pos, f.dir, 0, { scale: 0 });
        this.flyouts.splice(i, 1);
        this.records.delete(f.id);
      } else {
        const d = DIRS[f.dir];
        tmpOffset.set(d[0], d[1], d[2]).multiplyScalar(ease * 5.5);
        this._writeCubeMatrix(this.arrowMesh, f.slot, f.pos, f.dir, 0, {
          offset: tmpOffset,
          spin: ease * 2.2,
          scale: 1 - ease * 0.35,
        });
      }
      dirty = true;
    }

    // Invalid shakes.
    for (const [id, s] of this.shakes) {
      s.t += dt;
      const rec = this.records.get(id);
      if (!rec || s.t >= s.dur) {
        if (rec) this._writeCubeMatrix(this.arrowMesh, rec.slot, rec.pos, rec.dir, 0);
        this.shakes.delete(id);
      } else {
        const amp = 0.06 * (1 - s.t / s.dur);
        tmpOffset.set(Math.sin(s.t * 55) * amp, Math.cos(s.t * 47) * amp, 0);
        this._writeCubeMatrix(this.arrowMesh, rec.slot, rec.pos, rec.dir, 0, { offset: tmpOffset });
      }
      dirty = true;
    }

    // Unlock flashes and key pulse need color updates.
    let colorDirty = false;
    for (const [id, f] of this.flashes) {
      f.t += dt;
      if (f.t >= f.dur) this.flashes.delete(id);
      colorDirty = true;
    }
    for (const rec of this.records.values()) {
      if (rec.isKey) {
        colorDirty = true;
        break;
      }
    }
    if (colorDirty) this._refreshColors();

    // Selected cube lift.
    const rec = this.selectedId ? this.records.get(this.selectedId) : null;
    if (rec && rec.kind === 'arrow') {
      const lift = 0.08 + 0.03 * Math.sin(this.time * 3);
      this._writeCubeMatrix(this.arrowMesh, rec.slot, rec.pos, rec.dir, lift);
      dirty = true;
      const p = rec.pos;
      this.ring.position.set(p[0] * SPACING, p[1] * SPACING, p[2] * SPACING);
      if (camera) this.ring.quaternion.copy(camera.quaternion);
      const s = 1 + 0.06 * Math.sin(this.time * 3);
      this.ring.scale.setScalar(s);
    }

    if (dirty) this.arrowMesh.instanceMatrix.needsUpdate = true;
  }

  pickables() {
    return [this.arrowMesh, this.stoneMesh, this.coreMesh];
  }

  cubeIdFor(mesh, instanceId) {
    // Flyout ghosts (slots past the live range) are cosmetic: not pickable.
    if (mesh === this.arrowMesh) return this.arrowSlots[instanceId] ?? null;
    if (mesh === this.stoneMesh) return this.stoneSlots[instanceId] ?? null;
    if (mesh === this.coreMesh) return this.coreSlots[instanceId] ?? null;
    return null;
  }

  worldPosOf(cubeId) {
    const rec = this.records.get(cubeId);
    if (!rec) return null;
    return new THREE.Vector3(rec.pos[0] * SPACING, rec.pos[1] * SPACING, rec.pos[2] * SPACING);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const m of [this.arrowMesh, this.stoneMesh, this.coreMesh, this.chevMesh, this.bandMesh, this.dotMesh]) {
      m.dispose();
    }
    this.arrowGeo.dispose();
    this.arrowMat.map.dispose();
    this.arrowMat.dispose();
    this.stoneMat.map.dispose();
    this.stoneMat.dispose();
    this.coreMat.dispose();
    this.chevMat.dispose();
    this.bandMat.dispose();
    this.dotMat.dispose();
    this.outline.geometry.dispose();
    this.outline.material.dispose();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
  }
}
