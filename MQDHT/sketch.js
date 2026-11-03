// Mapeo de sensores (JSON: ms, lat, lon, temp, hum, mq) en p5.js
// Combina:
//  - sketch de tramos: pentatónica, zoom/arrastre, selección, panel de info
//  - sketch de puntos: hover que dispara sonido, pulsos visuales, leyenda
//  - sketch WiGLE: recorrido en el tiempo (play/pausa, modo de tiempo, línea de tiempo)

const DATA_FILE = 'data.json';
const STEP = 0.5;            // s entre muestras en modo "constante"
const COOLDOWN_MS = 40;      // evita ráfagas al mover rápido el ratón

// pentatónica mayor
const ESCALA = [0, 2, 4, 7, 9];
const NOMBRES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Cada variable: una voz, un color, una zona de registro y una forma visual
const VARS = {
  temp: { label: 'Temperatura', unit: '°C',  hex: '#ff8a65', wave: 'sine',     base: 48, oct: 3, amp: 0.28, invert: false, dec: 1 },
  hum:  { label: 'Humedad',     unit: '%',   hex: '#4fc3f7', wave: 'triangle', base: 36, oct: 3, amp: 0.30, invert: false, dec: 0 },
  mq:   { label: 'Gas (MQ)',    unit: 'raw', hex: '#a5d6a7', wave: 'square',   base: 60, oct: 3, amp: 0.10, invert: false, dec: 0 }
};
const KEYS = Object.keys(VARS);
for (const k of KEYS) VARS[k].rgb = [1, 3, 5].map(i => parseInt(VARS[k].hex.slice(i, i + 2), 16));

// Estado
let raw;
let puntos = [];
let bounds, fitK = 1, cosLat = 1;
let view = { x: 0, y: 0, k: 1 };
const rango = {};                                  // {temp:{min,max}, ...}
const activas = { temp: true, hum: true, mq: true };
const botones = {};

let hovered = null, lastHovered = null, selected = null;
let dragging = false, moved = 0, pressOnCanvas = false;
let pulsos = [];

// Reproducción
let steady = true, running = false, playhead = 0, duration = 0, speed = 4;

// Audio
let voices = {};
let audioOn = false, audioStarting = false, muted = false, ultimoDisparo = 0;

// ---------------------------------------------------------------- carga
function preload() {
  raw = loadJSON(DATA_FILE);
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont('sans-serif');
  crearVoces();
  conectarUI();
  setData(Array.isArray(raw) ? raw : Object.values(raw));
  actualizarAudioUI();
}

function parsePuntos(arr) {
  const data = arr
    .filter(d => d && isFinite(d.lat) && isFinite(d.lon) && isFinite(d.ms))
    .sort((a, b) => a.ms - b.ms);
  if (!data.length) return [];
  const t0 = data[0].ms;
  return data.map((d, i) => ({
    i, ms: d.ms, lat: +d.lat, lon: +d.lon,
    temp: +d.temp, hum: +d.hum, mq: +d.mq,
    t: (d.ms - t0) / 1000,      // tiempo real de la captura
    tS: i * STEP,               // tiempo constante
    played: false
  }));
}

function setData(arr) {
  const nuevos = parsePuntos(arr);
  if (!nuevos.length) { alert('El JSON no contiene muestras válidas (ms, lat, lon, temp, hum, mq).'); return; }
  puntos = nuevos;
  running = false; playhead = 0; hovered = lastHovered = selected = null; pulsos = [];
  mostrarInfo(null);

  // rangos por variable, para normalizar tono y tamaño
  for (const k of KEYS) {
    const vals = puntos.map(p => p[k]).filter(isFinite);
    rango[k] = { min: Math.min(...vals), max: Math.max(...vals) };
  }

  // proyección: corrección horizontal con la latitud media
  const latMedia = puntos.reduce((s, p) => s + p.lat, 0) / puntos.length;
  cosLat = Math.cos(radians(latMedia));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of puntos) {
    p.x = p.lon * cosLat; p.y = -p.lat;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  bounds = { minX, minY, maxX, maxY };

  // normalización, nota MIDI por variable y paneo occidente → oriente
  for (const p of puntos) {
    p.n = {}; p.midi = {}; p.nota = {};
    for (const k of KEYS) {
      const r = rango[k], v = VARS[k];
      let n = (p[k] - r.min) / ((r.max - r.min) || 1);
      if (v.invert) n = 1 - n;
      p.n[k] = constrain(n, 0, 1);
      const total = ESCALA.length * v.oct;
      const paso = Math.round(p.n[k] * (total - 1));
      p.midi[k] = v.base + 12 * Math.floor(paso / ESCALA.length) + ESCALA[paso % ESCALA.length];
      p.nota[k] = NOMBRES[p.midi[k] % 12] + (Math.floor(p.midi[k] / 12) - 1);
    }
    p.pan = ((p.x - minX) / ((maxX - minX) || 1) * 2 - 1) * 0.8;
  }

  actualizarDuracion();
  fitView();
  buildLegend();
  sincronizarUI();
}

