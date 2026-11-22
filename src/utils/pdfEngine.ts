import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {
  NormalizedRect,
  PdfExtractionPayload,
  PdfViewBox,
  RawNormalizedText,
} from '../types/cad';
import {
  buildPayloadGeometry,
  buildRawVectorAnalysis,
  buildViewChunksFromSpecs,
  parseOperatorListToSegments,
  type VectorAnalysisOptions,
} from './pdfVectorCore';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export { buildRawVectorAnalysis, type VectorAnalysisOptions };

function cropDataUrlFromCanvas(
  sourceCanvas: HTMLCanvasElement,
  norm: NormalizedRect
): string {
  const sx = Math.max(0, Math.round(norm.x * sourceCanvas.width));
  const sy = Math.max(0, Math.round(norm.y * sourceCanvas.height));
  const sw = Math.max(16, Math.min(sourceCanvas.width - sx, Math.round(norm.w * sourceCanvas.width)));
  const sh = Math.max(16, Math.min(sourceCanvas.height - sy, Math.round(norm.h * sourceCanvas.height)));

  const sub = document.createElement('canvas');
  sub.width = sw;
  sub.height = sh;
  const subCtx = sub.getContext('2d');
  if (!subCtx) return sourceCanvas.toDataURL('image/png');
  subCtx.fillStyle = '#ffffff';
  subCtx.fillRect(0, 0, sw, sh);
  subCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return sub.toDataURL('image/png');
}

const MAX_CACHED_PDF_DOCS = 2;

interface CachedPdfDocEntry {
  loadingTask: pdfjsLib.PDFDocumentLoadingTask;
  docPromise: Promise<pdfjsLib.PDFDocumentProxy>;
}

const pdfDocCache = new Map<ArrayBuffer, CachedPdfDocEntry>();

function getCachedPdfDocument(pdfBytes: ArrayBuffer): Promise<pdfjsLib.PDFDocumentProxy> {
  const existing = pdfDocCache.get(pdfBytes);
  if (existing) {
    // Refresh MRU order
    pdfDocCache.delete(pdfBytes);
    pdfDocCache.set(pdfBytes, existing);
    return existing.docPromise;
  }

  while (pdfDocCache.size >= MAX_CACHED_PDF_DOCS) {
    const oldestKey = pdfDocCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = pdfDocCache.get(oldestKey);
    pdfDocCache.delete(oldestKey);
    if (oldest) {
      void oldest.loadingTask.destroy().catch(() => {});
    }
  }

  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice(0) });
  const docPromise = loadingTask.promise.catch((err) => {
    const cur = pdfDocCache.get(pdfBytes);
    if (cur?.loadingTask === loadingTask) {
      pdfDocCache.delete(pdfBytes);
    }
    void loadingTask.destroy().catch(() => {});
    throw err;
  });

  pdfDocCache.set(pdfBytes, { loadingTask, docPromise });
  return docPromise;
}

export async function clearPdfDocumentCache(pdfBytes?: ArrayBuffer): Promise<void> {
  if (pdfBytes) {
    const entry = pdfDocCache.get(pdfBytes);
    if (!entry) return;
    pdfDocCache.delete(pdfBytes);
    await entry.loadingTask.destroy().catch(() => {});
    return;
  }
  const entries = Array.from(pdfDocCache.values());
  pdfDocCache.clear();
  await Promise.all(entries.map((e) => e.loadingTask.destroy().catch(() => {})));
}

export async function extractPdfPage(
  pdfBytes: ArrayBuffer,
  fileName: string,
  pageNumber = 1
): Promise<PdfExtractionPayload> {
  const pdf = await getCachedPdfDocument(pdfBytes);
  const clampedPage = Math.max(1, Math.min(pageNumber, pdf.numPages));
  const page = await pdf.getPage(clampedPage);

  try {
    const baseViewport = page.getViewport({ scale: 1 });
    const maxDim = Math.max(baseViewport.width, baseViewport.height);
    const renderScale = Math.min(2.6, Math.max(1.2, 1600 / maxDim));
    const viewport = page.getViewport({ scale: renderScale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize 2D canvas context for PDF rendering.');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext: ctx,
      viewport,
      canvas,
    }).promise;

    const renderedImageDataUrl = canvas.toDataURL('image/png');

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
      clampedPage,
      baseViewport.width,
      baseViewport.height,
      (bounds) => cropDataUrlFromCanvas(canvas, bounds)
    );

    return {
      fileName,
      pageCount: pdf.numPages,
      selectedPage: clampedPage,
      pageWidthPt: baseViewport.width,
      pageHeightPt: baseViewport.height,
      renderedImageDataUrl,
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
}

export async function repartitionPdfChunks(
  payload: PdfExtractionPayload,
  editedBoxes: PdfViewBox[]
): Promise<PdfExtractionPayload> {
  const img = new Image();
  img.src = payload.renderedImageDataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load rendered PDF image for chunk re-cropping.'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || 1200;
  canvas.height = img.naturalHeight || 850;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.drawImage(img, 0, 0);
  }

  const nextChunks = buildViewChunksFromSpecs(
    editedBoxes,
    payload.selectedPage,
    payload.pageWidthPt,
    payload.pageHeightPt,
    payload.rawNormalizedSegments,
    payload.rawNormalizedTextItems,
    (bounds) => cropDataUrlFromCanvas(canvas, bounds)
  );

  return {
    ...payload,
    hasMultipleViews: nextChunks.length > 1,
    viewChunks: nextChunks,
  };
}
