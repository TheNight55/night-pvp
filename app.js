'use strict';
/* Plates of Doubt — every illusion is drawn at runtime on <canvas>. No libraries. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const TAU = Math.PI * 2;
const C = { paper: '#ece7dc', ink: '#0e0e0c', red: '#ff3d1e' };
const state = { paused: matchMedia('(prefers-reduced-motion: reduce)').matches };

/* ------------------------------------------------------------------
   Stage: DPR-correct canvas that only renders while on screen.
   draw(ctx, w, h, api, dt, forced)
------------------------------------------------------------------ */
function stage(canvas, draw, { animated = false } = {}) {
  const ctx = canvas.getContext('2d');
  const api = { ctx, canvas, w: 0, h: 0, dpr: 1, time: 0, invalidate() { dirty = true; kick(); } };
  let visible = false, raf = 0, dirty = true, last = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    api.dpr = Math.min(window.devicePixelRatio || 1, 2);
    api.w = r.width; api.h = r.height;
    canvas.width = Math.round(r.width * api.dpr);
    canvas.height = Math.round(r.height * api.dpr);
    dirty = true; kick();
  }
  function frame(now) {
    raf = 0;
    if (!visible) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    const running = animated && !state.paused;
    if (running) api.time += dt;
    if (dirty || running) {
      const forced = dirty; dirty = false;
      ctx.setTransform(api.dpr, 0, 0, api.dpr, 0, 0);
      draw(ctx, api.w, api.h, api, dt, forced);
    }
    if (running) raf = requestAnimationFrame(frame);
  }
  function kick() { if (visible && api.w && !raf) raf = requestAnimationFrame(frame); }

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(es => {
    visible = es[0].isIntersecting;
    if (visible) { last = performance.now(); kick(); }
  }, { rootMargin: '120px' }).observe(canvas);
  addEventListener('motionchange', () => { last = performance.now(); dirty = true; kick(); });
  if (animated) canvas.closest('.stage')?.classList.toggle('off', state.paused);
  return api;
}

function local(e, el) {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function range(id, fn, fmt = v => v) {
  const el = $('#' + id), out = $('#' + id + '-o');
  const on = () => { const v = parseFloat(el.value); if (out) out.textContent = fmt(v); fn(v); };
  el.addEventListener('input', on); on();
  return el;
}
function toggle(id, fn, labels) {
  const el = $('#' + id);
  el.addEventListener('click', () => {
    const on = el.getAttribute('aria-pressed') !== 'true';
    el.setAttribute('aria-pressed', on);
    if (labels) el.textContent = labels[on ? 1 : 0];
    fn(on);
  });
  return el;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------
   Global: motion switch, reticle, rail, scroll-linked bands, reveal
------------------------------------------------------------------ */
(function chrome() {
  const btn = $('#motion');
  function setMotion(off) {
    state.paused = off;
    document.body.dataset.motion = off ? 'off' : 'on';
    btn.setAttribute('aria-pressed', off);
    btn.textContent = off ? 'Motion: off' : 'Motion: on';
    $$('.stage.animated').forEach(s => s.classList.toggle('off', off));
    dispatchEvent(new Event('motionchange'));
  }
  btn.addEventListener('click', () => setMotion(!state.paused));
  setMotion(state.paused);
  window.setMotion = setMotion;

  // reticle
  const ret = $('.reticle');
  if (matchMedia('(pointer:fine)').matches) {
    let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, run = false;
    const loop = () => {
      x += (tx - x) * .22; y += (ty - y) * .22;
      ret.style.transform = `translate(${x}px,${y}px)`;
      if (Math.abs(tx - x) + Math.abs(ty - y) > .1) requestAnimationFrame(loop); else run = false;
    };
    addEventListener('pointermove', e => {
      tx = e.clientX; ty = e.clientY; ret.classList.add('on');
      if (!run) { run = true; requestAnimationFrame(loop); }
      ret.classList.toggle('big', !!e.target.closest('button,a,input,.stage'));
    }, { passive: true });
    document.documentElement.addEventListener('mouseleave', () => ret.classList.remove('on'));
  }

  // rail + progress
  const links = $$('.rail a[data-n]');
  const secs = links.map(a => $(a.getAttribute('href')));
  secs.forEach(sec => {
    new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) links.forEach(a => a.classList.toggle('cur', a.getAttribute('href') === '#' + sec.id));
    }), { rootMargin: '-45% 0px -50% 0px' }).observe(sec);
  });

  // scroll-linked band moiré + progress
  const root = document.documentElement;
  let ly = scrollY, tick = false;
  function onScroll() {
    if (tick) return; tick = true;
    requestAnimationFrame(() => {
      tick = false;
      const y = scrollY, v = Math.max(-12, Math.min(12, (y - ly) * .35)); ly = y;
      root.style.setProperty('--sy', y);
      root.style.setProperty('--sv', v.toFixed(2));
      root.style.setProperty('--p', (y / (root.scrollHeight - innerHeight || 1)).toFixed(3));
    });
  }
  addEventListener('scroll', onScroll, { passive: true });

  const rvo = new IntersectionObserver((es, o) => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); o.unobserve(e.target); }
  }), { threshold: .12 });
  $$('.rv').forEach(el => rvo.observe(el));
})();