// ---------------------------------------------------------------- audio
function crearVoces() {
  for (const k of KEYS) {
    const v = VARS[k];
    const osc = new p5.Oscillator(v.wave);
    const env = new p5.Envelope();
    env.setADSR(0.01, 0.15, 0.0, 0.12);
    env.setRange(v.amp, 0);
    osc.amp(0);
    osc.start();
    voices[k] = { osc, env };
  }
}

function asegurarAudio() {
  if (audioOn || audioStarting) return;
  audioStarting = true;
  userStartAudio().then(() => { audioOn = true; actualizarAudioUI(); });
}

function tocar(p, conCooldown = false) {
  if (!audioOn || muted || !p) return;
  if (conCooldown) {
    const ahora = millis();
    if (ahora - ultimoDisparo < COOLDOWN_MS) return;
    ultimoDisparo = ahora;
  }
  for (const k of KEYS) {
    if (!activas[k]) continue;
    const v = voices[k];
    v.osc.freq(midiToFreq(p.midi[k]));
    v.osc.pan(p.pan);
    v.env.play(v.osc);
  }
}

function actualizarAudioUI() {
  const el = document.getElementById('audio');
  if (!el) return;
  el.className = !audioOn ? '' : (muted ? 'mute' : 'on');
  el.textContent = !audioOn ? 'Clic para activar el sonido'
                 : muted ? 'Silenciado (M para activar)' : 'Sonido activado';
}

// ---------------------------------------------------------------- tiempo
const timeOf = p => (steady ? p.tS : p.t);

function actualizarDuracion() {
  duration = Math.max(...puntos.map(timeOf));
}

function reiniciarReproduccion() {
  playhead = 0;
  for (const p of puntos) p.played = false;
  pulsos = [];
}

// Mover el cursor sin disparar notas (arrastrar la barra)
function irA(t) {
  playhead = constrain(t, 0, duration);
  for (const p of puntos) p.played = timeOf(p) <= playhead;
}

function togglePlay() {
  asegurarAudio();
  if (!running && playhead >= duration) reiniciarReproduccion();
  running = !running;
  sincronizarUI();
}

function toggleModo() {
  steady = !steady;
  actualizarDuracion();
  reiniciarReproduccion();
  sincronizarUI();
}

// posición interpolada del cursor sobre el recorrido
function posCursor() {
  let j = -1;
  for (let i = 0; i < puntos.length; i++) if (timeOf(puntos[i]) <= playhead) j = i;
  if (j < 0) return null;
  const a = puntos[j];
  if (j === puntos.length - 1) return { x: sx(a), y: sy(a) };
  const b = puntos[j + 1];
  const u = constrain((playhead - timeOf(a)) / ((timeOf(b) - timeOf(a)) || 1), 0, 1);
  return { x: lerp(sx(a), sx(b), u), y: lerp(sy(a), sy(b), u) };
}

// ---------------------------------------------------------------- vista
function fitView() {
  if (!bounds) return;
  const m = { l: 290, r: 290, t: 60, b: 110 };
  const w = (bounds.maxX - bounds.minX) || 1e-9, h = (bounds.maxY - bounds.minY) || 1e-9;
  const aw = Math.max(width - m.l - m.r, 100), ah = Math.max(height - m.t - m.b, 100);
  fitK = Math.min(aw / w, ah / h);
  view.k = fitK;
  view.x = m.l + aw / 2 - (bounds.minX + w / 2) * view.k;
  view.y = m.t + ah / 2 - (bounds.minY + h / 2) * view.k;
}

const sx = p => p.x * view.k + view.x;
const sy = p => p.y * view.k + view.y;

// ---------------------------------------------------------------- dibujo
function draw() {
  background('#0e1118');
  if (!puntos.length) return;

  if (running) {
    playhead += constrain(deltaTime, 0, 100) / 1000 * speed;
    for (const p of puntos) {
      if (!p.played && timeOf(p) <= playhead) {
        p.played = true;
        tocar(p);
        pulsos.push({ p, t0: millis() });
      }
    }
    if (playhead > duration + 1.5) { reiniciarReproduccion(); }   // loop
  }

  hovered = findHover();
  if (hovered !== lastHovered) {
    if (hovered) { tocar(hovered, true); pulsos.push({ p: hovered, t0: millis() }); }
    lastHovered = hovered;
  }
  cursor(hovered ? HAND : (dragging ? 'grabbing' : ARROW));

  dibujarRecorrido();
  dibujarPuntos();
  dibujarPulsos();
  dibujarCursor();

  const foco = hovered || selected;
  if (foco) etiqueta(foco);

  sincronizarSlider();
}

