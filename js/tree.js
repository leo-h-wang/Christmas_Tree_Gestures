import * as THREE from 'three';

export const TREE_HEIGHT = 9;
export const TREE_BASE_Y = -4.6;
export const TREE_BASE_R = 3.6;

/** Outer radius of the tree cone at world height y. */
export function treeRadiusAt(y) {
  const h = (y - TREE_BASE_Y) / TREE_HEIGHT;
  return TREE_BASE_R * THREE.MathUtils.clamp(1 - h, 0, 1);
}

const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const treeVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uMix;
  uniform float uDim;
  uniform float uScale;
  attribute vec3 aScatter;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aPhase;
  attribute float aTwinkle;
  varying vec3 vColor;

  void main() {
    // Each particle starts moving at a slightly different moment so the
    // tree dissolves / rebuilds in a wave rather than all at once.
    float delay = aPhase * 0.35;
    float m = clamp((uMix - delay) / 0.65, 0.0, 1.0);
    m = m * m * (3.0 - 2.0 * m);

    vec3 p = mix(position, aScatter, m);
    p += m * vec3(
      sin(uTime * 0.5 + aPhase * 20.0),
      cos(uTime * 0.4 + aPhase * 15.0),
      sin(uTime * 0.3 + aPhase * 10.0)
    ) * 0.4;
    p.y += sin(uTime * 1.5 + aPhase * 40.0) * 0.015;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float tw = 1.0 + aTwinkle * (0.6 * sin(uTime * 3.0 + aPhase * 60.0) + 0.3 * sin(uTime * 7.3 + aPhase * 20.0));
    vColor = aColor * max(tw, 0.15) * uDim;
    gl_PointSize = aSize * 0.07 * uScale / -mv.z;
  }
`;

const snowVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uDim;
  uniform float uScale;
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  varying vec3 vColor;

  void main() {
    float y = mod(position.y - uTime * aSpeed + 7.0, 16.0) - 7.0;
    vec3 p = vec3(
      position.x + sin(uTime * 0.6 + aPhase * 30.0) * 0.4,
      y,
      position.z + cos(uTime * 0.5 + aPhase * 20.0) * 0.3
    );
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vColor = vec3(0.55, 0.6, 0.72) * 0.6 * uDim;
    gl_PointSize = aSize * 0.07 * uScale / -mv.z;
  }
`;

const glowFragmentShader = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = pow(1.0 - d * 2.0, 1.6);
    gl_FragColor = vec4(vColor, a);
  }
