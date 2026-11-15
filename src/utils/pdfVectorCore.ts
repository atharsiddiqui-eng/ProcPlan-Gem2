import type {
  CadEntity,
  CadLayer,
  DrawingAnalysisResult,
  MachineCategory,
  NormalizedRect,
  PdfExtractionPayload,
  PdfTitleBlockMeta,
  PdfViewChunk,
  PipelineModulesConfig,
  ProcessOperation,
  RawNormalizedSegment,
  RawNormalizedText,
  ViewChunkKind,
} from '../types/cad';
import { getDefaultOperationTemplate } from './camEngine';

export const PT_TO_MM = 25.4 / 72;

type Matrix = [number, number, number, number, number, number];

interface PdfGState {
  cm: Matrix;
  lineWidth: number;
  strokeLuminance: number;
  dashPattern: number[];
}

interface InternalSegment {
  nx1: number;
  ny1: number;
  nx2: number;
  ny2: number;
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
  lenMm: number;
  effLineWidth: number;
  strokeLuminance: number;
  isDashed: boolean;
  dashCount: number;
  pathSegCount: number;
}

export interface PdfOpsTable {
  save: number;
  restore: number;
  transform: number;
  setLineWidth: number;
  setStrokeRGBColor: number;
  setStrokeGray: number;
  setDash: number;
  constructPath: number;
  moveTo: number;
  lineTo: number;
  curveTo: number;
  curveTo2: number;
  curveTo3: number;
  closePath: number;
  rectangle: number;
}

export interface PdfViewportLike {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
}

export interface VectorAnalysisOptions {
  scaleMode?: 'real' | 'paper';
  customScaleRatio?: number;
  unitsOverride?: 'auto' | 'mm' | 'in';
  preferredMaterial?: string;
  preferredMachines?: MachineCategory[];
  modules?: PipelineModulesConfig;
}

function multiplyMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): { x: number; y: number } {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

function parseStrokeLuminance(args: unknown[]): number | null {
  if (args.length === 1 && typeof args[0] === 'string') {
    const hex = args[0].trim();
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
  }
  if (
    args.length >= 3 &&
    typeof args[0] === 'number' &&
    typeof args[1] === 'number' &&
    typeof args[2] === 'number'
  ) {
    const div = Math.max(args[0], args[1], args[2]) > 1 ? 255 : 1;
    return (0.2126 * args[0] + 0.7152 * args[1] + 0.0722 * args[2]) / div;
  }
  return null;
}

// shortcut: assumes landscape/standard bottom title block (>=70% down sheet); upgrade if top/side title blocks are needed
export function detectTitleBlockTopNy(
  segments: Array<{ nx1: number; ny1: number; nx2: number; ny2: number }>,
  textItems: RawNormalizedText[]
): number {
  const titleKeywords = [
    'DRAWN',
    "CHK'D",
    "APPV'D",
    'MATERIAL',
    'DWG NO',
    'SCALE:',
    'SCALE ',
    'SHEET 1',
    'DO NOT SCALE',
    'UNLESS OTHERWISE',
    'DIMENSIONS ARE IN',
  ];

  const anchorYs = textItems
    .filter((t) => {
      const u = t.text.toUpperCase();
      return t.ny > 0.7 && titleKeywords.some((kw) => u.includes(kw));
    })
    .map((t) => t.ny);

  if (anchorYs.length === 0) return 0.86;

  const minAnchorY = Math.min(...anchorYs);
  const wideHorizLines = segments
    .filter((s) => {
      const spanX = Math.abs(s.nx2 - s.nx1);
      const spanY = Math.abs(s.ny2 - s.ny1);
      const midY = (s.ny1 + s.ny2) / 2;
      return spanX > 0.48 && spanY < 0.01 && midY >= 0.7 && midY <= minAnchorY + 0.015;
    })
    .map((s) => Math.min(s.ny1, s.ny2));

  if (wideHorizLines.length > 0) {
    return Math.max(0.7, Math.min(...wideHorizLines) - 0.004);
  }
  return Math.max(0.72, Math.min(0.84, minAnchorY - 0.018));
}

// shortcut: tuned for SolidWorks/ISO A-series sheet margins & gray zone ticks; upgrade if dark parts extend into outer 5% border
function isSheetChromeSegment(seg: InternalSegment, titleBlockTopNy: number): boolean {
  const minNx = Math.min(seg.nx1, seg.nx2);
  const maxNx = Math.max(seg.nx1, seg.nx2);
  const minNy = Math.min(seg.ny1, seg.ny2);
  const maxNy = Math.max(seg.ny1, seg.ny2);
  const spanX = maxNx - minNx;
  const spanY = maxNy - minNy;

  if (spanX > 0.68 || spanY > 0.68) return true;
  if (minNy > 0.955) return true;
  if (minNy >= titleBlockTopNy && maxNy > titleBlockTopNy + 0.01) return true;

  if (seg.strokeLuminance > 0.65) {
    if (minNx < 0.145 || maxNx > 0.895 || minNy < 0.055 || maxNy > titleBlockTopNy - 0.01) {
      return true;
    }
    if (spanX > 0.45 || spanY > 0.45) return true;
  }

  if ((minNx < 0.05 || maxNx > 0.95) && spanY > 0.25) return true;
  if ((minNy < 0.05 || maxNy > 0.95) && spanX > 0.25) return true;

  return false;
}

function classifySegmentLayer(seg: InternalSegment, primaryOutlineWidth: number): CadLayer {
  if (seg.isDashed) {
    return seg.dashCount >= 3 || seg.effLineWidth <= primaryOutlineWidth * 0.85
      ? 'centerline'
      : 'hidden';
  }
  if (seg.strokeLuminance >= 0.3 && seg.strokeLuminance <= 0.68) {
    return 'dimension';
  }
  if (
    seg.pathSegCount === 1 &&
    seg.effLineWidth <= Math.max(0.5, primaryOutlineWidth * 0.86) &&
    seg.lenMm <= 14
  ) {
    return 'centerline';
  }
  return 'outline';
}

// Two-step pure pipeline: parseOperatorListToSegments -> buildPayloadGeometry
export function parseOperatorListToSegments(
  ops: { fnArray: number[]; argsArray: unknown[][] },
  OPS: PdfOpsTable,
  viewport: PdfViewportLike
): InternalSegment[] {
  const cloneState = (st: PdfGState): PdfGState => ({
    cm: [...st.cm] as Matrix,
    lineWidth: st.lineWidth,
    strokeLuminance: st.strokeLuminance,
    dashPattern: [...st.dashPattern],
  });

  const gStack: PdfGState[] = [
    { cm: [1, 0, 0, 1, 0, 0], lineWidth: 1, strokeLuminance: 0, dashPattern: [] },
  ];
  let gState = cloneState(gStack[0]);
  const allInternalSegments: InternalSegment[] = [];

  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  const pushSegment = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    outList: InternalSegment[]
  ) => {
    if (
      !Number.isFinite(ax) ||
      !Number.isFinite(ay) ||
      !Number.isFinite(bx) ||
      !Number.isFinite(by)
    ) {
      return;
    }
    const p1 = applyMatrix(gState.cm, ax, ay);
    const p2 = applyMatrix(gState.cm, bx, by);
    if (
      !Number.isFinite(p1.x) ||
      !Number.isFinite(p1.y) ||
      !Number.isFinite(p2.x) ||
      !Number.isFinite(p2.y)
    ) {
      return;
    }
    const x1Mm = p1.x * PT_TO_MM;
    const y1Mm = p1.y * PT_TO_MM;
    const x2Mm = p2.x * PT_TO_MM;
    const y2Mm = p2.y * PT_TO_MM;
    const lenMm = Math.hypot(x2Mm - x1Mm, y2Mm - y1Mm);
    if (!Number.isFinite(lenMm) || lenMm < 0.08) return;

    const [vx1, vy1] = viewport.convertToViewportPoint(p1.x, p1.y);
    const [vx2, vy2] = viewport.convertToViewportPoint(p2.x, p2.y);
    const ctmScale = Math.hypot(gState.cm[0], gState.cm[1]) || 1;

    outList.push({
      nx1: Math.max(0, Math.min(1, vx1 / viewport.width)),
      ny1: Math.max(0, Math.min(1, vy1 / viewport.height)),
      nx2: Math.max(0, Math.min(1, vx2 / viewport.width)),
      ny2: Math.max(0, Math.min(1, vy2 / viewport.height)),
      x1Mm: Number(x1Mm.toFixed(3)),
      y1Mm: Number(y1Mm.toFixed(3)),
      x2Mm: Number(x2Mm.toFixed(3)),
      y2Mm: Number(y2Mm.toFixed(3)),
      lenMm,
      effLineWidth: gState.lineWidth * ctmScale,
      strokeLuminance: gState.strokeLuminance,
      isDashed: gState.dashPattern.length > 0,
      dashCount: gState.dashPattern.length,
      pathSegCount: 1,
    });
  };

  // shortcut: fixed 6-step cubic / 3-step quadratic Bezier flattening; upgrade to adaptive flatness if large fillets look faceted
  const tessellateCubicBezier = (
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    ex: number,
    ey: number,
    outList: InternalSegment[]
  ) => {
    let prevX = curX;
    let prevY = curY;
    for (let s = 1; s <= 6; s++) {
      const t = s / 6;
      const mt = 1 - t;
      const px =
        mt * mt * mt * curX +
        3 * mt * mt * t * c1x +
        3 * mt * t * t * c2x +
        t * t * t * ex;
      const py =
        mt * mt * mt * curY +
        3 * mt * mt * t * c1y +
        3 * mt * t * t * c2y +
        t * t * t * ey;
      pushSegment(prevX, prevY, px, py, outList);
      prevX = px;
      prevY = py;
    }
    curX = ex;
    curY = ey;
  };

  const tessellateQuadraticBezier = (
    qx: number,
    qy: number,
    ex: number,
    ey: number,
    outList: InternalSegment[]
  ) => {
    let prevX = curX;
    let prevY = curY;
    for (let s = 1; s <= 3; s++) {
      const t = s / 3;
      const mt = 1 - t;
      const px = mt * mt * curX + 2 * mt * t * qx + t * t * ex;
      const py = mt * mt * curY + 2 * mt * t * qy + t * t * ey;
      pushSegment(prevX, prevY, px, py, outList);
      prevX = px;
      prevY = py;
    }
    curX = ex;
    curY = ey;
  };

  const commitPathSegments = (pathSegs: InternalSegment[]) => {
    const count = pathSegs.length;
    for (const s of pathSegs) {
      s.pathSegCount = count;
      allInternalSegments.push(s);
    }
  };

  const handleLegacySubOp = (
    subOp: number,
    coords: number[],
    idxRef: { idx: number },
    outList: InternalSegment[]
  ) => {
    if (subOp === OPS.moveTo) {
      curX = coords[idxRef.idx++];
      curY = coords[idxRef.idx++];
      startX = curX;
      startY = curY;
    } else if (subOp === OPS.lineTo) {
      const nx = coords[idxRef.idx++];
      const ny = coords[idxRef.idx++];
      pushSegment(curX, curY, nx, ny, outList);
      curX = nx;
      curY = ny;
    } else if (subOp === OPS.curveTo) {
      tessellateCubicBezier(
        coords[idxRef.idx++],
        coords[idxRef.idx++],
        coords[idxRef.idx++],
        coords[idxRef.idx++],
        coords[idxRef.idx++],
        coords[idxRef.idx++],
        outList
      );
    } else if (subOp === OPS.curveTo2 || subOp === OPS.curveTo3) {
      tessellateQuadraticBezier(
        coords[idxRef.idx++],
        coords[idxRef.idx++],
        coords[idxRef.idx++],
        coords[idxRef.idx++],
        outList
      );
    } else if (subOp === OPS.closePath) {
      pushSegment(curX, curY, startX, startY, outList);
      curX = startX;
      curY = startY;
    } else if (subOp === OPS.rectangle) {
      const rx = coords[idxRef.idx++];
      const ry = coords[idxRef.idx++];
      const rw = coords[idxRef.idx++];
      const rh = coords[idxRef.idx++];
      pushSegment(rx, ry, rx + rw, ry, outList);
      pushSegment(rx + rw, ry, rx + rw, ry + rh, outList);
      pushSegment(rx + rw, ry + rh, rx, ry + rh, outList);
      pushSegment(rx, ry + rh, rx, ry, outList);
    }
  };

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] || [];

    if (fn === OPS.save) {
      gStack.push(cloneState(gState));
    } else if (fn === OPS.restore) {
      if (gStack.length > 1) {
        gState = gStack.pop()!;
      }
    } else if (fn === OPS.transform && args.length >= 6) {
      gState.cm = multiplyMatrix(gState.cm, args as Matrix);
    } else if (fn === OPS.setLineWidth && typeof args[0] === 'number') {
      gState.lineWidth = args[0];
    } else if (fn === OPS.setStrokeRGBColor) {
      const lum = parseStrokeLuminance(args);
      if (lum !== null) gState.strokeLuminance = lum;
    } else if (fn === OPS.setStrokeGray && typeof args[0] === 'number') {
      gState.strokeLuminance = args[0] > 1 ? args[0] / 255 : args[0];
    } else if (fn === OPS.setDash) {
      const arr = Array.isArray(args[0]) ? (args[0] as number[]) : [];
      gState.dashPattern = arr.filter((n) => typeof n === 'number' && n > 0);
    } else if (fn === OPS.constructPath) {
      const pathSegs: InternalSegment[] = [];
      // pdfjs-dist v5+ packed DrawOPS format: args[0] = paintOp, args[1] = [Float32Array]
      if (
        typeof args[0] === 'number' &&
        Array.isArray(args[1]) &&
        args[1][0] &&
        typeof (args[1][0] as { length?: number }).length === 'number'
      ) {
        const arr = args[1][0] as Float32Array | number[];
        let k = 0;
        while (k < arr.length) {
          const sub = arr[k++];
          if (sub === 0) {
            curX = arr[k++];
            curY = arr[k++];
            startX = curX;
            startY = curY;
          } else if (sub === 1) {
            const nx = arr[k++];
            const ny = arr[k++];
            pushSegment(curX, curY, nx, ny, pathSegs);
            curX = nx;
            curY = ny;
          } else if (sub === 2) {
            tessellateCubicBezier(
              arr[k++],
              arr[k++],
              arr[k++],
              arr[k++],
              arr[k++],
              arr[k++],
              pathSegs
            );
          } else if (sub === 3) {
            tessellateQuadraticBezier(arr[k++], arr[k++], arr[k++], arr[k++], pathSegs);
          } else if (sub === 4) {
            pushSegment(curX, curY, startX, startY, pathSegs);
            curX = startX;
            curY = startY;
          } else {
            break;
          }
        }
      } else if (Array.isArray(args[0]) && Array.isArray(args[1])) {
        const subOps = args[0] as number[];
        const coords = args[1] as number[];
        const idxRef = { idx: 0 };
        for (const subOp of subOps) {
          handleLegacySubOp(subOp, coords, idxRef, pathSegs);
        }
      }
      commitPathSegments(pathSegs);
    } else if (
      fn === OPS.moveTo ||
      fn === OPS.lineTo ||
      fn === OPS.curveTo ||
      fn === OPS.curveTo2 ||
      fn === OPS.curveTo3 ||
      fn === OPS.closePath ||
      fn === OPS.rectangle
    ) {
      const pathSegs: InternalSegment[] = [];
      handleLegacySubOp(fn, args as number[], { idx: 0 }, pathSegs);
      commitPathSegments(pathSegs);
    }
  }

  return allInternalSegments;
}

