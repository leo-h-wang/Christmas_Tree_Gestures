const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

export class HandTracker {
  constructor(video, overlay) {
    this.video = video;
    this.overlay = overlay;
    this.ctx = overlay.getContext('2d');
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.hands = [];
  }

  async init(onStatus) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('浏览器不支持摄像头访问（请通过 http://localhost 打开页面）');
    }
    onStatus('正在加载手势模型，并请求摄像头权限…');
    // Load the model and open the camera in parallel.
    const [landmarker, stream] = await Promise.all([this._createLandmarker(), this._openCamera()]);
    this.landmarker = landmarker;
    this.video.srcObject = stream;
    await this.video.play();
    this.overlay.width = this.video.videoWidth;
    this.overlay.height = this.video.videoHeight;
  }

  async _createLandmarker() {
    const { FilesetResolver, HandLandmarker } = await import(`${VISION_URL}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${VISION_URL}/wasm`);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });
    try {
      return await HandLandmarker.createFromOptions(fileset, options('GPU'));
    } catch (err) {
      console.warn('GPU delegate unavailable, falling back to CPU', err);
      return HandLandmarker.createFromOptions(fileset, options('CPU'));
    }
  }

  async _openCamera() {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
    } catch (err) {
      if (err.name === 'NotAllowedError') throw new Error('摄像头权限被拒绝');
      if (err.name === 'NotFoundError') throw new Error('没有找到摄像头');
      throw err;
    }
  }

  /** Returns landmarks when a new video frame was processed, otherwise null. */
  detect() {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2 || v.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = v.currentTime;
    const result = this.landmarker.detectForVideo(v, performance.now());
    this.hands = result.landmarks ?? [];
    this._draw();
    return this.hands;
  }

  _draw() {
    const { ctx, overlay } = this;
    const w = overlay.width, h = overlay.height;
    ctx.clearRect(0, 0, w, h);
    for (const lm of this.hands) {
      ctx.strokeStyle = 'rgba(255, 224, 138, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        ctx.moveTo(lm[a].x * w, lm[a].y * h);
        ctx.lineTo(lm[b].x * w, lm[b].y * h);
      }
      ctx.stroke();
      ctx.fillStyle = '#ff4d6d';
      for (const p of lm) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
