const vertexSource = `
  precision highp float;
  attribute vec3 a_point;
  uniform float u_time;
  uniform float u_aspect;
  uniform float u_dpr;
  uniform vec3 u_weights;
  uniform vec2 u_pointer;
  uniform vec3 u_ripple;
  varying float v_alpha;
  varying float v_tint;

  void main() {
    float x = a_point.x;
    float z = a_point.y;
    float t = u_time;
    float wave = sin(x * .135 + z * .17 + t * .37) * 3.8
      + sin(z * .205 - x * .105 - t * .27) * 3.1
      + cos(x * .19 + z * .04 + t * .19) * 1.8;
    vec3 wavePosition = vec3(x, wave, z);

    float angle = x / 45.0 * 3.141593 + t * .065;
    float ring = z / 32.0 * 3.141593;
    float radius = 20.0 + cos(ring) * 7.0;
    vec3 orbitPosition = vec3(cos(angle) * radius, sin(ring) * 5.0 + sin(angle * 3.0 + t * .3) * 1.8, sin(angle) * radius);

    float drift = sin(x * .07 + z * .08 + t * .2) * 5.5
      + cos(z * .11 - t * .18) * 3.0;
    vec3 driftPosition = vec3(x + sin(z * .11 + t * .1) * 3.0, drift, z);
    vec3 p = wavePosition * u_weights.x + orbitPosition * u_weights.y + driftPosition * u_weights.z;

    float pointerDistance = length(p.xz - u_pointer * vec2(30.0, -22.0));
    p.y += exp(-pointerDistance * pointerDistance * .014) * 1.5;
    float rippleAge = t - u_ripple.z;
    float rippleDistance = length(p.xz - u_ripple.xy);
    float rippleEnvelope = exp(-pow((rippleDistance - rippleAge * 12.0) * .3, 2.0)) * exp(-rippleAge * .65);
    p.y += sin(rippleDistance * 1.1 - rippleAge * 9.0) * rippleEnvelope * 3.0;

    float yaw = -.16 + u_pointer.x * .055;
    float px = p.x * cos(yaw) - p.z * sin(yaw);
    float pz = p.x * sin(yaw) + p.z * cos(yaw);
    float pitch = .56 + u_pointer.y * .025;
    float py = p.y * cos(pitch) + pz * sin(pitch);
    float depth = 52.0 + pz * cos(pitch) - p.y * sin(pitch);
    float focal = 2.35;
    gl_Position = vec4(px * focal / u_aspect, py * focal - depth * .09, 0.0, depth);
    gl_PointSize = clamp((1.0 + 38.0 / depth) * u_dpr, 1.0, 5.0 * u_dpr);

    float edges = (1.0 - smoothstep(35.0, 45.0, abs(x))) * (1.0 - smoothstep(25.0, 32.0, abs(z)));
    float depthFade = clamp((88.0 - depth) / 55.0, .07, 1.0);
    float crest = .57 + .43 * smoothstep(-6.0, 7.0, p.y);
    v_alpha = depthFade * crest * (.65 + a_point.z * .35) * mix(edges, .8, u_weights.y) * 1.4;
    v_tint = .35 + .65 * smoothstep(-4.0, 8.0, p.y);
  }
`;

const fragmentSource = `
  precision mediump float;
  varying float v_alpha;
  varying float v_tint;
  void main() {
    float distance = length(gl_PointCoord - .5) * 2.0;
    float circle = 1.0 - smoothstep(.35, 1.0, distance);
    vec3 color = mix(vec3(.52, .62, .68), vec3(.86, .94, .91), v_tint);
    gl_FragColor = vec4(color, circle * v_alpha);
  }
`;

const canvas = document.querySelector('#field');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const pauseButton = document.querySelector('#pause');
const status = document.querySelector('#field-status');
const announcement = document.querySelector('#announcement');
const welcome = document.querySelector('.welcome');
const returnButton = document.querySelector('#return');
const about = document.querySelector('#about');
let paused = reducedMotion.matches;
let time = 12;
let previousTime = 0;
let frame = null;
let selectedMode = 0;
const weights = [1, 0, 0];
const pointer = [0, 0];
const targetPointer = [0, 0];
const ripple = [0, 0, -100];