export function buildPayloadGeometry(
  allInternalSegments: InternalSegment[],
  rawNormalizedTextItems: RawNormalizedText[],
  pageNumber: number,
  pageWidthPt: number,
  pageHeightPt: number,
  cropImage: (normBounds: NormalizedRect) => string
): {
  rawNormalizedSegments: RawNormalizedSegment[];
  viewChunks: PdfViewChunk[];
  centeredEntities: CadEntity[];
  vectorBoundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  titleBlockMeta: PdfTitleBlockMeta;
  detectedScaleLabel?: string;
  detectedScaleFactor?: number;
} {
  const titleBlockTopNy = detectTitleBlockTopNy(allInternalSegments, rawNormalizedTextItems);
  const drawingSegments = allInternalSegments.filter(
    (seg) => !isSheetChromeSegment(seg, titleBlockTopNy)
  );

  const darkWidths = drawingSegments
    .filter((s) => s.strokeLuminance < 0.28 && !s.isDashed)
    .map((s) => s.effLineWidth);
  const primaryOutlineWidth = darkWidths.length > 0 ? Math.max(...darkWidths) : 0.6;

  const rawNormalizedSegments: RawNormalizedSegment[] = drawingSegments.map((seg) => ({
    nx1: seg.nx1,
    ny1: seg.ny1,
    nx2: seg.nx2,
    ny2: seg.ny2,
    x1Mm: seg.x1Mm,
    y1Mm: seg.y1Mm,
    x2Mm: seg.x2Mm,
    y2Mm: seg.y2Mm,
    layerHint: classifySegmentLayer(seg, primaryOutlineWidth),
  }));

  const titleBlockMeta = parseTitleBlockMetadata(rawNormalizedTextItems, rawNormalizedSegments);
  const detectedSpecs = detectViewRegions(
    rawNormalizedSegments,
    rawNormalizedTextItems,
    titleBlockTopNy
  );
  const viewChunks = buildViewChunksFromSpecs(
    detectedSpecs,
    pageNumber,
    pageWidthPt,
    pageHeightPt,
    rawNormalizedSegments,
    rawNormalizedTextItems,
    cropImage
  );
  const calibrated = calibrateScaleFromViewChunks(viewChunks, titleBlockMeta);

  const retainedSegs = rawNormalizedSegments.slice(0, 4000);
  const outlineForBB = retainedSegs.filter((s) => s.layerHint === 'outline' || s.layerHint === 'hidden');
  const structuralForBB = retainedSegs.filter((s) => s.layerHint !== 'dimension');
  const bbSegs =
    outlineForBB.length >= 2 ? outlineForBB : structuralForBB.length >= 2 ? structuralForBB : retainedSegs;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const s of bbSegs) {
    minX = Math.min(minX, s.x1Mm, s.x2Mm);
    minY = Math.min(minY, s.y1Mm, s.y2Mm);
    maxX = Math.max(maxX, s.x1Mm, s.x2Mm);
    maxY = Math.max(maxY, s.y1Mm, s.y2Mm);
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const centeredEntities: CadEntity[] = retainedSegs.map((s, idx) => ({
    id: `pdf-vec-${idx + 1}`,
    layer: s.layerHint || 'outline',
    type: 'line',
    x1: Number((s.x1Mm - centerX).toFixed(3)),
    y1: Number((s.y1Mm - centerY).toFixed(3)),
    x2: Number((s.x2Mm - centerX).toFixed(3)),
    y2: Number((s.y2Mm - centerY).toFixed(3)),
  }));

  return {
    rawNormalizedSegments,
    viewChunks,
    centeredEntities,
    vectorBoundingBox: {
      minX: Number((minX - centerX).toFixed(3)),
      minY: Number((minY - centerY).toFixed(3)),
      maxX: Number((maxX - centerX).toFixed(3)),
      maxY: Number((maxY - centerY).toFixed(3)),
    },
    titleBlockMeta: {
      ...titleBlockMeta,
      scaleLabel: calibrated.scaleLabel,
      scaleFactor: calibrated.scaleFactor,
    },
    detectedScaleLabel: calibrated.scaleLabel,
    detectedScaleFactor: calibrated.scaleFactor,
  };
}

