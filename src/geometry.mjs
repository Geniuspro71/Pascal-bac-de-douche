const EPSILON = 1e-8;
const DEFAULT_MARGIN = 0.05;

export class GeometryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GeometryError';
    this.code = code;
  }
}

const finite = value => Number.isFinite(Number(value));
const point = value => ({ x: Number(value.x), y: Number(value.y) });
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const samePoint = (a, b, epsilon = EPSILON) => distance(a, b) <= epsilon;
const quantize = value => Math.round(value * 1e6) / 1e6;

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function wallId(a, b) {
  const first = `${quantize(a.x)},${quantize(a.y)}`;
  const second = `${quantize(b.x)},${quantize(b.y)}`;
  return `wall-${hashText(first < second ? `${first}|${second}` : `${second}|${first}`)}`;
}

export function signedArea(vertices) {
  return vertices.reduce((sum, current, index) => {
    const next = vertices[(index + 1) % vertices.length];
    return sum + current.x * next.y - next.x * current.y;
  }, 0) / 2;
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  return Math.abs(value) <= EPSILON ? 0 : value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return b.x <= Math.max(a.x, c.x) + EPSILON && b.x + EPSILON >= Math.min(a.x, c.x)
    && b.y <= Math.max(a.y, c.y) + EPSILON && b.y + EPSILON >= Math.min(a.y, c.y);
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSegment(a, c, b)) || (o2 === 0 && onSegment(a, d, b))
    || (o3 === 0 && onSegment(c, a, d)) || (o4 === 0 && onSegment(c, b, d));
}

export function pointInPolygon(value, vertices) {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const current = vertices[index];
    const before = vertices[previous];
    if ((current.y > value.y) !== (before.y > value.y)
      && value.x < (before.x - current.x) * (value.y - current.y) / (before.y - current.y) + current.x) inside = !inside;
  }
  return inside;
}

export function rectangleInsidePolygon(vertices, center, width, height) {
  if (![center.x, center.y, width, height].every(finite) || width <= 0 || height <= 0) return false;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const corners = [
    { x: center.x - halfWidth, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y + halfHeight },
    { x: center.x - halfWidth, y: center.y + halfHeight }
  ];
  if (!corners.every(corner => pointInPolygon(corner, vertices))) return false;
  for (let polygonIndex = 0; polygonIndex < vertices.length; polygonIndex += 1) {
    const polygonStart = vertices[polygonIndex];
    const polygonEnd = vertices[(polygonIndex + 1) % vertices.length];
    for (let rectangleIndex = 0; rectangleIndex < corners.length; rectangleIndex += 1) {
      if (segmentsIntersect(polygonStart, polygonEnd, corners[rectangleIndex], corners[(rectangleIndex + 1) % corners.length])) return false;
    }
  }
  return true;
}

export function validatePolygon(inputVertices) {
  if (!Array.isArray(inputVertices) || inputVertices.length < 3) {
    throw new GeometryError('polygon_too_short', 'Il perimetro richiede almeno tre vertici.');
  }
  const vertices = inputVertices.map(point);
  if (vertices.some(vertex => !finite(vertex.x) || !finite(vertex.y))) {
    throw new GeometryError('non_finite_coordinate', 'Il perimetro contiene coordinate non finite.');
  }
  if (vertices.length > 10_000) {
    throw new GeometryError('polygon_too_complex', 'Il perimetro supera 10.000 vertici.');
  }
  for (let i = 0; i < vertices.length; i += 1) {
    if (samePoint(vertices[i], vertices[(i + 1) % vertices.length])) {
      throw new GeometryError('degenerate_segment', 'Il perimetro contiene un segmento di lunghezza nulla.');
    }
  }
  if (Math.abs(signedArea(vertices)) <= EPSILON) {
    throw new GeometryError('zero_area', 'Il perimetro non racchiude un’area valida.');
  }
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    for (let j = i + 1; j < vertices.length; j += 1) {
      const adjacent = j === i || j === (i + 1) % vertices.length || i === (j + 1) % vertices.length;
      if (adjacent) continue;
      const c = vertices[j];
      const d = vertices[(j + 1) % vertices.length];
      if (segmentsIntersect(a, b, c, d)) {
        throw new GeometryError('self_intersection', 'Il perimetro si auto-interseca.');
      }
    }
  }
  return signedArea(vertices) < 0 ? vertices.reverse() : vertices;
}

