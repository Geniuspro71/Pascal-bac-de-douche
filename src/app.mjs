import {
  GeometryError,
  addOpening,
  boundsOf,
  createRectangularRoom,
  createRoomModel,
  modelSnapshot,
  nearestWall,
  parseDxf,
  pointInPolygon,
  projectPointToWall,
  rectangleInsidePolygon,
  removeOpening,
  roomFromDxf,
  updateOpening,
  wallSurfaceRects
} from './geometry.mjs';

const byId = id => document.getElementById(id);
const screens = [1, 2, 3, 4].map(number => byId(`screen${number}`));
const status = byId('elementStatus');
const dxfStatus = byId('dxfStatus');
const errorBox = byId('error');
const svg = byId('planSvg');
const SVG_NS = 'http://www.w3.org/2000/svg';

let model = createRectangularRoom();
let selectedOpeningId = null;
let dxfSource = null;
let history = [modelSnapshot(model)];
let historyIndex = 0;
let view = null;
let dragState = null;
let render3D = () => {};
let exportGlb = async () => { throw new Error('Rendering 3D non disponibile.'); };
let applyMaterialCommand = () => false;

function showError(message) {
  errorBox.textContent = message;
  errorBox.style.display = 'block';
}

function clearError() {
  errorBox.textContent = '';
  errorBox.style.display = 'none';
}

function commit(nextModel, message = '') {
  model = nextModel;
  history = history.slice(0, historyIndex + 1);
  history.push(modelSnapshot(model));
  historyIndex = history.length - 1;
  if (message) status.textContent = message;
  byId('roomStatus').textContent = `Modello condiviso: ${model.walls.length} pareti · ${model.openings.length} aperture · ${model.height.toLocaleString('it-IT')} m di altezza`;
  drawPlan();
  try {
    render3D();
  } catch (error) {
    showError(`Rendering 3D non aggiornato: ${error.message}`);
  }
  updateHistoryButtons();
}

function replaceModel(nextModel, message = '') {
  selectedOpeningId = null;
  commit(nextModel, message);
  syncDimensionsFromModel();
}

function carryOpeningsTo(nextBase, { requireStableWallIds = false } = {}) {
  let next = nextBase;
  for (const opening of model.openings) {
    const oldWallIndex = model.walls.findIndex(item => item.id === opening.wallId);
    const oldWall = model.walls[oldWallIndex];
    const newWall = next.walls.find(item => item.id === opening.wallId)
      || (requireStableWallIds ? null : next.walls[oldWallIndex]);
    if (!oldWall || !newWall) throw new GeometryError('wall_mapping_failed', 'Il nuovo perimetro non consente di conservare tutte le aperture.');
    next = addOpening(next, {
      ...opening,
      wallId: newWall.id,
      offset: opening.offset / oldWall.length * newWall.length
    });
  }
  return next;
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex -= 1;
  model = modelSnapshot(history[historyIndex]);
  if (!model.openings.some(item => item.id === selectedOpeningId)) selectedOpeningId = null;
  status.textContent = 'Modifica annullata.';
  syncDimensionsFromModel();
  drawPlan();
  render3D();
  updateHistoryButtons();
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex += 1;
  model = modelSnapshot(history[historyIndex]);
  status.textContent = 'Modifica ripristinata.';
  syncDimensionsFromModel();
  drawPlan();
  render3D();
  updateHistoryButtons();
}

function updateHistoryButtons() {
  byId('undoAction').disabled = historyIndex <= 0;
  byId('redoAction').disabled = historyIndex >= history.length - 1;
  byId('deleteOpening').disabled = !selectedOpeningId;
}