export function parseTitleBlockMetadata(
  textItems: RawNormalizedText[],
  segments: RawNormalizedSegment[]
): PdfTitleBlockMeta {
  const joined = textItems.map((t) => t.text).join(' | ');

  let units: 'mm' | 'in' = 'mm';
  if (/DIMENSIONS\s+ARE\s+IN\s+INCH/i.test(joined) || /UNITS:\s*IN\b/i.test(joined)) {
    units = 'in';
  }

  let scaleLabel: string | undefined;
  let scaleFactor: number | undefined;
  const scaleMatch = joined.match(/SCALE\s*[:=]?\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/i);
  if (scaleMatch) {
    const a = Number(scaleMatch[1]);
    const b = Number(scaleMatch[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      scaleLabel = `${scaleMatch[1]}:${scaleMatch[2]}`;
      scaleFactor = Number((b / a).toFixed(4));
    }
  } else {
    const scaleLabelItem = textItems.find((t) => /\bSCALE\b/i.test(t.text));
    if (scaleLabelItem) {
      const ratioToken = textItems.find(
        (t) =>
          t !== scaleLabelItem &&
          Math.abs(t.ny - scaleLabelItem.ny) < 0.03 &&
          t.nx >= scaleLabelItem.nx - 0.02 &&
          t.nx <= scaleLabelItem.nx + 0.18 &&
          /^\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?$/.test(t.text.trim())
      );
      if (ratioToken) {
        const parts = ratioToken.text.split(':').map((p) => Number(p.trim()));
        if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
          scaleLabel = `${parts[0]}:${parts[1]}`;
          scaleFactor = Number((parts[1] / parts[0]).toFixed(4));
        }
      }
    }
  }

  // shortcut: infers missing scale only against standard architectural/CAD integer ratios; upgrade if arbitrary fractional scales lack title-block text
  if (!scaleFactor && segments.length > 0) {
    const dimNums = textItems
      .filter((t) => t.ny < 0.76 && /^\d{2,4}(?:\.\d+)?$/.test(t.text.trim()))
      .map((t) => Number(t.text.trim()))
      .filter((n) => Number.isFinite(n) && n >= 20 && n <= 10000);
    if (dimNums.length > 0) {
      const maxDimVal = Math.max(...dimNums);
      const geomSegs = segments.filter((s) => s.layerHint !== 'dimension');
      if (geomSegs.length > 0) {
        const minX = Math.min(...geomSegs.flatMap((s) => [s.x1Mm, s.x2Mm]));
        const maxX = Math.max(...geomSegs.flatMap((s) => [s.x1Mm, s.x2Mm]));
        const spanMm = maxX - minX;
        if (spanMm > 10 && maxDimVal / spanMm > 1.8) {
          const ratio = Math.round(maxDimVal / spanMm);
          if ([2, 4, 5, 10, 15, 20, 25, 50, 100].includes(ratio)) {
            scaleFactor = ratio;
            scaleLabel = `1:${ratio}`;
          }
        }
      }
    }
  }

  const findNearbyValue = (
    labelRegex: RegExp,
    opts: { maxDx?: number; minDx?: number; minDy?: number; maxDy?: number; exclude?: RegExp } = {}
  ): string | undefined => {
    const anchor = textItems.find((t) => labelRegex.test(t.text));
    if (!anchor) return undefined;
    const inlineMatch = anchor.text.match(/[:=]\s*(.+)$/);
    if (inlineMatch && inlineMatch[1].trim().length >= 2) {
      return inlineMatch[1].trim();
    }
    const maxDx = opts.maxDx ?? 0.22;
    const minDx = opts.minDx ?? -0.02;
    const minDy = opts.minDy ?? -0.02;
    const maxDy = opts.maxDy ?? 0.05;

    const candidates = textItems
      .filter((t) => {
        if (t === anchor) return false;
        const dx = t.nx - anchor.nx;
        const dy = t.ny - anchor.ny;
        if (dx < minDx || dx > maxDx || dy < minDy || dy > maxDy) return false;
        if (opts.exclude && opts.exclude.test(t.text)) return false;
        return t.text.trim().length > 0;
      })
      .sort(
        (a, b) =>
          Math.hypot(a.nx - anchor.nx, a.ny - anchor.ny) -
          Math.hypot(b.nx - anchor.nx, b.ny - anchor.ny)
      );

    return candidates[0]?.text.trim();
  };

  return {
    partName: findNearbyValue(/^(?:TITLE|PART\s*NAME)\s*[:.]?$/i, {
      maxDx: 0.25,
      minDy: -0.01,
      maxDy: 0.06,
      exclude: /^(?:DO NOT SCALE|DWG NO|SHEET|REVISION|RS Engineering)/i,
    }),
    partNumber: findNearbyValue(/(?:DWG\s*NO\.?|PART\s*NO\.?)/i, {
      maxDx: 0.22,
      minDy: -0.015,
      maxDy: 0.045,
      exclude: /^(?:SCALE|SHEET|A[0-4]|MATERIAL)/i,
    }),
    revision: findNearbyValue(/^REV(?:ISION)?\s*[:.]?$/i, {
      maxDx: 0.14,
      minDy: -0.015,
      maxDy: 0.025,
      exclude: /^(?:RS Engineering|DO NOT SCALE)/i,
    }),
    material: findNearbyValue(/^MAT(?:ERIAL)?\s*[:.]?$/i, {
      maxDx: 0.2,
      minDy: -0.015,
      maxDy: 0.045,
      exclude: /^(?:WEIGHT|DWG|SCALE|Q\.A)/i,
    }),
    units,
    weight: findNearbyValue(/^WEIGHT\s*[:.]?$/i, {
      maxDx: 0.14,
      minDy: -0.015,
      maxDy: 0.025,
    }),
    scaleLabel,
    scaleFactor,
  };
}

