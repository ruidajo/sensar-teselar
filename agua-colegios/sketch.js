let geo;
let puntos = [];
let bounds, fitK = 1;
let view = { x: 0, y: 0, k: 1 };
let hovered = null, lastHovered = null, selected = null;
let dragging = false, moved = 0, pressOnCanvas = false;
let pulsos = [];//feedback visual

// drumset. Se asignan por consumo per cápita (HCONS_PERCAPITA_2025)
const FAMILIAS = [
  { corto: 'Click', nombre: 'Click · sin dato o consumo 0', color: '#b8c0d0' },
  { corto: 'Hat',   nombre: 'Hat · consumo per cápita bajo',   color: '#4cc9f0' },
  { corto: 'Zap',   nombre: 'Zap · medio-bajo',                color: '#80ed99' },
  { corto: 'Snare', nombre: 'Snare · medio-alto',              color: '#ffb703' },
  { corto: 'Kick',  nombre: 'Kick · consumo per cápita alto',  color: '#ff5d73' }
];
const activas = [true, true, true, true, true];

// Audio
let ctxA, master, audioOn = false, muted = false, ultimoDisparo = 0;
const COOLDOWN_MS = 30;//mouse rápido, menos interact

//Point, EPSG:3857 en metros
//Mercator - proyeccion osm
function preload() { geo = loadJSON('consumoagua-12-2025.geojson'); }

function setup() {
  createCanvas(windowWidth, windowHeight);
  parseGeo();
  fitView();
  buildLegend();
  actualizarAudioUI();
}

// Datos
// EPSG:3857 ya es plano metros
function parseGeo() {
  const feats = geo.features.filter(f => f.geometry && f.geometry.type === 'Point');
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let lmMin = Infinity, lmMax = -Infinity, lvMin = Infinity, lvMax = -Infinity;

  for (const f of feats) {
    const [x, y] = f.geometry.coordinates, pr = f.properties;
    const p = { id: pr.OBJECTID, props: pr, x, y: -y,
                mat: pr.Matricula_2025, pc: pr.HCONS_PERCAPITA_2025, ht: pr.HTCONSUM_2025 || 0 };
    puntos.push(p);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    if (p.mat > 0) { const l = Math.log10(p.mat); lmMin = Math.min(lmMin, l); lmMax = Math.max(lmMax, l); }
    const lv = Math.log10(1 + p.ht); lvMin = Math.min(lvMin, lv); lvMax = Math.max(lvMax, lv);
  }
  bounds = { minX, minY, maxX, maxY };

  // cuartiles del consumo per cápita (solo valores > 0)
  const pos = puntos.map(p => p.pc).filter(v => v > 0).sort((a, b) => a - b);
  const q = [0.25, 0.5, 0.75].map(c => pos[Math.floor(pos.length * c)]);

  for (const p of puntos) {
    p.matN = p.mat > 0 ? (Math.log10(p.mat) - lmMin) / (lmMax - lmMin) : 0.5; // 0..1
    p.velN = (Math.log10(1 + p.ht) - lvMin) / (lvMax - lvMin);// 0..1
    p.fam = !(p.pc > 0) ? 0 : p.pc <= q[0] ? 1 : p.pc <= q[1] ? 2 : p.pc <= q[2] ? 3 : 4;
    p.pan = ((p.x - minX) / (maxX - minX) * 2 - 1) * 0.8; // occidente -> oriente
    p.vel = 0.45 + 0.55 * p.velN;
    p.r = 3 + 5 * p.matN;// radio visual
  }
}

function fitView(margin = 60) {
  const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
  fitK = Math.min((width - margin * 2) / w, (height - margin * 2) / h);
  view.k = fitK;
  view.x = width / 2 - (bounds.minX + w / 2) * view.k;
  view.y = height / 2 - (bounds.minY + h / 2) * view.k;
}

const sx = p => p.x * view.k + view.x;
const sy = p => p.y * view.k + view.y;

function draw() {
  background('#0e1118');
  hovered = findHover();
  if (hovered !== lastHovered) {
    if (hovered) { tocar(hovered); pulsos.push({ p: hovered, t0: millis() }); }
    lastHovered = hovered;
  }
  cursor(hovered ? HAND : (dragging ? 'grabbing' : ARROW));

  noStroke();
  for (const p of puntos) {
    if (!activas[p.fam]) continue;
    const x = sx(p), y = sy(p);
    if (x < -20 || y < -20 || x > width + 20 || y > height + 20) continue;
    const c = color(FAMILIAS[p.fam].color);
    const activo = p === hovered || p === selected;
    fill(red(c), green(c), blue(c), activo ? 255 : 170);
    circle(x, y, activo ? p.r * 2 + 6 : p.r * 2);
  }

  // feedbakc visual
  noFill();
  pulsos = pulsos.filter(u => millis() - u.t0 < 350);
  for (const u of pulsos) {
    const t = (millis() - u.t0) / 350, c = color(FAMILIAS[u.p.fam].color);
    stroke(red(c), green(c), blue(c), 255 * (1 - t));
    strokeWeight(2);
    circle(sx(u.p), sy(u.p), u.p.r * 2 + 10 + t * 40);
  }

  const foco = hovered || selected;
  if (foco) etiqueta(foco);
}

