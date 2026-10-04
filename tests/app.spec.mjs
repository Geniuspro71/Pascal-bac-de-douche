import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseDxf, rectangleInsidePolygon, roomFromDxf } from '../src/geometry.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(testDirectory, 'fixtures', 'inclined-room-mm.dxf');
const fixtureSource = readFileSync(fixture, 'utf8');

async function openEditor(page) {
  await page.goto('/');
  await page.locator('#projectName').fill('Progetto sintetico');
  await page.locator('#clientName').fill('Cliente sintetico');
  await page.locator('#toEditor').click();
  await expect(page.locator('#screen2')).toHaveClass(/active/);
}

test('validates dimensions, rejects collisions and keeps a real 3D wall hole', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => errors.push(`requestfailed:${request.url()}`));
  await openEditor(page);

  await page.locator('#roomW').fill('0');
  await page.locator('#toResult').click();
  await expect(page.locator('#screen2')).toHaveClass(/active/);
  await expect(page.locator('#roomStatus')).toContainText('positive');

  await page.locator('#roomW').fill('4');
  await page.locator('#roomD').fill('3');
  await page.locator('#roomH').fill('2.7');
  await page.locator('#applyRoom').click();
  await page.locator('#addOpening').click();
  await expect.poll(() => page.evaluate(() => window.__pascalDebug.openingCount())).toBe(1);
  await page.locator('#closeOpeningEditor').click();
  await page.locator('#addOpening').click();
  await expect.poll(() => page.evaluate(() => window.__pascalDebug.openingCount())).toBe(1);
  await expect(page.locator('#elementStatus')).toContainText('sovrappone');

  const hole = await page.evaluate(() => {
    const snapshot = window.__pascalDebug.snapshot();
    const opening = snapshot.openings[0];
    return {
      wallId: opening.wallId,
      openingId: opening.id,
      covered: window.__pascalDebug.isWallCovered(opening.wallId, opening.offset, opening.sill + opening.height / 2)
    };
  });
  expect(hole.openingId).toBeTruthy();
  expect(hole.wallId).toMatch(/^wall-/);
  expect(hole.covered).toBe(false);
  const twoDLeafIn = await page.locator('[data-door-leaf]').evaluate(element => ({ x2: element.getAttribute('x2'), y2: element.getAttribute('y2') }));

  await page.locator('#toResult').click();
  await expect(page.locator('#screen3')).toHaveClass(/active/);
  await expect(page.locator('#view canvas')).toBeVisible();
  const canvas = await page.locator('#view canvas').boundingBox();
  expect(canvas.width).toBeGreaterThan(200);
  expect(canvas.height).toBeGreaterThan(200);
  const rendered = await page.evaluate(({ wallId, openingId }) => {
    const snapshot = window.__pascalDebug.snapshot();
    const opening = snapshot.openings.find(item => item.id === openingId);
    const meshRects = window.__pascalDebug.meshRects(wallId);
    return {
      meshRects,
      meshCoversHole: meshRects.some(rect => rect.x0 < opening.offset && rect.x1 > opening.offset && rect.z0 < opening.sill + opening.height / 2 && rect.z1 > opening.sill + opening.height / 2),
      productParts: window.__pascalDebug.productParts()
    };
  }, hole);
  expect(rendered.meshRects.length).toBeGreaterThan(0);
  expect(rendered.meshCoversHole).toBe(false);
  expect(rendered.productParts.filter(part => part.kind === 'tray-slope')).toHaveLength(4);
  expect(rendered.productParts.some(part => part.kind === 'drain')).toBe(true);
  const leafIn = await page.evaluate(() => window.__pascalDebug.doorLeaves()[0]);
  const colorsBefore = await page.evaluate(() => window.__pascalDebug.materials?.());
  await page.locator('#command').fill('pietra blu sulla parete');
  await page.locator('#sendCommand').click();
  const colorsAfter = await page.evaluate(() => window.__pascalDebug.materials());
  expect(colorsAfter.wall).not.toBe(colorsBefore?.wall);
  await page.locator('#backEditor').click();
  await page.locator('[data-opening-id]').click({ force: true });
  await page.locator('#propSwing').selectOption('out');
  await page.locator('#applyOpeningProps').click();
  const twoDLeafOut = await page.locator('[data-door-leaf]').evaluate(element => ({ x2: element.getAttribute('x2'), y2: element.getAttribute('y2') }));
  expect(twoDLeafOut).not.toEqual(twoDLeafIn);
  await page.locator('#toResult').click();
  const leafOut = await page.evaluate(() => window.__pascalDebug.doorLeaves()[0]);
  expect(leafOut.position).not.toEqual(leafIn.position);
  expect(leafOut.swing).toBe('out');
  await page.screenshot({ path: 'test-results/shared-geometry-3d.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('imports synthetic millimetre DXF atomically and uses inclined stable walls', async ({ page }) => {
  await page.goto('/');
  await page.locator('#dxfImport').setInputFiles(fixture);
  await expect(page.locator('#dxfStatus')).toContainText('perimetro valido');
  const snapshot = await page.evaluate(() => window.__pascalDebug.snapshot());
  expect(snapshot.source.type).toBe('dxf');
  expect(snapshot.walls).toHaveLength(4);
  expect(snapshot.walls[0].length).toBeCloseTo(Math.hypot(4.2, 0.8), 5);
  expect(new Set(snapshot.walls.map(wall => wall.id)).size).toBe(4);
  expect(snapshot.references).toHaveLength(3);
  expect(snapshot.references.find(item => item.type === 'TEXT').classification).toBe('unclassified');
  await page.locator('#projectName').fill('DXF sintetico');
  await page.locator('#clientName').fill('Cliente sintetico');
  await page.locator('#toEditor').click();
  await page.locator('#addOpening').click();
  await page.locator('#closeOpeningEditor').click();
  const openingWallId = await page.evaluate(() => window.__pascalDebug.snapshot().openings[0].wallId);
  await page.locator('#backProject').click();
  const rotatedSource = fixtureSource.replace(
    '10\n0\n20\n0\n10\n4200\n20\n800\n10\n3500\n20\n3400\n10\n200\n20\n2800',
    '10\n4200\n20\n800\n10\n3500\n20\n3400\n10\n200\n20\n2800\n10\n0\n20\n0'
  );
  await page.locator('#dxfImport').setInputFiles({ name: 'rotated-room.dxf', mimeType: 'text/plain', buffer: Buffer.from(rotatedSource) });
  await expect.poll(() => page.evaluate(() => window.__pascalDebug.openingCount())).toBe(1);
  expect(await page.evaluate(() => window.__pascalDebug.snapshot().openings[0].wallId)).toBe(openingWallId);
  const shiftedSource = fixtureSource.replace(
    '10\n0\n20\n0\n10\n4200\n20\n800\n10\n3500\n20\n3400\n10\n200\n20\n2800',
    '10\n10000\n20\n0\n10\n14200\n20\n800\n10\n13500\n20\n3400\n10\n10200\n20\n2800'
  );
  await page.locator('#dxfImport').setInputFiles({ name: 'different-room.dxf', mimeType: 'text/plain', buffer: Buffer.from(shiftedSource) });
  await expect.poll(() => page.evaluate(() => window.__pascalDebug.openingCount())).toBe(0);
  await page.locator('#toEditor').click();
  await page.locator('#addOpening').click();
  await page.locator('#closeOpeningEditor').click();
  const beforeDrag = await page.evaluate(() => window.__pascalDebug.snapshot());
  const vertex = await page.locator('[data-vertex-index="1"]').boundingBox();
  await page.mouse.move(vertex.x + vertex.width / 2, vertex.y + vertex.height / 2);
  await page.mouse.down();
  await page.mouse.move(vertex.x + vertex.width / 2 + 18, vertex.y + vertex.height / 2 - 12, { steps: 4 });
  await page.mouse.up();
  const afterDrag = await page.evaluate(() => window.__pascalDebug.snapshot());
  expect(afterDrag.vertices[1]).not.toEqual(beforeDrag.vertices[1]);
  expect(afterDrag.source.edited).toBe(true);
  expect(afterDrag.openings).toHaveLength(1);
  expect(afterDrag.walls.some(wall => wall.id === afterDrag.openings[0].wallId)).toBe(true);
  await page.locator('#backProject').click();
  await page.locator('#dxfUnits').selectOption('0.001');
  await expect.poll(() => page.evaluate(() => window.__pascalDebug.openingCount())).toBe(1);
});

