// direccion o ubicacion del archivo CSV
//const CSV = 'andres-wigle-2026-10-24.csv';
const MAPS = [
 // {name: 'aaaa', file: 'csv-wigle/aaaa-wigle.csv', transpose: 0},
//  {name: 'alej', file: 'csv-wigle/alej-wigle.csv', transpose: 0},
  {name: 'andr', file: 'csv-wigle/andr-wigle.csv', transpose: 1},
  {name: 'azul', file: 'csv-wigle/azul-wigle.csv', transpose: 3},
  {name: 'laur', file: 'csv-wigle/laur-wigle.csv', transpose: 5},
 // {name: 'lina', file: 'csv-wigle/lina-wigle.csv', transpose: 4},
]

//esquina superiro boton mapas activar/desactivar
const MAPBTN = {w: 70, h: 26, gap:8, margin: 16};

//para alternar entre relacion de tiempos de la captura
//y un tiempo estable
const STEP = 1;
const STEPMODEBTN = {w: 150, h: 26, margin: 16};
let steady = true;
// 4 = el escaneo (~86 s) dura ~21 s
// Velocidad de recorrido
const SPEED = 80;

// tipos de señal.
const TYPES = ['WIFI', 'BLE', 'BT', 'LTE', 'GSM'];
const COLOR = {
  WIFI: '#4fc3f7',
  BLE:  '#ffb74d',
  BT:   '#ba68c8',
  LTE:  '#81c784',
  GSM:  '#e57373'
};

// forma de onda para p5.Oscillator.
const WAVE = {
  WIFI: 'sine',
  BLE:  'triangle',
  BT:   'square',
  LTE:  'sawtooth',
  GSM:  'sawtooth'
};

const BASENOTE = 48; //do
//[1, 3, 5, 8, 10] pentatonica mayor
//   [1, 3, 5, 6, 8, 10, 12]  mayor
const SCALE = [1, 3, 5, 8, 10];
const OCTAVES = 4;

// Rango de RSSI (dBm) que se mapea a tamaño y tono.
// -115 = señal muy débil, -60 = señal muy fuerte.
const RSSI_MIN = -115;
const RSSI_MAX = -60;

// panel izquierdo
// leyenda y lista - en píxeles.
const PANEL = {
  x: 16,
  y: 24,
  rowH: 22,// alto de cada fila de la leyenda
  w: 170, // ancho de la zona cliqueable
  listRowH: 16, // alto de de la lista de antenas
  maxChars: 24 // caracteres máximos de un nombre
};


//estado global
//let lines; // filas del csv / preload
let mapsOn = MAPS.map(() => true); //mapas activos
let rows = []; // antenas parseadas / setup()
let duration = 0;// duración del escaneo en segundos
let playhead = 0;// posición del cursor temporal en segundos
let running = false;// play pause
let voices = {};// { tipo: { osc, env } } una voz por tipo de señal
let box;// limites {minLat, maxLat, minLon, maxLon}
// tipos de señales activos
let enabled = { WIFI: true, BLE: true, BT: true, LTE: true, GSM: true };
// antenas de cada tipo en CSV / setup()
let counts = {};


// loadStrings - loadTable
function preload() {
  //lines = loadStrings(CSV);
  for (const map of MAPS) map.lines = loadStrings(map.file);
}

/**
  parseCSV(lines) filas a objetos "antena"
  Formato WiGLE:
  lnea 0 = metadatos
  linea 1 = cabecera de columnas
  linea 2 = datos
  Columnas:
  1 SSID  3 FirstSeen 6 RSSI 7 Latitud 8 Longitud 13 Tipo

  Cada fila se divide por comas - comillas
  tipo retorno
    {
    ssid:   nombre de la red/dispositivo - si no tiene ''
      type:   'WIFI' | 'BLE' | 'BT' | 'LTE' | 'GSM'
      rssi:   potencia de señal en dBm - numero negativo
      lat, lon: posición en grados
      t:      segundos desde la primera antena
      played: true - paso del cursor-dial
      flash:  1 → 0 - anillo animado
    }
 */
function parseCSV(lines, mapIndex) {
  // Regex: coma que NO está dentro de un par de comillas.
  const split = l => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);

  // slice(2) salta metadatos y cabecera
  // 1 si solo esta cabecera
  // filter quita líneas vacías.
  const data = lines.slice(1).filter(l => l.trim()).map(split);
  //const data = lines.filter(l => l.trim()).map(split);
  //sin cabecera y metadatos
  // const data = lines.filter(l => l.trim()).map(split);

  // hora de la primera antena
  // referencia para calcular t.
  const t0 = new Date(data[0][3].replace(' ', 'T')).getTime();

  return data.map((f, k) => ({
    map:    mapIndex,
    ssid:   f[1].replace(/"/g, '').trim(),
    type:   f[13].trim(),
    rssi:   +f[6],
    lat:    +f[7],
    lon:    +f[8],
    t:      (new Date(f[3].replace(' ', 'T')).getTime() - t0) / 1000,
    tSteady: k * STEP,
    played: false,
    flash:  0
  }));
}



