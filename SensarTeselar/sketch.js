// Mapeo de sensores en GeoJSON · p5.js
// - Varios archivos GeoJSON (capas), cada uno activable/desactivable
// - Cada medición numérica (propiedades de los Point) activable por archivo
// - Mapa base OpenStreetMap (teselas) que se puede poner o quitar
// - Sonorización: escala, tónica, transposición y octavas configurables
// - Reproducción en el tiempo (play/pausa, tiempo constante o real) + hover que suena

const COOLDOWN_MS = 40;                       // evita ráfagas al mover rápido el ratón
const KMIN = 128, KMAX = 256 * 2 ** 21;       // límites de zoom (px por unidad Mercator)
const KFIT_MAX = 256 * 2 ** 18;
const DEFAULT_FILES = ['./data/recorrido-2026-11-07T17-24-28.geojson',
                       './data/recorrido-2026-11-07T17-23-40.geojson',
                       './data/recorrido-2026-11-07T17-23-45.geojson'];   // se intenta cargar al inicio

// propiedades numéricas que NO se tratan como mediciones
const EXCLUIR = /^(ms|t|time|timestamp|fecha|acc|accuracy|lat|lon|lng|latitude|longitude|alt|altitude|id|index|i)$/i;

// ---------------------------------------------------------------- escalas
const NOMBRES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ESCALAS = {
  'Pentatónica mayor': [0, 2, 4, 7, 9],
  'Pentatónica menor': [0, 3, 5, 7, 10],
  'Mayor (jónica)': [0, 2, 4, 5, 7, 9, 11],
  'Menor natural': [0, 2, 3, 5, 7, 8, 10],
  'Menor armónica': [0, 2, 3, 5, 7, 8, 11],
  'Dórica': [0, 2, 3, 5, 7, 9, 10],
  'Frigia': [0, 1, 3, 5, 7, 8, 10],
  'Lidia': [0, 2, 4, 6, 7, 9, 11],
  'Mixolidia': [0, 2, 4, 5, 7, 9, 10],
  'Blues': [0, 3, 5, 6, 7, 10],
  'Tonos enteros': [0, 2, 4, 6, 8, 10],
  'Octatónica (T-S)': [0, 2, 3, 5, 6, 8, 9, 11],
  'Hirajoshi': [0, 2, 3, 7, 8],
  'Árabe (doble armónica)': [0, 1, 4, 5, 7, 8, 11],
  'Cromática': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  'Personalizada': null
};
// Opciones de sonido: cada medición tiene su propia copia (medidas[k].son).
// SON_DEF es la plantilla con la que nace cada medición nueva.
const SON_DEF = { escala: 'Pentatónica mayor', custom: [0, 2, 4, 7, 9], tonica: 0, transp: 0, octavas: 3, vol: 1, wave: 'triangle' };
const MASTER = { vol: 0.8 };
let SEL = null;                                  // medición cuyo sonido se edita en el panel derecho

function gradosEscala(s) {
  const g = s.escala === 'Personalizada' ? s.custom : ESCALAS[s.escala];
  return g && g.length ? g : ESCALAS['Pentatónica mayor'];
}
const objetivoSon = () => (SEL && medidas[SEL] ? medidas[SEL].son : SON_DEF);
const nombreMidi = m => NOMBRES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

// n (0..1) -> nota MIDI según escala, tónica, transposición y octavas
function midiDe(k, n) {
  const md = medidas[k], s = md.son;
  const g = gradosEscala(s);
  const total = g.length * s.octavas;
  const paso = Math.round(n * (total - 1));
  const m = md.base + s.tonica + s.transp + 12 * Math.floor(paso / g.length) + g[paso % g.length];
  return constrain(m, 0, 127);
}

// ---------------------------------------------------------------- mediciones (registro global por nombre)
const PALETA = ['#ff8a65', '#4fc3f7', '#a5d6a7', '#ffd54f', '#ce93d8', '#80cbc4', '#f48fb1', '#bcaaa4', '#90caf9', '#c5e1a5'];
const WAVES = ['sine', 'triangle', 'square', 'sawtooth'];
const AMPS = { sine: 0.28, triangle: 0.30, square: 0.10, sawtooth: 0.10 };
const REG = [48, 36, 60, 48, 36, 60, 48, 36];       // registros base (múltiplos de C)
const COLORES_CAPA = ['#ffffff', '#ffb74d', '#4dd0e1', '#ba68c8', '#aed581', '#f06292'];
const medidas = {};