function setScreen(number) {
  screens.forEach((screen, index) => screen.classList.toggle('active', index === number - 1));
  document.querySelectorAll('[data-step]').forEach(item => item.classList.toggle('current', Number(item.dataset.step) === number));
  if (number === 2) drawPlan();
  if (number === 3) {
    byId('resultTitle').textContent = byId('projectName').value.trim() || 'Progetto 3D';
    byId('resultProject').textContent = byId('clientName').value.trim();
    render3D();
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
}

function roomBounds() {
  return boundsOf(model.vertices);
}

function syncDimensionsFromModel() {
  const bounds = roomBounds();
  byId('roomW').value = bounds.width.toFixed(3).replace(/\.0+$/, '');
  byId('roomD').value = bounds.height.toFixed(3).replace(/\.0+$/, '');
  byId('roomH').value = String(model.height);
  byId('roomStatus').textContent = `Modello condiviso: ${model.walls.length} pareti · ${model.openings.length} aperture · ${model.height.toLocaleString('it-IT')} m di altezza`;
}

function computeView() {
  const bounds = boundsOf(model.vertices);
  const width = Math.max(bounds.width, 0.1);
  const height = Math.max(bounds.height, 0.1);
  const scale = Math.min(720 / width, 390 / height);
  return {
    bounds,
    scale,
    toSvg(point) {
      return {
        x: 450 + (point.x - (bounds.x + width / 2)) * scale,
        y: 275 - (point.y - (bounds.y + height / 2)) * scale
      };
    },
    toModel(point) {
      return {
        x: (point.x - 450) / scale + bounds.x + width / 2,
        y: (275 - point.y) / scale + bounds.y + height / 2
      };
    }
  };
}

function svgElement(name, attributes = {}, text = '') {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  if (text) element.textContent = text;
  return element;
}

function drawPlan() {
  view = computeView();
  svg.replaceChildren();
  const group = svgElement('g', { 'data-layer': 'references' });
  for (const reference of model.references.filter(item => item.layer !== 'PASCAL_OPENINGS')) {
    if (reference.points.length < 2) continue;
    const path = reference.points.map((value, index) => {
      const mapped = view.toSvg(value);
      return `${index ? 'L' : 'M'} ${mapped.x.toFixed(2)} ${mapped.y.toFixed(2)}`;
    }).join(' ');
    group.append(svgElement('path', {
      d: path,
      fill: 'none',
      stroke: reference.supported ? '#e8b56b' : '#e27d73',
      'stroke-width': 2,
      'stroke-dasharray': '6 5',
      opacity: 0.65,
      'pointer-events': 'none'
    }));
  }
  svg.append(group);
  const polygon = model.vertices.map(value => {
    const mapped = view.toSvg(value);
    return `${mapped.x.toFixed(2)},${mapped.y.toFixed(2)}`;
  }).join(' ');
  svg.append(svgElement('polygon', { points: polygon, fill: '#1b252b', stroke: 'none' }));
  for (const wall of model.walls) {
    const start = view.toSvg(wall.start);
    const end = view.toSvg(wall.end);
    svg.append(svgElement('line', {
      x1: start.x, y1: start.y, x2: end.x, y2: end.y,
      class: 'planWall', 'data-wall-id': wall.id,
      style: 'pointer-events:stroke;cursor:crosshair;touch-action:none'
    }));
  }
  model.vertices.forEach((vertex, index) => {
    const mapped = view.toSvg(vertex);
    svg.append(svgElement('circle', {
      cx: mapped.x, cy: mapped.y, r: 8,
      fill: '#8bc1d7', stroke: '#11181d', 'stroke-width': 3,
      'data-vertex-index': index,
      style: 'cursor:move;touch-action:none'
    }));
  });
  for (const opening of model.openings) {
    const wall = model.walls.find(item => item.id === opening.wallId);
    if (!wall) continue;
    const from = opening.offset - opening.width / 2;
    const to = opening.offset + opening.width / 2;
    const start = view.toSvg({ x: wall.start.x + wall.direction.x * from, y: wall.start.y + wall.direction.y * from });
    const end = view.toSvg({ x: wall.start.x + wall.direction.x * to, y: wall.start.y + wall.direction.y * to });
    const selected = opening.id === selectedOpeningId;
    svg.append(svgElement('line', {
      x1: start.x, y1: start.y, x2: end.x, y2: end.y,
      stroke: selected ? '#a5e4f7' : opening.type === 'window' ? '#8bc1d7' : '#11181d',
      'stroke-width': selected ? 17 : 14,
      'data-opening-id': opening.id,
      style: 'pointer-events:stroke;cursor:grab;touch-action:none'
    }));
    const swingLength = opening.width * view.scale;
    const normal = { x: wall.normal.x * swingLength * (opening.swing === 'out' ? -1 : 1), y: -wall.normal.y * swingLength * (opening.swing === 'out' ? -1 : 1) };
    if (opening.type === 'window') {
      svg.append(svgElement('line', { x1: start.x + normal.x * 0.28, y1: start.y + normal.y * 0.28, x2: end.x + normal.x * 0.28, y2: end.y + normal.y * 0.28, stroke: '#8bc1d7', 'stroke-width': 3, 'pointer-events': 'none' }));
      for (let leaf = 1; leaf < opening.windowLeaves; leaf += 1) {
        const ratio = leaf / opening.windowLeaves;
        const x = start.x + (end.x - start.x) * ratio;
        const y = start.y + (end.y - start.y) * ratio;
        svg.append(svgElement('line', { x1: x, y1: y, x2: x + normal.x * 0.55, y2: y + normal.y * 0.55, stroke: '#8bc1d7', 'stroke-width': 2, 'pointer-events': 'none' }));
      }
    } else if (opening.type === 'door') {
      const hinge = opening.hinge === 'right' ? end : start;
      const leafEnd = opening.doorType === 'sliding'
        ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
        : { x: hinge.x + normal.x, y: hinge.y + normal.y };
      svg.append(svgElement('line', {
        x1: hinge.x, y1: hinge.y, x2: leafEnd.x, y2: leafEnd.y,
        stroke: '#e7c18a', 'stroke-width': 5, 'pointer-events': 'none',
        'data-door-leaf': opening.id, 'data-swing': opening.swing
      }));
    }
    const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    svg.append(svgElement('text', {
      x: middle.x, y: middle.y + 24, class: 'planSmall', 'pointer-events': 'none'
    }, `${opening.type === 'door' ? 'Porta' : opening.type === 'window' ? 'Finestra' : 'Apertura'} · ${opening.width.toFixed(2)}×${opening.height.toFixed(2)} m`));
  }
  const bounds = roomBounds();
  svg.append(svgElement('text', { x: 450, y: 25, class: 'planSmall' }, `Pianta condivisa · ${model.walls.length} pareti · ${model.height.toFixed(2)} m`));
  svg.append(svgElement('text', { x: 450, y: 535, class: 'planText' }, `${bounds.width.toFixed(2)} × ${bounds.height.toFixed(2)} m`));
  status.textContent = selectedOpeningId
    ? `Apertura selezionata: ${selectedOpeningId}. Trascina per proiettarla su una parete; tocca per modificarla.`
    : `${model.openings.length} elemento/i · tocca una parete per aggiungere, un elemento per selezionare.`;
  updateHistoryButtons();
}

function pointerInModel(event) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const local = point.matrixTransform(svg.getScreenCTM().inverse());
  return view.toModel(local);
}

