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
  calibrateScaleFromViewChunks,
  detectViewRegions,
  extractNumericDimCallouts,
  inferSheetSizeMm,
  MAX_CHUNK_VECTOR_SEGMENTS,
  MAX_TOTAL_VECTOR_SEGMENTS,
  parseOperatorListToSegments,
  parseTitleBlockMetadata,
  PT_TO_MM,
  recoverPrimitivesFromSegments,
} from '../src/utils/pdfVectorCore';
import { generateSampleMechanicalPdfBytes, SAMPLE_DRAWINGS } from '../src/utils/sampleDrawings';
import { sanitizeAnalysisResult } from '../src/utils/sanitizeAnalysis';
import type {
  CadArcEntity,
  CadCircleEntity,
  CadLineEntity,
  CadPolylineEntity,
  PdfExtractionPayload,
  RawNormalizedSegment,
  RawNormalizedText,
} from '../src/types/cad';

async function extractPayloadFromPdfBytes(
  bytes: Uint8Array,
  fileName: string,
  pageNumber = 1
): Promise<PdfExtractionPayload> {
  const loadingTask = pdfjsLib.getDocument({ data: bytes, verbosity: 0 });
  const pdf = await loadingTask.promise;
  try {
    const page = await pdf.getPage(pageNumber);
    try {
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
        pageNumber,
        baseViewport.width,
        baseViewport.height,
        () => ''
      );

      return {
        fileName,
        pageCount: pdf.numPages,
        selectedPage: pageNumber,
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
    } finally {
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
}

async function loadShellPdfPayload(): Promise<PdfExtractionPayload> {
  const pdfPath = path.resolve(process.cwd(), 'public/assets/aistudio/Shell_b55006b8.pdf');
  const bytes = new Uint8Array(await fs.readFile(pdfPath));
  return extractPayloadFromPdfBytes(bytes, 'Shell_b55006b8.pdf', 1);
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
  assert.ok(dxfOut.includes('\nCIRCLE\n') && dxfOut.includes('\nARC\n'), 'Expected true CIRCLE and ARC records in DXF');
  assert.ok(svgOut.includes('<svg') && svgOut.includes('data-layer="DIMENSION"') && svgOut.includes('#b45309'));
  assert.ok(svgOut.includes('<circle') && svgOut.includes('<path'), 'Expected <circle and arc <path in SVG');
  assert.ok(exportToGcode(realAnalysis).includes('M30'));
  assert.ok(exportToProcessCsv(realAnalysis, 25).includes('OP-10'));

  // Step 7 check on Shell_b55006b8.pdf: cross-section view yields recovered circles within 1 mm of 440 and 430
  const crossSectionChunk = realAnalysis.viewChunks?.find((c) => c.viewKind === 'cross-section');
  assert.ok(crossSectionChunk, 'Expected a cross-section view chunk on Shell_b55006b8.pdf');
  const crossOutlineCircles = realAnalysis.entities.filter(
    (e): e is CadCircleEntity =>
      e.type === 'circle' && e.viewId === crossSectionChunk.id && e.layer === 'outline'
  );
  assert.ok(
    crossOutlineCircles.every((c) => c.source === 'recovered'),
    'Expected recovered source flag on cross-section circles'
  );
  const crossDias = crossOutlineCircles.map((c) => c.r * 2).sort((a, b) => b - a);
  assert.ok(
    crossDias.some((d) => Math.abs(d - 440) <= 1.0) &&
      crossDias.some((d) => Math.abs(d - 430) <= 1.0),
    `Expected cross-section circles within 1 mm of 440 and 430, got diameters [${crossDias.map((d) => d.toFixed(2)).join(', ')}]`
  );

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
      [OPS.fillStroke, [new Float32Array([0, 150, 360, 1, 160, 362, 1, 160, 358, 4])]],
      [OPS.fillStroke, [new Float32Array([0, 350, 360, 1, 340, 362, 1, 340, 358, 4])]],
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

  // 2e. Step 3 hand-built operator list with mocked OPS table (clip, fill-only, XObject matrix, setGState & setDash)
  const mockedOpsTable = {
    save: 10,
    restore: 11,
    transform: 12,
    setLineWidth: 2,
    setStrokeRGBColor: 58,
    setStrokeGray: 56,
    setDash: 6,
    setGState: 9,
    paintFormXObjectBegin: 74,
    paintFormXObjectEnd: 75,
    constructPath: 91,
    moveTo: 13,
    lineTo: 14,
    curveTo: 15,
    curveTo2: 16,
    curveTo3: 17,
    closePath: 18,
    rectangle: 19,
    stroke: 20,
    closeStroke: 21,
    fill: 22,
    eoFill: 23,
    fillStroke: 24,
    eoFillStroke: 25,
    closeFillStroke: 26,
    closeEOFillStroke: 27,
    endPath: 28,
    clip: 29,
    eoClip: 30,
  };
  const step3Ops = {
    fnArray: [
      mockedOpsTable.constructPath, // Clip-only rect (endPath / W n) -> MUST be ignored
      mockedOpsTable.moveTo,
      mockedOpsTable.lineTo,
      mockedOpsTable.clip,
      mockedOpsTable.endPath, // Legacy clip + endPath -> MUST be ignored
      mockedOpsTable.constructPath, // Fill-only small arrowhead triangle -> MUST emit nothing
      mockedOpsTable.constructPath, // Fill-only large block -> MUST emit nothing
      mockedOpsTable.paintFormXObjectBegin, // Push transform [2,0,0,2,100,50]
      mockedOpsTable.setGState, // Apply LW=0.25 and D=[[6,3,2,3],0]
      mockedOpsTable.constructPath, // Stroked line (0,0)->(50,0) => transformed to (100,50)->(200,50), dashed, lw=0.5
      mockedOpsTable.paintFormXObjectEnd, // Pop XObject transform & gState
      mockedOpsTable.setDash, // Explicit setDash [4,2]
      mockedOpsTable.constructPath, // Stroked line (10,10)->(60,10) => untransformed, dashed
    ],
    argsArray: [
      [mockedOpsTable.endPath, [new Float32Array([0, 50, 50, 1, 200, 50, 1, 200, 200, 1, 50, 200, 4])]],
      [10, 10],
      [90, 90],
      [],
      [],
      [mockedOpsTable.fill, [new Float32Array([0, 100, 100, 1, 110, 102, 1, 110, 98, 4])]],
      [mockedOpsTable.eoFill, [new Float32Array([0, 300, 300, 1, 400, 300, 1, 400, 350, 1, 300, 350, 4])]],
      [[2, 0, 0, 2, 100, 50], null],
      [[['LW', 0.25], ['D', [[6, 3, 2, 3], 0]]]],
      [mockedOpsTable.stroke, [new Float32Array([0, 0, 0, 1, 50, 0])]],
      [],
      [[4, 2], 0],
      [mockedOpsTable.fillStroke, [new Float32Array([0, 10, 10, 1, 60, 10])]],
    ],
  };
  const step3Segs = parseOperatorListToSegments(step3Ops, mockedOpsTable, mockViewport);
  assert.equal(step3Segs.length, 2, `Expected exactly 2 stroked segments (clip & fill-only ignored), got ${step3Segs.length}`);
  assert.ok(
    Math.abs(step3Segs[0].x1Mm - 100 * (25.4 / 72)) < 0.05 &&
      Math.abs(step3Segs[0].x2Mm - 200 * (25.4 / 72)) < 0.05,
    'Expected XObject transform matrix applied to first stroked segment'
  );
  assert.equal(step3Segs[0].isDashed, true, 'Expected setGState dash pattern applied');
  assert.ok(Math.abs(step3Segs[0].effLineWidth - 0.5) < 0.01, 'Expected setGState LW * XObject scale = 0.5');
  assert.ok(
    Math.abs(step3Segs[1].x1Mm - 10 * (25.4 / 72)) < 0.05 &&
      Math.abs(step3Segs[1].x2Mm - 60 * (25.4 / 72)) < 0.05,
    'Expected paintFormXObjectEnd restored outer transform matrix'
  );
  assert.equal(step3Segs[1].isDashed, true, 'Expected setDash applied to second stroked segment');

  // 2f. Step 4 view clustering: 50k random segments < 300 ms & 3 well-separated views (+ >6 cluster area selection)
  let rng = 0x13579bdf;
  const nextRand = () => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  const randSegs50k: RawNormalizedSegment[] = new Array(50000);
  for (let i = 0; i < 50000; i++) {
    const x1 = 0.04 + nextRand() * 0.88;
    const y1 = 0.04 + nextRand() * 0.72;
    const dx = (nextRand() - 0.5) * 0.04;
    const dy = (nextRand() - 0.5) * 0.04;
    const x2 = Math.max(0.02, Math.min(0.96, x1 + dx));
    const y2 = Math.max(0.02, Math.min(0.78, y1 + dy));
    randSegs50k[i] = {
      nx1: x1,
      ny1: y1,
      nx2: x2,
      ny2: y2,
      x1Mm: x1 * 420,
      y1Mm: (1 - y1) * 297,
      x2Mm: x2 * 420,
      y2Mm: (1 - y2) * 297,
      layerHint: 'outline',
    };
  }
  const t0 = performance.now();
  const randViews = detectViewRegions(randSegs50k, [], 0.86, inferSheetSizeMm(randSegs50k));
  const clusterMs = performance.now() - t0;
  assert.ok(randViews.length >= 1 && randViews.length <= 6);
  assert.ok(clusterMs < 300, `Expected 50k segment clustering < 300 ms, took ${clusterMs.toFixed(1)} ms`);

  // Synthetic non-square sheet (500 x 200 mm): 3 large views out-of-order + 5 tiny top notes (>6 clusters total)
  const makeBoxSegs = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    wMm: number,
    hMm: number
  ): RawNormalizedSegment[] => [
    { nx1: x1, ny1: y1, nx2: x2, ny2: y1, x1Mm: x1 * wMm, y1Mm: (1 - y1) * hMm, x2Mm: x2 * wMm, y2Mm: (1 - y1) * hMm, layerHint: 'outline' },
    { nx1: x2, ny1: y1, nx2: x2, ny2: y2, x1Mm: x2 * wMm, y1Mm: (1 - y1) * hMm, x2Mm: x2 * wMm, y2Mm: (1 - y2) * hMm, layerHint: 'outline' },
    { nx1: x2, ny1: y2, nx2: x1, ny2: y2, x1Mm: x2 * wMm, y1Mm: (1 - y2) * hMm, x2Mm: x1 * wMm, y2Mm: (1 - y2) * hMm, layerHint: 'outline' },
    { nx1: x1, ny1: y2, nx2: x1, ny2: y1, x1Mm: x1 * wMm, y1Mm: (1 - y2) * hMm, x2Mm: x1 * wMm, y2Mm: (1 - y1) * hMm, layerHint: 'outline' },
  ];
  const multiViewSegs: RawNormalizedSegment[] = [
    ...makeBoxSegs(0.15, 0.55, 0.75, 0.78, 500, 200),
    ...makeBoxSegs(0.55, 0.12, 0.85, 0.38, 500, 200),
    ...makeBoxSegs(0.10, 0.12, 0.40, 0.38, 500, 200),
    ...makeBoxSegs(0.05, 0.03, 0.095, 0.06, 500, 200),
    ...makeBoxSegs(0.20, 0.03, 0.245, 0.06, 500, 200),
    ...makeBoxSegs(0.38, 0.03, 0.425, 0.06, 500, 200),
    ...makeBoxSegs(0.60, 0.03, 0.645, 0.06, 500, 200),
    ...makeBoxSegs(0.80, 0.03, 0.845, 0.06, 500, 200),
  ];
  const multiViews = detectViewRegions(multiViewSegs, [], 0.88, { width: 500, height: 200 });
  assert.equal(multiViews.length, 6, 'Expected top 6 views by area when 8 clusters exist');
  const largeViews = multiViews.filter((v) => v.normBounds.w >= 0.3);
  assert.equal(largeViews.length, 3, 'Expected all 3 large views preserved despite 5 smaller top clusters');
  assert.ok(largeViews[0].normBounds.x < largeViews[1].normBounds.x, 'Expected top band left-to-right reading order');
  assert.ok(largeViews[2].normBounds.y > largeViews[0].normBounds.y + 0.2, 'Expected bottom view sorted after top band');

  // Isotropic 8 mm check: two views separated horizontally by 11 mm on 500 mm wide sheet stay separate
  const isoSegs: RawNormalizedSegment[] = [
    ...makeBoxSegs(0.10, 0.15, 0.30, 0.35, 500, 200),
    ...makeBoxSegs(0.322, 0.15, 0.52, 0.35, 500, 200),
    ...makeBoxSegs(0.10, 0.52, 0.52, 0.72, 500, 200),
  ];
  const isoViews = detectViewRegions(isoSegs, [], 0.88, inferSheetSizeMm(isoSegs));
  assert.equal(isoViews.length, 3, `Expected 3 separate views with 11 mm X gap on 500 mm wide sheet, got ${isoViews.length}`);

  // 2g. L-shaped view enclosing a separate 15%-of-sheet-wide view inside its bbox must stay 2 views
  const mkSeg = (x1: number, y1: number, x2: number, y2: number, wMm: number, hMm: number): RawNormalizedSegment => ({
    nx1: x1,
    ny1: y1,
    nx2: x2,
    ny2: y2,
    x1Mm: x1 * wMm,
    y1Mm: (1 - y1) * hMm,
    x2Mm: x2 * wMm,
    y2Mm: (1 - y2) * hMm,
    layerHint: 'outline',
  });
  // L-shape outer bbox [0.10..0.70] x [0.10..0.70] (area 0.36); separate 15%x15% view at [0.42..0.57, 0.18..0.33] (area 0.0225 = 6.25% >= 3%)
  const lShapeSegs: RawNormalizedSegment[] = [
    mkSeg(0.10, 0.10, 0.22, 0.10, 420, 297),
    mkSeg(0.22, 0.10, 0.22, 0.55, 420, 297),
    mkSeg(0.22, 0.55, 0.70, 0.55, 420, 297),
    mkSeg(0.70, 0.55, 0.70, 0.70, 420, 297),
    mkSeg(0.70, 0.70, 0.10, 0.70, 420, 297),
    mkSeg(0.10, 0.70, 0.10, 0.10, 420, 297),
    ...makeBoxSegs(0.42, 0.18, 0.57, 0.33, 420, 297),
  ];
  const lShapeViews = detectViewRegions(lShapeSegs, [], 0.86, { width: 420, height: 297 });
  assert.equal(lShapeViews.length, 2, `Expected L-shaped view + nested 15%-wide view to stay 2 views, got ${lShapeViews.length}`);

  // 2h. Long diagonal line spanning across sheet + two distant small views must not merge views
  const diagTestSegs: RawNormalizedSegment[] = [
    mkSeg(0.08, 0.72, 0.88, 0.08, 420, 297), // Long diagonal line (1 seg, not crossing corners)
    ...makeBoxSegs(0.08, 0.08, 0.22, 0.22, 420, 297), // Distant top-left view
    ...makeBoxSegs(0.74, 0.58, 0.88, 0.72, 420, 297), // Distant bottom-right view
  ];
  const diagViews = detectViewRegions(diagTestSegs, [], 0.86, { width: 420, height: 297 });
  assert.equal(diagViews.length, 2, `Expected long diagonal not to bridge 2 distant views, got ${diagViews.length}`);

  // 2i. 4 dense blobs + 1000 scattered tiny (<0.5 mm) noise segments must still yield 4 views
  const blobCenters: Array<[number, number]> = [
    [0.72, 0.20], // top-right (intentionally unordered)
    [0.22, 0.24], // top-left (same row band as top-right)
    [0.70, 0.62], // bottom-right
    [0.24, 0.58], // bottom-left
  ];
  const fourBlobSegs: RawNormalizedSegment[] = [];
  for (const [bx, by] of blobCenters) {
    fourBlobSegs.push(...makeBoxSegs(bx - 0.08, by - 0.08, bx + 0.08, by + 0.08, 420, 297));
    // Add dense interior lines >= 1 mm
    for (let k = 0; k < 20; k++) {
      const lx = bx - 0.06 + (k % 5) * 0.025;
      const ly = by - 0.05 + Math.floor(k / 5) * 0.025;
      fourBlobSegs.push(mkSeg(lx, ly, lx + 0.018, ly + 0.005, 420, 297));
    }
  }
  // 1000 tiny 0.25 mm segments scattered across entire sheet including gaps between blobs
  for (let i = 0; i < 1000; i++) {
    const sx = 0.06 + nextRand() * 0.84;
    const sy = 0.06 + nextRand() * 0.70;
    const dxNorm = 0.25 / 420; // 0.25 mm < MIN_CLUSTER_BRIDGE_MM (0.5 mm)
    fourBlobSegs.push(mkSeg(sx, sy, sx + dxNorm, sy, 420, 297));
  }
  const blobViews = detectViewRegions(fourBlobSegs, [], 0.86, { width: 420, height: 297 });
  assert.equal(blobViews.length, 4, `Expected 4 blobs + 1000 tiny noise segs to yield 4 views, got ${blobViews.length}`);
  assert.ok(blobViews[0].normBounds.x < blobViews[1].normBounds.x, 'Expected row-banded left-to-right order in top band');
  assert.ok(blobViews[2].normBounds.x < blobViews[3].normBounds.x, 'Expected row-banded left-to-right order in bottom band');

  // 2j. Step 5 stack-safe spreads, length-weighted primaryOutlineWidth mode, crosshair centerline, fill-only & parallel-offset black dimensions
  const step5Ops = {
    fnArray: [
      OPS.setStrokeRGBColor,
      OPS.setLineWidth,
      OPS.constructPath, // 4-seg main rectangle part [150,200..450,350] at 0.6 pt (long total length)
      OPS.setLineWidth,
      OPS.constructPath, // Single outlier thick 2.5 pt black cutting-plane mark (short 20pt) -> must NOT dominate primaryOutlineWidth
      OPS.setLineWidth,
      OPS.constructPath, // Short thin 0.5 pt 45-deg tilted chamfer (15pt) -> must stay 'outline' (not centerline)
      OPS.constructPath, // Horizontal crosshair seg (20pt, 0.5pt) at (300, 275)
      OPS.constructPath, // Vertical crosshair seg (20pt, 0.5pt) at (300, 275) -> forms '+' crosshair -> 'centerline'
      OPS.setLineWidth,
      OPS.constructPath, // Pure-black 0.4 pt dim line above top edge [150, 390 -> 450, 390]
      OPS.constructPath, // Fill-only black left arrowhead (tip at 150,390) -> must emit 0 segs yet promote dim line!
      OPS.constructPath, // Fill-only black right arrowhead (tip at 450,390) -> must emit 0 segs yet promote dim line!
      OPS.constructPath, // Pure-black 0.4 pt left witness [150, 353 -> 150, 396]
      OPS.constructPath, // Pure-black 0.4 pt right witness [450, 353 -> 450, 396]
      OPS.constructPath, // Pure-black arrowheadless thin dim line below bottom edge [150, 165 -> 450, 165] (parallel offset ~12.3 mm)
    ],
    argsArray: [
      ['#000000'],
      [0.6],
      [OPS.stroke, [new Float32Array([0, 150, 200, 1, 450, 200, 1, 450, 350, 1, 150, 350, 4])]],
      [2.5],
      [OPS.stroke, [new Float32Array([0, 110, 220, 1, 130, 220])]],
      [0.5],
      [OPS.stroke, [new Float32Array([0, 160, 210, 1, 175, 225])]],
      [OPS.stroke, [new Float32Array([0, 290, 275, 1, 310, 275])]],
      [OPS.stroke, [new Float32Array([0, 300, 265, 1, 300, 285])]],
      [0.4],
      [OPS.stroke, [new Float32Array([0, 150, 390, 1, 450, 390])]],
      [OPS.fill, [new Float32Array([0, 150, 390, 1, 160, 392, 1, 160, 388, 4])]],
      [OPS.fill, [new Float32Array([0, 450, 390, 1, 440, 392, 1, 440, 388, 4])]],
      [OPS.stroke, [new Float32Array([0, 150, 353, 1, 150, 396])]],
      [OPS.stroke, [new Float32Array([0, 450, 353, 1, 450, 396])]],
      [OPS.stroke, [new Float32Array([0, 150, 165, 1, 450, 165])]],
    ],
  };
  const step5Segs = parseOperatorListToSegments(step5Ops, OPS, mockViewport);
  assert.equal(step5Segs.length, 12, `Expected 12 stroked segs (2 fill-only arrows excluded from output), got ${step5Segs.length}`);
  const step5Geom = buildPayloadGeometry(
    step5Segs,
    [
      { text: '300', nx: 300 / pageW, ny: (pageH - 394) / pageH },
      { text: '300', nx: 300 / pageW, ny: (pageH - 161) / pageH },
    ],
    1,
    pageW,
    pageH,
    () => ''
  );
  const s5Outlines = step5Geom.centeredEntities.filter((e) => e.layer === 'outline');
  const s5Centerlines = step5Geom.centeredEntities.filter((e) => e.layer === 'centerline');
  const s5Dims = step5Geom.centeredEntities.filter((e) => e.layer === 'dimension');
  assert.equal(s5Outlines.length, 6, `Expected 4 rect + 1 thick mark + 1 tilted chamfer = 6 outline segs, got ${s5Outlines.length}`);
  assert.equal(s5Centerlines.length, 2, `Expected 2 axis-aligned crosshair segs on centerline, got ${s5Centerlines.length}`);
  assert.equal(s5Dims.length, 4, `Expected 4 black dim+witness segs promoted, got ${s5Dims.length}`);

  // 2k. Step 6 page rotations (/Rotate 0/90/180/270), non-zero MediaBox, ±/+/-/x callout splitting & structural title block
  const buildTestPdf = (opts: {
    mediaBox: [number, number, number, number];
    rotate: 0 | 90 | 180 | 270;
    stream: string;
  }): Uint8Array => {
    const [mx0, my0, mx1, my1] = opts.mediaBox;
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [${mx0} ${my0} ${mx1} ${my1}] /Rotate ${opts.rotate} /Contents 4 0 R >>\nendobj\n`,
      `4 0 obj\n<< /Length ${Buffer.byteLength(opts.stream, 'ascii')} >>\nstream\n${opts.stream}\nendstream\nendobj\n`,
    ];
    let pdfText = '%PDF-1.4\n';
    const offsets: number[] = [0];
    for (const obj of objects) {
      offsets.push(Buffer.byteLength(pdfText, 'ascii'));
      pdfText += obj;
    }
    const xrefPos = Buffer.byteLength(pdfText, 'ascii');
    pdfText += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) {
      pdfText += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdfText += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    return Uint8Array.from(Buffer.from(pdfText, 'ascii'));
  };

  // Non-zero MediaBox [100, 50, 712, 550] (612 x 500 pt) with an asymmetric 300 x 120 pt box at local (80, 100) -> (380, 220)
  const testMediaBox: [number, number, number, number] = [100, 50, 712, 550];
  const rectStream = 'q 1.2 w 0 0 0 RG 180 150 300 120 re S Q\n';
  for (const rot of [0, 90, 180, 270] as const) {
    const loadingTask = pdfjsLib.getDocument({
      data: buildTestPdf({ mediaBox: testMediaBox, rotate: rot, stream: rectStream }),
      verbosity: 0,
    });
    const pdfDoc = await loadingTask.promise;
    try {
      const page = await pdfDoc.getPage(1);
      const baseVp = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 1.5 });
      const rotOps = await page.getOperatorList();
      const rotSegs = parseOperatorListToSegments(rotOps, pdfjsLib.OPS, vp);
      assert.equal(rotSegs.length, 4, `Rotate ${rot}: expected 4 rect segments, got ${rotSegs.length}`);

      const pageWmm = baseVp.width * PT_TO_MM;
      const pageHmm = baseVp.height * PT_TO_MM;
      for (const s of rotSegs) {
        // Every endpoint must satisfy xMm/pageWmm == nx and yMm/pageHmm == 1 - ny in the rotated/MediaBox frame
        assert.ok(
          Math.abs(s.x1Mm / pageWmm - s.nx1) < 0.002 &&
            Math.abs(s.y1Mm / pageHmm - (1 - s.ny1)) < 0.002,
          `Rotate ${rot}: normalized and mm frames disagree (${s.x1Mm}/${pageWmm} vs ${s.nx1})`
        );
      }

      const rotGeom = buildPayloadGeometry(rotSegs, [], 1, baseVp.width, baseVp.height, () => '');
      const spanX = rotGeom.vectorBoundingBox.maxX - rotGeom.vectorBoundingBox.minX;
      const spanY = rotGeom.vectorBoundingBox.maxY - rotGeom.vectorBoundingBox.minY;
      const expectedW = (rot === 90 || rot === 270 ? 120 : 300) * PT_TO_MM;
      const expectedH = (rot === 90 || rot === 270 ? 300 : 120) * PT_TO_MM;
      assert.ok(
        Math.abs(spanX - expectedW) < 0.2 && Math.abs(spanY - expectedH) < 0.2,
        `Rotate ${rot}: expected visual bbox ${expectedW.toFixed(1)}x${expectedH.toFixed(1)} mm, got ${spanX.toFixed(1)}x${spanY.toFixed(1)} mm`
      );
    } finally {
      await loadingTask.destroy();
    }
  }

  // Callout splitting (±, +/-, x, X) & tolerance-only token exclusion in scale calibration
  const splitVals = extractNumericDimCallouts(['25±0.1', '40+/-0.2', '4x120', '100 X 50', '1:20']);
  assert.deepEqual(splitVals, [120, 100, 50, 40, 25, 4, 0.2, 0.1]);
  const nominalOnly = extractNumericDimCallouts(['25±0.1', '±200', '+/-150', '40+/-0.2'], {
    excludeTolerances: true,
  });
  assert.deepEqual(nominalOnly, [40, 25]);

  const tolScaleResult = calibrateScaleFromViewChunks(
    [
      {
        id: 'view-1',
        label: 'Front',
        viewKind: 'orthogonal',
        pageNumber: 1,
        normBounds: { x: 0.1, y: 0.1, w: 0.3, h: 0.2 },
        croppedImageDataUrl: '',
        extractedText: ['200±0.1', '±999'],
        vectorEntities: [],
        boundingBox: { minX: -5, minY: -2.5, maxX: 5, maxY: 2.5 },
        sheetOffset: { dx: 0, dy: 0 },
      },
      {
        id: 'view-2',
        label: 'Side',
        viewKind: 'orthogonal',
        pageNumber: 1,
        normBounds: { x: 0.5, y: 0.1, w: 0.3, h: 0.2 },
        croppedImageDataUrl: '',
        extractedText: ['200+/-0.2', '+/-888'],
        vectorEntities: [],
        boundingBox: { minX: -5, minY: -2.5, maxX: 5, maxY: 2.5 },
        sheetOffset: { dx: 0, dy: 0 },
      },
    ],
    { units: 'mm' }
  );
  assert.equal(tolScaleResult.scaleFactor, 20, 'Expected tolerances ignored and nominals calibrating 1:20');

  // Structural title-block label exclusion with an arbitrary company name (no hardcoded company filter)
  const metaArbitrary = parseTitleBlockMetadata(
    [
      { text: 'Apex Precision Industries', nx: 0.57, ny: 0.82 },
      { text: 'TITLE:', nx: 0.565, ny: 0.848 },
      { text: 'FINISH:', nx: 0.59, ny: 0.848 },
      { text: 'Drive Flange', nx: 0.58, ny: 0.872 },
      { text: 'DWG NO.', nx: 0.565, ny: 0.918 },
      { text: 'DF-402', nx: 0.65, ny: 0.92 },
      { text: 'REV', nx: 0.80, ny: 0.795 },
      { text: 'C', nx: 0.86, ny: 0.795 },
      { text: 'MATERIAL:', nx: 0.372, ny: 0.918 },
      { text: '6061-T6', nx: 0.43, ny: 0.92 },
      { text: 'WEIGHT:', nx: 0.372, ny: 0.962 },
      { text: '12.5 Kg', nx: 0.43, ny: 0.963 },
    ],
    []
  );
  assert.equal(metaArbitrary.partName, 'Drive Flange');
  assert.equal(metaArbitrary.partNumber, 'DF-402');
  assert.equal(metaArbitrary.revision, 'C');
  assert.equal(metaArbitrary.material, '6061-T6');
  assert.equal(metaArbitrary.weight, '12.5 Kg');

  // 2l. Step 7 primitive recovery: 4-Bezier circle, CCW/CW arcs, collinear polyline, straight lines, ellipse rejection & scaling
  const kKappa = 0.5522847498;
  const cxPt = 300;
  const cyPt = 260;
  const rPt = 50;
  const kr = kKappa * rPt;
  const bezCircleOps = {
    fnArray: [OPS.setStrokeRGBColor, OPS.setLineWidth, OPS.constructPath],
    argsArray: [
      ['#000000'],
      [1.0],
      [
        OPS.stroke,
        [
          new Float32Array([
            0, cxPt + rPt, cyPt,
            2, cxPt + rPt, cyPt + kr, cxPt + kr, cyPt + rPt, cxPt, cyPt + rPt,
            2, cxPt - kr, cyPt + rPt, cxPt - rPt, cyPt + kr, cxPt - rPt, cyPt,
            2, cxPt - rPt, cyPt - kr, cxPt - kr, cyPt - rPt, cxPt, cyPt - rPt,
            2, cxPt + kr, cyPt - rPt, cxPt + rPt, cyPt - kr, cxPt + rPt, cyPt,
            4,
          ]),
        ],
      ],
    ],
  };
  const bezSegs = parseOperatorListToSegments(bezCircleOps, OPS, mockViewport).map((s) => ({
    nx1: s.nx1,
    ny1: s.ny1,
    nx2: s.nx2,
    ny2: s.ny2,
    x1Mm: s.x1Mm,
    y1Mm: s.y1Mm,
    x2Mm: s.x2Mm,
    y2Mm: s.y2Mm,
    layerHint: 'outline' as const,
    strokeStyleKey: '1.00:0.00:0',
    subpathId: s.subpathId,
  }));
  const bezPrims = recoverPrimitivesFromSegments(bezSegs);
  assert.equal(bezPrims.length, 1, `Expected 4-Bezier circle -> 1 CadCircleEntity, got ${bezPrims.length}`);
  assert.equal(bezPrims[0].type, 'circle');
  assert.equal(bezPrims[0].source, 'recovered');
  const bezCircle = bezPrims[0] as CadCircleEntity;
  assert.ok(
    Math.abs(bezCircle.r - rPt * PT_TO_MM) < 0.05 &&
      Math.abs(bezCircle.cx - cxPt * PT_TO_MM) < 0.05 &&
      Math.abs(bezCircle.cy - cyPt * PT_TO_MM) < 0.05,
    `Expected Bezier circle r=${(rPt * PT_TO_MM).toFixed(2)}, got r=${bezCircle.r}`
  );

  // Arc recovery (CCW 30->150 deg and CW 240->120 deg -> CCW 120->240 deg), collinear run -> polyline, standalone -> line
  const arcChain = (startDeg: number, endDeg: number, steps: number, sid: number): RawNormalizedSegment[] => {
    const out: RawNormalizedSegment[] = [];
    const rr = 25;
    for (let k = 0; k < steps; k++) {
      const a0 = ((startDeg + ((endDeg - startDeg) * k) / steps) * Math.PI) / 180;
      const a1 = ((startDeg + ((endDeg - startDeg) * (k + 1)) / steps) * Math.PI) / 180;
      const x1Mm = 60 + rr * Math.cos(a0);
      const y1Mm = 60 + rr * Math.sin(a0);
      const x2Mm = 60 + rr * Math.cos(a1);
      const y2Mm = 60 + rr * Math.sin(a1);
      out.push({
        nx1: x1Mm / 297,
        ny1: 1 - y1Mm / 210,
        nx2: x2Mm / 297,
        ny2: 1 - y2Mm / 210,
        x1Mm,
        y1Mm,
        x2Mm,
        y2Mm,
        layerHint: 'outline',
        strokeStyleKey: '1.00:0.00:0',
        subpathId: sid,
      });
    }
    return out;
  };
  const cwArcSegs = arcChain(240, 120, 6, 101);
  const collinearRun: RawNormalizedSegment[] = [
    { nx1: 0.1, ny1: 0.5, nx2: 0.2, ny2: 0.5, x1Mm: 10, y1Mm: 10, x2Mm: 20, y2Mm: 10, layerHint: 'outline', strokeStyleKey: '1.00:0.00:0', subpathId: 102 },
    { nx1: 0.2, ny1: 0.5, nx2: 0.3, ny2: 0.5, x1Mm: 20, y1Mm: 10, x2Mm: 30, y2Mm: 10, layerHint: 'outline', strokeStyleKey: '1.00:0.00:0', subpathId: 102 },
    { nx1: 0.3, ny1: 0.5, nx2: 0.4, ny2: 0.5, x1Mm: 30, y1Mm: 10, x2Mm: 40, y2Mm: 10, layerHint: 'outline', strokeStyleKey: '1.00:0.00:0', subpathId: 102 },
  ];
  const singleLine: RawNormalizedSegment = {
    nx1: 0.5, ny1: 0.2, nx2: 0.7, ny2: 0.2, x1Mm: 50, y1Mm: 20, x2Mm: 70, y2Mm: 20, layerHint: 'outline', strokeStyleKey: '1.00:0.00:0', subpathId: 103,
  };
  const ellipseSegs: RawNormalizedSegment[] = [];
  for (let k = 0; k < 24; k++) {
    const a0 = (k / 24) * Math.PI * 2;
    const a1 = ((k + 1) / 24) * Math.PI * 2;
    const x1Mm = 120 + 30 * Math.cos(a0);
    const y1Mm = 80 + 15 * Math.sin(a0);
    const x2Mm = 120 + 30 * Math.cos(a1);
    const y2Mm = 80 + 15 * Math.sin(a1);
    ellipseSegs.push({
      nx1: x1Mm / 297,
      ny1: 1 - y1Mm / 210,
      nx2: x2Mm / 297,
      ny2: 1 - y2Mm / 210,
      x1Mm,
      y1Mm,
      x2Mm,
      y2Mm,
      layerHint: 'outline',
      strokeStyleKey: '1.00:0.00:0',
      subpathId: 104,
    });
  }
  const mixedPrims = recoverPrimitivesFromSegments([
    ...cwArcSegs,
    ...collinearRun,
    singleLine,
  ]);
  const ellipsePrims = recoverPrimitivesFromSegments(ellipseSegs);
  assert.equal(
    ellipsePrims.filter((e) => e.type === 'circle').length,
    0,
    'Expected 2:1 ellipse rejected from circle recovery'
  );
  const recArcs = mixedPrims.filter((e): e is CadArcEntity => e.type === 'arc');
  const recPolys = mixedPrims.filter((e): e is CadPolylineEntity => e.type === 'polyline');
  const recLines = mixedPrims.filter((e): e is CadLineEntity => e.type === 'line');
  const recCircles = mixedPrims.filter((e): e is CadCircleEntity => e.type === 'circle');
  assert.equal(recCircles.length, 0);
  assert.equal(recArcs.length, 1, `Expected CW chord arc recovered as 1 CCW CadArcEntity, got ${recArcs.length}`);
  assert.equal(recArcs[0].source, 'recovered');
  assert.ok(
    Math.abs(recArcs[0].r - 25) < 0.05 &&
      Math.abs(recArcs[0].startAngle - 120) < 0.5 &&
      Math.abs(recArcs[0].endAngle - 240) < 0.5,
    `Expected CCW arc angles 120..240 r=25, got ${recArcs[0].startAngle}..${recArcs[0].endAngle} r=${recArcs[0].r}`
  );
  assert.equal(recPolys.length, 1, 'Expected collinear chain merged into 1 CadPolylineEntity');
  assert.equal(recPolys[0].source, 'recovered');
  assert.deepEqual(recPolys[0].points, [{ x: 10, y: 10 }, { x: 40, y: 10 }]);
  assert.equal(recLines.length, 1);
  assert.ok(recLines[0].x1 === 50 && recLines[0].x2 === 70 && recLines[0].source === 'vector', 'Expected standalone line kept with source=vector');

  // Verify buildRawVectorAnalysis scales recovered primitives cleanly and DXF exports CIRCLE/ARC
  const synthScaledAnalysis = buildRawVectorAnalysis(
    {
      fileName: 'synth-prim.pdf',
      pageCount: 1,
      selectedPage: 1,
      pageWidthPt: 297 / PT_TO_MM,
      pageHeightPt: 210 / PT_TO_MM,
      renderedImageDataUrl: '',
      extractedText: ['SCALE 1:5'],
      vectorEntityCount: mixedPrims.length,
      vectorEntities: [bezCircle, recArcs[0]],
      vectorBoundingBox: { minX: -50, minY: -50, maxX: 120, maxY: 120 },
      hasMultipleViews: false,
      viewChunks: [],
      rawNormalizedSegments: [],
      rawNormalizedTextItems: [],
      detectedScaleLabel: '1:5',
      detectedScaleFactor: 5,
      truncated: false,
      droppedSegmentCount: 0,
    },
    { scaleMode: 'real' }
  );
  const scaledCircle = synthScaledAnalysis.entities.find((e): e is CadCircleEntity => e.type === 'circle');
  const scaledArc = synthScaledAnalysis.entities.find((e): e is CadArcEntity => e.type === 'arc');
  assert.ok(scaledCircle && Math.abs(scaledCircle.r - bezCircle.r * 5) < 0.1 && scaledCircle.source === 'recovered');
  assert.ok(scaledArc && Math.abs(scaledArc.r - 125) < 0.2 && scaledArc.source === 'recovered');
  const synthDxf = exportToDxf(synthScaledAnalysis);
  assert.ok(synthDxf.includes('\nCIRCLE\n') && synthDxf.includes('\nARC\n'));

  // 2m. Step 8 regression suite: 4 generated mechanical sample PDFs vs preset vector count, view count & bounding boxes
  const generatedPresets = SAMPLE_DRAWINGS.filter((p) => !p.assetUrl);
  assert.equal(generatedPresets.length, 4, `Expected 4 generated sample presets, got ${generatedPresets.length}`);
  const sampleSummaries: string[] = [];
  for (const preset of generatedPresets) {
    const sampleBuf = generateSampleMechanicalPdfBytes(preset);
    const samplePayload = await extractPayloadFromPdfBytes(new Uint8Array(sampleBuf), preset.fileName, 1);
    const expectedViews = preset.analysis.viewChunks?.length ?? 1;
    assert.equal(samplePayload.truncated, false, `${preset.id}: unexpected truncation`);
    assert.equal(
      samplePayload.vectorEntityCount,
      samplePayload.vectorEntities.length,
      `${preset.id}: vectorEntityCount mismatch`
    );
    assert.ok(
      samplePayload.vectorEntityCount >= preset.analysis.entities.length,
      `${preset.id}: expected >=${preset.analysis.entities.length} vectors, got ${samplePayload.vectorEntityCount}`
    );
    assert.equal(
      samplePayload.viewChunks.length,
      expectedViews,
      `${preset.id}: expected ${expectedViews} views, got ${samplePayload.viewChunks.length}`
    );

    const sampleAnalysis = buildRawVectorAnalysis(samplePayload, 'real');
    const aSpanX = sampleAnalysis.boundingBox.maxX - sampleAnalysis.boundingBox.minX;
    const aSpanY = sampleAnalysis.boundingBox.maxY - sampleAnalysis.boundingBox.minY;
    const presetBB = preset.analysis.boundingBox;
    const pSpanX = presetBB.maxX - presetBB.minX;
    const pSpanY = presetBB.maxY - presetBB.minY;

    if (expectedViews === 1) {
      // Single-view generator fits preset boundingBox using scale = min(360 / spanX, 260 / spanY) pt/unit
      const genScalePt = Math.min(360 / Math.max(40, pSpanX), 260 / Math.max(40, pSpanY));
      const expectedPaperX = pSpanX * genScalePt * PT_TO_MM;
      const expectedPaperY = pSpanY * genScalePt * PT_TO_MM;
      assert.ok(
        Math.abs(aSpanX - expectedPaperX) <= 1.0,
        `${preset.id}: expected spanX ~${expectedPaperX.toFixed(1)} mm, got ${aSpanX.toFixed(1)} mm`
      );
      assert.ok(
        aSpanY >= expectedPaperY * 0.72 && aSpanY <= expectedPaperY * 1.05,
        `${preset.id}: expected spanY in [${(expectedPaperY * 0.72).toFixed(1)}, ${(expectedPaperY * 1.05).toFixed(1)}] mm, got ${aSpanY.toFixed(1)} mm`
      );
    } else {
      const pRatio = pSpanX / pSpanY;
      const aRatio = aSpanX / aSpanY;
      assert.ok(
        Math.abs(aRatio - pRatio) <= 0.15 && aSpanX > 150 && aSpanY > 100,
        `${preset.id}: expected multi-view aspect ~${pRatio.toFixed(2)}, got ${aRatio.toFixed(2)} (${aSpanX.toFixed(1)}x${aSpanY.toFixed(1)} mm)`
      );
    }
    sampleSummaries.push(
      `${preset.id}:${samplePayload.vectorEntityCount}v/${samplePayload.viewChunks.length}vw`
    );
  }

  // 3. Entity & NaN sanitization guards
  const sanitized = sanitizeAnalysisResult({
    partName: 'Guard Test',
    entities: [
      { id: 'bad-line', layer: 'outline', type: 'line', x1: Number.NaN, y1: 0, x2: 10, y2: 10 },
      { id: 'bad-circle', layer: 'hole', type: 'circle', cx: 0, cy: 0, r: 0 },
      { id: 'good-circle', layer: 'hole', type: 'circle', cx: 10, cy: -5, r: 6, source: 'recovered' },
    ],
  });
  assert.equal(sanitized.entities.length, 1);
  assert.equal(sanitized.entities[0].id, 'good-circle');
  assert.equal(sanitized.entities[0].source, 'recovered');
  assert.ok(Number.isFinite(sanitized.boundingBox.minX) && Number.isFinite(sanitized.boundingBox.maxX));

  console.log(
    `Self-check passed: Shell_b55006b8.pdf (${payload.vectorEntityCount} vectors, ${payload.viewChunks.length} views, circles ${crossDias.map((d) => d.toFixed(1)).join('/')} mm, real ${realSpanX.toFixed(1)}x${realSpanY.toFixed(1)} mm), Step 1-8 (50k grid cluster ${clusterMs.toFixed(1)} ms, rot 0/90/180/270 & MediaBox, Bezier/arc/polyline recovery, 4 sample PDFs [${sampleSummaries.join(', ')}]), CAM & sanitize guards OK.`
  );
}

main().catch((err) => {
  console.error('Self-check failed:', err);
  process.exit(1);
});