function etiquetaDe(k) {
  const unidades = new Set(['c', 'pct', 'hpa', 'pa', 'ppm', 'v', 'mv', 'ms', 'raw', 'adc']);
  const t = k.split('_').filter((s, i, a) => !(i > 0 && i === a.length - 1 && unidades.has(s.toLowerCase())));
  return t.map((s, i) => (/\d/.test(s) ? s.toUpperCase() : (i === 0 ? s[0].toUpperCase() + s.slice(1) : s))).join(' ');
}
function unidadDe(k) {
  const s = k.split('_').pop().toLowerCase();
  return { c: '°C', pct: '%', hpa: 'hPa', pa: 'Pa', ppm: 'ppm', v: 'V', mv: 'mV', adc: 'ADC' }[s] || '';
}
function medida(k) {
  if (!medidas[k]) {
    const i = Object.keys(medidas).length;
    const hex = PALETA[i % PALETA.length];
    const wave = WAVES[i % WAVES.length];
    medidas[k] = {
      idx: i, hex, base: REG[i % REG.length],
      son: { ...SON_DEF, custom: [...SON_DEF.custom], wave },
      rgb: [1, 3, 5].map(j => parseInt(hex.slice(j, j + 2), 16)),
      label: etiquetaDe(k), unit: unidadDe(k)
    };
    if (SEL === null) SEL = k;
  }
  return medidas[k];
}
function fmt(k, v) {
  const u = medidas[k].unit;
  if (u === '°C' || u === 'hPa') return v.toFixed(1);
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

// ---------------------------------------------------------------- estado
let capas = [];
let GB = { minX: 0, minY: 0, maxX: 1, maxY: 1 };        // límites globales (para el paneo)
let view = { x: 0, y: 0, k: 256 };
let fitK = 256;
let T0 = 0;                                              // ms de referencia para tiempo real
const osm = { on: true, alpha: 0.55 };
let trazo = true;

let hovered = null, lastHovered = null, selected = null;
let dragging = false, moved = 0, pressOnCanvas = false;
let pulsos = [];

let steady = true, running = false, playhead = 0, duration = 0, speed = 4, STEP = 0.5;

let audioOn = false, audioStarting = false, muted = false, ultimoDisparo = 0;
let preview = null;
let capaId = 0;

// ---------------------------------------------------------------- Mercator
const mx = lon => (lon + 180) / 360;
const my = lat => {
  const l = constrain(lat, -85.0511, 85.0511) * Math.PI / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + l / 2)) / (2 * Math.PI);
};
const sx = p => p.x * view.k + view.x;
const sy = p => p.y * view.k + view.y;

// ---------------------------------------------------------------- setup
function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont('sans-serif');
  conectarUI();
  actualizarAudioUI();
  actualizarEscalaUI();
  for (const f of DEFAULT_FILES) cargarURL(f, true);
}

// ---------------------------------------------------------------- lectura de GeoJSON
function aFeatures(json) {
  if (!json) return [];
  if (Array.isArray(json)) {
    // soporta también el JSON plano [{lat, lon, ...}]
    return json.filter(d => d && isFinite(d.lat) && isFinite(d.lon)).map(d => {
      const { lat, lon, ...resto } = d;
      return { geometry: { type: 'Point', coordinates: [+lon, +lat] }, properties: resto };
    });
  }
  if (json.type === 'FeatureCollection') return json.features || [];
  if (json.type === 'Feature') return [json];
  if (json.type === 'GeometryCollection') return (json.geometries || []).map(g => ({ geometry: g, properties: {} }));
  if (json.type && json.coordinates) return [{ geometry: json, properties: {} }];
  if (typeof json === 'object') return aFeatures(Object.values(json));
  return [];
}

function construirCapa(nombre, json) {
  const pts = [], shapes = [];
  const proj = c => ({ x: mx(+c[0]), y: my(+c[1]) });
  const valido = c => Array.isArray(c) && isFinite(c[0]) && isFinite(c[1]);

  function agregarPunto(c, props) {
    if (!valido(c)) return;
    const vals = {};
    for (const [k, v] of Object.entries(props)) {
      if (typeof v === 'number' && isFinite(v) && !EXCLUIR.test(k)) vals[k] = v;
    }
    let ms = isFinite(props.ms) ? +props.ms : NaN;
    if (!isFinite(ms)) ms = Date.parse(props.t || props.time || props.timestamp || props.fecha || '');
    const q = proj(c);
    pts.push({ i: pts.length, lon: +c[0], lat: +c[1], x: q.x, y: q.y, props, vals, n: {}, ms: isFinite(ms) ? ms : null });
  }
  function agregarGeom(g, props) {
    if (!g) return;
    switch (g.type) {
      case 'Point': agregarPunto(g.coordinates, props); break;
      case 'MultiPoint': (g.coordinates || []).forEach(c => agregarPunto(c, props)); break;
      case 'LineString': shapes.push({ cerrada: false, v: g.coordinates.filter(valido).map(proj) }); break;
      case 'MultiLineString': g.coordinates.forEach(l => shapes.push({ cerrada: false, v: l.filter(valido).map(proj) })); break;
      case 'Polygon': g.coordinates.forEach(r => shapes.push({ cerrada: true, v: r.filter(valido).map(proj) })); break;
      case 'MultiPolygon': g.coordinates.forEach(poly => poly.forEach(r => shapes.push({ cerrada: true, v: r.filter(valido).map(proj) }))); break;
      case 'GeometryCollection': (g.geometries || []).forEach(s => agregarGeom(s, props)); break;
    }
  }
  for (const f of aFeatures(json)) if (f) agregarGeom(f.geometry, f.properties || {});
  if (!pts.length && !shapes.length) return null;

  if (pts.length && pts.every(p => p.ms !== null)) {
    pts.sort((a, b) => a.ms - b.ms);
    pts.forEach((p, i) => p.i = i);
  }

  const keys = [];
  for (const p of pts) for (const k of Object.keys(p.vals)) if (!keys.includes(k)) keys.push(k);
  const rango = {}, active = {}, invert = {};
  for (const k of keys) {
    medida(k);
    const vs = pts.map(p => p.vals[k]).filter(v => v !== undefined);
    rango[k] = { min: Math.min(...vs), max: Math.max(...vs) };
    active[k] = true; invert[k] = false;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acum = q => { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); };
  pts.forEach(acum);
  shapes.forEach(s => s.v.forEach(acum));

  const L = {
    id: ++capaId, nombre, visible: true, color: COLORES_CAPA[(capaId - 1) % COLORES_CAPA.length],
    pts, shapes, keys, rango, active, invert, next: 0, voces: {},
    bounds: { minX, minY, maxX, maxY }, ms0: pts.length && pts[0].ms !== null ? pts[0].ms : null
  };
  pts.forEach(p => p.L = L);
  recalcN(L);
  return L;
}