/* ------------------------------------------------------------------
   Hero — full-screen WebGL2 tunnel with an opt-in 20 s stare.
   No flashing: only smooth motion, so it stays clear of strobe limits.
   Falls back to a canvas moiré where WebGL2 is missing.
------------------------------------------------------------------ */
(function hero() {
  const cv = $('#hero-canvas'), heroEl = $('.hero');
  let ok = false;
  try { ok = !!document.createElement('canvas').getContext('webgl2'); } catch (e) { /* no webgl */ }
  if (ok) vortex(cv, heroEl); else { moire(cv, heroEl); $('#stare-go').hidden = true; }
})();

/* ------------------------------------------------------------------
   Hero — three concentric ring gratings beating against each other
------------------------------------------------------------------ */
function moire(cv, hero) {
  const p = { x: 0, y: 0, tx: 0, ty: 0, active: false, init: false };
  hero.addEventListener('pointermove', e => { const q = local(e, cv); p.tx = q.x; p.ty = q.y; p.active = true; }, { passive: true });
  hero.addEventListener('pointerleave', () => { p.active = false; });

  function rings(ctx, cx, cy, step, maxR) {
    ctx.beginPath();
    for (let r = step; r < maxR; r += step) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); }
    ctx.stroke();
  }
  stage(cv, (ctx, w, h, s, dt) => {
    const t = s.time;
    if (!p.active) { p.tx = w * (.5 + .3 * Math.sin(t * .31)); p.ty = h * (.5 + .24 * Math.sin(t * .47 + 1.2)); }
    if (!p.init) { p.x = p.tx; p.y = p.ty; p.init = true; }
    const k = 1 - Math.exp(-(dt || .016) * 3.2);
    p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k;

    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, w, h);
    const maxR = Math.hypot(w, h);
    ctx.lineWidth = 4.5; ctx.strokeStyle = C.ink;
    const ax = w * .5 + Math.sin(t * .2) * 40, ay = h * .5 + Math.cos(t * .17) * 30;
    rings(ctx, ax, ay, 15, maxR);
    rings(ctx, p.x, p.y, 15.7, maxR);
    // a faint red third grating halfway between the two centres
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,61,30,.8)';
    rings(ctx, (ax + p.x) / 2, (ay + p.y) / 2, 15.35, maxR);
  }, { animated: true });
}