export function createRoomModel(inputVertices, options = {}) {
  const vertices = validatePolygon(inputVertices);
  const height = Number(options.height ?? 2.7);
  const thickness = Number(options.thickness ?? 0.12);
  if (!finite(height) || height <= 0 || !finite(thickness) || thickness <= 0) {
    throw new GeometryError('invalid_room_dimensions', 'Altezza e spessore delle pareti devono essere positivi.');
  }
  const walls = vertices.map((start, index) => {
    const end = vertices[(index + 1) % vertices.length];
    const length = distance(start, end);
    const direction = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    return {
      id: wallId(start, end),
      start: { ...start },
      end: { ...end },
      length,
      direction,
      normal: { x: -direction.y, y: direction.x },
      thickness
    };
  });
  return {
    version: 1,
    units: 'm',
    height,
    thickness,
    vertices,
    walls,
    openings: [],
    references: options.references ? structuredClone(options.references) : [],
    source: options.source ? structuredClone(options.source) : { type: 'manual' }
  };
}

export function createRectangularRoom(width = 3.2, depth = 2.4, height = 2.7) {
  const w = Number(width);
  const d = Number(depth);
  if (!finite(w) || !finite(d) || w <= 0 || d <= 0) {
    throw new GeometryError('invalid_room_dimensions', 'Larghezza e profondità devono essere positive.');
  }
  return createRoomModel([
    { x: -w / 2, y: -d / 2 },
    { x: w / 2, y: -d / 2 },
    { x: w / 2, y: d / 2 },
    { x: -w / 2, y: d / 2 }
  ], { height, source: { type: 'manual' } });
}