function recalcN(L) {
  for (const k of L.keys) {
    const r = L.rango[k];
    for (const p of L.pts) {
      const v = p.vals[k];
      if (v === undefined) continue;
      let n = r.max > r.min ? (v - r.min) / (r.max - r.min) : 0.5;
      if (L.invert[k]) n = 1 - n;
      p.n[k] = constrain(n, 0, 1);
    }
  }
}

// ---------------------------------------------------------------- gestión de capas
function addCapa(nombre, json) {
  const L = construirCapa(nombre.replace(/\.(geo)?json$/i, ''), json);
  if (!L) { alert(`"${nombre}" no contiene geometrías válidas.`); return null; }
  capas.push(L);
  recalcGlobal();
  crearCard(L);
  reiniciarReproduccion();
  actualizarDuracion();
  fitView();
  sincronizarUI();
  return L;
}

function quitarCapa(L) {
  capas = capas.filter(c => c !== L);
  for (const k of Object.keys(L.voces)) {
    try { L.voces[k].osc.stop(); L.voces[k].osc.dispose(); } catch (e) { /* noop */ }
  }
  if (hovered && hovered.L === L) hovered = lastHovered = null;
  if (selected && selected.L === L) { selected = null; mostrarInfo(null); }
  L.el.remove();
  recalcGlobal();
  reiniciarReproduccion();
  actualizarDuracion();
  sincronizarUI();
}

function recalcGlobal() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, t0 = Infinity;
  for (const L of capas) {
    minX = Math.min(minX, L.bounds.minX); maxX = Math.max(maxX, L.bounds.maxX);
    minY = Math.min(minY, L.bounds.minY); maxY = Math.max(maxY, L.bounds.maxY);
    if (L.ms0 !== null) t0 = Math.min(t0, L.ms0);
  }
  if (capas.length) GB = { minX, minY, maxX, maxY };
  T0 = isFinite(t0) ? t0 : 0;
}

async function cargarArchivo(f) {
  try { addCapa(f.name, JSON.parse(await f.text())); }
  catch (err) { alert(`No se pudo leer "${f.name}": ${err.message}`); }
}

async function cargarURL(url, silencioso = false) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    addCapa(decodeURIComponent(url.split('/').pop().split('?')[0]) || 'mapa', await r.json());
  } catch (err) {
    if (!silencioso) alert('No se pudo cargar la URL: ' + err.message);
  }
}

// ---------------------------------------------------------------- audio
function voz(L, k) {
  if (!L.voces[k]) {
    const m = medidas[k];
    const osc = new p5.Oscillator(m.son.wave);
    const env = new p5.Envelope();
    env.setADSR(0.01, 0.15, 0.0, 0.12);
    env.setRange(AMPS[m.son.wave] * m.son.vol, 0);
    osc.amp(0);
    osc.start();
    L.voces[k] = { osc, env };
  }
  return L.voces[k];
}

function asegurarAudio() {
  if (audioOn || audioStarting) return;
  audioStarting = true;
  userStartAudio().then(() => { audioOn = true; masterVolume(MASTER.vol); actualizarAudioUI(); });
}

const panDe = p => ((p.x - GB.minX) / ((GB.maxX - GB.minX) || 1) * 2 - 1) * 0.8;

function tocar(p, conCooldown = false) {
  if (!audioOn || muted || !p || !p.L.visible) return;
  if (conCooldown) {
    const ahora = millis();
    if (ahora - ultimoDisparo < COOLDOWN_MS) return;
    ultimoDisparo = ahora;
  }
  const L = p.L;
  for (const k of L.keys) {
    if (!L.active[k] || p.n[k] === undefined) continue;
    const v = voz(L, k), md = medidas[k];
    v.osc.setType(md.son.wave);
    v.env.setRange(AMPS[md.son.wave] * md.son.vol, 0);
    v.osc.freq(midiToFreq(midiDe(k, p.n[k])));
    v.osc.pan(panDe(p));
    v.env.play(v.osc);
  }
}