//Crear el canvas, parsea los datos,
//calcula límites geográficos y conteos,
// y construye las voces de audio.
function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont('monospace');

  //rows = parseCSV(lines);
  rows = MAPS.flatMap((map, index) => parseCSV(map.lines, index))
  //duration = max(rows.map(r => r.t));
  updateDuration();

  // Límites geogrficos
  //sirven para escalar lat/lon a la pantalla
  // box = {
  //   minLat: min(rows.map(r => r.lat)), maxLat: max(rows.map(r => r.lat)),
  //   minLon: min(rows.map(r => r.lon)), maxLon: max(rows.map(r => r.lon))
  // };
  updateBounds();

  //conteo de antenas por tipo / leyenda
  for (const t of TYPES) counts[t] = rows.filter(r => r.type === t).length;

  //asignacion de voces a tipos de señal
  for (const type of TYPES) {
    const osc = new p5.Oscillator(WAVE[type]);
    const env = new p5.Envelope();
    env.setADSR(0.01, 0.15, 0.0, 0.1);
    env.setRange(0.25, 0);// intensidad max final
    osc.amp(0); //empieza en silencio
    osc.start();
    voices[type] = { osc, env };
  }
}

function isActive(r) {
  return enabled[r.type] && mapsOn[r.map];
}
//tiempo en que suena la antena, según el modo
function timeOf(r) {
  return steady ? r.tSteady : r.t;
}

// duración cambia con el modo
function updateDuration() {
  duration = max(rows.map(timeOf));
}

// alterna el modo, reinicia la reproducción
function toggleTimeMode() {
  steady = !steady;
  playhead = 0;
  rows.forEach(r => { r.played = false; r.flash = 0; });
  updateDuration();
}
  //posicion geografica de antenas a pixeles
  //la latitud se invierte / y crece hacia abajo
  //@param {object} r antena
 // @returns {number[]} [x, y] en píxeles
function toXY(r) {
  const pad = 80; // margenes
  const dLon = box.maxLon - box.minLon || 1e-6;// ancho
  const dLat = box.maxLat - box.minLat || 1e-6;// alto
  const s = min((width - 2 * pad) / dLon, (height - 2 * pad) / dLat);
  return [
    width  / 2 + (r.lon - (box.minLon + box.maxLon) / 2) * s,
    height / 2 - (r.lat - (box.minLat + box.maxLat) / 2) * s
  ];
}

/**
recalcula los límites geográficos usando solo las
antenas de los mapas activos. toXY() usa box para centrar y escalar,
*/
function updateBounds() {
  const act = rows.filter(r => mapsOn[r.map]);
  if (act.length === 0) return;

  box = {
    minLat: min(act.map(r => r.lat)), maxLat: max(act.map(r => r.lat)),
    minLon: min(act.map(r => r.lon)), maxLon: max(act.map(r => r.lon))
  };
}

//potencia senal a midi
 //@param {number} rssi dBm
 //@returns {number} nota MIDI
function noteFor(rssi, transpose = 0) {
  const len = SCALE.length;
  const totalSteps = len * OCTAVES;
  const step = round(map(constrain(rssi, RSSI_MIN, RSSI_MAX), RSSI_MIN, RSSI_MAX, 0, totalSteps - 1));
  return BASENOTE + 12 * floor(step / len) + (SCALE[step % len] - 1) + transpose;
}

//@param {object} r antena
function trigger(r) {
  if (!isActive(r)) return;
  const v = voices[r.type];
  v.osc.freq(midiToFreq(noteFor(r.rssi, MAPS[r.map].transpose)));
  v.env.play(v.osc);//bang la envolvente
  r.flash = 1;//animacion
}


//60fps
//fondo > tiempo y notas > recorrido > antenas > leyenda
function draw() {
  background(12, 14, 20);

  if (running) {
    // deltaTime ms desde el cuadro anterior
    // no depende de FPS
    playhead += (deltaTime / 1000) * SPEED;

    for (const r of rows) {
      if (!r.played && timeOf(r) <= playhead) {
        r.played = true;
        trigger(r);
      }
    }

    // +2 s de cola y loop
    if (playhead > duration + 2) {
      playhead = 0;
      rows.forEach(r => { r.played = false; r.flash = 0; });
    }
  }

  drawPath();
  drawAntennas();
  drawUI();
}

