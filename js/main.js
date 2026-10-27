import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ParticleTree } from './tree.js';
import { PhotoGallery } from './photos.js';
import { HandTracker } from './hands.js';
import { GestureRecognizer, GESTURE_LABELS } from './gestures.js';

const $ = (id) => document.getElementById(id);
const AUTO_SPIN = 0.15;        // rad/s idle rotation
const MAX_SPIN = 4;
const HOVER_GRACE_MS = 400;    // pinch can still grab a card hovered this recently

// ---------- scene ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color('#03050c');
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.5, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const tree = new ParticleTree();
tree.addTo(scene);

const gallery = new PhotoGallery(scene, camera);
gallery.load().then(() => {
  $('photo-count').textContent = gallery.usingPlaceholders
    ? `占位 ×${gallery.cards.length}`
    : `${gallery.cards.length} 张`;
});

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const aspect = w / h;
  camera.aspect = aspect;
  // Back the camera off on portrait screens so the tree still fits.
  camera.position.set(0, 0.6, 14 * Math.max(1, 1.1 / aspect));
  camera.lookAt(0, 0.2, 0);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  tree.setViewport(h * renderer.getPixelRatio(), camera.fov);
}
window.addEventListener('resize', resize);
resize();

// ---------- interaction state ----------
const state = {
  rotation: 0,
  spin: 0,
  hovered: null,
  lastHovered: null,
  lastHoverAt: 0,
  mouse: null,
  mouseActiveAt: -Infinity,
  dragging: null,
};

function setStatus(html, isError = false) {
  const el = $('status');
  el.innerHTML = html;
  el.classList.toggle('visible', Boolean(html));
  el.classList.toggle('error', isError);
}

function trySelect() {
  const recent = performance.now() - state.lastHoverAt < HOVER_GRACE_MS ? state.lastHovered : null;
  const card = state.hovered ?? recent;
  if (card) gallery.select(card);
}

// ---------- hands ----------
const tracker = new HandTracker($('video'), $('overlay'));
const gestures = new GestureRecognizer();
let handsEnabled = false;

gestures.onChange = (g) => {
  $('gesture').textContent = GESTURE_LABELS[g];
  if (g === 'pinch') {
    // Pinch toggles: enter the hovered photo, or leave the one being viewed.
    if (gallery.selected) gallery.release();
    else trySelect();
  } else if (gallery.selected) {
    // While viewing a photo, other gestures are ignored to avoid accidental exits.
  } else if (g === 'open') {
    tree.targetMix = 1;
  } else if (g === 'fist') {
    tree.targetMix = 0;
  }
};

tracker.init(setStatus)
  .then(() => {
    handsEnabled = true;
    $('cam').classList.add('on');
    setStatus('✋ 把手放到摄像头前试试吧');
    setTimeout(() => setStatus(''), 4000);
  })
  .catch((err) => {
    console.warn(err);
    $('gesture').textContent = '不可用';
    setStatus(`手势识别不可用：${err.message || err}<br>已切换为鼠标模式`, true);
  });

function processHands() {
  if (!handsEnabled) return;
  const hands = tracker.detect();
  if (!hands) return; // no new camera frame yet
  gestures.update(hands);
  const g = gestures.gesture;
  if (!gallery.selected && (g === 'open' || g === 'fist')) {
    state.spin += gestures.wristDX * 20;
  }
}

// ---------- mouse / keyboard fallback ----------
canvas.addEventListener('pointermove', (e) => {
  state.mouse = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
  state.mouseActiveAt = performance.now();
  if (state.dragging) {
    const dx = e.clientX - state.dragging.x;
    state.rotation += dx * 0.006;
    state.dragging.moved += Math.abs(dx);
    state.dragging.x = e.clientX;
  }
});
canvas.addEventListener('pointerdown', (e) => {
  state.dragging = { x: e.clientX, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => {
  if (state.dragging && state.dragging.moved < 6) {
    if (gallery.selected) gallery.release();
    else if (state.hovered) gallery.select(state.hovered);
  }
  state.dragging = null;
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    tree.targetMix = tree.targetMix > 0.5 ? 0 : 1;
  } else if (e.code === 'Escape') {
    gallery.release();
  } else if (e.code === 'KeyH') {
    $('hud').classList.toggle('hidden');
  }
});

// ---------- pointer / hover ----------
const ndc = new THREE.Vector2();
const cursorEl = $('cursor');

function currentPointer() {
  const handActive = handsEnabled && gestures.cursor && ['point', 'pinch', 'other'].includes(gestures.gesture);
  if (handActive) return { ...gestures.cursor, source: 'hand' };
  if (state.mouse && performance.now() - state.mouseActiveAt < 4000) return { ...state.mouse, source: 'mouse' };
  return null;
}

function updatePointer(now) {
  const pointer = currentPointer();
  let hovered = null;
  if (pointer && !gallery.selected) {
    ndc.set(pointer.x * 2 - 1, -(pointer.y * 2 - 1));
    hovered = gallery.pick(ndc);
  }
  if (hovered) {
    state.lastHovered = hovered;
    state.lastHoverAt = now;
  }
  state.hovered = hovered;
  gallery.setHovered(hovered);
  document.body.classList.toggle('hovering', Boolean(hovered) && pointer?.source === 'mouse');

  const showHandCursor = pointer?.source === 'hand';
  cursorEl.classList.toggle('visible', showHandCursor);
  if (showHandCursor) {
    cursorEl.style.transform = `translate(${pointer.x * window.innerWidth}px, ${pointer.y * window.innerHeight}px)`;
    cursorEl.classList.toggle('pinch', gestures.gesture === 'pinch');
    cursorEl.classList.toggle('hover', Boolean(hovered));
  }
}

// ---------- loop ----------
const clock = new THREE.Clock();
let fpsFrames = 0, fpsTime = 0;

function updateHud(fps) {
  $('fps').textContent = fps.toFixed(0);
  $('mode').textContent = gallery.selected
    ? '查看照片'
    : tree.targetMix > 0.5 ? '粒子散开' : '圣诞树';
}

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const now = performance.now();

  processHands();

  state.spin = THREE.MathUtils.clamp(state.spin * Math.exp(-dt * 1.5), -MAX_SPIN, MAX_SPIN);
  state.rotation += (AUTO_SPIN * (gallery.selected ? 0.3 : 1) + state.spin) * dt;
  tree.object.rotation.y = state.rotation;
  tree.targetDim = gallery.selected ? 0.35 : 1;
  tree.update(dt, t);

  updatePointer(now);
  gallery.update(dt, t, state.rotation, tree.mix);

  composer.render();

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime > 0.25) {
    updateHud(fpsFrames / fpsTime);
    fpsFrames = 0;
    fpsTime = 0;
  }
});