function openingDefaults(wall, offset) {
  const type = byId('openingType').value;
  return {
    type,
    wallId: wall.id,
    width: Number(byId('openingWidth').value),
    height: Number(byId('openingHeight').value),
    sill: type === 'window' ? 0.9 : 0,
    offset,
    margin: 0.05,
    doorType: 'hinged', swing: 'in', hinge: 'left', windowModel: 'casement', windowLeaves: 2, reveal: 0.1
  };
}

function selectOpening(openingId, openEditor = false) {
  selectedOpeningId = openingId;
  const opening = model.openings.find(item => item.id === openingId);
  if (!opening) return;
  byId('openingWidth').value = opening.width;
  byId('openingHeight').value = opening.height;
  byId('openingOffset').value = opening.offset;
  drawPlan();
  if (openEditor) showOpeningEditor(opening);
}

function showOpeningEditor(opening) {
  const wallSelect = byId('propWall');
  wallSelect.replaceChildren(...model.walls.map((wall, index) => {
    const option = document.createElement('option');
    option.value = wall.id;
    option.textContent = `Parete ${index + 1} · ${wall.length.toFixed(2)} m`;
    return option;
  }));
  const values = {
    propType: opening.type, propWall: opening.wallId, propWidth: opening.width,
    propHeight: opening.height, propSill: opening.sill, propOffset: opening.offset,
    propDoorType: opening.doorType,
    propWindowLeaves: String(opening.windowLeaves), propSwing: opening.swing,
    propHinge: opening.hinge, propReveal: opening.reveal
  };
  Object.entries(values).forEach(([id, value]) => { byId(id).value = value; });
  byId('openingEditorTitle').textContent = `Proprietà · ${opening.id}`;
  byId('propStatus').textContent = '';
  byId('openingEditor').hidden = false;
}