// function probarEscala() {
//   userStartAudio().then(() => {
//     audioOn = true; masterVolume(MASTER.vol); actualizarAudioUI();
//     if (!preview) {
//       const osc = new p5.Oscillator('triangle');
//       const env = new p5.Envelope();
//       env.setADSR(0.01, 0.12, 0.0, 0.1);
//       env.setRange(0.3, 0);
//       osc.amp(0); osc.start();
//       preview = { osc, env };
//     }
//     const so = objetivoSon();
//     const raiz = 60 + so.tonica + so.transp;
//     const notas = [...gradosEscala(so).map(g => raiz + g), raiz + 12];
//     notas.forEach((m, i) => setTimeout(() => {
//       preview.osc.setType(so.wave);
//       preview.env.setRange(0.3 * so.vol, 0);
//       preview.osc.freq(midiToFreq(constrain(m, 0, 127)));
//       preview.env.play(preview.osc);
//     }, i * 220));
//   });
// }

function actualizarAudioUI() {
  const el = document.getElementById('audio');
  if (!el) return;
  el.className = !audioOn ? '' : (muted ? 'mute' : 'on');
  el.textContent = !audioOn ? 'Clic para activar el sonido'
                 : muted ? 'Silenciado (M para activar)' : 'Sonido activado';
  const mb = document.getElementById('mute');
  if (mb) mb.firstChild.textContent = muted ? 'Activar sonido ' : 'Silenciar ';
}

// ---------------------------------------------------------------- tiempo
function timeOf(L, p) {
  if (steady || p.ms === null) return p.i * STEP;
  return (p.ms - T0) / 1000;
}

function actualizarDuracion() {
  let d = 0;
  for (const L of capas) {
    if (!L.visible || !L.pts.length) continue;
    d = Math.max(d, timeOf(L, L.pts[L.pts.length - 1]));
  }
  duration = d;
  playhead = Math.min(playhead, duration);
}

function reiniciarReproduccion() {
  playhead = 0;
  for (const L of capas) L.next = 0;
  pulsos = [];
}