function vortex(cv, heroEl) {
  const gl = cv.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  const VS = `#version 300 es
in vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }`;
  const FS = `#version 300 es
precision highp float;
uniform vec2 uRes, uC; uniform float uT, uI, uK, uDot;
out vec4 o;
float pat(vec2 p, float off, float n, float tw, float dir){
  float r = length(p) + 1e-4, a = atan(p.y, p.x), lr = log(r);
  float s = sin(n*a + tw*lr - dir*uT*(1.0 + .7*uI) + off);
  float z = sin(lr*(9.0 + 8.0*uI) + dir*uT*(2.2 + 2.0*uI) + off*.6);
  float v = s*z, w = fwidth(v)*.8 + .015;
  return smoothstep(-w, w, v);
}
void main(){
  vec2 f = gl_FragCoord.xy;
  vec2 p = (f - uC) / uRes.y * 2.0;
  float r = length(p), k = smoothstep(.34, .30, r);
  vec3 outer = vec3(pat(p,0.,8.,3.4+uI,1.), pat(p,.16,8.,3.4+uI,1.), pat(p,.32,8.,3.4+uI,1.));
  vec3 inner = vec3(pat(p,0.,5.,-2.4,-1.), pat(p,.16,5.,-2.4,-1.), pat(p,.32,5.,-2.4,-1.));
  vec3 ink = vec3(.055,.055,.047), paper = vec3(.93,.905,.86), flat_ = vec3(.80,.77,.71);
  vec3 col = mix(ink, paper, mix(outer, inner, k));
  col = mix(flat_, col, uK);
  col *= 1.0 - .22*smoothstep(.9, 2.0, length((f - .5*uRes)/uRes.y*2.0));
  float d = length(f - uC);
  col = mix(col, vec3(1., .24, .12), (1.0 - smoothstep(uDot - 1.5, uDot + 1.5, d)) * step(.5, uDot));
  o = vec4(col, 1.);
}`;
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { moire(cv, heroEl); return; }
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(pr, n);
  const uRes = U('uRes'), uC = U('uC'), uT = U('uT'), uI = U('uI'), uK = U('uK'), uDot = U('uDot');

  const STARE = 20;
  let W = 1, H = 1, dpr = 1, t = 0, I = 0, K = .55, spd = 1, mode = 'idle', el = 0;
  let c = { x: 0, y: 0, tx: 0, ty: 0, active: false, init: false };
  let vis = false, raf = 0, last = 0;
  const count = $('#stare-count'), go = $('#stare-go'), after = $('#stare-after');

  function resize() {
    const r = cv.getBoundingClientRect(); if (!r.width) return;
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    gl.viewport(0, 0, cv.width, cv.height); kick();
  }
  function setMode(m) {
    mode = m; heroEl.classList.toggle('staring', m === 'stare'); heroEl.classList.toggle('done', m === 'done');
    go.textContent = m === 'idle' ? 'Dare — stare 20 s' : m === 'done' ? 'Again' : 'Stop';
    go.setAttribute('aria-pressed', m === 'stare');
  }
  function update(dt) {
    const tgt = mode === 'stare' ? [W / 2, H / 2] : [c.tx, c.ty];
    if (mode !== 'stare' && !c.active) { tgt[0] = W * (.5 + .22 * Math.sin(t * .13)); tgt[1] = H * (.5 + .18 * Math.sin(t * .19 + 1)); }
    if (!c.init) { c.x = tgt[0]; c.y = tgt[1]; c.init = true; }
    const kk = 1 - Math.exp(-dt * (mode === 'stare' ? 6 : 2.6));
    c.x += (tgt[0] - c.x) * kk; c.y += (tgt[1] - c.y) * kk;
    if (mode === 'stare') {
      el += dt; const f = Math.min(1, el / STARE);
      I = f * f * (3 - 2 * f); K += (1 - K) * (1 - Math.exp(-dt * 1.5)); spd = 1 + 1.1 * f;
      count.textContent = Math.max(0, Math.ceil(STARE - el));
      if (el >= STARE) { setMode('done'); }
    } else if (mode === 'done') {
      spd += (0 - spd) * (1 - Math.exp(-dt * 5)); if (spd < .003) spd = 0; K = 1;
    } else {
      const e = 1 - Math.exp(-dt * 2); I += (0 - I) * e; K += (.55 - K) * e; spd += (1 - spd) * e;
    }
    t += dt * spd;
  }
  function draw() {
    gl.uniform2f(uRes, cv.width, cv.height);
    gl.uniform2f(uC, c.x * dpr, (H - c.y) * dpr);
    gl.uniform1f(uT, t); gl.uniform1f(uI, I); gl.uniform1f(uK, K);
    gl.uniform1f(uDot, mode === 'idle' ? 0 : Math.max(5, H * .012) * dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function frame(now) {
    raf = 0; if (!vis) return;
    const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
    const run = !state.paused;
    if (run) update(dt); else if (!c.init) update(0);
    draw();
    if (run) raf = requestAnimationFrame(frame);
  }
  function kick() { if (vis && !raf) raf = requestAnimationFrame(frame); }

  go.addEventListener('click', () => {
    if (mode === 'stare') { setMode('idle'); return; }
    if (state.paused) window.setMotion(false);   // the visitor asked for it explicitly
    el = 0; setMode('stare'); count.textContent = STARE; kick();
  });
  $('#stare-quit').addEventListener('click', () => setMode('idle'));
  addEventListener('keydown', e => { if (e.key === 'Escape' && mode === 'stare') setMode('idle'); });
  heroEl.addEventListener('pointermove', e => { const q = local(e, cv); c.tx = q.x; c.ty = q.y; c.active = true; }, { passive: true });
  heroEl.addEventListener('pointerleave', () => { c.active = false; });
  new ResizeObserver(resize).observe(cv);
  new IntersectionObserver(es => { vis = es[0].isIntersecting; if (vis) { last = performance.now(); kick(); } else if (mode === 'stare') setMode('idle'); }).observe(cv);
  addEventListener('motionchange', () => { last = performance.now(); kick(); });
  setMode('idle');
}

/* ------------------------------------------------------------------
   I — Rotating snakes
------------------------------------------------------------------ */
(function snakes() {
  const cv = $('#snakes'), off = new Set();
  const SEQ = ['#0b0b0b', '#2447c6', '#f3f1ea', '#e6c02a'];
  const GRAY = SEQ.map(h => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const l = Math.round(.2126 * r + .7152 * g + .0722 * b); return `rgb(${l},${l},${l})`;
  });
  let hits = [];

  function disc(ctx, cx, cy, R, gray) {
    const pal = gray ? GRAY : SEQ, rings = 4, r0 = R * .1;
    ctx.fillStyle = '#0b0b0b'; ctx.beginPath(); ctx.arc(cx, cy, R * 1.01, 0, TAU); ctx.fill();
    for (let i = 0; i < rings; i++) {
      const ri = r0 + (R - r0) * i / rings, ro = r0 + (R - r0) * (i + 1) / rings - R * .012;
      const n = 14 + i * 7, step = TAU / n / 4, rev = i % 2;
      for (let j = 0; j < n * 4; j++) {
        ctx.fillStyle = pal[rev ? 3 - (j % 4) : j % 4];
        const a0 = j * step, a1 = a0 + step + .004;
        ctx.beginPath(); ctx.arc(cx, cy, ro, a0, a1); ctx.arc(cx, cy, ri, a1, a0, true); ctx.closePath(); ctx.fill();
      }
    }
  }
  const api = stage(cv, (ctx, w, h) => {
    ctx.fillStyle = '#c9c3b4'; ctx.fillRect(0, 0, w, h);
    const cols = w > h * 1.2 ? 3 : 2, rows = cols === 3 ? 2 : 3;
    const cell = Math.min(w / cols, h / rows), R = cell * .45;
    const ox = (w - cell * cols) / 2, oy = (h - cell * rows) / 2;
    hits = []; let n = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const cx = ox + (c + .5) * cell, cy = oy + (r + .5) * cell;
      disc(ctx, cx, cy, R, off.has(n)); hits.push({ cx, cy, R }); n++;
    }
    $('#snakes-read').textContent = `${n} discs · ${off.size} desaturated`;
  });
  const pick = e => { const q = local(e, cv); return hits.findIndex(d => Math.hypot(q.x - d.cx, q.y - d.cy) < d.R); };
  cv.addEventListener('pointerdown', e => { const i = pick(e); if (i < 0) return; off.has(i) ? off.delete(i) : off.add(i); api.invalidate(); });
  cv.addEventListener('pointermove', e => { cv.style.cursor = pick(e) >= 0 ? 'pointer' : 'crosshair'; });
  $('#snakes-reset').addEventListener('click', () => { off.clear(); api.invalidate(); });
})();