export function boundsOf(points) {
  if (!points.length) throw new GeometryError('empty_geometry', 'Nessuna coordinata disponibile.');
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const item of points) {
    if (!finite(item.x) || !finite(item.y)) throw new GeometryError('non_finite_coordinate', 'La geometria contiene coordinate non finite.');
    minX = Math.min(minX, Number(item.x));
    maxX = Math.max(maxX, Number(item.x));
    minY = Math.min(minY, Number(item.y));
    maxY = Math.max(maxY, Number(item.y));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function projectPointToWall(value, wall) {
  const input = point(value);
  const dx = input.x - wall.start.x;
  const dy = input.y - wall.start.y;
  const rawOffset = dx * wall.direction.x + dy * wall.direction.y;
  const offset = Math.max(0, Math.min(wall.length, rawOffset));
  const projected = {
    x: wall.start.x + wall.direction.x * offset,
    y: wall.start.y + wall.direction.y * offset
  };
  return { offset, point: projected, distance: distance(input, projected) };
}

export function nearestWall(model, value) {
  return model.walls
    .map(wall => ({ wall, projection: projectPointToWall(value, wall) }))
    .sort((a, b) => a.projection.distance - b.projection.distance)[0];
}

function validateOpening(model, candidate, ignoreId = null) {
  const wall = model.walls.find(item => item.id === candidate.wallId);
  if (!wall) throw new GeometryError('wall_not_found', 'La parete associata non esiste più.');
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  const sill = Number(candidate.sill ?? 0);
  const offset = Number(candidate.offset);
  const margin = Number(candidate.margin ?? DEFAULT_MARGIN);
  if (![width, height, sill, offset, margin].every(finite) || width < 0.1 || height < 0.1 || sill < 0 || margin < 0) {
    throw new GeometryError('invalid_opening_dimensions', 'Larghezza e altezza dell’apertura devono essere almeno 0,10 m.');
  }
  if (width + 2 * margin > wall.length || offset - width / 2 < margin - EPSILON || offset + width / 2 > wall.length - margin + EPSILON) {
    throw new GeometryError('opening_out_of_bounds', 'L’apertura supera i margini della parete.');
  }
  if (sill + height > model.height + EPSILON) {
    throw new GeometryError('opening_too_tall', 'L’apertura supera l’altezza della parete.');
  }
  const start = offset - width / 2;
  const end = offset + width / 2;
  const top = sill + height;
  const collision = model.openings.find(item => item.id !== ignoreId && item.wallId === wall.id
    && start < item.offset + item.width / 2 - EPSILON
    && end > item.offset - item.width / 2 + EPSILON
    && sill < item.sill + item.height - EPSILON
    && top > item.sill + EPSILON);
  if (collision) throw new GeometryError('opening_collision', 'L’apertura si sovrappone a un altro elemento sulla stessa parete.');
  return { wall, width, height, sill, offset, margin };
}

export function addOpening(model, input) {
  const validated = validateOpening(model, input);
  const sequence = model.openings.reduce((max, item) => Math.max(max, Number(item.sequence) || 0), 0) + 1;
  const opening = {
    id: input.id || `opening-${sequence}`,
    sequence,
    type: ['door', 'window', 'opening'].includes(input.type) ? input.type : 'opening',
    wallId: validated.wall.id,
    width: validated.width,
    height: validated.height,
    sill: validated.sill,
    offset: validated.offset,
    margin: validated.margin,
    doorType: input.doorType || 'hinged',
    swing: input.swing || 'in',
    hinge: input.hinge || 'left',
    windowModel: input.windowModel || 'casement',
    windowLeaves: Math.max(1, Math.min(3, Number(input.windowLeaves) || 1)),
    reveal: Math.max(0, Number(input.reveal) || 0)
  };
  return { ...model, openings: [...model.openings, opening] };
}

export function updateOpening(model, openingId, patch) {
  const current = model.openings.find(item => item.id === openingId);
  if (!current) throw new GeometryError('opening_not_found', 'L’apertura selezionata non esiste.');
  const candidate = { ...current, ...patch, id: current.id };
  const validated = validateOpening(model, candidate, current.id);
  const normalized = {
    ...candidate,
    wallId: validated.wall.id,
    width: validated.width,
    height: validated.height,
    sill: validated.sill,
    offset: validated.offset,
    margin: validated.margin,
    reveal: Math.max(0, Number(candidate.reveal) || 0),
    windowLeaves: Math.max(1, Math.min(3, Number(candidate.windowLeaves) || 1))
  };
  return { ...model, openings: model.openings.map(item => item.id === current.id ? normalized : item) };
}

export function removeOpening(model, openingId) {
  return { ...model, openings: model.openings.filter(item => item.id !== openingId) };
}

export function wallSurfaceRects(model, wallId) {
  const wall = model.walls.find(item => item.id === wallId);
  if (!wall) throw new GeometryError('wall_not_found', 'Parete non trovata.');
  const openings = model.openings.filter(item => item.wallId === wallId);
  const xs = [...new Set([0, wall.length, ...openings.flatMap(item => [item.offset - item.width / 2, item.offset + item.width / 2])])].sort((a, b) => a - b);
  const zs = [...new Set([0, model.height, ...openings.flatMap(item => [item.sill, item.sill + item.height])])].sort((a, b) => a - b);
  const rectangles = [];
  for (let xi = 0; xi < xs.length - 1; xi += 1) {
    for (let zi = 0; zi < zs.length - 1; zi += 1) {
      const x0 = xs[xi];
      const x1 = xs[xi + 1];
      const z0 = zs[zi];
      const z1 = zs[zi + 1];
      if (x1 - x0 <= EPSILON || z1 - z0 <= EPSILON) continue;
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      const insideOpening = openings.some(item => mx > item.offset - item.width / 2 + EPSILON
        && mx < item.offset + item.width / 2 - EPSILON
        && mz > item.sill + EPSILON && mz < item.sill + item.height - EPSILON);
      if (!insideOpening) rectangles.push({ x0, x1, z0, z1 });
    }
  }
  return rectangles;
}

const UNIT_TO_METRES = new Map([[1, 0.0254], [2, 0.3048], [4, 0.001], [5, 0.01], [6, 1]]);

function parsePairs(source) {
  const raw = source.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n');
  if (!raw.some(value => value.trim() === 'EOF')) throw new GeometryError('truncated_dxf', 'Il DXF non contiene il marcatore EOF.');
  if (!raw.some(value => value.trim() === 'ENDSEC')) throw new GeometryError('truncated_dxf', 'Il DXF contiene una sezione non chiusa.');
  const pairs = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const code = Number(raw[i].trim());
    if (Number.isInteger(code)) pairs.push([code, raw[i + 1].trim()]);
  }
  if (pairs.length < 2) throw new GeometryError('invalid_dxf', 'File DXF vuoto o malformato.');
  return pairs;
}