function classifyViewFromFeatures(
  tokens: string[],
  normBounds: NormalizedRect,
  clusterSegs: RawNormalizedSegment[],
  index: number
): { viewKind: ViewChunkKind; label: string } {
  const joined = tokens.join(' ').toUpperCase();
  if (joined.includes('LONGITUDINAL')) {
    return { viewKind: 'longitudinal-section', label: 'Longitudinal Section' };
  }
  if (
    joined.includes('CROSS-SECTION') ||
    joined.includes('CROSS SECTION') ||
    joined.includes('SECTION B-B')
  ) {
    return { viewKind: 'cross-section', label: 'Cross-Section B-B' };
  }
  if (joined.includes('SECTION A-A') || joined.includes('SECTION')) {
    return { viewKind: 'longitudinal-section', label: 'Section View A-A' };
  }
  if (joined.includes('DETAIL')) return { viewKind: 'detail', label: 'Detail View' };
  if (joined.includes('ISOMETRIC') || joined.includes('ISO VIEW')) {
    return { viewKind: 'isometric', label: 'Isometric View' };
  }
  if (joined.includes('TOP VIEW') || joined.includes('PLAN VIEW')) {
    return { viewKind: 'orthogonal', label: 'Orthogonal Top View' };
  }
  if (joined.includes('SIDE VIEW') || joined.includes('RIGHT VIEW')) {
    return { viewKind: 'orthogonal', label: 'Orthogonal Side View' };
  }
  if (joined.includes('ORTHOGONAL') || joined.includes('FRONT VIEW')) {
    return { viewKind: 'orthogonal', label: 'Orthogonal Front View' };
  }

  if (clusterSegs.length > 0) {
    const xs = clusterSegs.flatMap((s) => [s.x1Mm, s.x2Mm]);
    const ys = clusterSegs.flatMap((s) => [s.y1Mm, s.y2Mm]);
    const wMm = Math.max(1, Math.max(...xs) - Math.min(...xs));
    const hMm = Math.max(1, Math.max(...ys) - Math.min(...ys));
    const aspect = wMm / hMm;
    const hasCenterlines = clusterSegs.some((s) => s.layerHint === 'centerline');
    const numericDimTokens = tokens.filter((t) => /^\d{2,4}(?:\.\d+)?$/.test(t.trim()));

    if (normBounds.y < 0.35 && numericDimTokens.length === 0 && clusterSegs.length >= 25) {
      return { viewKind: 'isometric', label: 'Isometric 3D View' };
    }
    if (aspect >= 0.78 && aspect <= 1.28 && (hasCenterlines || clusterSegs.length >= 40)) {
      return { viewKind: 'cross-section', label: 'End / Cross-Section View' };
    }
  }

  return {
    viewKind: 'orthogonal',
    label: index === 0 ? 'Orthogonal Front View' : `Orthogonal View ${index + 1}`,
  };
}

function boxesOverlapOrNear(a: NormalizedRect, b: NormalizedRect, gap: number): boolean {
  return !(
    a.x + a.w + gap < b.x ||
    b.x + b.w + gap < a.x ||
    a.y + a.h + gap < b.y ||
    b.y + b.h + gap < a.y
  );
}

export function detectViewRegions(
  segments: RawNormalizedSegment[],
  textItems: RawNormalizedText[],
  titleBlockTopNy: number
): Array<{ normBounds: NormalizedRect; viewKind: ViewChunkKind; label: string }> {
  const structuralIndices: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].layerHint !== 'dimension') {
      structuralIndices.push(i);
    }
  }

  const indicesToCluster =
    structuralIndices.length >= 6 ? structuralIndices : segments.map((_, idx) => idx);

  if (indicesToCluster.length === 0) {
    return [
      {
        normBounds: { x: 0.05, y: 0.06, w: 0.9, h: Math.max(0.4, titleBlockTopNy - 0.08) },
        viewKind: 'orthogonal',
        label: 'Primary Drawing View',
      },
    ];
  }

  interface Cluster {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    count: number;
    segIndices: number[];
  }

  let clusters: Cluster[] = indicesToCluster.map((idx) => {
    const s = segments[idx];
    return {
      x1: Math.min(s.nx1, s.nx2),
      y1: Math.min(s.ny1, s.ny2),
      x2: Math.max(s.nx1, s.nx2),
      y2: Math.max(s.ny1, s.ny2),
      count: 1,
      segIndices: [idx],
    };
  });

  // shortcut: fixed 2.6% normalized gap merges view primitives without bridging neighboring views; upgrade to adaptive gap for dense detail sheets
  const gap = 0.026;
  let merged = true;
  while (merged && clusters.length > 1) {
    merged = false;
    const next: Cluster[] = [];
    const used = new Array<boolean>(clusters.length).fill(false);

    for (let i = 0; i < clusters.length; i++) {
      if (used[i]) continue;
      let cur = clusters[i];
      used[i] = true;

      let changed = true;
      while (changed) {
        changed = false;
        for (let j = 0; j < clusters.length; j++) {
          if (used[j]) continue;
          const other = clusters[j];
          const curRect: NormalizedRect = {
            x: cur.x1,
            y: cur.y1,
            w: cur.x2 - cur.x1,
            h: cur.y2 - cur.y1,
          };
          const otherRect: NormalizedRect = {
            x: other.x1,
            y: other.y1,
            w: other.x2 - other.x1,
            h: other.y2 - other.y1,
          };
          if (boxesOverlapOrNear(curRect, otherRect, gap)) {
            cur = {
              x1: Math.min(cur.x1, other.x1),
              y1: Math.min(cur.y1, other.y1),
              x2: Math.max(cur.x2, other.x2),
              y2: Math.max(cur.y2, other.y2),
              count: cur.count + other.count,
              segIndices: cur.segIndices.concat(other.segIndices),
            };
            used[j] = true;
            changed = true;
            merged = true;
          }
        }
      }
      next.push(cur);
    }
    clusters = next;
  }

  const significant = clusters
    .filter((c) => c.count >= 3 && (c.x2 - c.x1 >= 0.04 || c.y2 - c.y1 >= 0.04))
    .sort((a, b) => (Math.abs(a.y1 - b.y1) > 0.14 ? a.y1 - b.y1 : a.x1 - b.x1))
    .slice(0, 6);

  if (significant.length === 0) {
    return [
      {
        normBounds: { x: 0.05, y: 0.06, w: 0.9, h: Math.max(0.4, titleBlockTopNy - 0.08) },
        viewKind: 'orthogonal',
        label: 'Primary Drawing View',
      },
    ];
  }

  return significant.map((c, idx) => {
    const x = Math.max(0.02, c.x1 - 0.032);
    const y = Math.max(0.03, c.y1 - 0.052);
    const x2 = Math.min(0.98, c.x2 + 0.032);
    const y2 = Math.min(titleBlockTopNy - 0.004, c.y2 + 0.052);
    const normBounds: NormalizedRect = {
      x: Number(x.toFixed(4)),
      y: Number(y.toFixed(4)),
      w: Number(Math.max(0.06, x2 - x).toFixed(4)),
      h: Number(Math.max(0.06, y2 - y).toFixed(4)),
    };

    const nearbyTokens = textItems
      .filter(
        (t) =>
          t.nx >= normBounds.x - 0.02 &&
          t.nx <= normBounds.x + normBounds.w + 0.02 &&
          t.ny >= normBounds.y - 0.02 &&
          t.ny <= normBounds.y + normBounds.h + 0.02
      )
      .map((t) => t.text);

    const clusterSegs = c.segIndices
      .map((i) => segments[i])
      .filter((s): s is RawNormalizedSegment => Boolean(s));

    const classified = classifyViewFromFeatures(nearbyTokens, normBounds, clusterSegs, idx);
    return {
      normBounds,
      viewKind: classified.viewKind,
      label: classified.label,
    };
  });
}

