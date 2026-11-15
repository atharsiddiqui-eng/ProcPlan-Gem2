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
    rawNormalizedSegments: geom.rawNormalizedSegments.slice(0, 6000),
    rawNormalizedTextItems: rawNormalizedTextItems.slice(0, 600),
    detectedScaleLabel: geom.detectedScaleLabel,
    detectedScaleFactor: geom.detectedScaleFactor,
    titleBlockMeta: geom.titleBlockMeta,
  };
}

async function main() {
  // 1. Shell_b55006b8.pdf SolidWorks vector parsing, view detection & 1:20 calibration
  const payload = await loadShellPdfPayload();
  assert.ok(payload.vectorEntityCount >= 100, `Expected >=100 vectors, got ${payload.vectorEntityCount}`);
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
  assert.ok(exportToDxf(realAnalysis).includes('ENTITIES'));
  assert.ok(exportToSvg(realAnalysis).includes('<svg'));
  assert.ok(exportToGcode(realAnalysis).includes('M30'));
  assert.ok(exportToProcessCsv(realAnalysis, 25).includes('OP-10'));

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
    `Self-check passed: Shell_b55006b8.pdf (${payload.vectorEntityCount} vectors, ${payload.viewChunks.length} views, real ${realSpanX.toFixed(1)}x${realSpanY.toFixed(1)} mm), CAM & sanitize guards OK.`
  );
}

main().catch((err) => {
  console.error('Self-check failed:', err);
  process.exit(1);
});