function dibujarRecorrido() {
  noFill(); strokeJoin(ROUND); strokeCap(ROUND);
  strokeWeight(1.5);
  stroke(255, 35);
  beginShape();
  for (const p of puntos) vertex(sx(p), sy(p));
  endShape();

  // tramo ya recorrido
  stroke(255, 110);
  beginShape();
  for (const p of puntos) if (p.played) vertex(sx(p), sy(p));
  const c = posCursor();
  if (c && running) vertex(c.x, c.y);
  endShape();
}

function dibujarPuntos() {
  for (const p of puntos) {
    const x = sx(p), y = sy(p);
    if (x < -30 || y < -30 || x > width + 30 || y > height + 30) continue;
    const activo = p === hovered || p === selected;

    if (!p.played && !activo) {          // pendiente
      noFill(); stroke(255, 40); strokeWeight(1);
      circle(x, y, 4);
      continue;
    }

    // gas: disco relleno
    if (activas.mq) {
      const [r, g, b] = VARS.mq.rgb;
      noStroke(); fill(r, g, b, activo ? 170 : 90);
      circle(x, y, 2 * (4 + 10 * p.n.mq));
    }
    // humedad: anillo fino
    if (activas.hum) {
      const [r, g, b] = VARS.hum.rgb;
      noFill(); stroke(r, g, b, 220); strokeWeight(1.5);
      circle(x, y, 2 * (3 + 8 * p.n.hum));
    }
    // temperatura: punto sólido
    if (activas.temp) {
      const [r, g, b] = VARS.temp.rgb;
      noStroke(); fill(r, g, b, 240);
      circle(x, y, 2 * (1.5 + 4 * p.n.temp));
    }
    if (activo) {
      noFill(); stroke(255); strokeWeight(1.5);
      circle(x, y, 2 * 16);
    }
  }
}

function dibujarPulsos() {
  noFill();
  pulsos = pulsos.filter(u => millis() - u.t0 < 450);
  for (const u of pulsos) {
    const t = (millis() - u.t0) / 450;
    const k = KEYS.find(key => activas[key]);
    if (!k) continue;
    const [r, g, b] = VARS[k].rgb;
    stroke(r, g, b, 255 * (1 - t));
    strokeWeight(2);
    circle(sx(u.p), sy(u.p), 24 + t * 50);
  }
}

function dibujarCursor() {
  if (!running && playhead === 0) return;
  const c = posCursor();
  if (!c) return;
  noStroke(); fill(255);
  circle(c.x, c.y, 8);
}

function etiqueta(p) {
  const hora = new Date(p.ms).toLocaleTimeString('es-CO');
  const txt = `${hora} · ${p.temp.toFixed(1)}°C · ${p.hum}% · MQ ${p.mq}`;
  textSize(12); textAlign(LEFT, CENTER);
  const w = textWidth(txt) + 14;
  const x = Math.min(sx(p) + 14, width - w - 6), y = Math.max(sy(p) - 34, 6);
  noStroke(); fill(10, 13, 20, 235);
  rect(x, y, w, 22, 6);
  fill(255); text(txt, x + 7, y + 11);
}

function findHover() {
  if (dragging || !mouseSobreCanvas()) return null;
  let mejor = null, dMin = Infinity;
  for (const p of puntos) {
    const d = dist(mouseX, mouseY, sx(p), sy(p));
    if (d < 12 && d < dMin) { dMin = d; mejor = p; }
  }
  return mejor;
}

// el ratón está sobre el canvas y no sobre un panel HTML
function mouseSobreCanvas() {
  if (mouseX < 0 || mouseY < 0 || mouseX > width || mouseY > height) return false;
  const el = document.elementFromPoint(winMouseX, winMouseY);
  return el === drawingContext.canvas;
}

// ---------------------------------------------------------------- interacción
function mousePressed(e) {
  pressOnCanvas = !!(e && e.target === drawingContext.canvas);
  moved = 0;
  asegurarAudio();
}

function mouseDragged() {
  if (!pressOnCanvas) return;
  dragging = true;
  moved += abs(mouseX - pmouseX) + abs(mouseY - pmouseY);
  view.x += mouseX - pmouseX;
  view.y += mouseY - pmouseY;
}

function mouseReleased() {
  if (pressOnCanvas && moved < 4) {      // clic sin arrastre
    selected = hovered === selected ? null : hovered;
    mostrarInfo(selected);
  }
  dragging = false; pressOnCanvas = false;
}