test('does not attach manual openings by index when a unitless DXF gets a late scale', async ({ page }) => {
  await openEditor(page);
  await page.locator('#addOpening').click();
  await page.locator('#closeOpeningEditor').click();
  await page.locator('#backProject').click();
  const unitless = fixtureSource.replace('$INSUNITS\n70\n4', '$INSUNITS\n70\n0').replace(
    '10\n0\n20\n0\n10\n4200\n20\n800\n10\n3500\n20\n3400\n10\n200\n20\n2800',
    '10\n4200\n20\n800\n10\n3500\n20\n3400\n10\n200\n20\n2800\n10\n0\n20\n0'
  );
  await page.locator('#dxfImport').setInputFiles({ name: 'unitless-room.dxf', mimeType: 'text/plain', buffer: Buffer.from(unitless) });
  await expect.poll(() => page.evaluate(() => window.__pascalDebug.openingCount())).toBe(1);
  await page.locator('#dxfUnits').selectOption('0.001');
  await expect.poll(() => page.evaluate(() => window.__pascalDebug.openingCount())).toBe(0);
  expect((await page.evaluate(() => window.__pascalDebug.snapshot())).source.type).toBe('dxf');
});

test('exports the shared model as JSON', async ({ page }) => {
  await openEditor(page);
  await page.locator('#backProject').click();
  await page.locator('#clientPhone').fill('+32 000 000');
  await page.locator('#clientEmail').fill('sintetico@example.test');
  await page.locator('#siteAddress').fill('Cantiere sintetico');
  await page.locator('#projectNotes').fill('Dati sintetici di prova');
  await page.locator('#toEditor').click();
  await page.locator('#addOpening').click();
  await page.locator('#closeOpeningEditor').click();
  await page.locator('#toResult').click();
  await page.locator('#toDocuments').click();
  await page.locator('#docDxf').uncheck();
  await page.locator('#docGlb').uncheck();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportDocs').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  const stream = await download.createReadStream();
  let content = '';
  for await (const chunk of stream) content += chunk.toString();
  const exported = JSON.parse(content);
  expect(exported.geometry.openings).toHaveLength(1);
  expect(exported.geometry.walls).toHaveLength(4);
  expect(exported.project.phone).toBe('+32 000 000');
  expect(exported.project.email).toBe('sintetico@example.test');
  expect(exported.project.siteAddress).toBe('Cantiere sintetico');
  expect(exported.project.notes).toBe('Dati sintetici di prova');
  await expect(page.locator('#docStatus')).toContainText('generato');
});

