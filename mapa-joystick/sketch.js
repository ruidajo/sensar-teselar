// Mapeo de sensores en GeoJSON · p5.js
// - Varios archivos GeoJSON o CSV de WiGLE (capas), cada uno activable/desactivable
// - Cada medición numérica (propiedades de los Point) activable por archivo
// - Mapa base OpenStreetMap (teselas) que se puede poner o quitar
// - Sonorización: escala, tónica, transposición y octavas configurables
// - Reproducción en el tiempo (play/pausa, tiempo constante o real) + hover que suena

const COOLDOWN_MS = 40;                       // evita ráfagas al mover rápido el ratón
const KMIN = 128, KMAX = 256 * 2 ** 21;       // límites de zoom (px por unidad Mercator)
const KFIT_MAX = 256 * 2 ** 18;
// Archivos que se cargan al iniciar (carpeta data/). Acepta .geojson, .json y .csv de WiGLE.
const DEFAULT_FILES = [
    'data/recorrido-2026-11-07T17-23-40.geojson',
    'data/recorrido-2026-11-07T17-23-45.geojson',
    'data/recorrido-2026-11-07T17-24-28.geojson',
    'data/WigleWifi_20261107122402.csv'
];

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
// Mediciones con aspecto propio (tipos de señal de WiGLE; rssi en dBm)
const PRESETS = {
  wifi_rssi_dbm: { label: 'WiFi', hex: '#4fc3f7', wave: 'sine',     base: 48, unit: 'dBm' },
  ble_rssi_dbm:  { label: 'BLE',  hex: '#ffb74d', wave: 'triangle', base: 60, unit: 'dBm' },
  bt_rssi_dbm:   { label: 'BT',   hex: '#ba68c8', wave: 'square',   base: 36, unit: 'dBm' },
  lte_rssi_dbm:  { label: 'LTE',  hex: '#81c784', wave: 'sawtooth', base: 48, unit: 'dBm' },
  gsm_rssi_dbm:  { label: 'GSM',  hex: '#e57373', wave: 'sawtooth', base: 36, unit: 'dBm' }
};
const RSSI_RANGO = { min: -115, max: -60 };      // rango fijo de potencia de señal (dBm)
const medidas = {};