function mouseWheel(e) {
  if (e.target !== drawingContext.canvas) return;
  const f = e.delta > 0 ? 0.9 : 1.1;
  const wx = (mouseX - view.x) / view.k, wy = (mouseY - view.y) / view.k;
  view.k = constrain(view.k * f, fitK * 0.5, fitK * 400);
  view.x = mouseX - wx * view.k;
  view.y = mouseY - wy * view.k;
  return false;
}

function keyPressed() {
  const ae = document.activeElement;
  if (ae && (ae.tagName === 'BUTTON')) ae.blur();
  if (key === ' ') { togglePlay(); return false; }
  if (key === 'r' || key === 'R') fitView();
  if (key === 'm' || key === 'M') { muted = !muted; actualizarAudioUI(); }
  if (key === 't' || key === 'T') toggleModo();
  if (key === '1') toggleVar(KEYS[0]);
  if (key === '2') toggleVar(KEYS[1]);
  if (key === '3') toggleVar(KEYS[2]);
  if (keyCode === ESCAPE) { selected = null; mostrarInfo(null); }
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); fitView(); }

// ---------------------------------------------------------------- UI HTML
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toggleVar(k) {
  activas[k] = !activas[k];
  if (botones[k]) botones[k].classList.toggle('off', !activas[k]);
}

function buildLegend() {
  const cont = document.getElementById('legend-items');
  cont.innerHTML = '';
  for (const k of KEYS) {
    const v = VARS[k], r = rango[k];
    const b = document.createElement('button');
    b.innerHTML = `<i style="background:${v.hex}"></i><span>${v.label}
      <small>${r.min.toFixed(v.dec)} – ${r.max.toFixed(v.dec)} ${v.unit} · ${v.wave}</small></span>`;
    b.onclick = () => { toggleVar(k); b.blur(); };
    b.classList.toggle('off', !activas[k]);
    botones[k] = b;
    cont.appendChild(b);
  }
}

function mostrarInfo(p) {
  const el = document.getElementById('info');
  if (!p) { el.style.display = 'none'; return; }
  const fecha = new Date(p.ms);
  el.innerHTML = `
    <h2>Muestra ${p.i + 1} / ${puntos.length}</h2>
    <div class="sub">${esc(fecha.toLocaleDateString('es-CO'))} ${esc(fecha.toLocaleTimeString('es-CO'))}</div>
    <dl>
      <dt>Latitud</dt><dd>${p.lat.toFixed(5)}</dd>
      <dt>Longitud</dt><dd>${p.lon.toFixed(5)}</dd>
      <dt>Temperatura</dt><dd>${p.temp.toFixed(1)} °C · ${esc(p.nota.temp)}</dd>
      <dt>Humedad</dt><dd>${p.hum} % · ${esc(p.nota.hum)}</dd>
      <dt>Gas (MQ)</dt><dd>${p.mq} · ${esc(p.nota.mq)}</dd>
      <dt>t captura</dt><dd>${p.t.toFixed(0)} s</dd>
    </dl>`;
  el.style.display = 'block';
}

function conectarUI() {
  const $ = id => document.getElementById(id);

  $('play').onclick = e => { togglePlay(); e.target.blur(); };
  $('mode').onclick = e => { toggleModo(); e.target.blur(); };

  $('scrub').addEventListener('input', e => {
    irA(+e.target.value / 100);
    sincronizarUI(false);
  });

  $('speed').addEventListener('input', e => {
    speed = +e.target.value;
    $('speed-val').textContent = speed + '×';
  });

  $('file').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      setData(Array.isArray(json) ? json : Object.values(json));
    } catch (err) {
      alert('No se pudo leer el JSON: ' + err.message);
    }
    e.target.value = '';
  });
}

// Actualiza textos y límites de los controles
function sincronizarUI(slider = true) {
  const $ = id => document.getElementById(id);
  $('play').textContent = running ? '⏸ Pausa' : '▶ Play';
  $('mode').textContent = steady ? 'Tiempo: constante' : 'Tiempo: real';
  $('scrub').max = Math.max(Math.round(duration * 100), 1);
  if (slider) $('scrub').value = Math.round(playhead * 100);
  $('time').textContent = `${playhead.toFixed(1)} / ${duration.toFixed(1)} s`;
}

// Cada cuadro: el deslizador sigue al cursor
function sincronizarSlider() {
  const s = document.getElementById('scrub');
  if (!s) return;
  s.value = Math.round(playhead * 100);
  document.getElementById('time').textContent = `${playhead.toFixed(1)} / ${duration.toFixed(1)} s`;
  const pb = document.getElementById('play');
  const txt = running ? '⏸ Pausa' : '▶ Play';
  if (pb.textContent !== txt) pb.textContent = txt;
}