svg.addEventListener('pointerdown', event => {
  const openingTarget = event.target.closest('[data-opening-id]');
  if (openingTarget) {
    const openingId = openingTarget.dataset.openingId;
    selectOpening(openingId, true);
    dragState = { openingId, startModel: modelSnapshot(model) };
    svg.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  const vertexTarget = event.target.closest('[data-vertex-index]');
  if (vertexTarget) {
    dragState = { type: 'vertex', vertexIndex: Number(vertexTarget.dataset.vertexIndex), startModel: modelSnapshot(model) };
    svg.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  const wallTarget = event.target.closest('[data-wall-id]');
  if (!wallTarget) {
    selectedOpeningId = null;
    byId('openingEditor').hidden = true;
    drawPlan();
    return;
  }
  const wall = model.walls.find(item => item.id === wallTarget.dataset.wallId);
  const projection = projectPointToWall(pointerInModel(event), wall);
  try {
    const next = addOpening(model, openingDefaults(wall, projection.offset));
    commit(next, 'Elemento aggiunto e collegato alla parete.');
    selectOpening(next.openings.at(-1).id, true);
  } catch (error) {
    status.textContent = error.message;
  }
});

svg.addEventListener('pointermove', event => {
  if (!dragState) return;
  if (dragState.type === 'vertex') {
    const vertices = dragState.startModel.vertices.map((vertex, index) => index === dragState.vertexIndex ? pointerInModel(event) : vertex);
    const previousModel = model;
    model = dragState.startModel;
    try {
      model = carryOpeningsTo(createRoomModel(vertices, {
        height: dragState.startModel.height,
        thickness: dragState.startModel.thickness,
        references: dragState.startModel.references,
        source: { ...dragState.startModel.source, edited: true }
      }));
      drawPlan();
      render3D();
      status.textContent = `Vertice ${dragState.vertexIndex + 1} modificato; aperture riproiettate.`;
    } catch (error) {
      model = previousModel;
      status.textContent = `Modifica rifiutata: ${error.message}`;
    }
    return;
  }
  const opening = dragState.startModel.openings.find(item => item.id === dragState.openingId);
  if (!opening) return;
  const hit = nearestWall(dragState.startModel, pointerInModel(event));
  const currentWall = dragState.startModel.walls.find(item => item.id === opening.wallId);
  const currentHit = currentWall ? { wall: currentWall, projection: nearestWall({ walls: [currentWall] }, pointerInModel(event)).projection } : hit;
  const chosen = hit.projection.distance <= 0.35 ? hit : currentHit;
  try {
    model = updateOpening(dragState.startModel, opening.id, { wallId: chosen.wall.id, offset: chosen.projection.offset });
    const movedOpening = model.openings.find(item => item.id === opening.id);
    byId('openingOffset').value = movedOpening.offset.toFixed(2);
    if (!byId('openingEditor').hidden) {
      byId('propWall').value = movedOpening.wallId;
      byId('propOffset').value = movedOpening.offset.toFixed(3);
    }
    drawPlan();
    render3D();
  } catch (error) {
    status.textContent = error.message;
  }
});

function finishDrag() {
  if (!dragState) return;
  const before = JSON.stringify(dragState.startModel);
  const after = JSON.stringify(model);
  if (before !== after) {
    history = history.slice(0, historyIndex + 1);
    history.push(modelSnapshot(model));
    historyIndex = history.length - 1;
  }
  dragState = null;
  updateHistoryButtons();
}

svg.addEventListener('pointerup', finishDrag);
svg.addEventListener('pointercancel', finishDrag);
svg.addEventListener('lostpointercapture', finishDrag);

function addOpeningAtCenter() {
  const wall = model.walls[0];
  try {
    const next = addOpening(model, openingDefaults(wall, wall.length / 2));
    commit(next, 'Elemento aggiunto sulla parete 1.');
    selectOpening(next.openings.at(-1).id, true);
  } catch (error) {
    status.textContent = error.message;
  }
}

function applyQuickOpeningEdit() {
  if (!selectedOpeningId) return;
  try {
    commit(updateOpening(model, selectedOpeningId, {
      width: Number(byId('openingWidth').value),
      height: Number(byId('openingHeight').value),
      offset: Number(byId('openingOffset').value)
    }), 'Misure dell’apertura aggiornate.');
  } catch (error) {
    status.textContent = error.message;
  }
}

function applyRoomDimensions() {
  const widthText = byId('roomW').value.trim();
  const depthText = byId('roomD').value.trim();
  const heightText = byId('roomH').value.trim();
  const width = Number(widthText);
  const depth = Number(depthText);
  const height = Number(heightText);
  if (!widthText || !depthText || !heightText || ![width, depth, height].every(Number.isFinite) || width <= 0 || depth <= 0 || height <= 0) {
    byId('roomStatus').textContent = 'Inserisci larghezza, profondità e altezza positive e finite.';
    return false;
  }
  const currentBounds = roomBounds();
  if (Math.abs(currentBounds.width - width) < 1e-8 && Math.abs(currentBounds.height - depth) < 1e-8 && Math.abs(model.height - height) < 1e-8) {
    byId('roomStatus').textContent = `Modello valido: ${model.walls.length} pareti · ${model.openings.length} aperture.`;
    return true;
  }
  if (model.source.type === 'dxf') {
    try {
      const bounds = roomBounds();
      const sx = width / bounds.width;
      const sy = depth / bounds.height;
      const vertices = model.vertices.map(item => ({ x: (item.x - bounds.x) * sx, y: (item.y - bounds.y) * sy }));
      const references = model.references.map(reference => ({ ...reference, points: reference.points.map(item => ({ x: (item.x - bounds.x) * sx, y: (item.y - bounds.y) * sy })) }));
      const next = carryOpeningsTo(roomFromDxf({ unitScale: 1, outline: vertices, entities: references, sourceId: model.source.sourceId, unitsCode: 6, warnings: [] }, height, { restoreOpenings: false }));
      replaceModel(next, 'Perimetro DXF riscalato; le aperture valide sono state riproiettate sulle stesse pareti.');
      return true;
    } catch (error) {
      byId('roomStatus').textContent = error.message;
      return false;
    }
  }
  try {
    replaceModel(carryOpeningsTo(createRectangularRoom(width, depth, height)), 'Dimensioni applicate; le aperture valide sono state riproiettate sulle stesse pareti.');
    return true;
  } catch (error) {
    byId('roomStatus').textContent = error.message;
    return false;
  }
}

function unitScaleFromSelect() {
  const value = byId('dxfUnits').value;
  return value === 'auto' ? null : Number(value);
}

function applyDxfSource({ preserveOpenings = false } = {}) {
  if (!dxfSource) return;
  try {
    const parsed = parseDxf(dxfSource, { unitScale: unitScaleFromSelect() });
    if (parsed.outline) {
      const imported = roomFromDxf(parsed, Number(byId('roomH').value) || 2.7);
      const canCarryByIndex = preserveOpenings
        && !imported.openings.length
        && model.source.type === 'dxf'
        && model.source.sourceId
        && model.source.sourceId === parsed.sourceId
        && model.walls.length === imported.walls.length;
      const canCarryByIdentity = !imported.openings.length
        && model.source.type === 'dxf'
        && model.openings.every(opening => imported.walls.some(wall => wall.id === opening.wallId));
      const next = canCarryByIndex
        ? carryOpeningsTo(imported)
        : canCarryByIdentity
          ? carryOpeningsTo(imported, { requireStableWallIds: true })
          : imported;
      replaceModel(next, `DXF applicato: ${parsed.counts.supported}/${parsed.counts.total} geometrie supportate, ${parsed.counts.unclassified} non classificate.`);
      dxfStatus.textContent = `DXF verificato: ${parsed.counts.total} entità, perimetro valido di ${parsed.outline.length} vertici, unità convertite in metri.`;
    } else {
      commit({ ...model, references: parsed.entities, source: { type: 'manual-with-dxf-reference' } }, 'DXF mantenuto come riferimento non distruttivo.');
      dxfStatus.textContent = `${parsed.counts.supported}/${parsed.counts.total} geometrie visibili. ${parsed.warnings.join(' ') || 'Nessun perimetro chiuso valido: stanza non sostituita.'}`;
    }
  } catch (error) {
    dxfStatus.textContent = `Importazione non applicata: ${error.message} Il modello precedente è rimasto invariato.`;
  }
}

byId('dxfImport').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  dxfSource = null;
  if (file.size > 12_000_000) {
    dxfStatus.textContent = 'Importazione non applicata: file superiore a 12 MB.';
    return;
  }
  const bytes = await file.arrayBuffer();
  const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  if (head[0] === 0x41 && new TextDecoder().decode(bytes.slice(0, 18)).startsWith('AutoCAD Binary DXF')) {
    dxfStatus.textContent = 'Importazione non applicata: il DXF binario non è supportato; esporta in DXF ASCII.';
    return;
  }
  const candidateSource = head[0] === 255 && head[1] === 254
    ? new TextDecoder('utf-16le').decode(bytes)
    : head[0] === 254 && head[1] === 255
      ? new TextDecoder('utf-16be').decode(bytes)
      : new TextDecoder('utf-8').decode(bytes);
  dxfSource = candidateSource;
  applyDxfSource();
});
byId('dxfUnits').addEventListener('change', () => applyDxfSource({ preserveOpenings: true }));