export function buildViewChunksFromSpecs(
  specs: Array<{
    id?: string;
    label: string;
    viewKind: ViewChunkKind;
    normBounds: NormalizedRect;
  }>,
  pageNumber: number,
  pageWidthPt: number,
  pageHeightPt: number,
  segments: RawNormalizedSegment[],
  textItems: RawNormalizedText[],
  cropImage: (normBounds: NormalizedRect) => string
): PdfViewChunk[] {
  const pageWmm = pageWidthPt * PT_TO_MM;
  const pageHmm = pageHeightPt * PT_TO_MM;

  const chunkBuckets: RawNormalizedSegment[][] = specs.map(() => []);
  for (const s of segments) {
    const mx = (s.nx1 + s.nx2) / 2;
    const my = (s.ny1 + s.ny2) / 2;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < specs.length; i++) {
      const b = specs[i].normBounds;
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
        const d = Math.hypot(mx - (b.x + b.w / 2), my - (b.y + b.h / 2));
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
    }
    if (bestIdx >= 0) {
      chunkBuckets[bestIdx].push(s);
    }
  }

  return specs.map((spec, idx) => {
    const id = spec.id || `view-${idx + 1}`;
    const b = spec.normBounds;
    const croppedImageDataUrl = cropImage(b);

    const chunkText = textItems
      .filter(
        (t) =>
          t.nx >= b.x - 0.01 &&
          t.nx <= b.x + b.w + 0.01 &&
          t.ny >= b.y - 0.02 &&
          t.ny <= b.y + b.h + 0.02
      )
      .map((t) => t.text);

    const enclosedSegs = chunkBuckets[idx];
    const outlineSegs = enclosedSegs.filter((s) => s.layerHint === 'outline' || s.layerHint === 'hidden');
    const structuralSegs = enclosedSegs.filter((s) => s.layerHint !== 'dimension');
    const boundsSegs =
      outlineSegs.length >= 2 ? outlineSegs : structuralSegs.length >= 2 ? structuralSegs : enclosedSegs;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const s of boundsSegs) {
      minX = Math.min(minX, s.x1Mm, s.x2Mm);
      minY = Math.min(minY, s.y1Mm, s.y2Mm);
      maxX = Math.max(maxX, s.x1Mm, s.x2Mm);
      maxY = Math.max(maxY, s.y1Mm, s.y2Mm);
    }

    if (!Number.isFinite(minX)) {
      minX = b.x * pageWmm;
      maxX = (b.x + b.w) * pageWmm;
      minY = (1 - (b.y + b.h)) * pageHmm;
      maxY = (1 - b.y) * pageHmm;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const vectorEntities: CadEntity[] = enclosedSegs.slice(0, 2500).map((s, sIdx) => ({
      id: `${id}-vec-${sIdx + 1}`,
      viewId: id,
      layer: s.layerHint || 'outline',
      type: 'line',
      x1: Number((s.x1Mm - cx).toFixed(3)),
      y1: Number((s.y1Mm - cy).toFixed(3)),
      x2: Number((s.x2Mm - cx).toFixed(3)),
      y2: Number((s.y2Mm - cy).toFixed(3)),
    }));

    return {
      id,
      label: spec.label,
      viewKind: spec.viewKind,
      pageNumber,
      normBounds: b,
      croppedImageDataUrl,
      extractedText: chunkText,
      vectorEntities,
      boundingBox: {
        minX: Number((minX - cx).toFixed(3)),
        minY: Number((minY - cy).toFixed(3)),
        maxX: Number((maxX - cx).toFixed(3)),
        maxY: Number((maxY - cy).toFixed(3)),
      },
      sheetOffset: {
        dx: Number((cx - pageWmm / 2).toFixed(3)),
        dy: Number((cy - pageHmm / 2).toFixed(3)),
      },
    };
  });
}

function extractNumericDimCallouts(tokens: string[]): number[] {
  const vals: number[] = [];
  for (const tok of tokens) {
    const cleaned = tok.replace(/[ØøRr±]/g, '').trim();
    if (/^\d{1,4}(?:\.\d+)?$/.test(cleaned)) {
      const n = Number(cleaned);
      if (Number.isFinite(n) && n >= 1 && n <= 10000) {
        vals.push(n);
      }
    }
  }
  return Array.from(new Set(vals)).sort((a, b) => b - a);
}

export function calibrateScaleFromViewChunks(
  viewChunks: PdfViewChunk[],
  titleMeta: PdfTitleBlockMeta
): { scaleFactor?: number; scaleLabel?: string } {
  const nonIso = viewChunks.filter((c) => c.viewKind !== 'isometric');
  const candidateRatios: number[] = [];

  for (const chunk of nonIso) {
    const dims = extractNumericDimCallouts(chunk.extractedText).filter((d) => d >= 15);
    if (dims.length === 0) continue;
    const wPaper = chunk.boundingBox.maxX - chunk.boundingBox.minX;
    const hPaper = chunk.boundingBox.maxY - chunk.boundingBox.minY;
    const maxPaper = Math.max(wPaper, hPaper);
    const minPaper = Math.min(wPaper, hPaper);
    if (maxPaper < 4) continue;

    const rMax = dims[0] / maxPaper;
    if (rMax >= 0.4 && rMax <= 200) {
      candidateRatios.push(rMax);
    }
    if (dims.length >= 2 && minPaper >= 4) {
      const rMin = dims[1] / minPaper;
      if (rMin >= 0.4 && rMin <= 200 && Math.abs(rMin - rMax) / Math.max(rMax, 0.001) < 0.06) {
        candidateRatios.push(rMin);
      }
    }
  }

  const baseFactor = titleMeta.scaleFactor;
  const baseLabel = titleMeta.scaleLabel;

  if (candidateRatios.length >= 2) {
    const sorted = [...candidateRatios].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const closeMatches = sorted.filter((r) => Math.abs(r - median) / median < 0.05);

    if (closeMatches.length >= 2) {
      const avg = closeMatches.reduce((a, b) => a + b, 0) / closeMatches.length;
      if (baseFactor && Math.abs(avg - baseFactor) / baseFactor <= 0.08) {
        return { scaleFactor: baseFactor, scaleLabel: baseLabel };
      }
      const nearestInt = Math.round(avg);
      const cleanFactor =
        nearestInt >= 1 && Math.abs(avg - nearestInt) / avg < 0.015
          ? nearestInt
          : Number(avg.toFixed(4));
      const ratioStr =
        cleanFactor >= 1
          ? `1:${Number(cleanFactor.toFixed(2))}`
          : `${Number((1 / cleanFactor).toFixed(2))}:1`;
      return {
        scaleFactor: cleanFactor,
        scaleLabel: baseLabel ? `${ratioStr} · sheet ${baseLabel}` : ratioStr,
      };
    }
  }

  return { scaleFactor: baseFactor, scaleLabel: baseLabel };
}