/* ------------------------------------------------------------------
   II — Spiral (motion after-effect)
------------------------------------------------------------------ */
(function spiral() {
  const cv = $('#spiral'), N = 420, ARMS = 6, K = 7.5, STARE = 20;
  const off = document.createElement('canvas'); off.width = off.height = N;
  const octx = off.getContext('2d'), img = octx.createImageData(N, N);
  const phase = new Float32Array(N * N), mask = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - N / 2 + .5, dy = y - N / 2 + .5, r = Math.hypot(dx, dy), i = y * N + x;
    phase[i] = ARMS * Math.atan2(dy, dx) + K * Math.log(r + 1);
    mask[i] = (1 - smooth(N / 2 - 3, N / 2, r)) * smooth(2.5, 4.5, r);
  }
  const A = [236, 231, 220], B = [14, 14, 12];
  let speed = 2.2, dir = 1, cur = 2.2, ang = 0, mode = 'spin', t0 = 0;
  const read = $('#spiral-read'), btn = $('#spiral-stare');

  const api = stage(cv, (ctx, w, h, s, dt, forced) => {
    if (mode === 'stare' && s.time - t0 >= STARE) { mode = 'rest'; btn.textContent = 'Stare — 20 s'; }
    const target = mode === 'rest' ? 0 : speed * dir;
    cur += (target - cur) * (1 - Math.exp(-dt * (mode === 'rest' ? 9 : 5)));
    if (mode === 'rest' && Math.abs(cur) < .004) cur = 0;
    ang += cur * dt;
    if (cur === 0 && !forced && mode === 'rest') return;

    const d = img.data;
    for (let i = 0, p = 0; i < phase.length; i++, p += 4) {
      const v = Math.max(-1, Math.min(1, Math.sin(phase[i] - ang) * 3.2)) * .5 + .5;
      d[p] = B[0] + (A[0] - B[0]) * v; d[p + 1] = B[1] + (A[1] - B[1]) * v; d[p + 2] = B[2] + (A[2] - B[2]) * v;
      d[p + 3] = mask[i] * 255;
    }
    octx.putImageData(img, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const S = Math.min(w, h) * .94;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, (w - S) / 2, (h - S) / 2, S, S);
    ctx.fillStyle = C.red; ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.max(3, S * .011), 0, TAU); ctx.fill();

    if (mode === 'stare') {
      const f = (s.time - t0) / STARE;
      ctx.strokeStyle = C.red; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(w / 2, h / 2, S / 2 + 2, -Math.PI / 2, -Math.PI / 2 + TAU * f); ctx.stroke();
      read.textContent = `keep staring · ${Math.ceil(STARE - (s.time - t0))} s`;
    } else read.textContent = mode === 'rest' ? 'frozen — now look away' : 'spinning';
  }, { animated: true });

  btn.addEventListener('click', () => {
    if (state.paused) { read.textContent = 'turn motion on first'; return; }
    mode = 'stare'; t0 = api.time; btn.textContent = 'Restart';
  });
  $('#spiral-flip').addEventListener('click', () => { dir *= -1; if (mode === 'rest') mode = 'spin'; });
  range('spiral-speed', v => { speed = v; if (mode === 'rest') mode = 'spin'; }, v => v.toFixed(1));
})();