// dibujar el recorrido cronologico
function drawPath() {
  noFill();
  stroke(255, 40);
  MAPS.forEach((m, i) => {
    if (!mapsOn[i]) return;
    beginShape();
    rows.filter(r => r.map === i).forEach(r => vertex(...toXY(r)));
    endShape();
  });
}

function mapButtonRect(i) {
  const x = width - MAPBTN.margin - (MAPS.length - i) * (MAPBTN.w + MAPBTN.gap) + MAPBTN.gap;
  return { x, y: MAPBTN.margin, w: MAPBTN.w, h: MAPBTN.h };
}

function mapButtonAt(mx, my) {
  for (let i = 0; i < MAPS.length; i++) {
    const b = mapButtonRect(i);
    if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return i;
  }
  return -1;
}

function drawMapButtons() {
  textAlign(CENTER, CENTER);
  textSize(12);
  MAPS.forEach((m, i) => {
    const b = mapButtonRect(i);
    const on = mapsOn[i];
    stroke(on ? 230 : 90);
    fill(on ? color(255, 30) : color(0, 0));
    rect(b.x, b.y, b.w, b.h, 6);
    noStroke();
    fill(on ? 230 : 110);
    text(m.name, b.x + b.w / 2, b.y + b.h / 2);
  });
}

// estado cambia si paso el reproductor o no
// animacion al pasar el dial
function drawAntennas() {
  for (const r of rows) {
    if (!isActive(r)) continue;

    const [x, y] = toXY(r);
    const size = map(constrain(r.rssi, RSSI_MIN, RSSI_MAX), RSSI_MIN, RSSI_MAX, 6, 28);
    const c = color(COLOR[r.type] || '#ffffff');

    if (r.played) {
      // base punto inicial
      noStroke();
      c.setAlpha(120);
      fill(c);
      circle(x, y, size);

      // animacion
      // crece N px y se desvanece
      if (r.flash > 0) {
        noFill();
        c.setAlpha(255 * r.flash);
        stroke(c);
        circle(x, y, size + (1 - r.flash) * 10);
        r.flash -= 0.02;
      }
    } else {
      // punto pendiente
      noFill();
      stroke(255, 25);
      circle(x, y, 4);
    }
  }
}

function drawUI() {
  const legendBottom = drawLegend();
  drawDetectedList(legendBottom + 24);
  drawTimeline();
  drawMapButtons();
  drawModeButton();
  const overUI = legendRowAt(mouseX, mouseY) !== null || mapButtonAt(mouseX, mouseY) !== -1 || overModeButton(mouseX, mouseY);
  cursor(overUI ? HAND : ARROW);

  if (!running && playhead === 0) {
    fill(200);
    noStroke();
    textSize(12);
    textAlign(CENTER, CENTER);
  }

  //reset alineación por defecto
  textAlign(LEFT, BASELINE);
}

function modeButtonRect() {
  return {
    x: width - STEPMODEBTN.margin - STEPMODEBTN.w,
    y: STEPMODEBTN.margin + MAPBTN.h + 10,   //debajo de los botones de mapa
    w: STEPMODEBTN.w,
    h: STEPMODEBTN.h
  };
}

function overModeButton(mx, my) {
  const b = modeButtonRect();
  return mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
}

function drawModeButton() {
  const b = modeButtonRect();
  textAlign(CENTER, CENTER);
  textSize(12);
  stroke(steady ? 230 : 140);
  fill(steady ? color(255, 30) : color(0, 0));
  rect(b.x, b.y, b.w, b.h, 6);
  noStroke();
  fill(steady ? 230 : 170);
  text(steady ? 'Tiempo: constante' : 'Tiempo: real', b.x + b.w / 2, b.y + b.h / 2);
}
//fila por tipo
//tipo desactivado / apagado y tachado.
//cambia  cursor  sobre una fila.
 //@returns {number} coordenada / leyenda