function etiqueta(p) {
  const txt = `${p.props.NOMBRE_SED} · ${FAMILIAS[p.fam].corto}`;
  textSize(12); textAlign(LEFT, CENTER);
  const w = textWidth(txt) + 14;
  const x = Math.min(sx(p) + 12, width - w - 6), y = Math.max(sy(p) - 30, 6);
  noStroke(); fill(10, 13, 20, 235);
  rect(x, y, w, 22, 6);
  fill(255); text(txt, x + 7, y + 11);
}

function findHover() {
  if (dragging || !mouseInCanvas()) return null;
  let mejor = null, dMin = Infinity;
  for (const p of puntos) {
    if (!activas[p.fam]) continue;
    const d = dist(mouseX, mouseY, sx(p), sy(p));
    if (d < Math.max(9, p.r + 4) && d < dMin) { dMin = d; mejor = p; }
  }
  return mejor;
}

// glitch generado por punto
function initAudio() {
  ctxA = getAudioContext();// contexto - p5.sound
  master = ctxA.createGain();
  master.gain.value = 0.8;
  const comp = ctxA.createDynamicsCompressor();// menos saturación
  master.connect(comp);
  comp.connect(ctxA.destination);
}

//el mismo punto siempre suena igual
function rng(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generarBuffer(p) {
  const sr = ctxA.sampleRate;
  const r = rng(p.id * 2654435761 + 12345);
  const R = (a, b) => a + (b - a) * r();
  const tono = 1.35 - 0.7 * p.matN;// colegios grandes - mas grave
  const dur = [R(0.05, 0.10), R(0.03, 0.07), R(0.07, 0.14), R(0.10, 0.18), R(0.18, 0.28)][p.fam];
  const n = Math.floor(dur * sr);
  const d = new Float32Array(n);
  let ph = 0, prev = 0, prev2 = 0;

  // Timbre de sonido
  const dobleGolpe = R(0.01, 0.03), usaDoble = r() < 0.5;
  const barrido = R(-2, 3), f0 = R(300, 1800) * tono;
  const densidad = R(0.01, 0.12);
  for (let i = 0; i < n; i++) {
    const t = i / sr, w = r() * 2 - 1;
    let v = 0;
    switch (p.fam) {
      case 0://impulsos dispersos - click sound
        v = r() < densidad * Math.exp(-t / (dur * 0.5)) ? (r() < 0.5 ? 1 : -1) * R(0.4, 1) : 0;
        if (i === 0) v = 1;//al menos un impulso
        break;
      case 1: {//ruido filtrado pasa-altos - hat
        const hp = w - prev; prev = w;
        const hp2 = hp - prev2; prev2 = hp;
        v = hp2 * 0.5 * Math.exp(-t / (dur * 0.22));
        if (usaDoble && t > dobleGolpe) v += hp2 * 0.35 * Math.exp(-(t - dobleGolpe) / (dur * 0.2));
        break;
      }
      case 2: {//cuadrada con barrido - zap
        const f = f0 * Math.exp(barrido * t / dur);
        ph += 2 * Math.PI * f / sr;
        v = (Math.sin(ph) > 0 ? 1 : -1) * 0.6 * Math.exp(-t / (dur * 0.45));
        break;
      }
      case 3: {//ruido + tono - snare
        ph += 2 * Math.PI * (R(0, 0) + 185 * tono) / sr;
        v = w * 0.7 * Math.exp(-t / (dur * 0.28)) + Math.sin(ph) * 0.5 * Math.exp(-t / (dur * 0.15));
        break;
      }
    default: {//sin con caida de tono (pd) - kick
        const f = (48 + 140 * Math.exp(-t / 0.028)) * tono;
        ph += 2 * Math.PI * f / sr;
        v = Math.sin(ph) * Math.exp(-t / (dur * 0.38)) + (t < 0.002 ? w * 0.5 : 0);
      }
    }
    d[i] = v;
  }

  //glitch: repite fragmento corto
  if (r() < 0.65) {
    const gl = Math.max(8, Math.floor(R(0.003, 0.02) * sr));
    const s0 = Math.floor(R(0, 0.4) * n), reps = Math.floor(R(2, 6));
    for (let k = 1; k <= reps; k++)
      for (let i = 0; i < gl; i++) {
        const dst = s0 + k * gl + i;
        if (dst < n) d[dst] = d[s0 + i] * (1 - k * 0.12);
      }
  }
  // glitch: frecuencia de muestreo + bitcrush
  const hold = Math.floor(R(1, 14)), bits = Math.floor(R(3, 8)), niveles = Math.pow(2, bits);
  let held = 0;
  for (let i = 0; i < n; i++) {
    if (i % hold === 0) held = d[i];
    d[i] = Math.round(held * niveles) / niveles;
  }
  // glitch - dropouts
  const nDrops = Math.floor(R(0, 4));
  for (let k = 0; k < nDrops; k++) {
    const a = Math.floor(R(0.05, 0.9) * n), len = Math.floor(R(0.001, 0.01) * sr);
    for (let i = a; i < Math.min(n, a + len); i++) d[i] = 0;
  }
  // evitar clics
  let pico = 0;
  for (let i = 0; i < n; i++) pico = Math.max(pico, Math.abs(d[i]));
  const g = pico > 0 ? 0.9 / pico : 1, fade = Math.floor(0.002 * sr);
  for (let i = 0; i < n; i++) {
    d[i] *= g;
    if (i > n - fade) d[i] *= (n - i) / fade;
  }

  const buf = ctxA.createBuffer(1, n, sr);
  buf.copyToChannel(d, 0);
  return buf;
}

function tocar(p) {
  if (!audioOn || muted || !p) return;
  const ahora = millis();
  if (ahora - ultimoDisparo < COOLDOWN_MS) return;
  ultimoDisparo = ahora;
  if (!p.buf) p.buf = generarBuffer(p);// se genera la primera vez y se guarda

  const src = ctxA.createBufferSource();
  src.buffer = p.buf;
  const gain = ctxA.createGain(); gain.gain.value = p.vel;
  const pan = ctxA.createStereoPanner(); pan.pan.value = p.pan;
  src.connect(gain); gain.connect(pan); pan.connect(master);
  src.start();
}

function actualizarAudioUI() {
  const el = document.getElementById('audio');
  if (!el) return;
  el.className = !audioOn ? '' : (muted ? 'mute' : 'on');
  el.textContent = !audioOn ? 'Clic activar el sonido'
                 : muted ? 'Silenciado (M para activar)' : 'Sonido activado';
}

// Interacción
function mouseInCanvas() { return mouseX >= 0 && mouseY >= 0 && mouseX <= width && mouseY <= height; }

function mousePressed(e) {
  pressOnCanvas = e && e.target === drawingContext.canvas;
  moved = 0;
  if (!audioOn) {// actvar audio con click
    userStartAudio().then(() => { initAudio(); audioOn = true; actualizarAudioUI(); });
  }
}

function mouseDragged() {
  if (!pressOnCanvas) return;
  dragging = true;
  moved += abs(mouseX - pmouseX) + abs(mouseY - pmouseY);
  view.x += mouseX - pmouseX;
  view.y += mouseY - pmouseY;
}

function mouseReleased() {
  if (pressOnCanvas && moved < 4) {
    selected = hovered === selected ? null : hovered;
    mostrarInfo(selected);
  }
  dragging = false; pressOnCanvas = false;
}

function mouseWheel(e) {
  if (e.target !== drawingContext.canvas) return;
  const f = e.delta > 0 ? 0.9 : 1.1;
  const wx = (mouseX - view.x) / view.k, wy = (mouseY - view.y) / view.k;
  view.k = constrain(view.k * f, fitK * 0.7, fitK * 400);
  view.x = mouseX - wx * view.k;
  view.y = mouseY - wy * view.k;
  return false;
}

function keyPressed() {
  if (key === 'r' || key === 'R') fitView();
  if (key === 'm' || key === 'M') { muted = !muted; actualizarAudioUI(); }
  if (key === 'Escape') { selected = null; mostrarInfo(null); }
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); fitView(); }