byId('projectDate').value = new Date().toISOString().slice(0, 10);
byId('toEditor').addEventListener('click', () => {
  const projectName = byId('projectName').value.trim();
  const clientName = byId('clientName').value.trim();
  if (!projectName || !clientName) {
    byId('projectStatus').textContent = 'Inserisci almeno il nome del progetto e il cliente.';
    return;
  }
  byId('projectStatus').textContent = '';
  setScreen(2);
});
byId('backProject').addEventListener('click', () => setScreen(1));
byId('toResult').addEventListener('click', () => { if (applyRoomDimensions()) setScreen(3); });
byId('backEditor').addEventListener('click', () => setScreen(2));
byId('toDocuments').addEventListener('click', () => setScreen(4));
byId('backResult').addEventListener('click', () => setScreen(3));
byId('roomTools').addEventListener('submit', event => { event.preventDefault(); applyRoomDimensions(); });
byId('addOpening').addEventListener('click', addOpeningAtCenter);
byId('clearOpenings').addEventListener('click', () => {
  if (!model.openings.length || !window.confirm('Rimuovere tutte le aperture dal progetto?')) return;
  selectedOpeningId = null;
  byId('openingEditor').hidden = true;
  commit({ ...model, openings: [] }, 'Tutte le aperture sono state rimosse.');
});
byId('deleteOpening').addEventListener('click', () => {
  if (!selectedOpeningId) return;
  const id = selectedOpeningId;
  selectedOpeningId = null;
  byId('openingEditor').hidden = true;
  commit(removeOpening(model, id), `Apertura ${id} rimossa.`);
});
byId('undoAction').addEventListener('click', undo);
byId('redoAction').addEventListener('click', redo);
['openingWidth', 'openingHeight', 'openingOffset'].forEach(id => byId(id).addEventListener('change', applyQuickOpeningEdit));
byId('closeOpeningEditor').addEventListener('click', () => { byId('openingEditor').hidden = true; });
byId('applyOpeningProps').addEventListener('click', () => {
  if (!selectedOpeningId) return;
  try {
    const next = updateOpening(model, selectedOpeningId, {
      type: byId('propType').value,
      wallId: byId('propWall').value,
      width: Number(byId('propWidth').value),
      height: Number(byId('propHeight').value),
      sill: Number(byId('propSill').value),
      offset: Number(byId('propOffset').value),
      reveal: Number(byId('propReveal').value),
      doorType: byId('propDoorType').value,
      windowLeaves: Number(byId('propWindowLeaves').value),
      swing: byId('propSwing').value,
      hinge: byId('propHinge').value
    });
    byId('openingEditor').hidden = true;
    commit(next, 'Proprietà applicate al modello condiviso.');
  } catch (error) {
    byId('propStatus').textContent = error.message;
  }
});

const settingsPanel = byId('settingsPanel');
byId('settingsToggle').addEventListener('click', () => { settingsPanel.hidden = !settingsPanel.hidden; });
byId('settingsClose').addEventListener('click', () => { settingsPanel.hidden = true; });
byId('languageSelect').addEventListener('change', event => {
  document.documentElement.lang = event.target.value;
  try { localStorage.setItem('projectLanguage', event.target.value); } catch { /* storage can be disabled */ }
});
try { byId('languageSelect').value = localStorage.getItem('projectLanguage') || 'it'; } catch { /* storage can be disabled */ }

