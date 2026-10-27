// Tramos (MultiLineString, EPSG:4686 ~ lon/lat) en p5.js

let geo;
let tramos = [];// [{ props, zona, lines: [[{x,y}]] }]
let bounds;
let view = { x: 0, y: 0, k: 1 };
let hovered = null, selected = null;
let dragging = false, moved = 0;

// pentatónica mayor
const ESCALA = [0, 2, 4, 7, 9];
const NOMBRES = ['C', 'D', 'E', 'G', 'A'];
const NOTA_BASE = 48;// C3 (MIDI)
let synth, audioOn = false, muted = false, lastHovered = null;

const COLORES = { Norte: '#4cc9f0', Centro: '#ffb703', Sur: '#80ed99' };
const zonasActivas = { Norte: true, Centro: true, Sur: true };
let COS_LAT = 1;// valor inicial para correccion de deformacion horizontal

function preload() { geo = loadJSON('data.geojson'); }

function setup() {
  createCanvas(windowWidth, windowHeight);
  parseGeo();
  asignarNotas();
  synth = new p5.PolySynth();
  fitView();
  buildLegend();
  actualizarAudioUI();
}

// Datos
function project(lon, lat) { return { x: lon * COS_LAT, y: -lat }; }//aplicacion de correccion horizontal

function parseGeo() {
  const feats = geo.features.filter(f => f.geometry);
  // latitud media para corregir la deformacion horizontal
  // posiblemente innecesario por el tamaño del mapa
  let sum = 0, n = 0;
  for (const f of feats) for (const l of f.geometry.coordinates) for (const c of l) { sum += c[1]; n++; }
  COS_LAT = Math.cos(radians(sum / n));

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of feats) {
    const g = f.geometry;
    const lineas = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
    const lines = lineas.map(l => l.map(c => {
      const p = project(c[0], c[1]);
      minX = min(minX, p.x); maxX = max(maxX, p.x);
      minY = min(minY, p.y); maxY = max(maxY, p.y);
      return p;
    }));
    const nombre = f.properties.Nombre_Tramo || '';
    tramos.push({ props: f.properties, zona: nombre.split(' ')[0], lines });
  }
  bounds = { minX, minY, maxX, maxY };
}

// Cada tramo suena una nota
function asignarNotas() {
  const latMedia = t => {
    let sum = 0, n = 0;
    for (const l of t.lines) for (const p of l) { sum += p.y; n++; }
    return sum / n;// y = -lat, menor y = más al norte
  };
  const orden = [...tramos].sort((a, b) => latMedia(a) - latMedia(b));// norte primero
  const N = orden.length;
  orden.forEach((t, r) => {
    const i = N - 1 - r;// el norte obtiene el grado más alto
    t.midi = NOTA_BASE + 12 * floor(i / 5) + ESCALA[i % 5];//octavada por tramo
    t.nota = NOMBRES[i % 5] + (floor(t.midi / 12) - 1);//recorre escala 5 notas
  });
}

function tocar(t) {
  if (!audioOn || muted || !t) return;
  synth.play(midiToFreq(t.midi), 0.60, 0, 0.8);// nota, velocidad, retardo, duración
}

function actualizarAudioUI() {
  const el = document.getElementById('audio');
  if (!el) return;
  el.className = !audioOn ? '' : (muted ? 'mute' : 'on');
  el.textContent = !audioOn ? 'Clic para activar el sonido'
                 : muted ? 'Silenciado (M para activar)' : 'Sonido activado';
}

function fitView(margin = 60) {
  const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
  view.k = min((width - margin * 2) / w, (height - margin * 2) / h);
  view.x = width / 2 - (bounds.minX + w / 2) * view.k;
  view.y = height / 2 - (bounds.minY + h / 2) * view.k;
}

const sx = p => p.x * view.k + view.x;
const sy = p => p.y * view.k + view.y;

