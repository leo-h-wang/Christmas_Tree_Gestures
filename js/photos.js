import * as THREE from 'three';
import { treeRadiusAt, TREE_BASE_Y, TREE_HEIGHT } from './tree.js';

const CARD_W = 1.2;
const CARD_H = 1.45;
const TEX_W = 480;
const TEX_H = 580;
const PAD = 24;
const PHOTO = TEX_W - PAD * 2;
const PLACEHOLDER_COUNT = 8;
const PLACEHOLDER_LABELS = ['Merry Christmas', 'Joy', 'Love', 'Family', 'Cheers', 'Snow Day', 'Ho Ho Ho', 'Wish'];
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;
const GLOW_MARGIN = 0.45; // how far the halo feathers out beyond the card edge (world units)
const SELECTED_DISTANCE = 5;
const SELECTED_SCALE = 2;

async function loadManifest() {
  try {
    const res = await fetch('photos/manifest.json', { cache: 'no-store' });
    if (!res.ok) return [];
    const list = await res.json();
    return Array.isArray(list) ? list.filter((n) => typeof n === 'string' && IMAGE_EXT.test(n)) : [];
  } catch {
    return [];
  }
}

function drawCard(canvas, img, label) {
  const ctx = canvas.getContext('2d');

  const paper = ctx.createLinearGradient(0, 0, 0, TEX_H);
  paper.addColorStop(0, '#fbf9f4');
  paper.addColorStop(1, '#ece8de');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  if (img) {
    // Cover-crop to the square photo window.
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - s) / 2;
    const sy = (img.naturalHeight - s) / 2;
    ctx.drawImage(img, sx, sy, s, s, PAD, PAD, PHOTO, PHOTO);
  } else {
    const g = ctx.createLinearGradient(0, PAD, 0, PAD + PHOTO);
    g.addColorStop(0, '#dfe3ea');
    g.addColorStop(1, '#c3c9d3');
    ctx.fillStyle = g;
    ctx.fillRect(PAD, PAD, PHOTO, PHOTO);

    // Simple camera glyph.
    const cx = TEX_W / 2, cy = PAD + PHOTO / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.roundRect(cx - 62, cy - 40, 124, 86, 14);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + 3, 24, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(cx - 24, cy - 54, 48, 16, 5);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 2;
  ctx.strokeRect(PAD, PAD, PHOTO, PHOTO);

  ctx.fillStyle = '#4a4a4a';
  ctx.font = '52px Caveat, "Bradley Hand", cursive';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, TEX_W / 2, PAD + PHOTO + (TEX_H - PAD - PHOTO) / 2, TEX_W - PAD * 2);
}