// Mover el cursor sin disparar notas (arrastrar la barra)
function irA(t) {
  playhead = constrain(t, 0, duration);
  for (const L of capas) {
    let n = 0;
    while (n < L.pts.length && timeOf(L, L.pts[n]) <= playhead) n++;
    L.next = n;
  }
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

function posCursor(L) {
  const j = L.next - 1;
  if (j < 0) return null;
  const a = L.pts[j];
  if (j === L.pts.length - 1) return { x: sx(a), y: sy(a) };
  const b = L.pts[j + 1];
  const u = constrain((playhead - timeOf(L, a)) / ((timeOf(L, b) - timeOf(L, a)) || 1), 0, 1);
  return { x: lerp(sx(a), sx(b), u), y: lerp(sy(a), sy(b), u) };
}

// ---------------------------------------------------------------- vista
function fitView(lista) {
  const objetivo = (lista || capas).filter(L => L.visible);
  const usar = objetivo.length ? objetivo : (lista || capas);
  if (!usar.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const L of usar) {
    minX = Math.min(minX, L.bounds.minX); maxX = Math.max(maxX, L.bounds.maxX);
    minY = Math.min(minY, L.bounds.minY); maxY = Math.max(maxY, L.bounds.maxY);
  }
  const izq = document.getElementById('panel-izq'), der = document.getElementById('panel-der');
  const ancho = width > 1000;
  const m = { l: ancho ? izq.offsetWidth + 40 : 20, r: ancho ? der.offsetWidth + 40 : 20, t: 60, b: 120 };
  const w = Math.max(maxX - minX, 2e-6), h = Math.max(maxY - minY, 2e-6);
  const aw = Math.max(width - m.l - m.r, 100), ah = Math.max(height - m.t - m.b, 100);
  fitK = constrain(Math.min(aw / w, ah / h), KMIN, KFIT_MAX);
  view.k = fitK;
  view.x = m.l + aw / 2 - (minX + w / 2) * view.k;
  view.y = m.t + ah / 2 - (minY + h / 2) * view.k;
}

// ---------------------------------------------------------------- teselas OSM
const tiles = new Map();
const urlTesela = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

function getTesela(z, x, y, cargar = true) {
  const id = z + '/' + x + '/' + y;
  let t = tiles.get(id);
  if (!t && cargar) {
    const img = new Image();
    t = { img, ok: false, used: frameCount };
    img.onload = () => { t.ok = true; };
    img.onerror = () => { t.err = true; };
    img.src = urlTesela(z, x, y);
    tiles.set(id, t);
    if (tiles.size > 500) purgarTeselas();
  }
  if (t) t.used = frameCount;
  return t;
}

function purgarTeselas() {
  const orden = [...tiles.entries()].sort((a, b) => a[1].used - b[1].used);
  for (let i = 0; i < 150; i++) tiles.delete(orden[i][0]);
}

function dibujarOSM() {
  if (!osm.on) return;
  const k = view.k;
  const z = constrain(Math.round(Math.log2(k / 256)), 0, 19);
  const n = 2 ** z, ts = k / n;
  const x0 = -view.x / k, x1 = (width - view.x) / k, y0 = -view.y / k, y1 = (height - view.y) / k;
  const tx0 = Math.max(0, Math.floor(x0 * n)), tx1 = Math.min(n - 1, Math.floor(x1 * n));
  const ty0 = Math.max(0, Math.floor(y0 * n)), ty1 = Math.min(n - 1, Math.floor(y1 * n));
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 120) return;

  const ctx = drawingContext;
  ctx.save();
  ctx.globalAlpha = osm.alpha;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const px = tx * ts + view.x, py = ty * ts + view.y;
      const t = getTesela(z, tx, ty);
      if (t && t.ok) { ctx.drawImage(t.img, px, py, ts + 0.5, ts + 0.5); continue; }
      // mientras carga: usa una teselas de menor zoom ya cargada
      for (let d = 1; d <= 4 && z - d >= 0; d++) {
        const a = getTesela(z - d, tx >> d, ty >> d, false);
        if (a && a.ok) {
          const sz = 256 / (2 ** d);
          ctx.drawImage(a.img, (tx - ((tx >> d) << d)) * sz, (ty - ((ty >> d) << d)) * sz, sz, sz, px, py, ts + 0.5, ts + 0.5);
          break;
        }
      }
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- dibujo
function draw() {
  background('#0e1118');
  dibujarOSM();

  if (!capas.length) {
    noStroke(); fill(255, 90); textAlign(CENTER, CENTER); textSize(15);
    text('Añade o arrastra un archivo .geojson', width / 2, height / 2);
    return;
  }

  if (running) {
    playhead += constrain(deltaTime, 0, 100) / 1000 * speed;
    for (const L of capas) {
      while (L.next < L.pts.length && timeOf(L, L.pts[L.next]) <= playhead) {
        const p = L.pts[L.next++];
        if (L.visible) { tocar(p); pulsos.push({ p, t0: millis() }); }
      }
    }
    if (playhead > duration + 1.5) reiniciarReproduccion();   // loop
  }

  hovered = findHover();
  if (hovered !== lastHovered) {
    if (hovered) { tocar(hovered, true); pulsos.push({ p: hovered, t0: millis() }); }
    lastHovered = hovered;
  }
  cursor(hovered ? HAND : (dragging ? 'grabbing' : ARROW));

  for (const L of capas) if (L.visible) dibujarFormas(L);
  for (const L of capas) if (L.visible && trazo) dibujarRecorrido(L);
  for (const L of capas) if (L.visible) dibujarPuntos(L);
  dibujarPulsos();
  for (const L of capas) if (L.visible) dibujarCursor(L);

  const foco = hovered || selected;
  if (foco) etiqueta(foco);

  sincronizarSlider();
}

function dibujarFormas(L) {
  const c = color(L.color);
  strokeJoin(ROUND); strokeWeight(1.5);
  for (const s of L.shapes) {
    if (s.v.length < 2) continue;
    stroke(red(c), green(c), blue(c), 170);
    if (s.cerrada) fill(red(c), green(c), blue(c), 25); else noFill();
    beginShape();
    for (const q of s.v) vertex(sx(q), sy(q));
    if (s.cerrada) endShape(CLOSE); else endShape();
  }
}

const reproduciendo = () => running || playhead > 0;

function dibujarRecorrido(L) {
  if (L.pts.length < 2) return;
  noFill(); strokeJoin(ROUND); strokeCap(ROUND);
  strokeWeight(1.5); stroke(255, 40);
  beginShape();
  for (const p of L.pts) vertex(sx(p), sy(p));
  endShape();

  if (!reproduciendo()) return;
  stroke(255, 120);
  beginShape();
  for (let i = 0; i < L.next; i++) vertex(sx(L.pts[i]), sy(L.pts[i]));
  const c = posCursor(L);
  if (c && running) vertex(c.x, c.y);
  endShape();
}

function marca(estilo, x, y, n, rgb, activo) {
  const [r, g, b] = rgb;
  switch (estilo) {
    case 0: noStroke(); fill(r, g, b, activo ? 170 : 90); circle(x, y, 2 * (4 + 10 * n)); break;       // disco
    case 1: noFill(); stroke(r, g, b, 220); strokeWeight(1.5); circle(x, y, 2 * (3 + 8 * n)); break;    // anillo
    case 2: noStroke(); fill(r, g, b, 240); circle(x, y, 2 * (1.5 + 4 * n)); break;                     // punto
    case 3: noFill(); stroke(r, g, b, 220); strokeWeight(1.5); rectMode(CENTER);
            square(x, y, 2 * (3 + 7 * n)); break;                                                       // cuadrado
    case 4: { const d = 3 + 8 * n; noStroke(); fill(r, g, b, 150);
              quad(x, y - d, x + d, y, x, y + d, x - d, y); break; }                                    // rombo
    case 5: { const d = 3 + 7 * n; stroke(r, g, b, 230); strokeWeight(1.8);
              line(x - d, y, x + d, y); line(x, y - d, x, y + d); break; }                              // cruz
  }
}

function dibujarPuntos(L) {
  const activas = L.keys.filter(k => L.active[k]);
  const rep = reproduciendo();
  for (const p of L.pts) {
    const x = sx(p), y = sy(p);
    if (x < -30 || y < -30 || x > width + 30 || y > height + 30) continue;
    const activo = p === hovered || p === selected;
    const pendiente = rep && p.i >= L.next;

    if ((pendiente && !activo) || !activas.length) {
      noFill(); stroke(255, pendiente ? 40 : 90); strokeWeight(1);
      circle(x, y, pendiente ? 4 : 5);
    } else {
      // de mayor a menor presencia: los discos van al fondo
      for (const k of activas) {
        if (p.n[k] === undefined) continue;
        const m = medidas[k];
        marca(m.idx % 6, x, y, p.n[k], m.rgb, activo);
      }
    }
    if (activo) {
      noFill(); stroke(255); strokeWeight(1.5);
      circle(x, y, 32);
    }
  }
}

function dibujarPulsos() {
  noFill();
  pulsos = pulsos.filter(u => millis() - u.t0 < 450);
  for (const u of pulsos) {
    const L = u.p.L;
    const k = L.keys.find(key => L.active[key]);
    if (!k) continue;
    const t = (millis() - u.t0) / 450;
    const [r, g, b] = medidas[k].rgb;
    stroke(r, g, b, 255 * (1 - t));
    strokeWeight(2);
    circle(sx(u.p), sy(u.p), 24 + t * 50);
  }
}

function dibujarCursor(L) {
  if (!reproduciendo()) return;
  const c = posCursor(L);
  if (!c) return;
  noStroke(); fill(255);
  circle(c.x, c.y, 8);
}

function etiqueta(p) {
  const L = p.L;
  const partes = [];
  if (p.ms !== null) partes.push(new Date(p.ms).toLocaleTimeString('es-CO'));
  for (const k of L.keys) {
    if (!L.active[k] || p.vals[k] === undefined) continue;
    const m = medidas[k];
    partes.push(`${m.label} ${fmt(k, p.vals[k])}${m.unit}`);
  }
  if (!partes.length) partes.push(`${L.nombre} · ${p.i + 1}`);
  const txt = partes.join(' · ');
  textSize(12); textAlign(LEFT, CENTER);
  const w = textWidth(txt) + 14;
    const x = Math.min(sx(p) + 14, width - w - 6);
    const y = Math.max(sy(p) - 34, 6);
  noStroke(); fill(10, 13, 20, 235);
  rect(x, y, w, 22, 6);
  fill(255); text(txt, x, y);
}

function findHover() {
  if (dragging || !mouseSobreCanvas()) return null;
  let mejor = null, dMin = Infinity;
  for (const L of capas) {
    if (!L.visible) continue;
    for (const p of L.pts) {
      const d = dist(mouseX, mouseY, sx(p), sy(p));
      if (d < 12 && d < dMin) { dMin = d; mejor = p; }
    }
  }
  return mejor;
}

// el ratón está sobre el canvas y no sobre un panel HTML
function mouseSobreCanvas() {
  if (mouseX < 0 || mouseY < 0 || mouseX > width || mouseY > height) return false;
  return document.elementFromPoint(winMouseX, winMouseY) === drawingContext.canvas;
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
  view.k = constrain(view.k * f, KMIN, KMAX);
  view.x = mouseX - wx * view.k;
  view.y = mouseY - wy * view.k;
  return false;
}

function keyPressed() {
  const ae = document.activeElement;
  if (ae && ['INPUT', 'SELECT', 'TEXTAREA'].includes(ae.tagName) && ae.type !== 'range' && ae.type !== 'checkbox') return;
  if (ae && (ae.tagName === 'BUTTON' || ae.type === 'range' || ae.type === 'checkbox')) ae.blur();
  if (key === ' ') { togglePlay(); return false; }
  if (key === 'r' || key === 'R') fitView();
  if (key === 'm' || key === 'M') { muted = !muted; actualizarAudioUI(); }
  if (key === 't' || key === 'T') toggleModo();
  if (key === 'o' || key === 'O') setOSM(!osm.on);
  if (key === 'l' || key === 'L') setTrazo(!trazo);
  if (keyCode === ESCAPE) { selected = null; mostrarInfo(null); }
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); fitView(); }