function collectRecords(pairs) {
  const sections = new Map();
  let section = null;
  let record = null;
  const flush = () => {
    if (section && record) sections.get(section).push(record);
    record = null;
  };
  for (let i = 0; i < pairs.length; i += 1) {
    const [code, value] = pairs[i];
    if (code === 0 && value === 'SECTION') {
      flush();
      section = pairs[i + 1]?.[0] === 2 ? pairs[++i][1] : null;
      if (section && !sections.has(section)) sections.set(section, []);
    } else if (code === 0 && value === 'ENDSEC') {
      flush();
      section = null;
    } else if (section && code === 0) {
      flush();
      record = { type: value.toUpperCase(), pairs: [] };
    } else if (record) {
      record.pairs.push([code, value]);
    }
  }
  flush();
  return sections;
}

const firstNumber = (record, code, fallback = Number.NaN) => {
  const pair = record.pairs.find(item => item[0] === code);
  return pair ? Number(pair[1]) : fallback;
};
const firstText = (record, code, fallback = '') => record.pairs.find(item => item[0] === code)?.[1] ?? fallback;

function verticesFromRecord(record) {
  const vertices = [];
  let current = null;
  for (const [code, value] of record.pairs) {
    if (code === 10) {
      if (current && finite(current.x) && finite(current.y)) vertices.push(current);
      current = { x: Number(value), y: Number.NaN };
    } else if (code === 20 && current) current.y = Number(value);
  }
  if (current && finite(current.x) && finite(current.y)) vertices.push(current);
  return vertices;
}

function sampleArc(record, circle = false) {
  const center = { x: firstNumber(record, 10), y: firstNumber(record, 20) };
  const radius = firstNumber(record, 40);
  if (![center.x, center.y, radius].every(finite) || radius <= 0) return [];
  const start = circle ? 0 : firstNumber(record, 50, 0);
  const end = circle ? 360 : firstNumber(record, 51, 360);
  if (![start, end].every(finite)) return [];
  const sweep = circle ? 360 : ((end - start) % 360 + 360) % 360 || 360;
  const count = Math.min(96, Math.max(24, Math.ceil(sweep / 7.5)));
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = (start + sweep * index / count) * Math.PI / 180;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

function sampleEllipse(record) {
  const center = { x: firstNumber(record, 10), y: firstNumber(record, 20) };
  const major = { x: firstNumber(record, 11), y: firstNumber(record, 21) };
  const ratio = firstNumber(record, 40);
  const start = firstNumber(record, 41, 0);
  const end = firstNumber(record, 42, Math.PI * 2);
  if (![center.x, center.y, major.x, major.y, ratio, start, end].every(finite) || ratio <= 0) return [];
  const fullTurn = Math.PI * 2;
  const sweep = ((end - start) % fullTurn + fullTurn) % fullTurn || fullTurn;
  const minor = { x: -major.y * ratio, y: major.x * ratio };
  const count = Math.min(128, Math.max(32, Math.ceil(sweep / (Math.PI / 48))));
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = start + sweep * index / count;
    return {
      x: center.x + major.x * Math.cos(angle) + minor.x * Math.sin(angle),
      y: center.y + major.y * Math.cos(angle) + minor.y * Math.sin(angle)
    };
  });
}