test('exports parseable DXF and binary GLB from the rendered shared model', async ({ page }) => {
  await openEditor(page);
  await page.locator('#addOpening').click();
  await page.locator('#closeOpeningEditor').click();
  await page.locator('#toResult').click();
  await page.locator('#toDocuments').click();
  await page.locator('#docJson').uncheck();
  await page.locator('#docGlb').uncheck();
  let downloadPromise = page.waitForEvent('download');
  await page.locator('#exportDocs').click();
  let download = await downloadPromise;
  let stream = await download.createReadStream();
  let content = '';
  for await (const chunk of stream) content += chunk.toString();
  expect(content).toContain('$INSUNITS');
  expect(content).toContain('PASCAL_OPENINGS');
  const roundTrip = roomFromDxf(parseDxf(content));
  expect(roundTrip.openings).toHaveLength(1);
  expect(roundTrip.openings[0].type).toBe('door');
  expect(roundTrip.openings[0].width).toBeCloseTo(0.9, 6);
  expect(roundTrip.openings[0].height).toBeCloseTo(2.1, 6);
  expect(content.trimEnd()).toMatch(/EOF$/);

  await page.locator('#docDxf').uncheck();
  await page.locator('#docGlb').check();
  downloadPromise = page.waitForEvent('download');
  await page.locator('#exportDocs').click();
  download = await downloadPromise;
  stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const glb = Buffer.concat(chunks);
  expect(glb.subarray(0, 4).toString('ascii')).toBe('glTF');
  expect(glb.length).toBeGreaterThan(1_000);

  await page.goto('/');
  await page.locator('#dxfImport').setInputFiles({ name: 'round-trip.dxf', mimeType: 'text/plain', buffer: Buffer.from(content) });
  await page.locator('#projectName').fill('Round trip');
  await page.locator('#clientName').fill('Cliente sintetico');
  await page.locator('#toEditor').click();
  await page.locator('#roomW').fill('5');
  await page.locator('#applyRoom').click();
  await expect.poll(() => page.evaluate(() => window.__pascalDebug.openingCount())).toBe(1);
  await expect(page.locator('#roomStatus')).not.toContainText('sovrappone');
});

test('mobile viewport has no document overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  await page.locator('#addOpening').click();
  await page.locator('#closeOpeningEditor').click();
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight
  }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  expect(dimensions.height).toBeLessThanOrEqual(dimensions.viewportHeight + 1);
  await page.screenshot({ path: 'test-results/mobile-editor.png', fullPage: true });
});

test('keeps the complete tray surface inside a concave room', async ({ page }) => {
  const concave = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nWALLS\n90\n8\n70\n1\n10\n0\n20\n0\n10\n4\n20\n0\n10\n4\n20\n1.8\n10\n1.5\n20\n1.8\n10\n1.5\n20\n2.2\n10\n4\n20\n2.2\n10\n4\n20\n4\n10\n0\n20\n4\n0\nENDSEC\n0\nEOF\n';
  await page.goto('/');
  await page.locator('#dxfImport').setInputFiles({ name: 'concave-room.dxf', mimeType: 'text/plain', buffer: Buffer.from(concave) });
  await page.locator('#projectName').fill('Perimetro concavo');
  await page.locator('#clientName').fill('Cliente sintetico');
  await page.locator('#toEditor').click();
  await page.locator('#toResult').click();
  await expect(page.locator('#view canvas')).toBeVisible();
  const placement = await page.evaluate(() => window.__pascalDebug.productPlacement());
  expect(Number.isFinite(placement.center.x)).toBe(true);
  expect(Number.isFinite(placement.center.y)).toBe(true);
  expect(placement.width).toBeGreaterThan(0.1);
  expect(placement.depth).toBeGreaterThan(0.1);
  const snapshot = await page.evaluate(() => window.__pascalDebug.snapshot());
  expect(rectangleInsidePolygon(snapshot.vertices, placement.center, placement.width, placement.depth)).toBe(true);
  await expect(page.locator('#error')).toBeHidden();
});