// ---------------------------------------------------------------- UI HTML
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function setOSM(v) { osm.on = v; $('osm-on').checked = v; $('atrib').style.display = v ? '' : 'none'; }
function setTrazo(v) { trazo = v; $('trazo-on').checked = v; }

function crearCard(L) {
  const card = document.createElement('div');
  card.className = 'capa';
  card.innerHTML = `
    <div class="capa-head">
      <button class="vis" title="Mostrar / ocultar archivo">👁</button>
      <i class="sw" style="background:${L.color}"></i>
      <span class="nombre" title="${esc(L.nombre)}">${esc(L.nombre)}</span>
      <small>${L.pts.length ? L.pts.length + ' pts' : 'formas'}</small>
      <button class="zoom" title="Ir a este archivo">⌖</button>
      <button class="del" title="Quitar archivo">✕</button>
    </div>
    <div class="meds"></div>`;
  const meds = card.querySelector('.meds');

  for (const k of L.keys) {
    const m = medidas[k], r = L.rango[k];
    const fila = document.createElement('div');
    fila.className = 'med-row';
    fila.innerHTML = `
      <button class="med"><i style="background:${m.hex}"></i>
        <span>${esc(m.label)}<small>${fmt(k, r.min)} – ${fmt(k, r.max)} ${esc(m.unit)}</small>
        <small class="sd" data-k="${esc(k)}">${esc(textoSon(m))}</small></span></button>
      <button class="ed" data-k="${esc(k)}" title="Editar el sonido de esta medición">🎚</button>
      <button class="inv" title="Invertir el mapeo a las notas">↕</button>`;
    const b = fila.querySelector('.med'), inv = fila.querySelector('.inv'), ed = fila.querySelector('.ed');
    ed.classList.toggle('on', k === SEL);
    ed.onclick = () => { seleccionarMedicion(k); ed.blur(); };
    b.onclick = () => { L.active[k] = !L.active[k]; b.classList.toggle('off', !L.active[k]); b.blur(); };
    inv.onclick = () => {
      L.invert[k] = !L.invert[k]; inv.classList.toggle('on', L.invert[k]);
      recalcN(L); mostrarInfo(selected); inv.blur();
    };
    meds.appendChild(fila);
  }

  card.querySelector('.vis').onclick = e => {
    L.visible = !L.visible;
    card.classList.toggle('off', !L.visible);
    if (!L.visible) {
      if (hovered && hovered.L === L) hovered = lastHovered = null;
      if (selected && selected.L === L) { selected = null; mostrarInfo(null); }
    }
    actualizarDuracion(); sincronizarUI(); e.target.blur();
  };
  card.querySelector('.zoom').onclick = e => { fitView([L]); e.target.blur(); };
  card.querySelector('.del').onclick = () => quitarCapa(L);

  L.el = card;
  $('capas').appendChild(card);
  construirChips();
}