/* ------------------------------------------------------------------
   III — Café wall
------------------------------------------------------------------ */
(function cafe() {
  let shift = .5, mortar = 4, ruler = false;
  const api = stage($('#cafe'), (ctx, w, h) => {
    ctx.fillStyle = '#8a867c'; ctx.fillRect(0, 0, w, h);
    const rows = w > h * 1.2 ? 9 : 12, s = (h - mortar * (rows - 1)) / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * (s + mortar), off = (r % 2) * shift * s;
      for (let x = -s * 2 + off; x < w + s * 2; x += s) {
        const k = Math.round((x - off) / s) + 1000;
        ctx.fillStyle = k % 2 ? '#0d0d0c' : '#f2efe6';
        ctx.fillRect(x, y, s + .5, s);
      }
    }
    if (ruler) {
      ctx.strokeStyle = C.red; ctx.lineWidth = 1.5;
      for (let r = 1; r < rows; r++) { const y = r * (s + mortar) - mortar / 2; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    }
  });
  range('cafe-shift', v => { shift = v; $('#cafe-read').textContent = `offset ${v.toFixed(2)} tile`; api.invalidate(); }, v => v.toFixed(2));
  range('cafe-mortar', v => { mortar = v; api.invalidate(); }, v => v + ' px');
  toggle('cafe-ruler', on => { ruler = on; api.invalidate(); });
})();

/* ------------------------------------------------------------------
   IV — Scintillating / Hermann grid
------------------------------------------------------------------ */
(function grid() {
  let mode = 'scint', size = 56, street = .22;
  const api = stage($('#grid'), (ctx, w, h) => {
    const sw = Math.max(2, size * street), ox = ((w % size) + size) / 2, oy = ((h % size) + size) / 2;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = mode === 'scint' ? '#5b5b57' : '#f4f1e8';
    for (let x = ox - size; x < w + size; x += size) ctx.fillRect(x - sw / 2, 0, sw, h);
    for (let y = oy - size; y < h + size; y += size) ctx.fillRect(0, y - sw / 2, w, sw);
    if (mode === 'scint') {
      ctx.fillStyle = '#fbfaf5';
      for (let x = ox - size; x < w + size; x += size) for (let y = oy - size; y < h + size; y += size) {
        ctx.beginPath(); ctx.arc(x, y, sw * .78, 0, TAU); ctx.fill();
      }
    }
  });
  $$('[data-mode]', $('#p4')).forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    $$('[data-mode]', $('#p4')).forEach(o => o.setAttribute('aria-pressed', o === b));
    $('#grid-read').textContent = mode === 'scint' ? 'scintillating' : 'hermann';
    api.invalidate();
  }));
  range('grid-size', v => { size = v; api.invalidate(); });
  range('grid-street', v => { street = v; api.invalidate(); }, v => v.toFixed(2));
})();