// UI - HTML
function buildLegend() {
  const cont = document.getElementById('legend-items');
  FAMILIAS.forEach((fam, i) => {
    const n = puntos.filter(p => p.fam === i).length;
    const b = document.createElement('button');
    b.innerHTML = `<i style="background:${fam.color}"></i>${fam.nombre} (${n})`;
    b.onclick = () => {
      activas[i] = !activas[i];
      b.classList.toggle('off', !activas[i]);
      if (selected && !activas[selected.fam]) { selected = null; mostrarInfo(null); }
    };
    cont.appendChild(b);
  });
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = v => (v == null ? '—' : Number(v).toLocaleString('es-CO', { maximumFractionDigits: 1 }));

function mostrarInfo(p) {
  const el = document.getElementById('info');
  if (!p) { el.style.display = 'none'; return; }
  const pr = p.props;
  el.innerHTML = `
    <h2>${esc(pr.NOMBRE_SED)}</h2>
    <div class="sub">${esc(pr.NOMBRE_EST)}</div>
    <dl>
      <dt>Localidad</dt><dd>${esc(pr.COD_LOCA)}</dd>
      <dt>Matrícula 2025</dt><dd>${num(pr.Matricula_2025)}</dd>
      <dt>HPCONSUM 2025</dt><dd>${num(pr.HPCONSUM_2025)}</dd>
      <dt>HTCONSUM 2025</dt><dd>${num(pr.HTCONSUM_2025)}</dd>
      <dt>Per cápita</dt><dd>${num(pr.HCONS_PERCAPITA_2025)}</dd>
      <dt>Voz</dt><dd>${FAMILIAS[p.fam].corto}</dd>
    </dl>`;
  el.style.display = 'block';
}