function etiquetaDe(k) {
  const unidades = new Set(['c', 'pct', 'hpa', 'pa', 'ppm', 'v', 'mv', 'ms', 'raw', 'adc', 'dbm']);
  const t = k.split('_').filter((s, i, a) => !(i > 0 && i === a.length - 1 && unidades.has(s.toLowerCase())));
  return t.map((s, i) => (/\d/.test(s) ? s.toUpperCase() : (i === 0 ? s[0].toUpperCase() + s.slice(1) : s))).join(' ');
}
function unidadDe(k) {
  const s = k.split('_').pop().toLowerCase();
  return { c: '°C', pct: '%', hpa: 'hPa', pa: 'Pa', ppm: 'ppm', v: 'V', mv: 'mV', adc: 'ADC', dbm: 'dBm' }[s] || '';
}
function medida(k) {
  if (!medidas[k]) {
    const i = Object.keys(medidas).length;
    const pr = PRESETS[k] || {};
    const hex = pr.hex || PALETA[i % PALETA.length];
    const wave = pr.wave || WAVES[i % WAVES.length];
    medidas[k] = {
      idx: i, hex, base: pr.base !== undefined ? pr.base : REG[i % REG.length],
      son: { ...SON_DEF, custom: [...SON_DEF.custom], wave },
      rgb: [1, 3, 5].map(j => parseInt(hex.slice(j, j + 2), 16)),
      label: pr.label || etiquetaDe(k), unit: pr.unit !== undefined ? pr.unit : unidadDe(k)
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
const osm = { on: true, alpha: 0.55, estilo: 'osm' };
let trazo = true;

let hovered = null, lastHovered = null, selected = null;
let dragging = false, moved = 0, pressOnCanvas = false;
let pulsos = [];

let steady = true, running = false, playhead = 0, duration = 0, speed = 4, STEP = 0.5;

let audioOn = false, audioStarting = false, muted = false, ultimoDisparo = 0;
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
  for (const f of DEFAULT_FILES) cargarDefecto(f);
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

// CSV de WiGLE -> FeatureCollection de Point.
// Las columnas se desplazan según el tipo de señal (WIFI vs BLE/LTE/BT), así que no se usa la
// cabecera: se localiza la fecha (FirstSeen) en cada fila y el resto se cuenta desde ahí.
function wigleAGeoJSON(texto) {
  const FECHA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  const dividir = l => (l.indexOf('"') < 0 ? l.split(',') : l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/));
  const features = [];
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea) continue;
    const f = dividir(linea);
    const i = f.findIndex(v => FECHA.test(v));
    if (i < 0 || f.length < i + 11) continue;                 // metadatos / cabecera / fila corta
    const rssi = parseInt(f[i + 3], 10), lat = parseFloat(f[i + 4]), lon = parseFloat(f[i + 5]);
    const tipo = (f[i + 10] || '').trim().toUpperCase();
    const ms = Date.parse(f[i].replace(' ', 'T') + 'Z');       // WiGLE guarda la hora en UTC
    if (!tipo || !isFinite(rssi) || rssi >= 0 || !isFinite(lat) || !isFinite(lon) || !isFinite(ms)) continue;
    if (lat === 0 && lon === 0) continue;
    const props = {
      t: new Date(ms).toISOString(), ms,
      ssid: (f[1] || '').replace(/"/g, '').trim(), mac: f[0], tipo,
      [tipo.toLowerCase() + '_rssi_dbm']: rssi
    };
    const acc = parseFloat(f[i + 7]);
    if (isFinite(acc)) props.acc = acc;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props });
  }
  return features.length ? { type: 'FeatureCollection', features } : null;
}

// texto de un archivo -> GeoJSON (acepta GeoJSON/JSON y CSV de WiGLE)
function aJSON(texto, nombre) {
  if (/\.csv$/i.test(nombre) || /^\s*(WigleWifi|MAC,)/.test(texto)) {
    const g = wigleAGeoJSON(texto);
    if (!g) throw new Error('el CSV no tiene filas de WiGLE válidas');
    return g;
  }
  return JSON.parse(texto);
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
  const rango = {}, active = {}, invert = {}, cuenta = {};
  for (const k of keys) {
    medida(k);
    let mn = Infinity, mxv = -Infinity, c = 0;
    for (const p of pts) {
      const v = p.vals[k];
      if (v === undefined) continue;
      c++; if (v < mn) mn = v; if (v > mxv) mxv = v;
    }
    rango[k] = /_dbm$/.test(k) ? { ...RSSI_RANGO } : { min: mn, max: mxv };
    cuenta[k] = c;
    active[k] = true; invert[k] = false;
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const acum = q => { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); };
  pts.forEach(acum);
  shapes.forEach(s => s.v.forEach(acum));

  const L = {
    id: ++capaId, nombre, visible: true, color: COLORES_CAPA[(capaId - 1) % COLORES_CAPA.length],
    pts, shapes, keys, rango, active, invert, cuenta, next: 0, voces: {},
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
  const L = construirCapa(nombre.replace(/\.(geojson|json|csv)$/i, ''), json);
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
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const L of capas) {
    minX = Math.min(minX, L.bounds.minX); maxX = Math.max(maxX, L.bounds.maxX);
    minY = Math.min(minY, L.bounds.minY); maxY = Math.max(maxY, L.bounds.maxY);
  }
  if (capas.length) GB = { minX, minY, maxX, maxY };
}

async function cargarArchivo(f) {
  try { addCapa(f.name, aJSON(await f.text(), f.name)); }
  catch (err) { alert(`No se pudo leer "${f.name}": ${err.message}`); }
}