function buildDefaultProcessRouting(
  material: string,
  hasRoundProfile: boolean,
  primaryFeatureId: string | undefined,
  primaryFeatureName: string,
  secondaryFeatureId: string | undefined,
  secondaryFeatureName: string,
  preferredMachines?: MachineCategory[]
): ProcessOperation[] {
  if (preferredMachines && preferredMachines.length > 0) {
    return preferredMachines.map((machine, idx) =>
      getDefaultOperationTemplate(
        machine,
        material,
        (idx + 1) * 10,
        idx === 0
          ? 'Raw Stock / Primary Datum'
          : idx === preferredMachines.length - 1
            ? secondaryFeatureName
            : primaryFeatureName,
        idx === preferredMachines.length - 1
          ? secondaryFeatureId || primaryFeatureId
          : primaryFeatureId
      )
    );
  }

  return [
    getDefaultOperationTemplate('Band Saw', material, 10, 'Raw Stock Blank', primaryFeatureId),
    getDefaultOperationTemplate(
      hasRoundProfile ? 'Lathe Machine' : 'Milling',
      material,
      20,
      primaryFeatureName,
      primaryFeatureId
    ),
    getDefaultOperationTemplate(
      'Grinding Finishing',
      material,
      30,
      secondaryFeatureName,
      secondaryFeatureId
    ),
    getDefaultOperationTemplate(
      'Inspection',
      material,
      40,
      'All Critical Dimensions',
      primaryFeatureId
    ),
  ];
}