/* ------------------------------------------------------------------
   V — Checker shadow (A and B are identical)
------------------------------------------------------------------ */
(function checker() {
  const cv = $('#checker'), DARK = 110, LIGHT = 176, SH = .375; // 176 × (1 − .375) = 110
  const A = { u: 5, v: 2 }, B = { u: 5, v: 3 };
  let iso = 0, isoT = 0, g = null;

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  const api = stage(cv, (ctx, w, h, s) => {
    const c = Math.min(w / 12.6, h / 7), ox = (w - 12 * c) / 2 + 4 * c, oy = (h - 4.4 * c) / 2 + .55 * c;
    const P = (u, v) => [ox + u * c - .5 * c * v, oy + .55 * c * v];
    const board = dx => ctx.setTransform(s.dpr * c, 0, -.5 * c * s.dpr, .55 * c * s.dpr, (ox + (dx || 0)) * s.dpr, oy * s.dpr);
    g = { P, c, s: s.dpr };

    ctx.fillStyle = '#d6d0c2'; ctx.fillRect(0, 0, w, h);
    board();
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
      const l = (u + v) % 2 === 0 ? LIGHT : DARK; ctx.fillStyle = `rgb(${l},${l},${l})`; ctx.fillRect(u, v, 1.003, 1.003);
    }
    // soft shadow: draw the shape far off-canvas and let shadowOffset bring only the blur back
    ctx.save();
    board(-10000);
    ctx.shadowColor = `rgba(0,0,0,${SH})`; ctx.shadowBlur = .14 * c * s.dpr; ctx.shadowOffsetX = 10000 * s.dpr;
    ctx.fillStyle = '#000'; rr(ctx, 1.4, 2.97, 6.3, 2.1, .7); ctx.fill();
    ctx.restore();

    // cylinder
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    const [bx, by] = P(1.4, 4.0), rx = .72 * c, ry = rx * .55, H = 2.5 * c;
    const gr = ctx.createLinearGradient(bx - rx, 0, bx + rx, 0);
    gr.addColorStop(0, '#ece8dc'); gr.addColorStop(.35, '#bdb8aa'); gr.addColorStop(1, '#3e3d38');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(bx - rx, by - H); ctx.lineTo(bx - rx, by);
    ctx.ellipse(bx, by, rx, ry, 0, Math.PI, 0, true); ctx.lineTo(bx + rx, by - H); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f3f0e6'; ctx.beginPath(); ctx.ellipse(bx, by - H, rx, ry, 0, 0, TAU); ctx.fill();

    // isolation veil
    if (Math.abs(iso - isoT) > .002) { iso += (isoT - iso) * .16; api.invalidate(); } else iso = isoT;
    if (iso > .002) {
      board(); ctx.globalAlpha = iso; ctx.fillStyle = '#d6d0c2';
      ctx.beginPath(); ctx.rect(-40, -40, 90, 90); ctx.rect(A.u, A.v, 1, 1); ctx.rect(B.u, B.v, 1, 1); ctx.fill('evenodd');
      ctx.fillStyle = `rgb(${DARK},${DARK},${DARK})`; ctx.fillRect(A.u, A.v, 1.003, 1); ctx.fillRect(B.u, B.v, 1, 1.003);
      ctx.globalAlpha = 1; ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    }
    // labels
    ctx.font = `500 ${Math.round(c * .3)}px "IBM Plex Mono",monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [k, q] of [['A', A], ['B', B]]) {
      const [x, y] = P(q.u + .5, q.v + .5);
      ctx.fillStyle = C.paper; ctx.beginPath(); ctx.arc(x, y, c * .22, 0, TAU); ctx.fill();
      ctx.fillStyle = C.ink; ctx.fillText(k, x, y + 1);
    }
  });
  const got = {};
  cv.addEventListener('pointerdown', e => {
    if (!g) return;
    const q = local(e, cv), px = cv.getContext('2d').getImageData(Math.round(q.x * g.s), Math.round(q.y * g.s), 1, 1).data;
    // which cell was clicked? (invert the affine board transform)
    const c = g.c, [x0, y0] = g.P(0, 0), v = (q.y - y0) / (.55 * c), u = (q.x - x0 + .5 * c * v) / c;
    const hit = k => Math.floor(u) === k.u && Math.floor(v) === k.v;
    const key = hit(A) ? 'A' : hit(B) ? 'B' : null; if (!key) return;
    got[key] = `${px[0]}`;
    $('#checker-read').textContent = `A = ${got.A ?? '?'}  B = ${got.B ?? '?'}  (grey level, 0–255)`;
  });
  toggle('checker-iso', on => { isoT = on ? 1 : 0; api.invalidate(); });
})();

/* ------------------------------------------------------------------
   VI — Lilac chaser
------------------------------------------------------------------ */
(function lilac() {
  const cv = $('#lilac'); let speed = 10, dir = 1, gap = true;
  stage(cv, (ctx, w, h, s) => {
    ctx.fillStyle = '#b9b9b6'; ctx.fillRect(0, 0, w, h);
    const m = Math.min(w, h), R = m * .35, r = m * .075, n = 12;
    const idx = (((Math.floor(s.time * speed) * dir) % n) + n) % n;
    for (let i = 0; i < n; i++) {
      if (gap && i === idx) continue;
      const a = i / n * TAU - Math.PI / 2, x = w / 2 + Math.cos(a) * R, y = h / 2 + Math.sin(a) * R;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, '#e98fd3'); g.addColorStop(.72, '#e98fd3'); g.addColorStop(1, 'rgba(233,143,211,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
    const q = m * .022; ctx.strokeStyle = '#111'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w / 2 - q, h / 2); ctx.lineTo(w / 2 + q, h / 2); ctx.moveTo(w / 2, h / 2 - q); ctx.lineTo(w / 2, h / 2 + q); ctx.stroke();
  }, { animated: true });
  range('lilac-speed', v => { speed = v; $('#lilac-read').textContent = v + ' steps / s'; });
  $('#lilac-dir').addEventListener('click', () => { dir *= -1; });
  toggle('lilac-gap', on => { gap = on; }, ['Gap: off', 'Gap: on']);
})();

/* ------------------------------------------------------------------
   VII — Kanizsa triangle
------------------------------------------------------------------ */
(function kanizsa() {
  let k = 1, edge = false, breathe = false;
  const slider = $('#kz-open');
  const api = stage($('#kanizsa'), (ctx, w, h, s) => {
    if (breathe) { k = .5 + .5 * Math.sin(s.time * 1.1 - 1.3); slider.value = k; $('#kz-open-o').textContent = Math.round(k * 100); }
    $('#kanizsa-read').textContent = `notch ${Math.round(k * 100)} %`;
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, w, h);
    const m = Math.min(w, h), R = m * .36, cx = w / 2, cy = h / 2 + m * .02, side = R * Math.sqrt(3), pr = side * .235;
    const pt = (a, rad = R) => [cx + Math.cos(a * Math.PI / 180) * rad, cy + Math.sin(a * Math.PI / 180) * rad];
    ctx.fillStyle = C.ink;
    for (const a of [-90, 30, 150]) {
      const [x, y] = pt(a), dir = Math.atan2(cy - y, cx - x), mouth = Math.PI / 3 * k;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, pr, dir + mouth / 2, dir - mouth / 2 + TAU); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = C.ink; ctx.lineWidth = m * .011; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    const dv = [90, 210, 330].map(a => pt(a));
    dv.forEach((v, i) => {
      ctx.beginPath();
      for (const o of [dv[(i + 1) % 3], dv[(i + 2) % 3]]) {
        const d = Math.hypot(o[0] - v[0], o[1] - v[1]), L = side * .34;
        ctx.moveTo(v[0], v[1]);
        ctx.lineTo(v[0] + (o[0] - v[0]) / d * L, v[1] + (o[1] - v[1]) / d * L);
      }
      ctx.stroke();
    });
    if (edge) {
      ctx.setLineDash([6, 6]); ctx.strokeStyle = C.red; ctx.lineWidth = 1.5; ctx.beginPath();
      [-90, 30, 150].forEach((a, i) => { const [x, y] = pt(a); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    }
  }, { animated: true });
  range('kz-open', v => { if (!breathe) { k = v; api.invalidate(); } }, v => Math.round(v * 100));
  toggle('kz-breathe', on => { breathe = on; api.invalidate(); });
  toggle('kz-edge', on => { edge = on; api.invalidate(); });
})();

/* ------------------------------------------------------------------
   VIII — Shepard tables
------------------------------------------------------------------ */
(function shepard() {
  let rot = 0, ghost = false;
  // one parallelogram, defined once, reused for both tables
  const BASE = [[0, 0], [104, 16], [104 + 74, 16 - 142], [74, -142]]; // short edge b=(104,16), long edge a=(74,-142)
  const cen = BASE.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4], [0, 0]);
  const shape = deg => BASE.map(([x, y]) => {
    const a = deg * Math.PI / 180, dx = x - cen[0], dy = y - cen[1];
    return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
  });
  function table(ctx, pts, cx, cy, sc, leg, thick) {
    const P = pts.map(([x, y]) => [cx + x * sc, cy + y * sc]);
    const order = [...P].sort((a, b) => a[1] - b[1]);
    ctx.lineCap = 'butt';
    for (const [x, y] of order) {           // legs, back to front
      ctx.strokeStyle = '#4a2f1b'; ctx.lineWidth = 11 * sc; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + leg * sc); ctx.stroke();
      ctx.fillStyle = '#2a1a0f'; ctx.fillRect(x - 5.5 * sc, y + leg * sc - 7 * sc, 11 * sc, 7 * sc);
    }
    const poly = (pp, dy) => { ctx.beginPath(); pp.forEach(([x, y], i) => i ? ctx.lineTo(x, y + dy) : ctx.moveTo(x, y + dy)); ctx.closePath(); };
    ctx.fillStyle = '#7a4d28'; poly(P, thick * sc); ctx.fill();          // slab edge
    poly(P, thick * sc); ctx.strokeStyle = '#7a4d28'; ctx.lineWidth = 1; ctx.stroke();
    const mnY = Math.min(...P.map(p => p[1])), mxY = Math.max(...P.map(p => p[1]));
    const gr = ctx.createLinearGradient(0, mnY, 0, mxY); gr.addColorStop(0, '#d9a066'); gr.addColorStop(1, '#bd8247');
    ctx.fillStyle = gr; poly(P, 0); ctx.fill();
    // faint grain lines along the long edge
    ctx.save(); poly(P, 0); ctx.clip(); ctx.strokeStyle = 'rgba(90,55,25,.13)'; ctx.lineWidth = 1;
    const e = [P[3][0] - P[0][0], P[3][1] - P[0][1]];
    for (let i = 1; i < 9; i++) { const f = i / 9; ctx.beginPath(); ctx.moveTo(P[0][0] + (P[1][0] - P[0][0]) * f, P[0][1] + (P[1][1] - P[0][1]) * f);
      ctx.lineTo(P[0][0] + (P[1][0] - P[0][0]) * f + e[0], P[0][1] + (P[1][1] - P[0][1]) * f + e[1]); ctx.stroke(); }
    ctx.restore();
    return P;
  }
  const api = stage($('#shepard'), (ctx, w, h) => {
    ctx.fillStyle = '#1d1b17'; ctx.fillRect(0, 0, w, h);
    const sc = Math.min(w / 640, h / 520), top = h * .5 - 25 * sc;
    // floor line
    ctx.fillStyle = '#26231e'; ctx.fillRect(0, h * .78, w, h);
    table(ctx, shape(0), w * .27, top, sc, 125, 14);
    const right = shape(90 - rot);
    table(ctx, right, w * .73, top, sc, 125, 14);
    if (ghost) {
      const gp = shape(0).map(([x, y]) => [w * .73 + x * sc, top + y * sc]);
      ctx.setLineDash([7, 5]); ctx.strokeStyle = C.red; ctx.lineWidth = 2; ctx.beginPath();
      gp.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    }
  });
  range('sh-rot', v => { rot = v; $('#shepard-read').textContent = v >= 90 ? 'same orientation — identical' : `right top rotated ${90 - v}°`; api.invalidate(); }, v => v + '°');
  toggle('sh-ghost', on => { ghost = on; api.invalidate(); });
})();

/* ------------------------------------------------------------------
   IX — Necker cube
------------------------------------------------------------------ */
(function necker() {
  const cv = $('#necker');
  const V = []; for (let i = 0; i < 8; i++) V.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
  const E = []; for (let i = 0; i < 8; i++) for (const b of [1, 2, 4]) if (!(i & b)) E.push([i, i | b]);
  let ry = .7, rx = -.5, depth = 0, drag = null;
  const api = stage(cv, (ctx, w, h, s, dt) => {
    if (!drag && !state.paused) { ry += dt * .55; rx += Math.sin(s.time * .23) * dt * .12; }
    ctx.fillStyle = C.ink; ctx.fillRect(0, 0, w, h);
    const m = Math.min(w, h), S = m * .21, cx = w / 2, cy = h / 2;
    const sy = Math.sin(ry), cyy = Math.cos(ry), sx = Math.sin(rx), cxx = Math.cos(rx);
    const Q = V.map(([x, y, z]) => {
      const x1 = x * cyy + z * sy, z1 = -x * sy + z * cyy, y2 = y * cxx - z1 * sx, z2 = y * sx + z1 * cxx;
      return [cx + x1 * S, cy + y2 * S, z2];
    });
    ctx.lineCap = 'round';
    const w0 = m * .012;
    E.map(([a, b]) => [a, b, (Q[a][2] + Q[b][2]) / 2]).sort((p, q) => p[2] - q[2]).forEach(([a, b, z]) => {
      const near = z / 1.45; // −1 … 1
      ctx.lineWidth = Math.max(.35, 1 + depth * .85 * near) * w0;
      ctx.globalAlpha = 1 - depth * .6 * (1 - near) / 2;
      ctx.strokeStyle = C.paper; ctx.beginPath(); ctx.moveTo(Q[a][0], Q[a][1]); ctx.lineTo(Q[b][0], Q[b][1]); ctx.stroke();
    });
    ctx.globalAlpha = 1; ctx.fillStyle = C.red;
    Q.forEach(q => { ctx.beginPath(); ctx.arc(q[0], q[1], w0 * .75, 0, TAU); ctx.fill(); });
  }, { animated: true });
  let lx, ly;
  cv.addEventListener('pointerdown', e => { drag = e.pointerId; lx = e.clientX; ly = e.clientY; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (drag !== e.pointerId) return;
    ry += (e.clientX - lx) * .012; rx = Math.max(-1.4, Math.min(1.4, rx - (e.clientY - ly) * .012)); lx = e.clientX; ly = e.clientY;
    api.invalidate();
  });
  const end = e => { if (drag === e.pointerId) drag = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  range('nk-depth', v => { depth = v; $('#necker-read').textContent = `depth cue ${v.toFixed(2)}`; }, v => v.toFixed(2));
})();