function downloadBlob(name, blob) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function exportDxfText() {
  const pairs = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  pairs.push('0', 'LWPOLYLINE', '8', 'ROOM', '90', String(model.vertices.length), '70', '1');
  model.vertices.forEach(vertex => pairs.push('10', String(vertex.x), '20', String(vertex.y)));
  model.openings.forEach(opening => {
    const wall = model.walls.find(item => item.id === opening.wallId);
    const start = opening.offset - opening.width / 2;
    const end = opening.offset + opening.width / 2;
    const metadata = JSON.stringify({
      type: opening.type,
      width: opening.width,
      height: opening.height,
      sill: opening.sill,
      margin: opening.margin,
      doorType: opening.doorType,
      windowModel: opening.windowModel,
      windowLeaves: opening.windowLeaves,
      swing: opening.swing,
      hinge: opening.hinge,
      reveal: opening.reveal
    });
    pairs.push('0', 'LINE', '8', 'PASCAL_OPENINGS',
      '10', String(wall.start.x + wall.direction.x * start), '20', String(wall.start.y + wall.direction.y * start),
      '11', String(wall.start.x + wall.direction.x * end), '21', String(wall.start.y + wall.direction.y * end),
      '1001', 'PASCAL', '1000', metadata);
  });
  pairs.push('0', 'ENDSEC', '0', 'EOF');
  return `${pairs.join('\n')}\n`;
}

byId('exportDocs').addEventListener('click', async () => {
  const selected = ['docDxf', 'docGlb', 'docJson'].filter(id => byId(id).checked);
  if (!selected.length) {
    byId('docStatus').textContent = 'Seleziona almeno un documento.';
    return;
  }
  const baseName = (byId('projectName').value.trim() || 'progetto-pascal').replace(/[^a-z0-9_-]+/gi, '-');
  byId('docStatus').textContent = 'Preparazione documenti…';
  try {
    if (byId('docJson').checked) downloadBlob(`${baseName}.json`, new Blob([JSON.stringify({ project: {
      name: byId('projectName').value.trim(),
      client: byId('clientName').value.trim(),
      phone: byId('clientPhone').value.trim(),
      email: byId('clientEmail').value.trim(),
      siteAddress: byId('siteAddress').value.trim(),
      date: byId('projectDate').value,
      roomType: byId('roomType').value,
      notes: byId('projectNotes').value.trim()
    }, geometry: model }, null, 2)], { type: 'application/json' }));
    if (byId('docDxf').checked) downloadBlob(`${baseName}.dxf`, new Blob([exportDxfText()], { type: 'application/dxf' }));
    if (byId('docGlb').checked) await exportGlb(`${baseName}.glb`);
    byId('docStatus').textContent = `${selected.length} documento/i generato/i sul dispositivo.`;
  } catch (error) {
    byId('docStatus').textContent = `Esportazione non completata: ${error.message}`;
  }
});