// ---- sonido por medición
const signo = n => (n > 0 ? '+' : '') + n;
const textoSon = m => `${m.son.escala} · ${NOMBRES[m.son.tonica]} ${signo(m.son.transp)} st · ${m.son.wave}`;

function refrescarCards() {
  document.querySelectorAll('.sd').forEach(el => { const m = medidas[el.dataset.k]; if (m) el.textContent = textoSon(m); });
  document.querySelectorAll('.ed').forEach(el => el.classList.toggle('on', el.dataset.k === SEL));
}

function construirChips() {
  const c = $('chips');
  c.innerHTML = '';
  for (const k of Object.keys(medidas)) {
    const m = medidas[k];
    const b = document.createElement('button');
    b.className = 'chip' + (k === SEL ? ' sel' : '');
    b.innerHTML = `<i style="background:${m.hex}"></i>${esc(m.label)}`;
    b.onclick = () => { seleccionarMedicion(k); b.blur(); };
    c.appendChild(b);
  }
  actualizarEscalaUI();
}

function seleccionarMedicion(k) { SEL = k; construirChips(); }

function mostrarInfo(p) {
  const el = $('info');
  if (!p) { el.style.display = 'none'; return; }
  const L = p.L;
  const filas = L.keys.filter(k => p.vals[k] !== undefined).map(k => {
    const m = medidas[k];
    return `<dt>${esc(m.label)}</dt><dd>${fmt(k, p.vals[k])} ${esc(m.unit)} · ${nombreMidi(midiDe(k, p.n[k]))}</dd>`;
  }).join('');
  const fecha = p.ms !== null ? new Date(p.ms) : null;
  el.innerHTML = `
    <h2>${esc(L.nombre)} · ${p.i + 1} / ${L.pts.length}</h2>
    <div class="sub">${fecha ? esc(fecha.toLocaleDateString('es-CO') + ' ' + fecha.toLocaleTimeString('es-CO')) : '&nbsp;'}</div>
    <dl>
      <dt>Latitud</dt><dd>${p.lat.toFixed(5)}</dd>
      <dt>Longitud</dt><dd>${p.lon.toFixed(5)}</dd>
      ${filas}
      ${isFinite(p.props.acc) ? `<dt>Precisión</dt><dd>${p.props.acc} m</dd>` : ''}
    </dl>`;
  el.style.display = 'block';
}

function actualizarEscalaUI() {
  const so = objetivoSon();
  const m = SEL ? medidas[SEL] : null;
  $('med-titulo').textContent = m ? `Editando el sonido de: ${m.label}` : 'Aún no hay mediciones: estos valores se usarán por defecto.';
  $('escala').value = so.escala;
  $('custom-wrap').hidden = so.escala !== 'Personalizada';
  if (document.activeElement !== $('custom')) $('custom').value = so.custom.join(', ');
  $('tonica').value = so.tonica;
  $('escala-notas').textContent = gradosEscala(so).map(g => NOMBRES[(so.tonica + g) % 12]).join('  ');
  $('transp').value = so.transp;
  $('transp-val').textContent = signo(so.transp) + ' st';
  $('octavas').value = so.octavas; $('octavas-val').textContent = so.octavas;
  $('timbre').value = so.wave;
  $('nivel').value = Math.round(so.vol * 100); $('nivel-val').textContent = Math.round(so.vol * 100) + '%';
  refrescarCards();
  mostrarInfo(selected);
}