function createWebGLRenderer() {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
  if (!gl) throw new Error('WebGL is not available.');

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
  }

  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);

  const columns = innerWidth < 600 ? 160 : 240;
  const rows = innerWidth < 600 ? 112 : 160;
  const points = new Float32Array(columns * rows * 3);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = (row * columns + column) * 3;
      points[index] = (column / (columns - 1) - .5) * 90;
      points[index + 1] = (row / (rows - 1) - .5) * 64;
      points[index + 2] = (Math.sin(column * 127.1 + row * 311.7) * 43758.5453) % 1 * .5 + .5;
    }
  }

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, points, gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_point');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
  const uniforms = Object.fromEntries(['time', 'aspect', 'dpr', 'weights', 'pointer', 'ripple'].map(name => [name, gl.getUniformLocation(program, `u_${name}`)]));
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.clearColor(5 / 255, 6 / 255, 7 / 255, 1);
  let dpr = 1;

  return {
    resize() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(innerWidth * dpr);
      canvas.height = Math.round(innerHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    draw() {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uniforms.time, time);
      gl.uniform1f(uniforms.aspect, canvas.width / canvas.height);
      gl.uniform1f(uniforms.dpr, dpr);
      gl.uniform3fv(uniforms.weights, weights);
      gl.uniform2fv(uniforms.pointer, pointer);
      gl.uniform3fv(uniforms.ripple, ripple);
      gl.drawArrays(gl.POINTS, 0, columns * rows);
    },
  };
}

