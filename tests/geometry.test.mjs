import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GeometryError,
  addOpening,
  createRectangularRoom,
  createRoomModel,
  nearestWall,
  parseDxf,
  projectPointToWall,
  rectangleInsidePolygon,
  roomFromDxf,
  updateOpening,
  validatePolygon,
  wallSurfaceRects
} from '../src/geometry.mjs';

const rectangleDxf = units => `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${units}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nWALLS\n90\n4\n70\n1\n10\n0\n20\n0\n10\n3200\n20\n0\n10\n3200\n20\n2400\n10\n0\n20\n2400\n0\nCIRCLE\n8\nANNOTATION\n10\n100\n20\n100\n40\n20\n0\nENDSEC\n0\nEOF\n`;

test('converts DXF millimetres, chooses polygon instead of sampled circle and preserves references', () => {
  const parsed = parseDxf(rectangleDxf(4));
  assert.equal(parsed.unitScale, 0.001);
  assert.equal(parsed.entities.length, 2);
  assert.equal(parsed.outline.length, 4);
  const room = roomFromDxf(parsed, 2.7);
  assert.equal(room.walls.length, 4);
  assert.equal(room.walls[0].length, 3.2);
  assert.equal(room.walls[1].length, 2.4);
  assert.equal(room.references.length, 2);
});

test('requires an explicit scale for unitless DXF', () => {
  const parsed = parseDxf(rectangleDxf(0));
  assert.equal(parsed.unitScale, null);
  assert.equal(parsed.outline, null);
  assert.throws(() => roomFromDxf(parsed), error => error instanceof GeometryError && error.code === 'units_required');
  const scaled = parseDxf(rectangleDxf(0), { unitScale: 0.001 });
  assert.equal(roomFromDxf(scaled).walls[0].length, 3.2);
});

test('does not read an entity flag as a missing INSUNITS value', () => {
  const missingValue = rectangleDxf(0).replace('70\n0\n0\nENDSEC', '1\nmissing\n0\nENDSEC');
  const parsed = parseDxf(missingValue);
  assert.equal(parsed.unitsCode, 0);
  assert.equal(parsed.unitScale, null);
  assert.equal(parsed.outline, null);
});

test('bounds arc sampling when angles are non-finite or extreme', () => {
  const extraArc = '0\nARC\n8\nREFERENCE\n10\n0\n20\n0\n40\n2\n50\nInfinity\n51\n1e309\n';
  const source = rectangleDxf(6).replace(/0\nENDSEC\n0\nEOF\n$/, `${extraArc}0\nENDSEC\n0\nEOF\n`);
  const parsed = parseDxf(source);
  const arc = parsed.entities.find(entity => entity.type === 'ARC');
  assert.equal(arc.supported, false);
  assert.deepEqual(arc.points, []);
  assert.equal(parsed.outline.length, 4);
});

test('does not allocate interpolated points for an oversized unsupported spline', () => {
  const controls = Array.from({ length: 10_001 }, (_, index) => `10\n${index}\n20\n${index % 17}`).join('\n');
  const spline = `0\nSPLINE\n8\nREFERENCE\n${controls}\n`;
  const source = rectangleDxf(6).replace(/0\nENDSEC\n0\nEOF\n$/, `${spline}0\nENDSEC\n0\nEOF\n`);
  const parsed = parseDxf(source);
  const entity = parsed.entities.find(item => item.type === 'SPLINE');
  assert.equal(entity.supported, false);
  assert.deepEqual(entity.points, []);
});

test('rejects a rectangle whose corners are inside but whose surface crosses a concave notch', () => {
  const polygon = [
    { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1.8 }, { x: 1.5, y: 1.8 },
    { x: 1.5, y: 2.2 }, { x: 4, y: 2.2 }, { x: 4, y: 4 }, { x: 0, y: 4 }
  ];
  assert.equal(rectangleInsidePolygon(polygon, { x: 1.1875, y: 2 }, 2.16, 0.72), false);
  assert.equal(rectangleInsidePolygon(polygon, { x: 0.7, y: 2 }, 0.5, 0.3), true);
});