function sampleSpline(record) {
  const controls = verticesFromRecord(record);
  return controls.length >= 2 && controls.length <= 10_000 ? controls : [];
}

function decodeEntity(record, polylineVertices = null) {
  const layer = firstText(record, 8, '0');
  let points = [];
  let closed = false;
  if (record.type === 'LINE') {
    points = [{ x: firstNumber(record, 10), y: firstNumber(record, 20) }, { x: firstNumber(record, 11), y: firstNumber(record, 21) }];
  } else if (record.type === 'LWPOLYLINE') {
    points = verticesFromRecord(record);
    closed = (firstNumber(record, 70, 0) & 1) !== 0;
  } else if (record.type === 'POLYLINE') {
    points = polylineVertices || [];
    closed = (firstNumber(record, 70, 0) & 1) !== 0;
  } else if (record.type === 'ARC') points = sampleArc(record);
  else if (record.type === 'CIRCLE') {
    points = sampleArc(record, true);
    closed = true;
  } else if (record.type === 'ELLIPSE') points = sampleEllipse(record);
  else if (record.type === 'SPLINE') points = sampleSpline(record);
  const bulge = record.pairs.some(([code, value]) => code === 42 && Math.abs(Number(value)) > EPSILON);
  const extrusion = {
    x: firstNumber(record, 210, 0),
    y: firstNumber(record, 220, 0),
    z: firstNumber(record, 230, 1)
  };
  const nonWorldCoordinates = Math.abs(extrusion.x) > EPSILON || Math.abs(extrusion.y) > EPSILON || Math.abs(extrusion.z - 1) > EPSILON;
  if (points.some(item => !finite(item.x) || !finite(item.y))) points = [];
  const approximateOnly = record.type === 'SPLINE';
  const supported = points.length >= 2 && !bulge && !nonWorldCoordinates && !approximateOnly;
  let opening = null;
  if (layer === 'PASCAL_OPENINGS') {
    try {
      const candidate = JSON.parse(firstText(record, 1000, ''));
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) opening = candidate;
    } catch {
      opening = null;
    }
  }
  return {
    type: record.type,
    layer,
    points,
    closed,
    supported,
    opening,
    unsupportedReason: bulge ? 'bulge_non_supportato' : nonWorldCoordinates ? 'ocs_non_supportato' : approximateOnly ? 'spline_non_supportata' : points.length < 2 ? 'entita_non_supportata' : null,
    rawPairs: record.pairs.map(([code, value]) => [code, value])
  };
}