function draw() {
  background('#141821');
  hovered = findHover();
  if (hovered !== lastHovered) {// hover en ruta nueva
    if (hovered) tocar(hovered);
    lastHovered = hovered;
  }
  cursor(hovered ? HAND : (dragging ? 'grabbing' : ARROW));

  noFill();
  strokeCap(ROUND); strokeJoin(ROUND);
  // primero los normales, luego hover/selección encima
  const orden = tramos.filter(t => t !== hovered && t !== selected);
  if (selected && selected !== hovered) orden.push(selected);
  if (hovered) orden.push(hovered);

  for (const t of orden) {
    if (!zonasActivas[t.zona]) continue;
    const activo = t === hovered || t === selected;
    const c = color(COLORES[t.zona] || '#ffffff');
    if (activo) { stroke(red(c), green(c), blue(c), 70); strokeWeight(14); drawLines(t); }
    stroke(c);
    strokeWeight(activo ? 5 : 3);
    drawLines(t);
  }

  const foco = hovered || selected;
  if (foco && zonasActivas[foco.zona]) etiqueta(foco);
}

function drawLines(t) {
  for (const l of t.lines) {
    beginShape();
    for (const p of l) vertex(sx(p), sy(p));
    endShape();
  }
}

function etiqueta(t) {
  const l = t.lines[0], p = l[floor(l.length / 2)];
  const txt = `${t.props.Nombre_Tramo} · ${t.props.identificador_del_tramo} · ${t.nota}`;
  textSize(12); textAlign(LEFT, CENTER);
  const w = textWidth(txt) + 14;
  noStroke(); fill(10, 13, 20, 230);
  rect(sx(p) + 10, sy(p) - 28, w, 22, 6);
  fill(255); text(txt, sx(p) + 17, sy(p) - 17);
}


function findHover() {
  if (dragging || !mouseInCanvas()) return null;
  let mejor = null, dMin = 10;//radio de captura en px
  for (const t of tramos) {
    if (!zonasActivas[t.zona]) continue;
    for (const l of t.lines) {
      for (let i = 1; i < l.length; i++) {
        const d = distSeg(mouseX, mouseY, sx(l[i - 1]), sy(l[i - 1]), sx(l[i]), sy(l[i]));
        if (d < dMin) { dMin = d; mejor = t; }
      }
    }
  }
  return mejor;
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  let u = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  u = constrain(u, 0, 1);
  return dist(px, py, ax + u * dx, ay + u * dy);
}

//Interaccin
let pressOnCanvas = false;
function mouseInCanvas() { return mouseX >= 0 && mouseY >= 0 && mouseX <= width && mouseY <= height; }

function mousePressed(e) {
  pressOnCanvas = e && e.target === drawingContext.canvas;
  moved = 0;
  if (!audioOn) {
    userStartAudio().then(() => { audioOn = true; actualizarAudioUI(); });
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
  if (pressOnCanvas && moved < 4) {// clic sin dragg
    selected = hovered === selected ? null : hovered;
    mostrarInfo(selected);
  }
  dragging = false; pressOnCanvas = false;
}

function mouseWheel(e) {
  if (e.target !== drawingContext.canvas) return;
  const f = e.delta > 0 ? 0.9 : 1.1;
  const wx = (mouseX - view.x) / view.k, wy = (mouseY - view.y) / view.k;
  view.k = constrain(view.k * f, 100, 2e6);
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
  for (const z of Object.keys(COLORES)) {
    const n = tramos.filter(t => t.zona === z).length;
    const b = document.createElement('button');
    b.innerHTML = `<i style="background:${COLORES[z]}"></i>${z} (${n})`;
    b.onclick = () => {
      zonasActivas[z] = !zonasActivas[z];
      b.classList.toggle('off', !zonasActivas[z]);
      if (selected && !zonasActivas[selected.zona]) { selected = null; mostrarInfo(null); }
    };
    cont.appendChild(b);
  }
}

function mostrarInfo(t) {
  const el = document.getElementById('info');
  if (!t) { el.style.display = 'none'; return; }
  const p = t.props;
  const fecha = (p.Fecha_Actualizacion || '').slice(0, 10);
  el.innerHTML = `
    <h2>${p.Nombre_Tramo}</h2>
    <div class="sub">${p.identificador_del_tramo} · ${p.Estado}</div>
    <dl>
      <dt>Dirección</dt><dd>${p['Dirección']}</dd>
      <dt>Horario</dt><dd>${p.Horario}</dd>
      <dt>Guardianes</dt><dd>${p.No_de_Guardianes}</dd>
      <dt>Servidores</dt><dd>${p.No_de_Servidores}</dd>
      <dt>Policías</dt><dd>${p.No_de_Policias}</dd>
      <dt>Actualizado</dt><dd>${fecha}</dd>
    </dl>`;
  el.style.display = 'block';
}
