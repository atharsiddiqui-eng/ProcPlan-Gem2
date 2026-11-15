import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  calculateCuttingParams,
  exportToDxf,
  exportToGcode,
  exportToProcessCsv,
  exportToSvg,
  generateToolpathOverlay,
  matchMaterialPreset,
} from '../src/utils/camEngine';
import {
  buildPayloadGeometry,
  buildRawVectorAnalysis,
  MAX_CHUNK_VECTOR_SEGMENTS,
  MAX_TOTAL_VECTOR_SEGMENTS,
  parseOperatorListToSegments,
} from '../src/utils/pdfVectorCore';
import { sanitizeAnalysisResult } from '../src/utils/sanitizeAnalysis';
import type { PdfExtractionPayload, RawNormalizedText } from '../src/types/cad';

async function loadShellPdfPayload(): Promise<PdfExtractionPayload> {
  const pdfPath = path.resolve(process.cwd(), 'public/assets/aistudio/Shell_b55006b8.pdf');
  const bytes = new Uint8Array(await fs.readFile(pdfPath));
  const pdf = await pdfjsLib.getDocument({ data: bytes, verbosity: 0 }).promise;
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 1.5 });

  const textContent = await page.getTextContent();
  const extractedText: string[] = [];
  const rawNormalizedTextItems: RawNormalizedText[] = [];
  for (const item of textContent.items) {
    if ('str' in item && typeof item.str === 'string') {
      const cleaned = item.str.trim();
      if (!cleaned) continue;
      extractedText.push(cleaned);
      const tx = item.transform?.[4] ?? 0;
      const ty = item.transform?.[5] ?? 0;
      const [vx, vy] = viewport.convertToViewportPoint(tx, ty);
      rawNormalizedTextItems.push({
        text: cleaned,
        nx: Math.max(0, Math.min(1, vx / viewport.width)),
        ny: Math.max(0, Math.min(1, vy / viewport.height)),
      });
    }
  }

  const ops = await page.getOperatorList();
  const internalSegments = parseOperatorListToSegments(ops, pdfjsLib.OPS, viewport);
  const geom = buildPayloadGeometry(
    internalSegments,
    rawNormalizedTextItems,
    1,
    baseViewport.width,
    baseViewport.height,
    () => ''
  );

  return {
    fileName: 'Shell_b55006b8.pdf',
    pageCount: pdf.numPages,
    selectedPage: 1,
    pageWidthPt: baseViewport.width,
    pageHeightPt: baseViewport.height,
    renderedImageDataUrl: '',
    extractedText,
    vectorEntityCount: geom.centeredEntities.length,
    vectorEntities: geom.centeredEntities,
    vectorBoundingBox: geom.vectorBoundingBox,
    hasMultipleViews: geom.viewChunks.length > 1,
    viewChunks: geom.viewChunks,
    rawNormalizedSegments: geom.rawNormalizedSegments,
    rawNormalizedTextItems: rawNormalizedTextItems.slice(0, 600),
    detectedScaleLabel: geom.detectedScaleLabel,
    detectedScaleFactor: geom.detectedScaleFactor,
    titleBlockMeta: geom.titleBlockMeta,
    truncated: geom.truncated,
    droppedSegmentCount: geom.droppedSegmentCount,
  };
}