/** Halo whose alpha falls off smoothly with distance from the card's edge. */
function makeGlowTexture() {
  const w = 256;
  const h = Math.round((w * (CARD_H + GLOW_MARGIN * 2)) / (CARD_W + GLOW_MARGIN * 2));
  const unitsPerPx = (CARD_W + GLOW_MARGIN * 2) / w;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = Math.max(Math.abs((x + 0.5 - w / 2) * unitsPerPx) - CARD_W / 2, 0);
      const dy = Math.max(Math.abs((y + 0.5 - h / 2) * unitsPerPx) - CARD_H / 2, 0);
      const t = Math.min(Math.hypot(dx, dy) / GLOW_MARGIN, 1);
      const a = Math.exp(-t * t * 5) * (1 - t); // gaussian-ish, forced to 0 at the plane edge
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

class Card {
  constructor(index, total, name, geometry, glowGeometry, glowTexture) {
    this.index = index;
    this.name = name;

    this.canvas = document.createElement('canvas');
    this.canvas.width = TEX_W;
    this.canvas.height = TEX_H;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;

    // Slightly below white so the paper stays under the bloom threshold.
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      color: new THREE.Color(0.85, 0.85, 0.85),
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.userData.card = this;

    // HDR-coloured halo behind the card; it blooms when hovered/selected.
    this.glowMaterial = new THREE.MeshBasicMaterial({
      map: glowTexture,
      color: new THREE.Color(1.3, 1.0, 0.45),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glow = new THREE.Mesh(glowGeometry, this.glowMaterial);
    this.glow.position.z = -0.02;
    this.mesh.add(this.glow);

    // Golden-angle spiral up the tree so any number of photos spreads evenly.
    const t = (index + 0.5) / total;
    this.baseY = TREE_BASE_Y + 0.6 + t * (TREE_HEIGHT - 2.2);
    this.baseAngle = index * 2.39996;
    this.radius = treeRadiusAt(this.baseY) + 2.0 + (index % 3) * 0.25;

    this.hover = 0;
    this.hoverTarget = 0;
    this.scale = 1;
    this.tilt = 0;
    this.opacity = 1;

    const label = name ? name.replace(/\.[^.]+$/, '') : PLACEHOLDER_LABELS[index % PLACEHOLDER_LABELS.length];
    drawCard(this.canvas, null, label);
    if (name) {
      const img = new Image();
      img.onload = () => {
        drawCard(this.canvas, img, label);
        this.texture.needsUpdate = true;
      };
      img.onerror = () => console.warn(`照片加载失败: ${name}`);
      img.src = 'photos/' + name.split('/').map(encodeURIComponent).join('/');
    }
  }
}

export class PhotoGallery {
  constructor(scene, camera) {
    this.camera = camera;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.cards = [];
    this.selected = null;
    this.usingPlaceholders = true;
    this.raycaster = new THREE.Raycaster();
    this._target = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
  }

  async load() {
    const names = await loadManifest();
    try { await document.fonts?.load('52px Caveat'); } catch { /* fall back to system font */ }

    this.usingPlaceholders = names.length === 0;
    const list = this.usingPlaceholders ? new Array(PLACEHOLDER_COUNT).fill(null) : names;
    const geometry = new THREE.PlaneGeometry(CARD_W, CARD_H);
    const glowGeometry = new THREE.PlaneGeometry(CARD_W + GLOW_MARGIN * 2, CARD_H + GLOW_MARGIN * 2);
    const glowTexture = makeGlowTexture();

    list.forEach((name, i) => {
      const card = new Card(i, list.length, name, geometry, glowGeometry, glowTexture);
      card.mesh.position.set(Math.cos(card.baseAngle) * card.radius, card.baseY, Math.sin(card.baseAngle) * card.radius);
      this.cards.push(card);
      this.group.add(card.mesh);
    });
  }

  /** Returns the card under the given NDC point, or null. */
  pick(ndc) {
    if (!this.cards.length) return null;
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.cards.map((c) => c.mesh), false);
    return hits[0]?.object.userData.card ?? null;
  }

  setHovered(card) {
    for (const c of this.cards) c.hoverTarget = c === card ? 1 : 0;
  }

  select(card) {
    if (this.selected === card) return;
    this.release();
    this.selected = card;
    card.material.depthTest = false;
    card.mesh.renderOrder = 10;
    card.glow.renderOrder = 9;
  }

  release() {
    const card = this.selected;
    if (!card) return;
    card.material.depthTest = true;
    card.mesh.renderOrder = 0;
    card.glow.renderOrder = 0;
    this.selected = null;
  }

  /**
   * @param rotation tree rotation (rad) so cards orbit together with the tree
   * @param spread   0..1 how scattered the particles are; cards drift outward with them
   */
  update(dt, time, rotation, spread) {
    const cam = this.camera;
    cam.getWorldDirection(this._camDir);

    for (const card of this.cards) {
      const isSelected = card === this.selected;
      let scale, tilt, k;

      if (isSelected) {
        this._target.copy(cam.position).addScaledVector(this._camDir, SELECTED_DISTANCE);
        scale = SELECTED_SCALE;
        tilt = 0;
        k = 1 - Math.exp(-dt * 7);
      } else {
        // Tree rotation by +θ maps polar angle a → a − θ, so subtract to stay attached.
        const a = card.baseAngle - rotation - time * 0.05;
        const r = card.radius + spread * 2.5;
        const y = card.baseY * (1 + spread * 0.4) + Math.sin(time * 0.7 + card.index * 1.3) * 0.18;
        this._target.set(Math.cos(a) * r, y, Math.sin(a) * r);
        scale = 1 + card.hover * 0.18;
        tilt = Math.sin(time * 0.6 + card.index) * 0.1;
        k = 1 - Math.exp(-dt * 3.5);
      }

      card.hover += (card.hoverTarget - card.hover) * (1 - Math.exp(-dt * 10));
      card.mesh.position.lerp(this._target, k);
      card.scale += (scale - card.scale) * k;
      card.tilt += (tilt - card.tilt) * k;
      card.mesh.scale.setScalar(card.scale);
      card.mesh.quaternion.copy(cam.quaternion);
      card.mesh.rotateZ(card.tilt);

      const targetOpacity = this.selected && !isSelected ? 0.25 : 1;
      card.opacity += (targetOpacity - card.opacity) * (1 - Math.exp(-dt * 6));
      card.material.opacity = card.opacity;
      card.glowMaterial.opacity = (isSelected ? 0.6 : card.hover * 0.85) * card.opacity;
    }
  }
}