// archivos por defecto (carpeta data/); si no existen, se ignora en silencio
async function cargarDefecto(ruta) {
  try {
    const r = await fetch(ruta);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const nombre = decodeURIComponent(ruta.split('/').pop());
    addCapa(nombre, aJSON(await r.text(), nombre));
  } catch (err) { console.warn('No se cargó', ruta, err.message); }
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

function tocar(p, conCooldown = false, vistos = null) {
  if (!audioOn || muted || !p || !p.L.visible) return;
  if (conCooldown) {
    const ahora = millis();
    if (ahora - ultimoDisparo < COOLDOWN_MS) return;
    ultimoDisparo = ahora;
  }
  const L = p.L;
  for (const k of L.keys) {
    if (!L.active[k] || p.n[k] === undefined) continue;
    if (vistos) {                                   // una sola nota por voz y cuadro
      const id = L.id + '|' + k;
      if (vistos.has(id)) continue;
      vistos.add(id);
    }
    const v = voz(L, k), md = medidas[k];
    v.osc.setType(md.son.wave);
    v.env.setRange(AMPS[md.son.wave] * md.son.vol, 0);
    v.osc.freq(midiToFreq(midiDe(k, p.n[k])));
    v.osc.pan(panDe(p));
    v.env.play(v.osc);
  }
}

function actualizarAudioUI() {
  const mb = $('mute');
  if (mb) mb.firstChild.textContent = muted ? 'Activar sonido ' : 'Silenciar ';
}

// ---------------------------------------------------------------- tiempo
// Tiempo real: relativo al inicio de cada archivo (las sesiones suelen ser de días distintos)
function timeOf(L, p) {
  if (steady || p.ms === null || L.ms0 === null) return p.i * STEP;
  return (p.ms - L.ms0) / 1000;
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
// zona libre del mapa (fuera de los paneles), según la vista
function margenesMapa() {
  if (document.body.classList.contains('vertical')) {
    // vertical: cabecera arriba; transporte, pestañas y panel abajo
    const ca = $('cabecera').getBoundingClientRect(), tr = $('transport').getBoundingClientRect();
    return { l: 20, r: 20, t: ca.bottom + 16, b: Math.max(height - tr.top + 16, 100) };
  }
  const ancho = width > 1000;
  return { l: ancho ? $('panel-izq').offsetWidth + 40 : 20, r: ancho ? $('panel-der').offsetWidth + 40 : 20, t: 60, b: 120 };
}

// centro de esa zona (donde está la mira del gamepad); se recalcula cada 300 ms
let centroCache = { x: 0, y: 0, t: -1e9 };
function centroMapa() {
  if (millis() - centroCache.t > 300) {
    const m = margenesMapa();
    centroCache = { x: (m.l + width - m.r) / 2, y: (m.t + height - m.b) / 2, t: millis() };
  }
  return centroCache;
}

function zoomEn(cx, cy, f) {
  const wx = (cx - view.x) / view.k, wy = (cy - view.y) / view.k;
  view.k = constrain(view.k * f, KMIN, KMAX);
  view.x = cx - wx * view.k;
  view.y = cy - wy * view.k;
}

function fitView(lista) {
  const objetivo = (lista || capas).filter(L => L.visible);
  const usar = objetivo.length ? objetivo : (lista || capas);
  if (!usar.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const L of usar) {
    minX = Math.min(minX, L.bounds.minX); maxX = Math.max(maxX, L.bounds.maxX);
    minY = Math.min(minY, L.bounds.minY); maxY = Math.max(maxY, L.bounds.maxY);
  }
  const m = margenesMapa();
  const w = Math.max(maxX - minX, 2e-6), h = Math.max(maxY - minY, 2e-6);
  const aw = Math.max(width - m.l - m.r, 100), ah = Math.max(height - m.t - m.b, 100);
  fitK = constrain(Math.min(aw / w, ah / h), KMIN, KFIT_MAX);
  view.k = fitK;
  view.x = m.l + aw / 2 - (minX + w / 2) * view.k;
  view.y = m.t + ah / 2 - (minY + h / 2) * view.k;
}

// ---------------------------------------------------------------- teselas OSM
const tiles = new Map();
const sub = (x, y, l) => l[(x + y) % l.length];
const BASES = {
  osm:      { nombre: 'OpenStreetMap estándar', max: 19, attr: '© colaboradores de OpenStreetMap',
              url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png` },
  hot:      { nombre: 'OSM Humanitario (HOT)', max: 19, attr: '© OpenStreetMap · HOT',
              url: (z, x, y) => `https://${sub(x, y, 'abc')}.tile.openstreetmap.fr/hot/${z}/${x}/${y}.png` },
  cyclosm:  { nombre: 'CyclOSM (ciclismo)', max: 19, attr: '© OpenStreetMap · CyclOSM',
              url: (z, x, y) => `https://${sub(x, y, 'abc')}.tile-cyclosm.openstreetmap.fr/cyclosm/${z}/${x}/${y}.png` },
  topo:     { nombre: 'OpenTopoMap (relieve)', max: 17, attr: '© OpenStreetMap · SRTM · OpenTopoMap',
              url: (z, x, y) => `https://${sub(x, y, 'abc')}.tile.opentopomap.org/${z}/${x}/${y}.png` }
};

function getTesela(z, x, y, cargar = true) {
  const id = osm.estilo + '/' + z + '/' + x + '/' + y;
  let t = tiles.get(id);
  if (!t && cargar) {
    const img = new Image();
    t = { img, ok: false, used: frameCount };
    img.onload = () => { t.ok = true; };
    img.onerror = () => { t.err = true; };
    img.src = BASES[osm.estilo].url(z, x, y);
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
  const z = constrain(Math.round(Math.log2(k / 256)), 0, BASES[osm.estilo].max);
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

// ---------------------------------------------------------------- joystick por Web Serial (ESP32 + USB)
// Ver examples/Serial-Joystick. Líneas de texto "J,x,y,btn" (x, y de -127 a 127). Chrome / Edge,
// desde localhost o HTTPS; el permiso del puerto se pide con el botón "🎮 Joystick".
const SERIE = { baudios: 115200, puerto: null, lector: null, buf: '', conectado: false, ax: 0, ay: 0, btn: false };

function procesarSerie(texto) {
  SERIE.buf += texto;
  let i;
  while ((i = SERIE.buf.indexOf('\n')) >= 0) {
    const linea = SERIE.buf.slice(0, i).trim();
    SERIE.buf = SERIE.buf.slice(i + 1);
    const m = /^J,(-?\d+),(-?\d+),([01])$/.exec(linea);       // otras líneas (arranque, basura) se ignoran
    if (!m) continue;
    SERIE.ax = constrain(+m[1] / 127, -1, 1);
    SERIE.ay = constrain(+m[2] / 127, -1, 1);
    SERIE.btn = m[3] === '1';
  }
  if (SERIE.buf.length > 200) SERIE.buf = '';
}

async function conectarSerie(puertoConocido = null) {
  if (!('serial' in navigator)) return;
  try {
    const puerto = puertoConocido || await navigator.serial.requestPort();
    await puerto.open({ baudRate: SERIE.baudios });
    try { await puerto.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch (e) { /* noop */ }
    SERIE.puerto = puerto; SERIE.conectado = true; SERIE.buf = '';
    actualizarJoyUI();
    leerSerie(puerto);
  } catch (err) {
    if (!puertoConocido && err.name !== 'NotFoundError') alert('No se pudo abrir el puerto serie: ' + err.message +
      '\n(¿Está abierto el monitor serie u otro programa?)');
  }
}

async function leerSerie(puerto) {
  const decodificador = new TextDecoderStream();
  const cerrado = puerto.readable.pipeTo(decodificador.writable).catch(() => {});
  const lector = decodificador.readable.getReader();
  SERIE.lector = lector;
  try {
    while (true) {
      const { value, done } = await lector.read();
      if (done) break;
      procesarSerie(value);
    }
  } catch (e) { /* cable desconectado */ }
  try { lector.releaseLock(); } catch (e) { /* noop */ }
  await cerrado;
  try { await puerto.close(); } catch (e) { /* noop */ }
  SERIE.conectado = false; SERIE.puerto = null; SERIE.lector = null;
  SERIE.ax = 0; SERIE.ay = 0; SERIE.btn = false;
  actualizarJoyUI();
}

function desconectarSerie() {
  if (SERIE.lector) SERIE.lector.cancel().catch(() => {});
}

function actualizarJoyUI() {
  const b = $('joy');
  if (!b) return;
  b.textContent = SERIE.conectado ? '🎮 Conectado ✓' : '🎮 Joystick';
  b.title = SERIE.conectado ? 'Joystick conectado por USB (clic para desconectar)' : 'Conectar el joystick de la ESP32 por USB (Web Serial)';
}

// ---------------------------------------------------------------- gamepad (Web Serial o USB HID en ESP32-S2/S3)
// Ver examples/MapaGamepad. El stick desplaza el mapa bajo una mira fija al centro:
// el punto más cercano a la mira suena, como el hover del ratón.
const PAD = {
  ID: /Mapa Gamepad|303a/i,   // nombre / VID del dispositivo; si no hay coincidencia se usa el primer gamepad
  zonaMuerta: 0.06,           // zona muerta extra en el navegador (la principal está en el firmware)
  velPan: 520,                // px/s con el stick al máximo
  velZoom: 1.6,               // el zoom cambia un factor e^1.6 por segundo con el stick al máximo
  radioMira: 18               // px: distancia a la que la mira "toca" un punto
};
const pad = { activo: false, modoZoom: false, prev0: false };

function leerGamepad() {
  // origen 1: Web Serial (ESP32 por USB) · origen 2: Gamepad API (ESP32-S2/S3 como HID)
  let ax = 0, ay = 0, b0 = false;
  if (SERIE.conectado) {
    ax = SERIE.ax; ay = SERIE.ay; b0 = SERIE.btn;
  } else {
    if (!navigator.getGamepads) return;
    const lista = Array.from(navigator.getGamepads()).filter(Boolean);
    const g = lista.find(p => PAD.ID.test(p.id)) || lista[0];
    if (!g) return;
    ax = g.axes[0] || 0; ay = g.axes[1] || 0;
    b0 = !!(g.buttons[0] && g.buttons[0].pressed);
  }

  // pulsador del stick (botón 0): alterna desplazar / zoom al pulsar
  if (b0 && !pad.prev0) { pad.activo = true; pad.modoZoom = !pad.modoZoom; }
  pad.prev0 = b0;

  const dz = v => (Math.abs(v) < PAD.zonaMuerta ? 0 : v);
  ax = dz(ax); ay = dz(ay);
  if (!ax && !ay) return;
  pad.activo = true;

  const dt = constrain(deltaTime, 0, 100) / 1000;
  const curva = v => Math.sign(v) * v * v;          // respuesta cuadrática: control fino cerca del centro
  if (pad.modoZoom) {
    const c = centroMapa();
    zoomEn(c.x, c.y, Math.exp(-curva(ay) * PAD.velZoom * dt));      // stick arriba = acercar
  } else {
    view.x -= curva(ax) * PAD.velPan * dt;           // el mapa se mueve al revés del stick
    view.y -= curva(ay) * PAD.velPan * dt;
  }
}

function dibujarMira() {
  if (!pad.activo) return;
  const c = centroMapa(), r = PAD.radioMira;
  noFill(); stroke(255, pad.modoZoom ? 255 : 170); strokeWeight(pad.modoZoom ? 2.2 : 1.2);
  circle(c.x, c.y, r * 2);
  strokeWeight(1.2); stroke(255, 170);
  line(c.x - r - 8, c.y, c.x - r + 4, c.y); line(c.x + r - 4, c.y, c.x + r + 8, c.y);
  line(c.x, c.y - r - 8, c.x, c.y - r + 4); line(c.x, c.y + r - 4, c.x, c.y + r + 8);
  if (pad.modoZoom) {
    noStroke(); fill(255); textSize(12); textAlign(CENTER, CENTER);
    text('+', c.x, c.y - r - 16); text('−', c.x, c.y + r + 16);
  }
}

// ---------------------------------------------------------------- dibujo
function draw() {
  background('#0e1118');
  leerGamepad();
  dibujarOSM();

  if (!capas.length) {
    noStroke(); fill(255, 90); textAlign(CENTER, CENTER); textSize(15);
    text('Añade o arrastra un archivo .geojson', width / 2, height / 2);
    return;
  }

  if (running) {
    playhead += constrain(deltaTime, 0, 100) / 1000 * speed;
    const lote = [];
    for (const L of capas) {
      while (L.next < L.pts.length && timeOf(L, L.pts[L.next]) <= playhead) {
        const p = L.pts[L.next++];
        if (L.visible) lote.push(p);
      }
    }
    if (lote.length) {
      const vistos = new Set();
      for (let i = lote.length - 1; i >= 0; i--) tocar(lote[i], false, vistos);
      for (const p of lote.slice(-40)) pulsos.push({ p, t0: millis() });
    }
    if (playhead > duration + 1.5) reiniciarReproduccion();   // loop
  }

  hovered = findHover();
  if (hovered !== lastHovered) {
    if (hovered) { tocar(hovered, true); pulsos.push({ p: hovered, t0: millis() }); }
    lastHovered = hovered;
  }
  if (pad.activo) noCursor(); else cursor(hovered ? HAND : (dragging ? 'grabbing' : ARROW));

  for (const L of capas) if (L.visible) dibujarFormas(L);
  for (const L of capas) if (L.visible && trazo) dibujarRecorrido(L);
  for (const L of capas) if (L.visible) dibujarPuntos(L);
  dibujarPulsos();
  for (const L of capas) if (L.visible) dibujarCursor(L);
  dibujarMira();

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
  const ctx = drawingContext;
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = 1.5;
  ctx.strokeStyle = L.pts.length > 3000 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  L.pts.forEach((p, i) => (i ? ctx.lineTo(sx(p), sy(p)) : ctx.moveTo(sx(p), sy(p))));
  ctx.stroke();

  if (reproduciendo() && L.next > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.47)';
    ctx.beginPath();
    for (let i = 0; i < L.next; i++) { const p = L.pts[i]; i ? ctx.lineTo(sx(p), sy(p)) : ctx.moveTo(sx(p), sy(p)); }
    const c = posCursor(L);
    if (c && running) ctx.lineTo(c.x, c.y);
    ctx.stroke();
  }
  ctx.restore();
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

// ¿el punto tiene alguna medición activa? (archivos sin mediciones: siempre sí)
const puntoActivo = (L, p) => !L.keys.length || L.keys.some(k => L.active[k] && p.n[k] !== undefined);

function dibujarPuntos(L) {
  const activas = L.keys.filter(k => L.active[k]);
  const rep = reproduciendo();

  if (L.pts.length > 3000) {
    dibujarPuntosRapido(L, activas, rep);
  } else {
    for (const p of L.pts) {
      const x = sx(p), y = sy(p);
      if (x < -30 || y < -30 || x > width + 30 || y > height + 30) continue;
      if (L.keys.length && !activas.some(k => p.n[k] !== undefined)) continue;
      const activo = p === hovered || p === selected;
      const pendiente = rep && p.i >= L.next;

      if ((pendiente && !activo) || !activas.length) {
        noFill(); stroke(255, pendiente ? 40 : 90); strokeWeight(1);
        circle(x, y, pendiente ? 4 : 5);
      } else {
        for (const k of activas) {
          if (p.n[k] === undefined) continue;
          const m = medidas[k];
          marca(m.idx % 6, x, y, p.n[k], m.rgb, activo);
        }
      }
    }
  }
  for (const p of [hovered, selected]) {
    if (p && p.L === L) { noFill(); stroke(255); strokeWeight(1.5); circle(sx(p), sy(p), 32); }
  }
}

// Archivos grandes (p. ej. WiGLE, miles de filas): discos agrupados por medición en un solo trazo
function dibujarPuntosRapido(L, activas, rep) {
  const ctx = drawingContext;
  const dentro = (x, y) => x > -20 && y > -20 && x < width + 20 && y < height + 20;
  ctx.save();
  if (rep) {
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    for (let i = L.next; i < L.pts.length; i++) {
      const p = L.pts[i], x = sx(p), y = sy(p);
      if (dentro(x, y) && puntoActivo(L, p)) ctx.rect(x - 1, y - 1, 2, 2);
    }
    ctx.fill();
  }
  const fin = rep ? L.next : L.pts.length;
  for (const k of activas) {
    const [r, g, b] = medidas[k].rgb;
    ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
    ctx.beginPath();
    for (let i = 0; i < fin; i++) {
      const p = L.pts[i], n = p.n[k];
      if (n === undefined) continue;
      const x = sx(p), y = sy(p);
      if (!dentro(x, y)) continue;
      const rad = 2 + 6 * n;
      ctx.moveTo(x + rad, y);
      ctx.arc(x, y, rad, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.restore();
}

function dibujarPulsos() {
  noFill();
  pulsos = pulsos.filter(u => millis() - u.t0 < 450);
  for (const u of pulsos) {
    const L = u.p.L;
    const k = L.keys.find(key => L.active[key] && u.p.n[key] !== undefined);
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
  if (p.props.ssid) partes.push(p.props.ssid.length > 24 ? p.props.ssid.slice(0, 23) + '…' : p.props.ssid);
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
  const x = Math.min(sx(p) + 14, width - w - 6), y = Math.max(sy(p) - 34, 6);
  noStroke(); fill(10, 13, 20, 235);
  rect(x, y, w, 22, 6);
  fill(255); text(txt, x + 7, y + 11);
}

// de dónde se busca el punto: la mira del gamepad (si está en uso) o el ratón
function puntero() {
  if (pad.activo) { const c = centroMapa(); return { x: c.x, y: c.y, r: PAD.radioMira }; }
  if (dragging || !mouseSobreCanvas()) return null;
  return { x: mouseX, y: mouseY, r: 12 };
}

function findHover() {
  const q = puntero();
  if (!q) return null;
  let mejor = null, dMin = Infinity;
  for (const L of capas) {
    if (!L.visible) continue;
    for (const p of L.pts) {
      const dx = q.x - sx(p);
      if (dx > q.r || dx < -q.r) continue;
      const dy = q.y - sy(p);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < q.r && d < dMin && puntoActivo(L, p)) { dMin = d; mejor = p; }
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
  pad.activo = false;
  pressOnCanvas = !!(e && e.target === drawingContext.canvas);
  moved = 0;
  asegurarAudio();
}

function mouseDragged() {
  pad.activo = false;
  if (!pressOnCanvas) return;
  dragging = true;
  moved += abs(mouseX - pmouseX) + abs(mouseY - pmouseY);
  view.x += mouseX - pmouseX;
  view.y += mouseY - pmouseY;
}

function alternarSeleccion() {
  selected = hovered === selected ? null : hovered;
  mostrarInfo(selected);
}

function mouseMoved() { pad.activo = false; }      // al mover el ratón, éste recupera el control

function mouseReleased() {
  if (pressOnCanvas && moved < 4) alternarSeleccion();      // clic sin arrastre
  dragging = false; pressOnCanvas = false;
}

function mouseWheel(e) {
  if (e.target !== drawingContext.canvas) return;
  const f = e.delta > 0 ? 0.9 : 1.1;
  pad.activo = false;
  zoomEn(mouseX, mouseY, f);
  return false;
}

function keyPressed() {
  const ae = document.activeElement;
  if (ae && ['INPUT', 'SELECT', 'TEXTAREA'].includes(ae.tagName) && ae.type !== 'range' && ae.type !== 'checkbox') return;
  if (ae && (ae.tagName === 'BUTTON' || ae.tagName === 'SUMMARY' || ae.type === 'range' || ae.type === 'checkbox')) ae.blur();
  if (key === ' ') { togglePlay(); return false; }
  if (key === 'r' || key === 'R') fitView();
  if (key === 'm' || key === 'M') { muted = !muted; actualizarAudioUI(); }
  if (key === 't' || key === 'T') toggleModo();
  if (key === 'o' || key === 'O') setOSM(!osm.on);
  if (key === 'v' || key === 'V') setVista(!document.body.classList.contains('vertical'));
  if (key === 'l' || key === 'L') setTrazo(!trazo);
  if (keyCode === ESCAPE) { selected = null; mostrarInfo(null); }
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); fitView(); }

// ---------------------------------------------------------------- UI HTML
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function setOSM(v) { osm.on = v; $('osm-on').checked = v; $('atrib').style.display = v ? '' : 'none'; }
function setEstilo(id) { osm.estilo = id; $('osm-estilo').value = id; $('atrib').textContent = BASES[id].attr; }
function setTrazo(v) { trazo = v; $('trazo-on').checked = v; }

// Vista horizontal (paneles a los lados) / vertical (paneles abajo, con pestañas)
function setVista(vertical, reencuadrar = true) {
  document.body.classList.toggle('vertical', vertical);
  $('vista').textContent = vertical ? 'Vertical' : 'Horizontal';
  try { localStorage.setItem('vista', vertical ? 'vertical' : 'horizontal'); } catch (e) { /* noop */ }
  if (reencuadrar) requestAnimationFrame(() => fitView());
}

function elegirPestana(t) {
  document.body.dataset.tab = t;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  requestAnimationFrame(() => fitView());
}

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
        <span>${esc(m.label)}<small>${fmt(k, r.min)} – ${fmt(k, r.max)} ${esc(m.unit)}${L.cuenta[k] < L.pts.length ? ' · ' + L.cuenta[k] + ' pts' : ''}</small>
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
      ${p.props.ssid ? `<dt>Red</dt><dd>${esc(p.props.ssid)}</dd>` : ''}
      ${p.props.tipo ? `<dt>Tipo</dt><dd>${esc(p.props.tipo)}</dd>` : ''}
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
  // --- joystick por Web Serial
  if ('serial' in navigator) {
    $('joy').onclick = e => { if (SERIE.conectado) desconectarSerie(); else conectarSerie(); e.target.blur(); };
    // si el navegador ya tiene permiso para un único puerto, reconecta solo
    navigator.serial.getPorts().then(l => { if (l.length === 1) conectarSerie(l[0]); }).catch(() => {});
  } else {
    $('joy').hidden = true;
  }
  actualizarJoyUI();

  window.addEventListener('gamepadconnected', e => console.log('Gamepad conectado:', e.gamepad.id));

  // --- vista: la guardada, o según la orientación de la pantalla
  let guardada = null;
  try { guardada = localStorage.getItem('vista'); } catch (e) { /* noop */ }
  setVista(guardada ? guardada === 'vertical' : window.innerHeight > window.innerWidth, false);
  $('vista').onclick = e => { setVista(!document.body.classList.contains('vertical')); e.target.blur(); };
  document.querySelectorAll('#tabs button').forEach(b => { b.onclick = () => elegirPestana(b.dataset.tab); });

  // --- mapas
  for (const [id, b] of Object.entries(BASES)) $('osm-estilo').add(new Option(b.nombre, id));
  $('osm-estilo').onchange = e => { setEstilo(e.target.value); e.target.blur(); };
  setEstilo(osm.estilo);
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
  // velocidad exponencial: 0.5× … 300×
  $('speed').addEventListener('input', e => {
    speed = +(0.5 * Math.pow(600, +e.target.value / 100)).toPrecision(2);
    $('speed-val').textContent = speed + '×';
  });
  $('speed').dispatchEvent(new Event('input'));
  $('step').addEventListener('change', e => {
    STEP = Math.max(0.01, +e.target.value || 0.5);
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