function drawLegend() {
  textAlign(LEFT, CENTER);
  textSize(12);
  noStroke();

  //let hovering = false;

  TYPES.forEach((t, i) => {
    const y = PANEL.y + i * PANEL.rowH; // centro vertical de la fila
    const on = enabled[t];
    const over = legendRowAt(mouseX, mouseY) === t;
    //if (over) hovering = true;

    // fondo hover
    if (over) {
      fill(255, 25);
      rect(PANEL.x - 6, y - PANEL.rowH / 2, PANEL.w, PANEL.rowH, 4);
    }

    const c = color(COLOR[t]);
    if (on) { noStroke(); fill(c); }
    else    { noFill(); stroke(c); strokeWeight(1); }
    circle(PANEL.x + 6, y, 10);
    strokeWeight(1);

    //nombre + conteo / antenas filas
    noStroke();
    fill(on ? 230 : 110);
    text(`${t}  (${counts[t]})`, PANEL.x + 26, y);

    //tachado
    if (!on) {
      stroke(110);
      const w = textWidth(`${t}  (${counts[t]})`);
      line(PANEL.x + 26, y, PANEL.x + 26 + w, y);
    }
  });

  //cursor(hovering ? HAND : ARROW);

  //info leyenda
  const bottom = PANEL.y + TYPES.length * PANEL.rowH;
  noStroke();
  fill(120);
  textSize(10);
  text('clic para activar/desactivar', PANEL.x - 6, bottom);
  return bottom;
}

/**
lista de antenas detectadas
las más recientes quedan abajo
las más antiguas salen por arriba / contador
@param {number} startY coordenada y donde empieza la lista
 */
function drawDetectedList(startY) {
  //Antenas ya sonadas y activas
  const seen = rows
    .filter(r => r.played && isActive(r))
    .sort((a, b) => timeOf(a) - timeOf(b));

  // total de antenas
  const total = rows.filter(isActive).length;

  // Agrupar por tipo + nombre. delete() + set()
  const groups = new Map();
  for (const r of seen) {
    if (!r.ssid) continue;
    const key = r.type + '|' + r.ssid;
    const g = groups.get(key) || { type: r.type, ssid: r.ssid, n: 0 };
    g.n++;
    groups.delete(key);
    groups.set(key, g);
  }
  const items = [...groups.values()];

  //Cabecera con el contador.
  textAlign(LEFT, CENTER);
  noStroke();
  fill(150);
  textSize(10);
  text(`ANTENAS ${seen.length} / ${total}`, PANEL.x - 6, startY);

  // Cuántas líneas caben / recortar
  // aviso "↑ N anteriores".
  const firstY = startY + 20;
  let maxLines = max(floor((height - 60 - firstY) / PANEL.listRowH), 0);
  let hidden = max(items.length - maxLines, 0);
  if (hidden > 0) {
    maxLines = max(maxLines - 1, 0);
    hidden = items.length - maxLines;
  }

  //Quedarse con las ÚLTIMAS maxLines
  const shown = items.slice(items.length - maxLines);
  const offset = hidden > 0 ? 1 : 0;// la primera línea es el aviso

  textSize(11);
  if (hidden > 0) {
    fill(120);
    text(`↑ ${hidden} anteriores`, PANEL.x + 14, firstY);
  }

  // 6) Dibujar: punto de color + nombre truncado (+ contador).
  shown.forEach((it, i) => {
    const y = firstY + (i + offset) * PANEL.listRowH;
    fill(COLOR[it.type]);
    circle(PANEL.x + 2, y, 6);

    let name = it.ssid.length > PANEL.maxChars
      ? it.ssid.slice(0, PANEL.maxChars - 1) + '…'
      : it.ssid;
    if (it.n > 1) name += ` x${it.n}`;

    fill(215);
    text(name, PANEL.x + 14, y);
  });
}

//barra horizontal inferior / reproducción.
function drawTimeline() {
  const w = width - 80;
  const y = height - 30;
  stroke(255, 60);
  line(40, y, 40 + w, y);
  noStroke();
  fill(255);
  circle(40 + w * constrain(playhead / duration, 0, 1), y, 10);
}

//posición del cursor sobre tipos de señal
//para activar desactivar
function legendRowAt(mx, my) {
  for (let i = 0; i < TYPES.length; i++) {
    const cy = PANEL.y + i * PANEL.rowH;
    if (mx >= PANEL.x - 6 && mx <= PANEL.x - 6 + PANEL.w &&
        my >= cy - PANEL.rowH / 2 && my <= cy + PANEL.rowH / 2) {
      return TYPES[i];
    }
  }
  return null;
}

//sobre un tipo de señal activa o desactiva
//inicia pausa la reproducción.
//userStartAudio()
function mousePressed() {
  userStartAudio();

  const t = legendRowAt(mouseX, mouseY);
  if (t) {
    enabled[t] = !enabled[t];
    return false;// evita que el click pause/reanude
  }
  const b = mapButtonAt(mouseX, mouseY);
  if (b !== -1) {
    mapsOn[b] = !mapsOn[b];
    updateBounds();
    return false;
  }
  if (overModeButton(mouseX, mouseY)) {
    toggleTimeMode();
    return false;
  }
  running = !running;
}

//cambiar el tamaño de la ventana.
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