// A lighter perspective renderer keeps the scene usable without GPU support.
function createCanvasRenderer() {
  const fallback = document.createElement('canvas');
  fallback.id = 'field';
  fallback.setAttribute('aria-hidden', 'true');
  document.querySelector('#field').replaceWith(fallback);
  const context = fallback.getContext('2d');
  let width, height;
  return {
    resize() {
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      width = innerWidth;
      height = innerHeight;
      fallback.width = Math.round(width * dpr);
      fallback.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    draw() {
      context.fillStyle = '#050607';
      context.fillRect(0, 0, width, height);
      const age = time - ripple[2];
      for (let z = 32; z >= -32; z -= .85) {
        for (let x = -45; x <= 45; x += .65) {
          const wave = Math.sin(x * .135 + z * .17 + time * .37) * 3.8 + Math.sin(z * .205 - x * .105 - time * .27) * 3.1 + Math.cos(x * .19 + z * .04 + time * .19) * 1.8;
          const angle = x / 45 * Math.PI + time * .065;
          const ring = z / 32 * Math.PI;
          const radius = 20 + Math.cos(ring) * 7;
          const drift = Math.sin(x * .07 + z * .08 + time * .2) * 5.5 + Math.cos(z * .11 - time * .18) * 3;
          let px = x * weights[0] + Math.cos(angle) * radius * weights[1] + (x + Math.sin(z * .11 + time * .1) * 3) * weights[2];
          let pz = z * (weights[0] + weights[2]) + Math.sin(angle) * radius * weights[1];
          let py = wave * weights[0] + (Math.sin(ring) * 5 + Math.sin(angle * 3 + time * .3) * 1.8) * weights[1] + drift * weights[2];
          const distance = Math.hypot(px - ripple[0], pz - ripple[1]);
          py += Math.sin(distance * 1.1 - age * 9) * Math.exp(-(((distance - age * 12) * .3) ** 2)) * Math.exp(-age * .65) * 3;
          const yaw = -.16 + pointer[0] * .055;
          const rotatedX = px * Math.cos(yaw) - pz * Math.sin(yaw);
          pz = px * Math.sin(yaw) + pz * Math.cos(yaw);
          const pitch = .56 + pointer[1] * .025;
          const depth = 52 + pz * Math.cos(pitch) - py * Math.sin(pitch);
          const screenX = width / 2 + rotatedX * 2.35 / depth * height / 2;
          const screenY = height * .545 - (py * Math.cos(pitch) + pz * Math.sin(pitch)) * 2.35 / depth * height / 2;
          const edge = Math.min(1, (45 - Math.abs(x)) / 10, (32 - Math.abs(z)) / 7);
          const alpha = Math.max(0, Math.min(.85, (88 - depth) / 80)) * (edge * (1 - weights[1]) + weights[1] * .8);
          context.fillStyle = `rgba(183,204,201,${alpha})`;
          context.beginPath();
          context.arc(screenX, screenY, .5 + 19 / depth, 0, Math.PI * 2);
          context.fill();
        }
      }
    },
  };
}

let renderer;
try {
  renderer = createWebGLRenderer();
} catch {
  renderer = createCanvasRenderer();
}

function render(timestamp) {
  frame = null;
  const delta = previousTime ? Math.min((timestamp - previousTime) / 1000, .05) : 0;
  previousTime = timestamp;
  if (!paused) {
    time += delta;
    const ease = 1 - Math.exp(-delta * 2.8);
    weights.forEach((value, i) => { weights[i] = value + ((i === selectedMode ? 1 : 0) - value) * ease; });
    pointer.forEach((value, i) => { pointer[i] = value + (targetPointer[i] - value) * ease; });
  }
  renderer.draw();
  if (!paused && !document.hidden) frame = requestAnimationFrame(render);
}

function requestFrame() {
  if (frame === null && !document.hidden) frame = requestAnimationFrame(render);
}

function syncPauseState() {
  document.body.classList.toggle('is-paused', paused);
  const label = paused ? 'Play animation' : 'Pause animation';
  pauseButton.setAttribute('aria-label', label);
  pauseButton.setAttribute('aria-pressed', String(paused));
  pauseButton.title = label;
  status.textContent = paused ? 'A MOMENT OF STILLNESS' : 'THE FIELD IS ALIVE';
  previousTime = 0;
  requestFrame();
}

pauseButton.addEventListener('click', () => {
  paused = !paused;
  syncPauseState();
  announcement.textContent = paused ? 'Animation paused.' : 'Animation playing.';
});

document.querySelectorAll('.preset').forEach(button => {
  button.addEventListener('click', () => {
    selectedMode = Number(button.dataset.mode);
    document.querySelectorAll('.preset').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    if (paused) weights.forEach((_, i) => { weights[i] = i === selectedMode ? 1 : 0; });
    announcement.textContent = `${button.textContent.trim()} field selected.`;
    requestFrame();
  });
});

function setImmersive(immersive) {
  document.body.classList.toggle('immersive', immersive);
  welcome.inert = immersive;
  welcome.setAttribute('aria-hidden', String(immersive));
  returnButton.hidden = !immersive;
  (immersive ? returnButton : document.querySelector('#explore')).focus({ preventScroll: true });
  announcement.textContent = immersive ? 'You are in the field. Press Escape or Back to still to return.' : 'Welcome back.';
}

document.querySelector('#explore').addEventListener('click', () => setImmersive(true));
returnButton.addEventListener('click', () => setImmersive(false));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !about.open && document.body.classList.contains('immersive')) setImmersive(false);
});
document.querySelector('#about-open').addEventListener('click', () => about.showModal());
document.querySelector('#about-close').addEventListener('click', () => about.close());
about.addEventListener('click', event => {
  const rect = about.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) about.close();
});

window.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch') return;
  targetPointer[0] = event.clientX / innerWidth * 2 - 1;
  targetPointer[1] = event.clientY / innerHeight * 2 - 1;
}, { passive: true });
document.documentElement.addEventListener('pointerleave', () => { targetPointer.fill(0); });
window.addEventListener('pointerdown', event => {
  if (paused || event.target.closest('button, a, .welcome, dialog')) return;
  ripple[0] = (event.clientX / innerWidth * 2 - 1) * 30;
  ripple[1] = -(event.clientY / innerHeight * 2 - 1) * 22;
  ripple[2] = time;
}, { passive: true });
window.addEventListener('resize', () => { renderer.resize(); requestFrame(); }, { passive: true });
document.addEventListener('visibilitychange', () => {
  previousTime = 0;
  if (document.hidden && frame !== null) { cancelAnimationFrame(frame); frame = null; }
  else requestFrame();
});
reducedMotion.addEventListener('change', event => { paused = event.matches; syncPauseState(); });
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  renderer = createCanvasRenderer();
  renderer.resize();
  requestFrame();
});

renderer.resize();
syncPauseState();