async function main() {
  // 1. Shell_b55006b8.pdf SolidWorks vector parsing, view detection & 1:20 calibration
  const payload = await loadShellPdfPayload();
  assert.ok(payload.vectorEntityCount >= 100, `Expected >=100 vectors, got ${payload.vectorEntityCount}`);
  assert.equal(payload.vectorEntityCount, payload.vectorEntities.length);
  assert.equal(payload.truncated, false);
  assert.equal(payload.droppedSegmentCount, 0);
  assert.ok(payload.viewChunks.length >= 2, `Expected >=2 views, got ${payload.viewChunks.length}`);
  assert.ok(
    payload.detectedScaleFactor && payload.detectedScaleFactor > 5 && payload.detectedScaleLabel?.includes('1:20'),
    `Expected calibrated scale referencing sheet 1:20, got ${payload.detectedScaleFactor} (${payload.detectedScaleLabel})`
  );

  const realAnalysis = buildRawVectorAnalysis(payload, { scaleMode: 'real' });
  const realSpanX = realAnalysis.boundingBox.maxX - realAnalysis.boundingBox.minX;
  const realSpanY = realAnalysis.boundingBox.maxY - realAnalysis.boundingBox.minY;
  assert.ok(
    realAnalysis.stockEnvelope.length >= 990 && realAnalysis.stockEnvelope.length <= 1050,
    `Expected ~1000+ mm stock length for 1000 mm shell, got ${realAnalysis.stockEnvelope.length}`
  );
  assert.ok(
    realAnalysis.features.some((f) => f.dimensions.includes('992.') || f.dimensions.includes('1000')),
    `Expected ~1000x440 mm shell view feature, got: ${realAnalysis.features.map((f) => f.dimensions).join('; ')}`
  );
  assert.equal(matchMaterialPreset(realAnalysis.material).id, 'ms-is2062');

  const paperAnalysis = buildRawVectorAnalysis(payload, { scaleMode: 'paper' });
  const paperSpanX = paperAnalysis.boundingBox.maxX - paperAnalysis.boundingBox.minX;
  assert.ok(
    realSpanX > paperSpanX * 5 && realSpanY > 100 && paperSpanX > 100,
    `Expected real span (${realSpanX.toFixed(1)}) >> paper span (${paperSpanX.toFixed(1)})`
  );

  const skippedAnalysis = buildRawVectorAnalysis(payload, {
    scaleMode: 'paper',
    customScaleRatio: 10,
    preferredMaterial: '304 Stainless Steel',
    modules: { cadPlotting: false, processPlan: false, toolingFeeds: false },
  });
  assert.equal(skippedAnalysis.material, '304 Stainless Steel');
  assert.equal(skippedAnalysis.detectedScaleFactor, 10);
  assert.equal(skippedAnalysis.entities.length, 0);
  assert.equal(skippedAnalysis.dimensions.length, 0);
  assert.equal(skippedAnalysis.processPlan.length, 0);

  // 2. CAM presets, speed/feed bounds, toolpath & exporters
  const al = matchMaterialPreset('6061-T6');
  assert.equal(al.id, 'al-6061');
  const cut = calculateCuttingParams(al, 10, 3);
  assert.ok(cut.spindleRpm >= 150 && cut.spindleRpm <= 18000);
  assert.ok(cut.feedRateMmMin >= 40);

  const toolpaths = generateToolpathOverlay(realAnalysis);
  assert.ok(toolpaths.length > 0, 'Expected generated toolpath segments');
  const dxfOut = exportToDxf(realAnalysis);
  const svgOut = exportToSvg(realAnalysis);
  assert.ok(dxfOut.includes('ENTITIES') && dxfOut.includes('\nDIMENSION\n'));
  assert.ok(svgOut.includes('<svg') && svgOut.includes('data-layer="DIMENSION"') && svgOut.includes('#b45309'));
  assert.ok(exportToGcode(realAnalysis).includes('M30'));
  assert.ok(exportToProcessCsv(realAnalysis, 25).includes('OP-10'));

  // 2b. Color-agnostic arrowhead + dim text + dim line + extension line detection & CAM exclusion
  const pageW = 842;
  const pageH = 595;
  const mockViewport = {
    width: pageW,
    height: pageH,
    convertToViewportPoint: (x: number, y: number) => [x, pageH - y],
  };
  const OPS = pdfjsLib.OPS;
  const mockOps = {
    fnArray: [
      OPS.setLineWidth,
      OPS.setStrokeRGBColor,
      OPS.constructPath, // Part rectangle (closed 4-seg outline, thick black)
      OPS.setLineWidth,
      OPS.setStrokeRGBColor,
      OPS.constructPath, // Left extension line (blue, thin, overshoots arrow tip)
      OPS.constructPath, // Right extension line (blue, thin, overshoots arrow tip)
      OPS.constructPath, // Dimension line spanning between x=150..350 at y=360
      OPS.constructPath, // Left filled black arrowhead triangle (tip at 150,360)
      OPS.constructPath, // Right filled black arrowhead triangle (tip at 350,360)
    ],
    argsArray: [
      [1.2],
      ['#000000'],
      [OPS.stroke, [new Float32Array([0, 150, 200, 1, 350, 200, 1, 350, 300, 1, 150, 300, 4])]],
      [0.4],
      ['#0066cc'],
      [OPS.stroke, [new Float32Array([0, 150, 305, 1, 150, 368])]],
      [OPS.stroke, [new Float32Array([0, 350, 305, 1, 350, 368])]],
      [OPS.stroke, [new Float32Array([0, 150, 360, 1, 350, 360])]],
      [OPS.fill, [new Float32Array([0, 150, 360, 1, 160, 362, 1, 160, 358, 4])]],
      [OPS.fill, [new Float32Array([0, 350, 360, 1, 340, 362, 1, 340, 358, 4])]],
    ],
  };
  const synSegs = parseOperatorListToSegments(mockOps, OPS, mockViewport);
  const synGeom = buildPayloadGeometry(
    synSegs,
    [{ text: '250', nx: 250 / pageW, ny: (pageH - 365) / pageH }],
    1,
    pageW,
    pageH,
    () => ''
  );
  const synOutlines = synGeom.centeredEntities.filter((e) => e.layer === 'outline');
  const synDims = synGeom.centeredEntities.filter((e) => e.layer === 'dimension');
  assert.equal(synOutlines.length, 4, `Expected 4 part outline segs, got ${synOutlines.length}`);
  assert.equal(synDims.length, 9, `Expected 9 dim segs (2 arrows + dim + 2 ext), got ${synDims.length}`);

  const dimOnlyToolpaths = generateToolpathOverlay({
    ...realAnalysis,
    entities: synDims.map((e, i) => ({ ...e, featureId: `f-${i}` })),
    processPlan: [{ ...realAnalysis.processPlan[0], targetFeatureId: 'f-0' }],
  });
  assert.equal(dimOnlyToolpaths.length, 0, 'Expected zero CAM toolpaths on dimension entities');

  // 2c. Step 1 lossless collinear merge, shortest-first cap pruning & chunk/payload bounds agreement
  const fnArr: number[] = [OPS.setLineWidth, OPS.setStrokeRGBColor];
  const argArr: unknown[][] = [[1.0], ['#000000']];
  // Two collinear touching 30pt segments in interior -> must merge into 1 segment
  fnArr.push(OPS.constructPath, OPS.constructPath);
  argArr.push(
    [OPS.stroke, [new Float32Array([0, 120, 420, 1, 150, 420])]],
    [OPS.stroke, [new Float32Array([0, 150, 420, 1, 180, 420])]]
  );
  // 21,000 tiny 0.8pt (~0.28 mm) segments + 50 macro 20pt (~7 mm) segments inside one dense view
  for (let i = 0; i < 21000; i++) {
    const x = 100 + (i % 210) * 1.6;
    const y = 140 + Math.floor(i / 210) * 1.8;
    fnArr.push(OPS.constructPath);
    argArr.push([OPS.stroke, [new Float32Array([0, x, y, 1, x + 0.8, y])]]);
  }
  for (let i = 0; i < 50; i++) {
    const y = 330 + (i % 10) * 5;
    const x = 200 + Math.floor(i / 10) * 25;
    fnArr.push(OPS.constructPath);
    argArr.push([OPS.stroke, [new Float32Array([0, x, y, 1, x + 20, y])]]);
  }
  const denseSegs = parseOperatorListToSegments({ fnArray: fnArr, argsArray: argArr }, OPS, mockViewport);
  const denseGeom = buildPayloadGeometry(denseSegs, [], 1, pageW, pageH, () => '');
  assert.equal(denseGeom.truncated, true, 'Expected truncated=true above 20,000 segments');
  assert.ok(denseGeom.droppedSegmentCount > 0, 'Expected droppedSegmentCount > 0');
  assert.equal(denseGeom.centeredEntities.length, MAX_TOTAL_VECTOR_SEGMENTS);
  // Check the two 30pt collinear segments merged into one ~21.167 mm line and survived pruning
  const mergedLongLine = denseGeom.centeredEntities.find(
    (e) => e.type === 'line' && Math.hypot(e.x2 - e.x1, e.y2 - e.y1) > 20.5
  );
  assert.ok(mergedLongLine, 'Expected merged collinear 60pt segment (~21.2 mm) to be preserved');
  // Check all 50 macro segments (>= 1mm) survived shortest-first pruning
  const macroCount = denseGeom.centeredEntities.filter(
    (e) => e.type === 'line' && Math.hypot(e.x2 - e.x1, e.y2 - e.y1) >= 6.5
  ).length;
  assert.equal(macroCount, 51, `Expected 50 macro + 1 merged long line = 51, got ${macroCount}`);
  assert.ok(
    denseGeom.viewChunks.every((c) => c.vectorEntities.length <= MAX_CHUNK_VECTOR_SEGMENTS),
    'Expected every view chunk to respect MAX_CHUNK_VECTOR_SEGMENTS'
  );
  // Verify vectorBoundingBox agrees with centeredEntities bounds
  const entMinX = denseGeom.centeredEntities.reduce((m, e) => (e.type === 'line' ? Math.min(m, e.x1, e.x2) : m), Infinity);
  const entMaxX = denseGeom.centeredEntities.reduce((m, e) => (e.type === 'line' ? Math.max(m, e.x1, e.x2) : m), -Infinity);
  assert.ok(Math.abs(entMinX - denseGeom.vectorBoundingBox.minX) < 0.05);
  assert.ok(Math.abs(entMaxX - denseGeom.vectorBoundingBox.maxX) < 0.05);

  // 2d. Step 2 border & title block filtering keeps long (>70% sheet width) interior part edges
  const borderOps = {
    fnArray: [
      OPS.setLineWidth,
      OPS.setStrokeRGBColor,
      OPS.constructPath, // Outer border rectangle [24,24..818,571]
      OPS.constructPath, // Title block box bottom-right [540,24..818,114]
      OPS.constructPath, // Long horizontal part plate inside border [80..720] = 76% width
    ],
    argsArray: [
      [1.0],
      ['#000000'],
      [OPS.stroke, [new Float32Array([0, 24, 24, 1, 818, 24, 1, 818, 571, 1, 24, 571, 4])]],
      [OPS.stroke, [new Float32Array([0, 540, 24, 1, 818, 24, 1, 818, 114, 1, 540, 114, 4])]],
      [OPS.stroke, [new Float32Array([0, 80, 250, 1, 720, 250, 1, 720, 420, 1, 80, 420, 4])]],
    ],
  };
  const borderSegs = parseOperatorListToSegments(borderOps, OPS, mockViewport);
  const borderGeom = buildPayloadGeometry(
    borderSegs,
    [{ text: 'DWG NO: LONG-EDGE-01', nx: 600 / pageW, ny: (pageH - 60) / pageH }],
    1,
    pageW,
    pageH,
    () => ''
  );
  assert.equal(borderGeom.centeredEntities.length, 4, `Expected 4 interior part edges kept, got ${borderGeom.centeredEntities.length}`);
  const longPartSpanMm = borderGeom.vectorBoundingBox.maxX - borderGeom.vectorBoundingBox.minX;
  assert.ok(longPartSpanMm > 220, `Expected >70% sheet width edge (~225.8 mm), got ${longPartSpanMm.toFixed(1)}`);

  // 3. Entity & NaN sanitization guards
  const sanitized = sanitizeAnalysisResult({
    partName: 'Guard Test',
    entities: [
      { id: 'bad-line', layer: 'outline', type: 'line', x1: Number.NaN, y1: 0, x2: 10, y2: 10 },
      { id: 'bad-circle', layer: 'hole', type: 'circle', cx: 0, cy: 0, r: 0 },
      { id: 'good-circle', layer: 'hole', type: 'circle', cx: 10, cy: -5, r: 6 },
    ],
  });
  assert.equal(sanitized.entities.length, 1);
  assert.equal(sanitized.entities[0].id, 'good-circle');
  assert.ok(Number.isFinite(sanitized.boundingBox.minX) && Number.isFinite(sanitized.boundingBox.maxX));

  console.log(
    `Self-check passed: Shell_b55006b8.pdf (${payload.vectorEntityCount} vectors, ${payload.viewChunks.length} views, real ${realSpanX.toFixed(1)}x${realSpanY.toFixed(1)} mm), Step 1-2 compaction & border filter, dim topology, CAM & sanitize guards OK.`
  );
}

main().catch((err) => {
  console.error('Self-check failed:', err);
  process.exit(1);
});