function init3D() {
  const host = byId('view');
  Promise.all([
    import('three'),
    import('three/addons/controls/OrbitControls.js'),
    import('three/addons/environments/RoomEnvironment.js'),
    import('three/addons/exporters/GLTFExporter.js')
  ]).then(([THREE, controlsModule, environmentModule, exporterModule]) => {
    const { OrbitControls } = controlsModule;
    const { RoomEnvironment } = environmentModule;
    const { GLTFExporter } = exporterModule;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x20272b);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 500);
    camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    host.replaceChildren(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    const environment = new RoomEnvironment(renderer);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(environment, 0.04).texture;
    environment.dispose();
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xeaf4fa, 0x303438, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-3, -4, 7);
    key.castShadow = true;
    scene.add(key);
    const roomGroup = new THREE.Group();
    const openingGroup = new THREE.Group();
    const productGroup = new THREE.Group();
    scene.add(roomGroup, openingGroup, productGroup);
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xd3d2cd, roughness: 0.55, transparent: true, opacity: 0.38, depthWrite: false });
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x8f9496, roughness: 0.82, side: THREE.DoubleSide });
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0xdde5e8, roughness: 0.35 });
    const glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0x8ac8df, transparent: true, opacity: 0.42, roughness: 0.1, side: THREE.DoubleSide });
    const doorMaterial = new THREE.MeshStandardMaterial({ color: 0xb7a18a, roughness: 0.7 });
    const trayMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.18, clearcoat: 0.8, side: THREE.DoubleSide });
    const drainMaterial = new THREE.MeshStandardMaterial({ color: 0x202629, roughness: 0.45 });

    function clearGroup(group) {
      while (group.children.length) {
        const child = group.children[0];
        group.remove(child);
        child.traverse(node => { if (node.geometry) node.geometry.dispose(); });
      }
    }

    function wallPoint(wall, offset, normalOffset = 0) {
      return {
        x: wall.start.x + wall.direction.x * offset + wall.normal.x * normalOffset,
        y: wall.start.y + wall.direction.y * offset + wall.normal.y * normalOffset
      };
    }

    function addBoxOnWall(group, wall, offset, z, width, height, depth, material, userData = {}) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, depth, height), material);
      const position = wallPoint(wall, offset);
      mesh.position.set(position.x, position.y, z);
      mesh.rotation.z = Math.atan2(wall.direction.y, wall.direction.x);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { ...userData };
      group.add(mesh);
      return mesh;
    }

    function addDoorLeaf(wall, opening, material) {
      const leafWidth = opening.width * (opening.doorType === 'sliding' ? 0.9 : 0.94);
      if (opening.doorType === 'sliding') {
        return addBoxOnWall(openingGroup, wall, opening.offset, opening.height / 2, leafWidth, opening.height * 0.96, 0.025, material, {
          kind: 'door-leaf', swing: opening.swing, hinge: opening.hinge, doorType: opening.doorType
        });
      }
      const hingeOffset = opening.hinge === 'right' ? opening.offset + opening.width / 2 : opening.offset - opening.width / 2;
      const hinge = wallPoint(wall, hingeOffset);
      const swingDirection = opening.swing === 'out' ? -1 : 1;
      const leafDirection = { x: wall.normal.x * swingDirection, y: wall.normal.y * swingDirection };
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(leafWidth, 0.025, opening.height * 0.96), material);
      mesh.position.set(hinge.x + leafDirection.x * leafWidth / 2, hinge.y + leafDirection.y * leafWidth / 2, opening.height / 2);
      mesh.rotation.z = Math.atan2(leafDirection.y, leafDirection.x);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = {
        kind: 'door-leaf', swing: opening.swing, hinge: opening.hinge, doorType: opening.doorType,
        position: { x: mesh.position.x, y: mesh.position.y }, rotationZ: mesh.rotation.z
      };
      openingGroup.add(mesh);
      return mesh;
    }

    function buildProduct() {
      clearGroup(productGroup);
      const bounds = roomBounds();
      let center = model.vertices.reduce((sum, vertex) => ({ x: sum.x + vertex.x / model.vertices.length, y: sum.y + vertex.y / model.vertices.length }), { x: 0, y: 0 });
      let trayWidth = Math.min(2.4, Math.max(0.4, bounds.width * 0.65));
      let trayDepth = Math.min(0.8, Math.max(0.4, bounds.height * 0.3));
      let trayFits = false;
      const boundsCenter = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      for (let attempt = 0; attempt < 19; attempt += 1) {
        const candidates = [center];
        for (let row = 1; row < 12; row += 1) {
          for (let column = 1; column < 12; column += 1) {
            candidates.push({ x: bounds.x + bounds.width * column / 12, y: bounds.y + bounds.height * row / 12 });
          }
        }
        const fitting = candidates.filter(candidate => pointInPolygon(candidate, model.vertices)
          && rectangleInsidePolygon(model.vertices, candidate, trayWidth, trayDepth));
        if (fitting.length) {
          center = fitting.sort((left, right) => {
            const leftDistance = (left.x - boundsCenter.x) ** 2 + (left.y - boundsCenter.y) ** 2;
            const rightDistance = (right.x - boundsCenter.x) ** 2 + (right.y - boundsCenter.y) ** 2;
            return leftDistance - rightDistance;
          })[0];
          trayFits = true;
          break;
        }
        trayWidth *= 0.9;
        trayDepth *= 0.9;
      }
      if (!trayFits) throw new Error('Il perimetro non contiene uno spazio sufficiente per il bac de douche.');
      const outer = [[-trayWidth / 2, -trayDepth / 2], [trayWidth / 2, -trayDepth / 2], [trayWidth / 2, trayDepth / 2], [-trayWidth / 2, trayDepth / 2]];
      const inner = [[-0.05, -0.05], [0.05, -0.05], [0.05, 0.05], [-0.05, 0.05]];
      for (let index = 0; index < 4; index += 1) {
        const next = (index + 1) % 4;
        const vertices = [
          outer[index][0], outer[index][1], 0.05,
          outer[next][0], outer[next][1], 0.05,
          inner[next][0], inner[next][1], 0,
          inner[index][0], inner[index][1], 0
        ];
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex([0, 1, 2, 0, 2, 3]);
        geometry.computeVertexNormals();
        const face = new THREE.Mesh(geometry, trayMaterial);
        face.castShadow = true;
        face.receiveShadow = true;
        face.userData = { kind: 'tray-slope' };
        productGroup.add(face);
      }
      const drain = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.012), drainMaterial);
      drain.position.set(0, 0, -0.006);
      drain.userData = { kind: 'drain', width: 0.1, depth: 0.1 };
      productGroup.add(drain);
      productGroup.position.set(center.x, center.y, 0);
      productGroup.userData = { center: { ...center }, width: trayWidth, depth: trayDepth };
    }

    function fitCamera() {
      const box = new THREE.Box3().setFromObject(scene);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z, 1);
      const aspect = Math.max(renderer.domElement.clientWidth / Math.max(renderer.domElement.clientHeight, 1), 0.5);
      const vertical = radius / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      const distance = Math.max(vertical, vertical / aspect) * 1.55;
      camera.position.set(center.x + distance, center.y - distance, center.z + distance * 0.7);
      camera.near = Math.max(0.01, distance / 1_000);
      camera.far = distance * 20;
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.maxDistance = distance * 4;
      controls.update();
    }

    render3D = () => {
      clearGroup(roomGroup);
      clearGroup(openingGroup);
      const shape = new THREE.Shape();
      shape.moveTo(model.vertices[0].x, model.vertices[0].y);
      model.vertices.slice(1).forEach(vertex => shape.lineTo(vertex.x, vertex.y));
      shape.closePath();
      const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMaterial);
      floor.position.z = -0.01;
      floor.receiveShadow = true;
      roomGroup.add(floor);
      for (const wall of model.walls) {
        for (const rect of wallSurfaceRects(model, wall.id)) {
          addBoxOnWall(roomGroup, wall, (rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2, rect.x1 - rect.x0, rect.z1 - rect.z0, wall.thickness, wallMaterial, { kind: 'wall', wallId: wall.id, rect: { ...rect } });
        }
        for (const opening of model.openings.filter(item => item.wallId === wall.id)) {
          const depth = wall.thickness + Math.max(opening.reveal, 0.02);
          const thickness = 0.035;
          addBoxOnWall(openingGroup, wall, opening.offset - opening.width / 2, opening.sill + opening.height / 2, thickness, opening.height, depth, frameMaterial);
          addBoxOnWall(openingGroup, wall, opening.offset + opening.width / 2, opening.sill + opening.height / 2, thickness, opening.height, depth, frameMaterial);
          addBoxOnWall(openingGroup, wall, opening.offset, opening.sill + opening.height, opening.width + thickness, thickness, depth, frameMaterial);
          if (opening.sill > 0) addBoxOnWall(openingGroup, wall, opening.offset, opening.sill, opening.width + thickness, thickness, depth, frameMaterial);
          if (opening.type === 'window') {
            addBoxOnWall(openingGroup, wall, opening.offset, opening.sill + opening.height / 2, opening.width - thickness, opening.height - thickness, 0.01, glassMaterial);
            for (let leaf = 1; leaf < opening.windowLeaves; leaf += 1) {
              addBoxOnWall(openingGroup, wall, opening.offset - opening.width / 2 + opening.width * leaf / opening.windowLeaves, opening.sill + opening.height / 2, 0.025, opening.height, depth, frameMaterial);
            }
          } else if (opening.type === 'door') {
            addDoorLeaf(wall, opening, doorMaterial);
          }
        }
      }
      buildProduct();
      fitCamera();
      window.__pascalDebug.meshRects = wallId => roomGroup.children.filter(child => child.userData.kind === 'wall' && child.userData.wallId === wallId).map(child => ({ ...child.userData.rect }));
      window.__pascalDebug.productParts = () => productGroup.children.map(child => ({ ...child.userData }));
      window.__pascalDebug.productPlacement = () => ({ ...productGroup.userData });
      window.__pascalDebug.doorLeaves = () => openingGroup.children.filter(child => child.userData.kind === 'door-leaf').map(child => ({ ...child.userData }));
    };

    applyMaterialCommand = command => {
      const lower = command.toLowerCase();
      const targetWalls = /paret|muro|wall/.test(lower);
      const targetFloor = /paviment|suolo|floor/.test(lower) || !targetWalls;
      const color = /blu|blue/.test(lower) ? 0x315777 : /scur|nero|antracit|dark/.test(lower) ? 0x34383a : /carrar|bianc|marmo|white/.test(lower) ? 0xe7e5df : null;
      if (color == null) return false;
      if (targetWalls) { wallMaterial.color.setHex(color); wallMaterial.needsUpdate = true; }
      if (targetFloor) { floorMaterial.color.setHex(color); floorMaterial.needsUpdate = true; }
      window.__pascalDebug.materials = () => ({ wall: wallMaterial.color.getHex(), floor: floorMaterial.color.getHex() });
      return true;
    };

    exportGlb = async fileName => {
      const exporter = new GLTFExporter();
      const buffer = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });
      downloadBlob(fileName, new Blob([buffer], { type: 'model/gltf-binary' }));
    };

    const resize = () => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    resize();
    render3D();
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
    clearError();
  }).catch(error => showError(`Avvio 3D non riuscito: ${error.message}`));
}

byId('sendCommand').addEventListener('click', () => {
  const command = byId('command').value.trim().toLowerCase();
  if (!command) return;
  if (!applyMaterialCommand(command)) {
    showError('Materiale non riconosciuto. Prova “Carrara sul pavimento” o “pietra blu sulla parete”.');
  } else clearError();
});

window.__pascalDebug = {
  snapshot: () => modelSnapshot(model),
  wallRects: wallId => wallSurfaceRects(model, wallId),
  isWallCovered: (wallId, offset, height) => wallSurfaceRects(model, wallId)
    .some(rect => offset > rect.x0 && offset < rect.x1 && height > rect.z0 && height < rect.z1),
  openingCount: () => model.openings.length
};

syncDimensionsFromModel();
drawPlan();
setScreen(1);
init3D();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker non registrato', error)));
}