function conectarUI() {
  // --- mapas
  $('osm-on').onchange = e => setOSM(e.target.checked);
  $('osm-alpha').addEventListener('input', e => {
    osm.alpha = +e.target.value / 100;
    $('osm-alpha-val').textContent = e.target.value + '%';
  });
  $('osm-alpha').dispatchEvent(new Event('input'));
  $('trazo-on').onchange = e => setTrazo(e.target.checked);

  $('add-file').onclick = () => $('file').click();
  $('file').addEventListener('change', async e => {
    for (const f of e.target.files) await cargarArchivo(f);
    e.target.value = '';
  });
  // $('add-url').onclick = () => { const u = $('url').value.trim(); if (u) cargarURL(u).then(() => { $('url').value = ''; }); };
  // $('url').addEventListener('keydown', e => { if (e.key === 'Enter') $('add-url').click(); });

  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', async e => {
    e.preventDefault();
    for (const f of e.dataTransfer.files) await cargarArchivo(f);
  });

  // --- sonido
  for (const n of Object.keys(ESCALAS)) $('escala').add(new Option(n, n));
  NOMBRES.forEach((n, i) => $('tonica').add(new Option(n, i)));
  $('escala').value = SON_DEF.escala;

  for (const w of WAVES) $('timbre').add(new Option(w, w));

  $('escala').onchange = e => { objetivoSon().escala = e.target.value; actualizarEscalaUI(); e.target.blur(); };
  $('custom').addEventListener('input', e => {
    const g = [...new Set(e.target.value.split(/[\s,;]+/).map(Number).filter(isFinite)
      .map(n => ((Math.round(n) % 12) + 12) % 12))].sort((a, b) => a - b);
    if (g.length) { objetivoSon().custom = g; actualizarEscalaUI(); }
  });
  $('tonica').onchange = e => { objetivoSon().tonica = +e.target.value; actualizarEscalaUI(); e.target.blur(); };
  $('transp').addEventListener('input', e => { objetivoSon().transp = +e.target.value; actualizarEscalaUI(); });
  $('oct-down').onclick = e => { const so = objetivoSon(); so.transp = Math.max(-24, so.transp - 12); actualizarEscalaUI(); e.target.blur(); };
  $('oct-up').onclick = e => { const so = objetivoSon(); so.transp = Math.min(24, so.transp + 12); actualizarEscalaUI(); e.target.blur(); };
  $('transp-0').onclick = e => { objetivoSon().transp = 0; actualizarEscalaUI(); e.target.blur(); };
  //$('probar').onclick = e => { probarEscala(); e.target.blur(); };
  $('octavas').addEventListener('input', e => { objetivoSon().octavas = +e.target.value; actualizarEscalaUI(); });
  $('timbre').onchange = e => { objetivoSon().wave = e.target.value; actualizarEscalaUI(); e.target.blur(); };
  $('nivel').addEventListener('input', e => { objetivoSon().vol = +e.target.value / 100; actualizarEscalaUI(); });
  $('aplicar-todas').onclick = e => {
    const o = objetivoSon();
    for (const k of Object.keys(medidas)) {
      const so = medidas[k].son;
      so.escala = o.escala; so.custom = [...o.custom]; so.tonica = o.tonica; so.transp = o.transp; so.octavas = o.octavas;
    }
    actualizarEscalaUI(); e.target.blur();
  };
  $('vol').addEventListener('input', e => {
    MASTER.vol = +e.target.value / 100; $('vol-val').textContent = e.target.value + '%';
    if (audioOn) masterVolume(MASTER.vol);
  });
  $('mute').onclick = e => { muted = !muted; actualizarAudioUI(); e.currentTarget.blur(); };

  // --- reproducción
  $('play').onclick = e => { togglePlay(); e.target.blur(); };
  $('mode').onclick = e => { toggleModo(); e.target.blur(); };
  $('scrub').addEventListener('input', e => { irA(+e.target.value / 100); sincronizarUI(false); });
  $('speed').addEventListener('input', e => { speed = +e.target.value; $('speed-val').textContent = speed + '×'; });
  $('step').addEventListener('change', e => {
    STEP = Math.max(0.05, +e.target.value || 0.5);
    e.target.value = STEP;
    actualizarDuracion(); reiniciarReproduccion(); sincronizarUI();
  });
}

// Actualiza textos y límites de los controles
function sincronizarUI(slider = true) {
  $('play').textContent = running ? '⏸ Pausa' : '▶ Play';
  $('mode').textContent = steady ? 'Tiempo: constante' : 'Tiempo: real';
  $('scrub').max = Math.max(Math.round(duration * 100), 1);
  if (slider) $('scrub').value = Math.round(playhead * 100);
  $('time').textContent = `${playhead.toFixed(1)} / ${duration.toFixed(1)} s`;
}

// Cada cuadro: el deslizador sigue al cursor
function sincronizarSlider() {
  const s = $('scrub');
  if (!s) return;
  s.value = Math.round(playhead * 100);
  $('time').textContent = `${playhead.toFixed(1)} / ${duration.toFixed(1)} s`;
  const txt = running ? '⏸ Pausa' : '▶ Play';
  if ($('play').textContent !== txt) $('play').textContent = txt;
}