test('projects to an inclined wall and keeps a stable wall id through opening edits', () => {
  const model = createRoomModel([{ x: 0, y: 0 }, { x: 4, y: 1 }, { x: 3, y: 4 }]);
  const wall = model.walls[0];
  const projection = projectPointToWall({ x: 2, y: 1.2 }, wall);
  assert.ok(projection.distance < 0.7);
  const nearest = nearestWall(model, { x: 2, y: 1.2 });
  assert.equal(nearest.wall.id, wall.id);
  const withOpening = addOpening(model, { type: 'window', wallId: wall.id, width: 0.8, height: 1, sill: 0.9, offset: 2 });
  const updated = updateOpening(withOpening, withOpening.openings[0].id, { offset: 2.2 });
  assert.equal(updated.openings[0].wallId, wall.id);
});

test('keeps wall ids stable when the polygon start vertex changes', () => {
  const vertices = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }];
  const original = createRoomModel(vertices);
  const shifted = createRoomModel([vertices[1], vertices[2], vertices[3], vertices[0]]);
  assert.deepEqual(new Set(original.walls.map(wall => wall.id)), new Set(shifted.walls.map(wall => wall.id)));
});

test('rejects out-of-bounds and colliding openings', () => {
  const model = createRectangularRoom(4, 3, 2.7);
  const wallId = model.walls[0].id;
  assert.throws(() => addOpening(model, { wallId, width: 1, height: 2, sill: 0, offset: 0.2 }), error => error.code === 'opening_out_of_bounds');
  const first = addOpening(model, { wallId, width: 1, height: 2, sill: 0, offset: 1 });
  assert.throws(() => addOpening(first, { wallId, width: 1, height: 1, sill: 0.5, offset: 1.4 }), error => error.code === 'opening_collision');
  assert.doesNotThrow(() => addOpening(first, { wallId, width: 0.6, height: 0.6, sill: 2.05, offset: 1 }));
});

test('wall tessellation leaves a real hole', () => {
  const base = createRectangularRoom(4, 3, 2.7);
  const wallId = base.walls[0].id;
  const model = addOpening(base, { wallId, width: 1, height: 2.1, sill: 0, offset: 2 });
  const rectangles = wallSurfaceRects(model, wallId);
  const coversHoleCenter = rectangles.some(rect => rect.x0 < 2 && rect.x1 > 2 && rect.z0 < 1 && rect.z1 > 1);
  const coversWallEdge = rectangles.some(rect => rect.x0 <= 0.1 && rect.x1 >= 0.1 && rect.z0 <= 1 && rect.z1 >= 1);
  assert.equal(coversHoleCenter, false);
  assert.equal(coversWallEdge, true);
});

test('rejects self-intersecting and degenerate polygons', () => {
  assert.throws(() => validatePolygon([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }]), error => error.code === 'zero_area' || error.code === 'self_intersection');
  assert.throws(() => validatePolygon([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }]), error => error.code === 'degenerate_segment');
});

test('reports malformed DXF without mutating an existing model', () => {
  const original = createRectangularRoom();
  assert.throws(() => parseDxf('not a dxf'), error => error.code === 'truncated_dxf');
  assert.equal(original.walls.length, 4);
  assert.equal(original.openings.length, 0);
});

test('rejects truncated DXF and excludes bulge geometry from the room outline', () => {
  assert.throws(() => parseDxf('0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n1\n21\n1\n'), error => error.code === 'truncated_dxf');
  const bulge = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n70\n1\n10\n0\n20\n0\n42\n1\n10\n4\n20\n0\n10\n4\n20\n3\n10\n0\n20\n3\n0\nENDSEC\n0\nEOF\n';
  const parsed = parseDxf(bulge);
  assert.equal(parsed.outline, null);
  assert.equal(parsed.entities[0].supported, false);
  assert.equal(parsed.entities[0].unsupportedReason, 'bulge_non_supportato');
});

test('normalizes string opening patches and rejects sub-10cm openings', () => {
  const base = createRectangularRoom(4, 3, 2.7);
  const model = addOpening(base, { wallId: base.walls[0].id, width: 1, height: 2, sill: 0, offset: 2 });
  const updated = updateOpening(model, model.openings[0].id, { width: '0.8', height: '1.8', offset: '1.5' });
  assert.equal(typeof updated.openings[0].width, 'number');
  assert.equal(updated.openings[0].width, 0.8);
  assert.throws(() => addOpening(base, { wallId: base.walls[0].id, width: 0.05, height: 1, sill: 0, offset: 2 }), error => error.code === 'invalid_opening_dimensions');
});