export function parseDxf(source, options = {}) {
  if (typeof source !== 'string' || source.startsWith('AutoCAD Binary DXF')) {
    throw new GeometryError('unsupported_dxf', 'È richiesto un file DXF ASCII.');
  }
  const pairs = parsePairs(source);
  if (pairs.length > 250_000) throw new GeometryError('dxf_too_complex', 'Il DXF supera 250.000 coppie di codici.');
  const sections = collectRecords(pairs);
  let unitsCode = 0;
  for (let i = 0; i < pairs.length - 1; i += 1) {
    if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS') {
      for (let cursor = i + 1; cursor < pairs.length; cursor += 1) {
        const [code, value] = pairs[cursor];
        if (code === 9 || code === 0) break;
        if (code === 70 || code === 280) {
          unitsCode = Number(value);
          break;
        }
      }
      break;
    }
  }
  const overrideScale = options.unitScale == null ? null : Number(options.unitScale);
  const unitScale = finite(overrideScale) && overrideScale > 0 ? overrideScale : UNIT_TO_METRES.get(unitsCode) ?? null;
  const warnings = [];
  if (!unitScale) warnings.push('Unità DXF assente o non supportata: scegli una scala esplicita prima di usare il perimetro come stanza.');
  const records = sections.get('ENTITIES') || [];
  const entities = [];
  let totalPointCount = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.type === 'VERTEX' || record.type === 'SEQEND') continue;
    let vertices = null;
    if (record.type === 'POLYLINE') {
      vertices = [];
      let cursor = index + 1;
      while (cursor < records.length && records[cursor].type === 'VERTEX') {
        const vertex = { x: firstNumber(records[cursor], 10), y: firstNumber(records[cursor], 20) };
        if (finite(vertex.x) && finite(vertex.y)) vertices.push(vertex);
        cursor += 1;
      }
      index = cursor - 1;
    }
    const decoded = decodeEntity(record, vertices);
    const scale = unitScale || 1;
    decoded.points = decoded.points.map(item => ({ x: item.x * scale, y: item.y * scale }));
    decoded.id = `dxf-${entities.length + 1}`;
    decoded.classification = decoded.supported ? 'reference' : 'unclassified';
    entities.push(decoded);
    totalPointCount += decoded.points.length;
    if (entities.length > 25_000 || totalPointCount > 100_000) {
      throw new GeometryError('dxf_too_complex', 'Il DXF supera i limiti di 25.000 entità o 100.000 punti.');
    }
  }
  if (!entities.length) throw new GeometryError('empty_dxf', 'Il DXF non contiene entità nella sezione ENTITIES.');
  const supported = entities.filter(item => item.supported);
  const rejectedGeometry = entities.filter(item => ['bulge_non_supportato', 'ocs_non_supportato', 'spline_non_supportata'].includes(item.unsupportedReason));
  if (rejectedGeometry.length) warnings.push(`${rejectedGeometry.length} entità curve/OCS sono conservate ma escluse dal perimetro.`);
  const geometricEntities = entities.filter(item => item.points.length >= 2);
  if (!geometricEntities.length) throw new GeometryError('unsupported_entities', 'Il DXF non contiene geometrie 2D ispezionabili.');
  const outlineCandidates = supported.filter(item => ['LWPOLYLINE', 'POLYLINE'].includes(item.type) && item.closed && item.points.length >= 3)
    .map(item => {
      const vertices = samePoint(item.points[0], item.points[item.points.length - 1]) ? item.points.slice(0, -1) : item.points;
      try {
        const valid = validatePolygon(vertices);
        return { entity: item, vertices: valid, area: Math.abs(signedArea(valid)) };
      } catch {
        return null;
      }
    }).filter(Boolean).sort((a, b) => b.area - a.area);
  const outline = unitScale ? outlineCandidates[0]?.vertices ?? null : null;
  const allPoints = geometricEntities.flatMap(item => item.points);
  return {
    sourceId: hashText(source),
    unitsCode,
    unitScale,
    warnings,
    entities,
    outline,
    bounds: boundsOf(allPoints),
    counts: {
      total: entities.length,
      supported: supported.length,
      unclassified: entities.filter(item => !item.supported).length
    }
  };
}

export function roomFromDxf(parsed, height = 2.7, { restoreOpenings = true } = {}) {
  if (!parsed.unitScale) throw new GeometryError('units_required', 'Seleziona l’unità del DXF prima di creare la stanza.');
  if (!parsed.outline) throw new GeometryError('outline_required', 'Nessun perimetro chiuso valido è stato riconosciuto.');
  let model = createRoomModel(parsed.outline, {
    height,
    references: parsed.entities,
    source: { type: 'dxf', sourceId: parsed.sourceId ?? null, unitsCode: parsed.unitsCode, warnings: parsed.warnings }
  });
  if (!restoreOpenings) return model;
  for (const entity of parsed.entities.filter(item => item.opening && item.points.length >= 2)) {
    const middle = {
      x: (entity.points[0].x + entity.points.at(-1).x) / 2,
      y: (entity.points[0].y + entity.points.at(-1).y) / 2
    };
    const hit = nearestWall(model, middle);
    try {
      model = addOpening(model, { ...entity.opening, wallId: hit.wall.id, offset: hit.projection.offset });
    } catch {
      model.source.warnings = [...model.source.warnings, 'Un’apertura PASCAL_OPENINGS non valida è stata conservata soltanto come riferimento.'];
    }
  }
  return model;
}

export function modelSnapshot(model) {
  return structuredClone(model);
}