`;

export class ParticleTree {
  constructor() {
    this.mix = 0;        // 0 = tree, 1 = scattered
    this.targetMix = 0;
    this.dim = 1;
    this.targetDim = 1;
    this.uniforms = {
      uTime: { value: 0 },
      uMix: { value: 0 },
      uDim: { value: 1 },
      uScale: { value: 1000 },
    };

    this.object = new THREE.Group();
    this.object.add(this._buildTree());
    this.snow = this._buildSnow(1400);
  }

  addTo(scene) {
    scene.add(this.object, this.snow);
  }

  /** Point sizes are specified in world units; convert using the drawing-buffer height. */
  setViewport(bufferHeight, fov) {
    this.uniforms.uScale.value = bufferHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  update(dt, time) {
    this.mix += (this.targetMix - this.mix) * (1 - Math.exp(-dt * 2.2));
    this.dim += (this.targetDim - this.dim) * (1 - Math.exp(-dt * 4));
    this.uniforms.uTime.value = time;
    this.uniforms.uMix.value = this.mix;
    this.uniforms.uDim.value = this.dim;
  }

  _buildTree() {
    const pos = [], scatter = [], color = [], size = [], phase = [], twinkle = [];
    const c = new THREE.Color();

    const add = (x, y, z, col, intensity, s, tw) => {
      pos.push(x, y, z);
      // Scatter target: random point in a thick spherical shell around the tree.
      const u = rand(-1, 1), th = rand(0, Math.PI * 2), r = 6 + 8 * Math.cbrt(Math.random());
      const s2 = Math.sqrt(1 - u * u);
      scatter.push(s2 * Math.cos(th) * r, u * r * 0.75 + 0.5, s2 * Math.sin(th) * r);
      c.set(col).multiplyScalar(intensity);
      color.push(c.r, c.g, c.b);
      size.push(s);
      phase.push(Math.random());
      twinkle.push(tw);
    };

    // Body: tiered cone, denser toward the outside so the silhouette reads clearly.
    const greens = ['#0d5c24', '#17803a', '#2fa552', '#6fdc8c'];
    for (let i = 0; i < 13000; i++) {
      const h = 1 - Math.sqrt(Math.random());
      const tierFrac = (h * 8) % 1;
      const rMax = TREE_BASE_R * (1 - h) * (0.72 + 0.42 * (1 - tierFrac));
      const k = Math.pow(Math.random(), 0.45);
      const r = rMax * k;
      const a = rand(0, Math.PI * 2);
      const y = TREE_BASE_Y + h * TREE_HEIGHT - k * 0.35 * (1 - tierFrac);
      const col = greens[Math.min(3, Math.floor(k * 3.2 + Math.random() * 0.8))];
      add(Math.cos(a) * r, y, Math.sin(a) * r, col, 0.35 + 0.4 * k, rand(0.6, 1.1), Math.random() < 0.05 ? 0.5 : 0);
    }

    // Two spiral garlands.
    for (let s = 0; s < 2; s++) {
      const n = 1100;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const h = t * 0.92;
        const a = t * Math.PI * 2 * 5 + s * Math.PI;
        const r = TREE_BASE_R * (1 - h) * 1.02 + 0.05 + rand(-0.04, 0.04);
        const y = TREE_BASE_Y + h * TREE_HEIGHT + rand(-0.04, 0.04);
        add(Math.cos(a) * r, y, Math.sin(a) * r, s ? '#fff2d6' : '#ffd98a', 1.1, 0.9, 0.35);
      }
    }

    // Ornament baubles: big, saturated, slowly pulsing.
    const ornaments = ['#ff2b45', '#ffc23d', '#3fa0ff', '#ff5fc8', '#c06bff'];
    for (let i = 0; i < 260; i++) {
      const h = rand(0.04, 0.88);
      const r = TREE_BASE_R * (1 - h) * rand(0.9, 1.05);
      const a = rand(0, Math.PI * 2);
      add(Math.cos(a) * r, TREE_BASE_Y + h * TREE_HEIGHT, Math.sin(a) * r, pick(ornaments), 1.4, rand(2.2, 3.2), 0.4);
    }

    // Fairy lights: small, bright, fast twinkle.
    const lights = ['#fff3c4', '#ffd36b', '#ff8a8a', '#8ad4ff'];
    for (let i = 0; i < 1600; i++) {
      const h = 1 - Math.sqrt(Math.random());
      const r = TREE_BASE_R * (1 - h) * rand(0.92, 1.04);
      const a = rand(0, Math.PI * 2);
      add(Math.cos(a) * r, TREE_BASE_Y + h * TREE_HEIGHT, Math.sin(a) * r, pick(lights), 1.6, 0.9, 1);
    }

    // Star on top: outline + fill + halo.
    const topY = TREE_BASE_Y + TREE_HEIGHT + 0.5;
    const star = [];
    for (let k = 0; k < 10; k++) {
      const ang = Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 ? 0.24 : 0.6;
      star.push([Math.cos(ang) * rr, Math.sin(ang) * rr]);
    }
    for (let k = 0; k < 10; k++) {
      const [ax, ay] = star[k], [bx, by] = star[(k + 1) % 10];
      for (let j = 0; j < 60; j++) {
        const t = j / 60;
        add(ax + (bx - ax) * t, topY + ay + (by - ay) * t, rand(-0.04, 0.04), '#ffe27a', 1.6, 1.0, 0.2);
      }
    }
    for (let i = 0; i < 500; i++) {
      const k = Math.floor(Math.random() * 10);
      const [ax, ay] = star[k], [bx, by] = star[(k + 1) % 10];
      let u = Math.random(), v = Math.random();
      if (u + v > 1) { u = 1 - u; v = 1 - v; }
      add(ax * u + bx * v, topY + ay * u + by * v, rand(-0.06, 0.06), '#ffd76a', 1.2, 0.9, 0.3);
    }
    for (let i = 0; i < 250; i++) {
      const u = rand(-1, 1), th = rand(0, Math.PI * 2), r = rand(0.4, 1.1);
      const s2 = Math.sqrt(1 - u * u);
      add(s2 * Math.cos(th) * r, topY + u * r, s2 * Math.sin(th) * r, '#fff0b0', 0.2, 1.4, 0.6);
    }

    // Trunk.
    for (let i = 0; i < 500; i++) {
      const a = rand(0, Math.PI * 2), r = 0.38 * Math.sqrt(Math.random());
      add(Math.cos(a) * r, rand(TREE_BASE_Y - 0.8, TREE_BASE_Y + 0.2), Math.sin(a) * r, '#7a4524', 0.45, 0.9, 0);
    }

    // Glowing ground ring.
    for (let i = 0; i < 1500; i++) {
      const a = rand(0, Math.PI * 2), r = rand(1.5, 5.5);
      add(Math.cos(a) * r, TREE_BASE_Y - 0.85 + rand(-0.05, 0.05), Math.sin(a) * r,
        Math.random() < 0.5 ? '#cfe3ff' : '#ffe3a8', 0.1 + 0.25 * (1 - r / 6), 0.8, 0.7);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aScatter', new THREE.Float32BufferAttribute(scatter, 3));
    geo.setAttribute('aColor', new THREE.Float32BufferAttribute(color, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
    geo.setAttribute('aTwinkle', new THREE.Float32BufferAttribute(twinkle, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: treeVertexShader,
      fragmentShader: glowFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false; // scattered positions live outside the bounding sphere
    this.count = pos.length / 3;
    return points;
  }

  _buildSnow(n) {
    const pos = [], size = [], phase = [], speed = [];
    for (let i = 0; i < n; i++) {
      pos.push(rand(-14, 14), rand(-7, 9), rand(-10, 8));
      size.push(rand(0.5, 1.2));
      phase.push(Math.random());
      speed.push(rand(0.3, 0.9));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
    geo.setAttribute('aSpeed', new THREE.Float32BufferAttribute(speed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: snowVertexShader,
      fragmentShader: glowFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return points;
  }
}