export function buildRawVectorAnalysis(
  payload: PdfExtractionPayload,
  scaleModeOrOptions: 'real' | 'paper' | VectorAnalysisOptions = 'real'
): DrawingAnalysisResult {
  const opts: VectorAnalysisOptions =
    typeof scaleModeOrOptions === 'string'
      ? { scaleMode: scaleModeOrOptions }
      : scaleModeOrOptions;

  const scaleMode = opts.scaleMode ?? 'real';
  const includeCadPlotting = opts.modules?.cadPlotting !== false;
  const includeProcessPlan = opts.modules?.processPlan !== false;

  const meta = payload.titleBlockMeta;
  const cleanTitle = meta?.partName || payload.fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ');
  const material = opts.preferredMaterial?.trim() || meta?.material || '6061-T6 Aluminum';
  const isMultiView = payload.viewChunks.length > 1;
  const partNumber = meta?.partNumber || (isMultiView ? 'PDF-MV-01' : 'PDF-VEC-01');
  const revision = meta?.revision || 'A';
  const units =
    opts.unitsOverride && opts.unitsOverride !== 'auto'
      ? opts.unitsOverride
      : meta?.units || 'mm';
  const customRatio =
    opts.customScaleRatio && Number.isFinite(opts.customScaleRatio) && opts.customScaleRatio > 0
      ? opts.customScaleRatio
      : undefined;
  const effectiveScaleFactor = customRatio || payload.detectedScaleFactor || 1;
  const effectiveScaleLabel = customRatio
    ? `1:${Number(customRatio.toFixed(2))} (manual)`
    : payload.detectedScaleLabel;
  const scaleFactor = scaleMode === 'real' ? effectiveScaleFactor : 1;

  const isCylindricalPart =
    /shell|pulley|shaft|pipe|tube|bushing|sleeve|ring|roller|cylinder/i.test(cleanTitle) ||
    payload.viewChunks.some((c) => c.viewKind === 'cross-section');

  const entities: CadEntity[] = [];
  const dimensions: DrawingAnalysisResult['dimensions'] = [];
  const features: DrawingAnalysisResult['features'] = [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let stockW = 20;
  let stockH = 20;

  if (isMultiView) {
    for (const chunk of payload.viewChunks) {
      const featId = `feat-${chunk.id}`;
      const dx = Number((chunk.sheetOffset.dx * scaleFactor).toFixed(2));
      const dy = Number((chunk.sheetOffset.dy * scaleFactor).toFixed(2));
      const chunkHasOutlines = chunk.vectorEntities.some(
        (e) => e.layer === 'outline' || e.layer === 'hidden'
      );

      let cMinX = Infinity;
      let cMinY = Infinity;
      let cMaxX = -Infinity;
      let cMaxY = -Infinity;

      for (const ent of chunk.vectorEntities) {
        if (ent.type !== 'line') continue;
        const placed: CadEntity = {
          ...ent,
          viewId: chunk.id,
          featureId: featId,
          x1: Number((ent.x1 * scaleFactor + dx).toFixed(2)),
          y1: Number((ent.y1 * scaleFactor + dy).toFixed(2)),
          x2: Number((ent.x2 * scaleFactor + dx).toFixed(2)),
          y2: Number((ent.y2 * scaleFactor + dy).toFixed(2)),
        };
        entities.push(placed);
        const countsTowardBounds = chunkHasOutlines
          ? placed.layer === 'outline' || placed.layer === 'hidden'
          : placed.layer !== 'dimension';
        if (countsTowardBounds) {
          cMinX = Math.min(cMinX, placed.x1, placed.x2);
          cMinY = Math.min(cMinY, placed.y1, placed.y2);
          cMaxX = Math.max(cMaxX, placed.x1, placed.x2);
          cMaxY = Math.max(cMaxY, placed.y1, placed.y2);
        }
        minX = Math.min(minX, placed.x1, placed.x2);
        minY = Math.min(minY, placed.y1, placed.y2);
        maxX = Math.max(maxX, placed.x1, placed.x2);
        maxY = Math.max(maxY, placed.y1, placed.y2);
      }

      if (!Number.isFinite(cMinX)) {
        cMinX = chunk.boundingBox.minX * scaleFactor + dx;
        cMinY = chunk.boundingBox.minY * scaleFactor + dy;
        cMaxX = chunk.boundingBox.maxX * scaleFactor + dx;
        cMaxY = chunk.boundingBox.maxY * scaleFactor + dy;
      }

      const w = Math.max(5, Number((cMaxX - cMinX).toFixed(1)));
      const h = Math.max(5, Number((cMaxY - cMinY).toFixed(1)));
      if (chunk.viewKind !== 'isometric') {
        stockW = Math.max(stockW, w);
        stockH = Math.max(stockH, h);
      }

      const callouts = extractNumericDimCallouts(chunk.extractedText);
      const calloutSuffix =
        callouts.length > 0 ? ` · Callouts: ${callouts.slice(0, 3).join(', ')} ${units}` : '';

      dimensions.push({
        id: `dim-${chunk.id}-w`,
        viewId: chunk.id,
        featureId: featId,
        kind: 'linear',
        label: `${w.toFixed(1)} × ${h.toFixed(1)} mm${scaleMode === 'paper' && payload.detectedScaleLabel ? ` (${payload.detectedScaleLabel} paper)` : ''}`,
        x1: cMinX,
        y1: cMinY,
        x2: cMaxX,
        y2: cMinY,
        offset: -Math.max(8, h * 0.14),
      });

      features.push({
        id: featId,
        name: chunk.label,
        category:
          chunk.viewKind === 'cross-section'
            ? isCylindricalPart
              ? 'turning'
              : 'bore'
            : chunk.viewKind === 'longitudinal-section'
              ? 'bore'
              : 'contour',
        dimensions: `${w.toFixed(1)} × ${h.toFixed(1)} mm (${chunk.vectorEntities.length} segments)${calloutSuffix}`,
        tolerance: '±0.10 mm',
        surfaceFinishRa: 'Ra 1.6 µm',
        notes: `Linked PDF chunk (${Math.round(chunk.normBounds.w * 100)}%×${Math.round(chunk.normBounds.h * 100)}% of sheet).`,
      });
    }

    if (!Number.isFinite(minX)) {
      minX = payload.vectorBoundingBox.minX * scaleFactor;
      minY = payload.vectorBoundingBox.minY * scaleFactor;
      maxX = payload.vectorBoundingBox.maxX * scaleFactor;
      maxY = payload.vectorBoundingBox.maxY * scaleFactor;
    }
  } else {
    for (const ent of payload.vectorEntities) {
      entities.push(
        ent.type === 'line'
          ? {
              ...ent,
              x1: Number((ent.x1 * scaleFactor).toFixed(2)),
              y1: Number((ent.y1 * scaleFactor).toFixed(2)),
              x2: Number((ent.x2 * scaleFactor).toFixed(2)),
              y2: Number((ent.y2 * scaleFactor).toFixed(2)),
            }
          : ent
      );
    }
    minX = Number((payload.vectorBoundingBox.minX * scaleFactor).toFixed(2));
    minY = Number((payload.vectorBoundingBox.minY * scaleFactor).toFixed(2));
    maxX = Number((payload.vectorBoundingBox.maxX * scaleFactor).toFixed(2));
    maxY = Number((payload.vectorBoundingBox.maxY * scaleFactor).toFixed(2));
    stockW = Math.max(10, Number((maxX - minX).toFixed(1)));
    stockH = Math.max(10, Number((maxY - minY).toFixed(1)));

    dimensions.push(
      {
        id: 'vec-dim-w',
        kind: 'linear',
        label: `${stockW.toFixed(1)} mm (Span X)`,
        x1: minX,
        y1: minY,
        x2: maxX,
        y2: minY,
        offset: -Math.max(8, stockH * 0.12),
      },
      {
        id: 'vec-dim-h',
        kind: 'linear',
        label: `${stockH.toFixed(1)} mm (Span Y)`,
        x1: maxX,
        y1: minY,
        x2: maxX,
        y2: maxY,
        offset: Math.max(8, stockW * 0.12),
      }
    );

    features.push({
      id: 'feat-vec-contour',
      name: 'Extracted PDF Vector Geometry',
      category: isCylindricalPart ? 'turning' : 'contour',
      dimensions: `${stockW.toFixed(1)} × ${stockH.toFixed(1)} mm (${payload.vectorEntityCount} segments)`,
      tolerance: '±0.10 mm',
      surfaceFinishRa: 'Ra 1.6 µm',
      notes: 'Parsed directly from PDF vector operator stream.',
    });
  }

  const stockLen = Math.ceil(stockW + 6);
  const stockWid = Math.ceil(stockH + 6);
  const stockThk = isCylindricalPart
    ? stockWid
    : isMultiView
      ? Math.max(15, Math.round(stockWid * 0.25))
      : 15;

  const primaryFeat =
    features.find((f) => !f.name.toLowerCase().includes('isometric')) || features[0];
  const secondaryFeat = features[1] || features[0];

  return {
    partName: cleanTitle || (isMultiView ? 'Multi-View Vector Drawing' : 'Imported Vector Drawing'),
    partNumber,
    revision,
    units,
    material,
    stockEnvelope: {
      length: stockLen,
      width: stockWid,
      thickness: stockThk,
      form: isCylindricalPart ? 'Round Bar' : 'Plate / Bar',
    },
    generalTolerance: 'ISO 2768-m',
    surfaceFinishDefault: 'Ra 1.6 µm',
    boundingBox: { minX, minY, maxX, maxY },
    viewChunks: payload.viewChunks.map((c) => ({
      id: c.id,
      label: c.label,
      viewKind: c.viewKind,
      pageNumber: c.pageNumber,
      normBounds: c.normBounds,
      sheetOffset: {
        dx: Number((c.sheetOffset.dx * scaleFactor).toFixed(2)),
        dy: Number((c.sheetOffset.dy * scaleFactor).toFixed(2)),
      },
    })),
    entities: includeCadPlotting ? entities : [],
    dimensions: includeCadPlotting ? dimensions : [],
    features,
    processPlan: includeProcessPlan
      ? buildDefaultProcessRouting(
          material,
          isCylindricalPart,
          primaryFeat?.id,
          primaryFeat?.name || 'Primary Profile',
          secondaryFeat?.id,
          secondaryFeat?.name || 'Critical Datum Faces',
          opts.preferredMachines
        )
      : [],
    dfmNotes: [
      isMultiView
        ? `Split PDF page ${payload.selectedPage} into ${payload.viewChunks.length} linked view chunks (${payload.viewChunks.map((c) => c.label).join(', ')}).`
        : `Extracted ${payload.vectorEntityCount} vector line/curve primitives directly from PDF page ${payload.selectedPage}.`,
      effectiveScaleLabel
        ? `Detected/configured scale ${effectiveScaleLabel}; plotting in ${scaleMode === 'real' ? '1:1 Real part mm' : 'raw Paper mm'} (toggle in toolbar).`
        : 'Use Adjust View Boxes on the PDF sheet to manually split additional section views if needed.',
      ...(meta?.weight ? [`Drawing title-block weight specification: ${meta.weight}.`] : []),
    ],
    extractionSource: 'pdf-vector',
    detectedScaleLabel: effectiveScaleLabel,
    detectedScaleFactor:
      effectiveScaleFactor !== 1 ? effectiveScaleFactor : payload.detectedScaleFactor,
  };
}
