// Classifies MediaPipe hand landmarks into a small set of gestures, with
// frame-count debouncing so the stable gesture doesn't flicker.

const STABLE_FRAMES = 4;
const LOST_FRAMES = 8;
const FINGER_TIPS = [8, 12, 16, 20]; // index, middle, ring, pinky (PIP joint = tip - 2)

export const GESTURE_LABELS = {
  none: '未检测到手',
  open: '✋ 张开手掌',
  fist: '✊ 握拳',
  point: '☝️ 食指指向',
  pinch: '🤏 捏合',
  other: '🖐 其他',
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const remap = (v, lo, hi) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));

export class GestureRecognizer {
  constructor() {
    this.gesture = 'none';      // debounced gesture
    this.cursor = null;         // {x, y} in 0..1 screen space (mirrored), smoothed
    this.pinchDistance = 0;     // thumb–index tip distance / palm size
    this.wristDX = 0;           // horizontal wrist movement since last frame (screen units)
    this.handCount = 0;
    this.onChange = null;       // (next, prev) => void
    this._candidate = 'none';
    this._count = 0;
    this._prevWristX = null;
  }

  _classify(lm) {
    const palm = dist(lm[0], lm[9]) || 1e-6;
    const ratios = FINGER_TIPS.map((t) => dist(lm[t], lm[0]) / (dist(lm[t - 2], lm[0]) || 1e-6));
    const extended = ratios.map((r) => r > 1.12);
    const pinch = dist(lm[4], lm[8]) / palm;
    const indexReach = dist(lm[8], lm[0]) / palm;
    this.pinchDistance = pinch;

    // Hysteresis: once pinching, allow a wider gap before letting go.
    const pinchThreshold = this.gesture === 'pinch' ? 0.42 : 0.3;
    if (pinch < pinchThreshold && indexReach > 1.05) return 'pinch';
    if (ratios.every((r) => r < 1.0)) return 'fist';
    if (extended.every(Boolean) && pinch > 0.5) return 'open';
    if (extended[0] && !extended[1] && !extended[2] && !extended[3]) return 'point';
    return 'other';
  }

  update(hands) {
    this.handCount = hands.length;
    let raw = 'none';

    if (hands.length) {
      const lm = hands[0];
      raw = this._classify(lm);

      // Cursor sits between index tip and thumb tip so it barely jumps when pinching.
      const px = lm[8].x * 0.75 + lm[4].x * 0.25;
      const py = lm[8].y * 0.75 + lm[4].y * 0.25;
      // Mirror x, and stretch the comfortable middle of the camera view to the full screen.
      const target = { x: remap(1 - px, 0.12, 0.88), y: remap(py, 0.1, 0.8) };
      this.cursor = this.cursor
        ? { x: this.cursor.x + (target.x - this.cursor.x) * 0.45, y: this.cursor.y + (target.y - this.cursor.y) * 0.45 }
        : target;

      const wx = 1 - lm[0].x;
      const dx = this._prevWristX === null ? 0 : wx - this._prevWristX;
      this.wristDX = Math.abs(dx) < 0.1 ? dx : 0; // ignore jumps when hand identity swaps
      this._prevWristX = wx;
    } else {
      this.cursor = null;
      this.wristDX = 0;
      this._prevWristX = null;
    }

    if (raw === this._candidate) this._count++;
    else { this._candidate = raw; this._count = 1; }

    const needed = raw === 'none' ? LOST_FRAMES : STABLE_FRAMES;
    if (this._count >= needed && raw !== this.gesture) {
      const prev = this.gesture;
      this.gesture = raw;
      this.onChange?.(raw, prev);
    }
  }
}
