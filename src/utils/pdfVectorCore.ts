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
export const MAX_TOTAL_VECTOR_SEGMENTS = 20000;
export const MAX_CHUNK_VECTOR_SEGMENTS = 8000;

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
  subpathId: number;
  isFilled: boolean;
}

export interface PdfOpsTable {
  save: number;
  restore: number;
  transform: number;
  setLineWidth: number;
  setStrokeRGBColor: number;
  setStrokeGray: number;
  setDash: number;
  setGState?: number;
  paintFormXObjectBegin?: number;
  paintFormXObjectEnd?: number;
  constructPath: number;
  moveTo: number;
  lineTo: number;
  curveTo: number;
  curveTo2: number;
  curveTo3: number;
  closePath: number;
  rectangle: number;
  stroke?: number;
  closeStroke?: number;
  fill?: number;
  eoFill?: number;
  fillStroke?: number;
  eoFillStroke?: number;
  closeFillStroke?: number;
  closeEOFillStroke?: number;
  endPath?: number;
  clip?: number;
  eoClip?: number;
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

interface SheetBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const TITLE_BLOCK_KEYWORDS = [
  'DRAWN',
  "CHK'D",
  "APPV'D",
  'MATERIAL',
  'MAT:',
  'DWG NO',
  'PART NO',
  'SCALE:',
  'SCALE ',
  'SHEET 1',
  'DO NOT SCALE',
  'UNLESS OTHERWISE',
  'DIMENSIONS ARE IN',
];

// shortcut: assumes landscape/standard bottom title block (>=70% down sheet); upgrade if top/side title blocks are needed
export function detectTitleBlockTopNy(
  segments: Array<{ nx1: number; ny1: number; nx2: number; ny2: number }>,
  textItems: RawNormalizedText[]
): number {
  const anchorYs = textItems
    .filter((t) => {
      const u = t.text.toUpperCase();
      return t.ny > 0.7 && TITLE_BLOCK_KEYWORDS.some((kw) => u.includes(kw));
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

function collectSubpathRects(segments: InternalSegment[]): SheetBox[] {
  const bySubpath = new Map<number, InternalSegment[]>();
  for (const seg of segments) {
    if (!seg.subpathId) continue;
    const arr = bySubpath.get(seg.subpathId);
    if (arr) arr.push(seg);
    else bySubpath.set(seg.subpathId, [seg]);
  }

  const rects: SheetBox[] = [];
  for (const segs of bySubpath.values()) {
    if (segs.length !== 4) continue;
    let x1 = Infinity;
    let y1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    let hCount = 0;
    let vCount = 0;
    for (const s of segs) {
      const dx = Math.abs(s.nx2 - s.nx1);
      const dy = Math.abs(s.ny2 - s.ny1);
      if (dy <= 0.006 && dx >= 0.02) hCount++;
      else if (dx <= 0.006 && dy >= 0.02) vCount++;
      x1 = Math.min(x1, s.nx1, s.nx2);
      y1 = Math.min(y1, s.ny1, s.ny2);
      x2 = Math.max(x2, s.nx1, s.nx2);
      y2 = Math.max(y2, s.ny1, s.ny2);
    }
    if (hCount === 2 && vCount === 2 && Number.isFinite(x1)) {
      rects.push({ x1, y1, x2, y2 });
    }
  }
  return rects;
}

function detectSheetChromeContext(
  segments: InternalSegment[],
  textItems: RawNormalizedText[],
  titleBlockTopNy: number
): { borderRect: SheetBox | null; titleBlockRect: SheetBox | null } {
  const subpathRects = collectSubpathRects(segments);
  const borderCandidates: SheetBox[] = subpathRects.filter(
    (r) =>
      r.x2 - r.x1 >= 0.64 &&
      r.y2 - r.y1 >= 0.64 &&
      r.x1 <= 0.22 &&
      r.x2 >= 0.78 &&
      r.y1 <= 0.22 &&
      r.y2 >= 0.78
  );

  // Also detect frames formed by 4 independent long near-axis-aligned border lines
  const horiz = segments.filter(
    (s) => Math.abs(s.nx2 - s.nx1) >= 0.58 && Math.abs(s.ny2 - s.ny1) <= 0.008
  );
  const vert = segments.filter(
    (s) => Math.abs(s.ny2 - s.ny1) >= 0.58 && Math.abs(s.nx2 - s.nx1) <= 0.008
  );

  const tops = horiz.filter((s) => (s.ny1 + s.ny2) / 2 <= 0.22);
  const bots = horiz.filter((s) => (s.ny1 + s.ny2) / 2 >= 0.78);
  const lefts = vert.filter((s) => (s.nx1 + s.nx2) / 2 <= 0.22);
  const rights = vert.filter((s) => (s.nx1 + s.nx2) / 2 >= 0.78);

  const tol = 0.025;
  for (const t of tops) {
    const tx1 = Math.min(t.nx1, t.nx2);
    const tx2 = Math.max(t.nx1, t.nx2);
    const ty = (t.ny1 + t.ny2) / 2;
    for (const b of bots) {
      const bx1 = Math.min(b.nx1, b.nx2);
      const bx2 = Math.max(b.nx1, b.nx2);
      const by = (b.ny1 + b.ny2) / 2;
      if (Math.abs(tx1 - bx1) > tol || Math.abs(tx2 - bx2) > tol || by - ty < 0.64) continue;
      const hasLeft = lefts.some((l) => {
        const lx = (l.nx1 + l.nx2) / 2;
        const ly1 = Math.min(l.ny1, l.ny2);
        const ly2 = Math.max(l.ny1, l.ny2);
        return Math.abs(lx - tx1) <= tol && Math.abs(ly1 - ty) <= tol && Math.abs(ly2 - by) <= tol;
      });
      const hasRight = rights.some((r) => {
        const rx = (r.nx1 + r.nx2) / 2;
        const ry1 = Math.min(r.ny1, r.ny2);
        const ry2 = Math.max(r.ny1, r.ny2);
        return Math.abs(rx - tx2) <= tol && Math.abs(ry1 - ty) <= tol && Math.abs(ry2 - by) <= tol;
      });
      if (hasLeft && hasRight) {
        borderCandidates.push({
          x1: Math.min(tx1, bx1),
          y1: ty,
          x2: Math.max(tx2, bx2),
          y2: by,
        });
      }
    }
  }

  if (borderCandidates.length === 0) {
    return { borderRect: null, titleBlockRect: null };
  }

  // Pick outermost frame, then step inward if an ISO/SolidWorks concentric inner border exists
  let outerBorder = borderCandidates[0];
  let outerArea = (outerBorder.x2 - outerBorder.x1) * (outerBorder.y2 - outerBorder.y1);
  for (const c of borderCandidates) {
    const area = (c.x2 - c.x1) * (c.y2 - c.y1);
    if (area > outerArea) {
      outerBorder = c;
      outerArea = area;
    }
  }

  let borderRect = outerBorder;
  let innerArea = outerArea;
  for (const c of borderCandidates) {
    if (
      c.x1 > outerBorder.x1 + 0.003 &&
      c.x2 < outerBorder.x2 - 0.003 &&
      c.y1 > outerBorder.y1 + 0.003 &&
      c.y2 < outerBorder.y2 - 0.003 &&
      c.x1 - outerBorder.x1 <= 0.075 &&
      outerBorder.x2 - c.x2 <= 0.075 &&
      c.y1 - outerBorder.y1 <= 0.075 &&
      outerBorder.y2 - c.y2 <= 0.075
    ) {
      const area = (c.x2 - c.x1) * (c.y2 - c.y1);
      if (area < innerArea) {
        borderRect = c;
        innerArea = area;
      }
    }
  }

  // Detect title-block rectangle (either closed `re` box in bottom region or wide divider strip)
  const titleAnchorTexts = textItems.filter((t) => {
    const u = t.text.toUpperCase();
    return t.ny >= 0.62 && TITLE_BLOCK_KEYWORDS.some((kw) => u.includes(kw));
  });

  const tbRects = subpathRects.filter(
    (r) =>
      r.y1 >= 0.60 &&
      r.y2 <= borderRect.y2 + 0.02 &&
      r.y2 - r.y1 >= 0.05 &&
      r.y2 - r.y1 <= 0.40 &&
      r.x2 - r.x1 >= 0.18 &&
      (r.x2 - r.x1 < borderRect.x2 - borderRect.x1 - 0.02 || r.y1 >= 0.70) &&
      (titleAnchorTexts.length === 0 ||
        titleAnchorTexts.some(
          (t) => t.nx >= r.x1 - 0.02 && t.nx <= r.x2 + 0.02 && t.ny >= r.y1 - 0.02 && t.ny <= r.y2 + 0.02
        ))
  );

  let titleBlockRect: SheetBox | null = null;
  if (tbRects.length > 0) {
    titleBlockRect = tbRects.reduce((acc, r) => ({
      x1: Math.min(acc.x1, r.x1),
      y1: Math.min(acc.y1, r.y1),
      x2: Math.max(acc.x2, r.x2),
      y2: Math.max(acc.y2, r.y2),
    }));
  } else {
    const dividerLines = segments.filter((s) => {
      const spanX = Math.abs(s.nx2 - s.nx1);
      const spanY = Math.abs(s.ny2 - s.ny1);
      const midY = (s.ny1 + s.ny2) / 2;
      return spanX >= 0.40 && spanY <= 0.008 && midY >= 0.68 && midY <= borderRect.y2 - 0.03;
    });
    if (dividerLines.length > 0) {
      let tbX1 = Infinity;
      let tbY1 = Infinity;
      let tbX2 = -Infinity;
      for (const l of dividerLines) {
        tbX1 = Math.min(tbX1, l.nx1, l.nx2);
        tbX2 = Math.max(tbX2, l.nx1, l.nx2);
        tbY1 = Math.min(tbY1, l.ny1, l.ny2);
      }
      titleBlockRect = {
        x1: Math.max(borderRect.x1, tbX1),
        y1: Math.max(0.68, tbY1 - 0.004),
        x2: Math.min(borderRect.x2, tbX2),
        y2: borderRect.y2,
      };
    } else if (titleAnchorTexts.length > 0 || titleBlockTopNy < borderRect.y2 - 0.02) {
      titleBlockRect = {
        x1: borderRect.x1,
        y1: titleBlockTopNy,
        x2: borderRect.x2,
        y2: borderRect.y2,
      };
    }
  }

  return { borderRect, titleBlockRect };
}

function isSheetChromeSegment(
  seg: InternalSegment,
  titleBlockTopNy: number,
  chromeCtx?: { borderRect: SheetBox | null; titleBlockRect: SheetBox | null }
): boolean {
  const minNx = Math.min(seg.nx1, seg.nx2);
  const maxNx = Math.max(seg.nx1, seg.nx2);
  const minNy = Math.min(seg.ny1, seg.ny2);
  const maxNy = Math.max(seg.ny1, seg.ny2);
  const spanX = maxNx - minNx;
  const spanY = maxNy - minNy;

  if (chromeCtx?.borderRect) {
    const b = chromeCtx.borderRect;
    const tb = chromeCtx.titleBlockRect;
    const eps = 0.006;

    // On or outside the detected drawing border (including concentric margin zone ticks)
    if (
      minNx <= b.x1 + eps ||
      maxNx >= b.x2 - eps ||
      minNy <= b.y1 + eps ||
      maxNy >= b.y2 - eps
    ) {
      return true;
    }

    // Inside or bounding the title-block rectangle
    if (
      tb &&
      minNx >= tb.x1 - eps &&
      maxNx <= tb.x2 + eps &&
      minNy >= tb.y1 - eps &&
      maxNy <= tb.y2 + eps
    ) {
      return true;
    }

    return false;
  }

  // Fallback legacy heuristics when no sheet border rectangle is detected
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
      subpathId: 0,
      isFilled: false,
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

  let nextSubpathId = 1;
  const commitPathSegments = (pathSegs: InternalSegment[], isFilled = false) => {
    if (pathSegs.length === 0) return;
    const id = nextSubpathId++;
    const count = pathSegs.length;
    for (const s of pathSegs) {
      s.pathSegCount = count;
      s.subpathId = id;
      s.isFilled = isFilled;
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

  const isFilledPaintOp = (paintOp: number): boolean =>
    paintOp !== -1 &&
    ((typeof OPS.fill === 'number' && paintOp === OPS.fill) ||
      (typeof OPS.eoFill === 'number' && paintOp === OPS.eoFill) ||
      (typeof OPS.fillStroke === 'number' && paintOp === OPS.fillStroke) ||
      (typeof OPS.eoFillStroke === 'number' && paintOp === OPS.eoFillStroke) ||
      (typeof OPS.closeFillStroke === 'number' && paintOp === OPS.closeFillStroke) ||
      (typeof OPS.closeEOFillStroke === 'number' && paintOp === OPS.closeEOFillStroke));

  const isStrokedPaintOp = (paintOp: number): boolean =>
    paintOp !== -1 &&
    ((typeof OPS.stroke === 'number' && paintOp === OPS.stroke) ||
      (typeof OPS.closeStroke === 'number' && paintOp === OPS.closeStroke) ||
      (typeof OPS.fillStroke === 'number' && paintOp === OPS.fillStroke) ||
      (typeof OPS.eoFillStroke === 'number' && paintOp === OPS.eoFillStroke) ||
      (typeof OPS.closeFillStroke === 'number' && paintOp === OPS.closeFillStroke) ||
      (typeof OPS.closeEOFillStroke === 'number' && paintOp === OPS.closeEOFillStroke));

  const isDiscardPaintOp = (op: number): boolean =>
    (typeof OPS.fill === 'number' && op === OPS.fill) ||
    (typeof OPS.eoFill === 'number' && op === OPS.eoFill) ||
    (typeof OPS.endPath === 'number' && op === OPS.endPath);

  let pendingLegacySubpaths: InternalSegment[][] = [];
  let curLegacySegs: InternalSegment[] = [];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] || [];

    if (fn === OPS.save) {
      gStack.push(cloneState(gState));
    } else if (fn === OPS.restore) {
      if (gStack.length > 1) {
        gState = gStack.pop()!;
      }
    } else if (typeof OPS.paintFormXObjectBegin === 'number' && fn === OPS.paintFormXObjectBegin) {
      gStack.push(cloneState(gState));
      if (Array.isArray(args[0]) && args[0].length >= 6) {
        gState.cm = multiplyMatrix(gState.cm, args[0] as Matrix);
      }
    } else if (typeof OPS.paintFormXObjectEnd === 'number' && fn === OPS.paintFormXObjectEnd) {
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
    } else if (typeof OPS.setGState === 'number' && fn === OPS.setGState && Array.isArray(args[0])) {
      for (const entry of args[0]) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const [key, val] = entry;
        if (key === 'LW' && typeof val === 'number' && Number.isFinite(val)) {
          gState.lineWidth = val;
        } else if (key === 'D' && Array.isArray(val) && Array.isArray(val[0])) {
          gState.dashPattern = (val[0] as unknown[]).filter(
            (n): n is number => typeof n === 'number' && n > 0
          );
        }
      }
    } else if (fn === OPS.constructPath) {
      // pdfjs-dist v5+ packed DrawOPS format: args[0] = paintOp, args[1] = [Float32Array]
      if (
        typeof args[0] === 'number' &&
        Array.isArray(args[1]) &&
        args[1][0] &&
        typeof (args[1][0] as { length?: number }).length === 'number'
      ) {
        const paintOp = args[0];
        if (!isStrokedPaintOp(paintOp)) {
          continue; // Ignore clip-only (W n / endPath) and fill-only paths (including fill-only arrowheads)
        }
        const isFilled = isFilledPaintOp(paintOp);
        let pathSegs: InternalSegment[] = [];
        const arr = args[1][0] as Float32Array | number[];
        let k = 0;
        while (k < arr.length) {
          const sub = arr[k++];
          if (sub === 0) {
            if (pathSegs.length > 0) {
              commitPathSegments(pathSegs, isFilled);
              pathSegs = [];
            }
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
        commitPathSegments(pathSegs, isFilled);
      } else if (Array.isArray(args[0]) && Array.isArray(args[1])) {
        // Legacy constructPath(subOps, coords) waits for trailing paint op (stroke / fill / endPath)
        const subOps = args[0] as number[];
        const coords = args[1] as number[];
        const idxRef = { idx: 0 };
        for (const subOp of subOps) {
          if (subOp === OPS.moveTo && curLegacySegs.length > 0) {
            pendingLegacySubpaths.push(curLegacySegs);
            curLegacySegs = [];
          }
          handleLegacySubOp(subOp, coords, idxRef, curLegacySegs);
        }
      }
    } else if (
      fn === OPS.moveTo ||
      fn === OPS.lineTo ||
      fn === OPS.curveTo ||
      fn === OPS.curveTo2 ||
      fn === OPS.curveTo3 ||
      fn === OPS.closePath ||
      fn === OPS.rectangle
    ) {
      if ((fn === OPS.moveTo || fn === OPS.rectangle) && curLegacySegs.length > 0) {
        pendingLegacySubpaths.push(curLegacySegs);
        curLegacySegs = [];
      }
      handleLegacySubOp(fn, args as number[], { idx: 0 }, curLegacySegs);
      if (fn === OPS.rectangle && curLegacySegs.length > 0) {
        pendingLegacySubpaths.push(curLegacySegs);
        curLegacySegs = [];
      }
    } else if (isStrokedPaintOp(fn)) {
      if (curLegacySegs.length > 0) {
        pendingLegacySubpaths.push(curLegacySegs);
        curLegacySegs = [];
      }
      const filled = isFilledPaintOp(fn);
      for (const sub of pendingLegacySubpaths) {
        commitPathSegments(sub, filled);
      }
      pendingLegacySubpaths = [];
    } else if (isDiscardPaintOp(fn)) {
      pendingLegacySubpaths = [];
      curLegacySegs = [];
    }
  }

  return allInternalSegments;
}

function pointToSegMetrics(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { dist: number; tClamped: number; tRaw: number; len: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const len = Math.sqrt(lenSq);
  if (lenSq <= 1e-9) {
    return { dist: Math.hypot(px - x1, py - y1), tClamped: 0, tRaw: 0, len: 0 };
  }
  const tRaw = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  const tClamped = Math.max(0, Math.min(1, tRaw));
  const projX = x1 + tClamped * dx;
  const projY = y1 + tClamped * dy;
  return { dist: Math.hypot(px - projX, py - projY), tClamped, tRaw, len };
}

function isDimensionTextToken(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /^\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?$/.test(trimmed)) return false;
  return (
    /^(?:[ØøRrMm±]?\s*\d{1,5}(?:\.\d+)?(?:\s*[°"'])?|\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?)$/i.test(
      trimmed
    ) || /(?:[Øø°±]\s*\d|\d\s*[Øø°±])/.test(trimmed)
  );
}

// shortcut: detects CAD wedge/V-tick arrowheads by subpath shape (<=6.5mm, acute tip 8°-60°) + dim-text/pair anchoring; upgrade if curved/dot tick terminators are needed
function promoteDimensionGeometry(
  segments: InternalSegment[],
  layers: CadLayer[],
  textItems: RawNormalizedText[],
  titleBlockTopNy: number,
  pageWmm: number,
  pageHmm: number,
  primaryOutlineWidth: number
): void {
  if (segments.length === 0) return;

  const coords = segments.map((s) => {
    const x1 = s.nx1 * pageWmm;
    const y1 = s.ny1 * pageHmm;
    const x2 = s.nx2 * pageWmm;
    const y2 = s.ny2 * pageHmm;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1e-6;
    return { x1, y1, x2, y2, dx, dy, ux: dx / len, uy: dy / len, len };
  });

  const dimTexts = textItems
    .filter((t) => t.ny < titleBlockTopNy && isDimensionTextToken(t.text))
    .map((t) => ({ x: t.nx * pageWmm, y: t.ny * pageHmm }));

  // 1. Group into subpaths to detect any-color arrowheads (triangles or V-ticks)
  const subpathMap = new Map<number, number[]>();
  for (let i = 0; i < segments.length; i++) {
    const sid = segments[i].subpathId || -(i + 1);
    const list = subpathMap.get(sid);
    if (list) list.push(i);
    else subpathMap.set(sid, [i]);
  }

  interface ArrowCandidate {
    segIndices: number[];
    tipX: number;
    tipY: number;
    axisX: number; // unit vector pointing from tip toward tail/base
    axisY: number;
    confirmed: boolean;
  }

  const arrows: ArrowCandidate[] = [];
  const arrowSegSet = new Set<number>();

  for (const idxs of subpathMap.values()) {
    if (idxs.length < 2 || idxs.length > 4) continue;
    if (segments[idxs[0]].isDashed) continue;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxLen = 0;
    for (const idx of idxs) {
      const c = coords[idx];
      minX = Math.min(minX, c.x1, c.x2);
      minY = Math.min(minY, c.y1, c.y2);
      maxX = Math.max(maxX, c.x1, c.x2);
      maxY = Math.max(maxY, c.y1, c.y2);
      maxLen = Math.max(maxLen, c.len);
    }
    const span = Math.max(maxX - minX, maxY - minY);
    if (span < 0.65 || span > 6.5 || maxLen > 6.5) continue;

    // Collect endpoints and test acute wedge vertices formed by two segments meeting at a tip
    const pts: Array<{ x: number; y: number; others: Array<{ x: number; y: number; len: number }> }> = [];
    for (const idx of idxs) {
      const c = coords[idx];
      const addEnd = (px: number, py: number, ox: number, oy: number) => {
        const existing = pts.find((p) => Math.hypot(p.x - px, p.y - py) <= 0.35);
        if (existing) existing.others.push({ x: ox, y: oy, len: c.len });
        else pts.push({ x: px, y: py, others: [{ x: ox, y: oy, len: c.len }] });
      };
      addEnd(c.x1, c.y1, c.x2, c.y2);
      addEnd(c.x2, c.y2, c.x1, c.y1);
    }

    let bestTip: ArrowCandidate | null = null;
    for (const p of pts) {
      if (p.others.length !== 2) continue;
      const [a, b] = p.others;
      if (a.len < 0.6 || b.len < 0.6) continue;
      const v1x = (a.x - p.x) / a.len;
      const v1y = (a.y - p.y) / a.len;
      const v2x = (b.x - p.x) / b.len;
      const v2y = (b.y - p.y) / b.len;
      const cosA = v1x * v2x + v1y * v2y;
      // Acute CAD arrowhead angle ~10°..58° (cos between 0.53 and 0.985)
      if (cosA >= 0.53 && cosA <= 0.988) {
        const bx = v1x + v2x;
        const by = v1y + v2y;
        const bLen = Math.hypot(bx, by);
        if (bLen > 1e-4) {
          bestTip = {
            segIndices: idxs,
            tipX: p.x,
            tipY: p.y,
            axisX: bx / bLen,
            axisY: by / bLen,
            confirmed: false,
          };
          break;
        }
      }
    }

    // Require open 2-seg ticks or closed/filled 3-4 seg wedges to avoid stray open corners
    const isClosedOrFilled = segments[idxs[0]].isFilled || pts.every((p) => p.others.length >= 2);
    if (bestTip && (idxs.length === 2 || isClosedOrFilled)) {
      arrows.push(bestTip);
      for (const idx of idxs) arrowSegSet.add(idx);
    }
  }

  if (arrows.length === 0) return;

  // 2. Link arrowheads to collinear dimension/leader lines and anchor via dim text or opposing pairs
  const arrowToLineIdx = new Map<number, number>();
  const lineToArrows = new Map<number, number[]>();

  for (let ai = 0; ai < arrows.length; ai++) {
    const ar = arrows[ai];
    let bestLine = -1;
    let bestScore = Infinity;
    for (let si = 0; si < segments.length; si++) {
      if (arrowSegSet.has(si) || segments[si].isDashed) continue;
      const c = coords[si];
      if (c.len < 2.2) continue;
      const align = Math.abs(c.ux * ar.axisX + c.uy * ar.axisY);
      if (align < 0.90) continue;
      const m = pointToSegMetrics(ar.tipX, ar.tipY, c.x1, c.y1, c.x2, c.y2);
      if (m.dist <= 1.6 && m.tRaw >= -0.2 && m.tRaw <= 1.2) {
        if (m.dist < bestScore) {
          bestScore = m.dist;
          bestLine = si;
        }
      }
    }
    if (bestLine !== -1) {
      arrowToLineIdx.set(ai, bestLine);
      const list = lineToArrows.get(bestLine);
      if (list) list.push(ai);
      else lineToArrows.set(bestLine, [ai]);
    }
  }

  const nearDimText = (x: number, y: number, maxDist: number) =>
    dimTexts.some((t) => Math.hypot(t.x - x, t.y - y) <= maxDist);

  const lineNearDimText = (si: number, maxDist: number) => {
    const c = coords[si];
    return dimTexts.some((t) => pointToSegMetrics(t.x, t.y, c.x1, c.y1, c.x2, c.y2).dist <= maxDist);
  };

  for (let ai = 0; ai < arrows.length; ai++) {
    const ar = arrows[ai];
    const attachedLine = arrowToLineIdx.get(ai);
    const hasPairedArrow =
      (attachedLine !== undefined && (lineToArrows.get(attachedLine)?.length ?? 0) >= 2) ||
      arrows.some((other, oi) => {
        if (oi === ai) return false;
        const dotAxis = ar.axisX * other.axisX + ar.axisY * other.axisY;
        if (dotAxis > -0.88) return false;
        const dx = other.tipX - ar.tipX;
        const dy = other.tipY - ar.tipY;
        const span = Math.hypot(dx, dy);
        if (span < 3 || span > 260) return false;
        const perp = Math.abs(dx * -ar.axisY + dy * ar.axisX);
        return perp <= 2.2;
      });

    const hasTextAnchor =
      nearDimText(ar.tipX, ar.tipY, 26) ||
      (attachedLine !== undefined && lineNearDimText(attachedLine, 12));

    if (hasPairedArrow || hasTextAnchor) {
      ar.confirmed = true;
    }
  }

  const confirmedArrows = arrows.filter((a) => a.confirmed);
  if (confirmedArrows.length === 0) return;

  const promotedLines = new Set<number>();

  for (let ai = 0; ai < arrows.length; ai++) {
    const ar = arrows[ai];
    if (!ar.confirmed) continue;
    for (const idx of ar.segIndices) layers[idx] = 'dimension';
    const si = arrowToLineIdx.get(ai);
    if (si !== undefined) {
      layers[si] = 'dimension';
      promotedLines.add(si);
    }
  }

  // Promote leader text shelves / gap-split collinear span lines attached to confirmed dimension lines
  const basePromoted = Array.from(promotedLines);
  for (const di of basePromoted) {
    const dc = coords[di];
    for (let si = 0; si < segments.length; si++) {
      if (arrowSegSet.has(si) || layers[si] === 'dimension' || segments[si].isDashed) continue;
      if (segments[si].pathSegCount > 2) continue;
      const c = coords[si];
      const touchesStart = Math.hypot(c.x1 - dc.x1, c.y1 - dc.y1) <= 1.2 || Math.hypot(c.x1 - dc.x2, c.y1 - dc.y2) <= 1.2;
      const touchesEnd = Math.hypot(c.x2 - dc.x1, c.y2 - dc.y1) <= 1.2 || Math.hypot(c.x2 - dc.x2, c.y2 - dc.y2) <= 1.2;
      if ((touchesStart || touchesEnd) && c.len <= 28 && lineNearDimText(si, 8)) {
        layers[si] = 'dimension';
        promotedLines.add(si);
        continue;
      }
      // Gap-split dimension line bridging numeric text
      if (
        Math.abs(c.ux * dc.ux + c.uy * dc.uy) >= 0.96 &&
        pointToSegMetrics(c.x1, c.y1, dc.x1, dc.y1, dc.x2, dc.y2).dist <= 18 &&
        Math.abs((c.x1 - dc.x1) * -dc.uy + (c.y1 - dc.y1) * dc.ux) <= 1.0 &&
        lineNearDimText(si, 12)
      ) {
        layers[si] = 'dimension';
        promotedLines.add(si);
      }
    }
  }

  // 3. Detect orthogonal extension (witness) lines framing confirmed arrowheads
  for (let si = 0; si < segments.length; si++) {
    if (arrowSegSet.has(si) || layers[si] === 'dimension' || segments[si].isDashed) continue;
    if (segments[si].pathSegCount > 2) continue;
    const c = coords[si];
    if (c.len < 2.0) continue;

    const isThin = segments[si].effLineWidth <= primaryOutlineWidth * 0.90;
    const isWitness = confirmedArrows.some((ar) => {
      const cosOrth = Math.abs(c.ux * ar.axisX + c.uy * ar.axisY);
      if (cosOrth > 0.42) return false; // requires ~65°..115° to dimension axis
      const m = pointToSegMetrics(ar.tipX, ar.tipY, c.x1, c.y1, c.x2, c.y2);
      if (m.dist > 1.8) return false;
      const distFromNearestEnd = Math.min(m.tClamped, 1 - m.tClamped) * c.len;
      const hasWitnessOvershoot = distFromNearestEnd >= 0.35 && distFromNearestEnd <= 5.2;
      return hasWitnessOvershoot || (isThin && distFromNearestEnd <= 5.5);
    });

    if (isWitness) {
      layers[si] = 'dimension';
    }
  }
}

interface CollinearEndpoint {
  xMm: number;
  yMm: number;
  nx: number;
  ny: number;
}

function makeStrokeStyleKey(seg: InternalSegment): string {
  return `${seg.effLineWidth.toFixed(2)}:${seg.strokeLuminance.toFixed(2)}:${seg.isDashed ? 1 : 0}`;
}

function mergeCollinearSegments(segments: RawNormalizedSegment[]): RawNormalizedSegment[] {
  if (segments.length <= 1) return segments;

  const groups = new Map<string, RawNormalizedSegment[]>();
  for (const s of segments) {
    const key = `${s.layerHint || 'outline'}|${s.strokeStyleKey || 'default'}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  }

  const out: RawNormalizedSegment[] = [];

  for (const group of groups.values()) {
    if (group.length <= 1) {
      for (const s of group) out.push(s);
      continue;
    }

    interface LineItem {
      angleBucket: number;
      ux: number;
      uy: number;
      d: number;
      minT: number;
      maxT: number;
      pMin: CollinearEndpoint;
      pMax: CollinearEndpoint;
      layerHint?: CadLayer;
      strokeStyleKey?: string;
    }

    const items: LineItem[] = [];
    for (const s of group) {
      const dx = s.x2Mm - s.x1Mm;
      const dy = s.y2Mm - s.y1Mm;
      const len = Math.hypot(dx, dy);
      if (len <= 1e-4) continue;
      let ux = dx / len;
      let uy = dy / len;
      if (ux < -1e-6 || (Math.abs(ux) <= 1e-6 && uy < 0)) {
        ux = -ux;
        uy = -uy;
      }
      let deg = (Math.atan2(uy, ux) * 180) / Math.PI;
      if (deg < 0) deg += 180;
      if (deg >= 179.75) deg = 0;
      const angleBucket = Math.round(deg * 2) % 360;
      const nX = -uy;
      const nY = ux;
      const d = s.x1Mm * nX + s.y1Mm * nY;
      const t1 = s.x1Mm * ux + s.y1Mm * uy;
      const t2 = s.x2Mm * ux + s.y2Mm * uy;
      const e1: CollinearEndpoint = { xMm: s.x1Mm, yMm: s.y1Mm, nx: s.nx1, ny: s.ny1 };
      const e2: CollinearEndpoint = { xMm: s.x2Mm, yMm: s.y2Mm, nx: s.nx2, ny: s.ny2 };
      const [minT, pMin, maxT, pMax] = t1 <= t2 ? [t1, e1, t2, e2] : [t2, e2, t1, e1];
      items.push({
        angleBucket,
        ux,
        uy,
        d,
        minT,
        maxT,
        pMin,
        pMax,
        layerHint: s.layerHint,
        strokeStyleKey: s.strokeStyleKey,
      });
    }

    items.sort((a, b) =>
      a.angleBucket !== b.angleBucket
        ? a.angleBucket - b.angleBucket
        : Math.abs(a.d - b.d) > 0.05
          ? a.d - b.d
          : a.minT - b.minT
    );

    const active: LineItem[] = [];
    const flushItem = (it: LineItem) => {
      out.push({
        nx1: it.pMin.nx,
        ny1: it.pMin.ny,
        nx2: it.pMax.nx,
        ny2: it.pMax.ny,
        x1Mm: Number(it.pMin.xMm.toFixed(3)),
        y1Mm: Number(it.pMin.yMm.toFixed(3)),
        x2Mm: Number(it.pMax.xMm.toFixed(3)),
        y2Mm: Number(it.pMax.yMm.toFixed(3)),
        layerHint: it.layerHint,
        strokeStyleKey: it.strokeStyleKey,
      });
    };

    for (const it of items) {
      while (
        active.length > 0 &&
        (active[0].angleBucket !== it.angleBucket || it.d - active[0].d > 0.06)
      ) {
        flushItem(active.shift()!);
      }

      let merged = false;
      for (let ai = active.length - 1; ai >= 0; ai--) {
        const cur = active[ai];
        const dot = cur.ux * it.ux + cur.uy * it.uy;
        if (Math.abs(dot) < 0.9999) continue;
        const cNx = -cur.uy;
        const cNy = cur.ux;
        const perp1 = Math.abs((it.pMin.xMm - cur.pMin.xMm) * cNx + (it.pMin.yMm - cur.pMin.yMm) * cNy);
        const perp2 = Math.abs((it.pMax.xMm - cur.pMin.xMm) * cNx + (it.pMax.yMm - cur.pMin.yMm) * cNy);
        if (perp1 > 0.045 || perp2 > 0.045) continue;
        if (it.minT <= cur.maxT + 0.06 && it.maxT >= cur.minT - 0.06) {
          if (it.minT < cur.minT) {
            cur.minT = it.minT;
            cur.pMin = it.pMin;
          }
          if (it.maxT > cur.maxT) {
            cur.maxT = it.maxT;
            cur.pMax = it.pMax;
          }
          merged = true;
          break;
        }
      }
      if (!merged) active.push(it);
    }

    for (const rem of active) flushItem(rem);
  }

  return out;
}

function compactSegmentsForCap(
  segments: RawNormalizedSegment[],
  cap: number,
  scaleFactor = 1
): { segments: RawNormalizedSegment[]; truncated: boolean; droppedSegmentCount: number } {
  const merged = mergeCollinearSegments(segments);
  if (merged.length <= cap) {
    return { segments: merged, truncated: false, droppedSegmentCount: 0 };
  }

  const longSegs: Array<{ seg: RawNormalizedSegment; lenMm: number }> = [];
  const shortSegs: Array<{ seg: RawNormalizedSegment; lenMm: number }> = [];
  const effScale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;

  for (const seg of merged) {
    const lenMm = Math.hypot(seg.x2Mm - seg.x1Mm, seg.y2Mm - seg.y1Mm);
    if (lenMm * effScale >= 1.0) {
      longSegs.push({ seg, lenMm });
    } else {
      shortSegs.push({ seg, lenMm });
    }
  }

  let retained: RawNormalizedSegment[];
  if (longSegs.length <= cap) {
    shortSegs.sort((a, b) => b.lenMm - a.lenMm);
    const shortBudget = cap - longSegs.length;
    retained = longSegs.map((x) => x.seg);
    for (let i = 0; i < shortBudget && i < shortSegs.length; i++) {
      retained.push(shortSegs[i].seg);
    }
  } else {
    // shortcut: enforces cap by dropping shortest >=1mm segments when >cap macro segments exist; raise MAX_*_VECTOR_SEGMENTS if denser sheets need more
    longSegs.sort((a, b) => b.lenMm - a.lenMm);
    retained = longSegs.slice(0, cap).map((x) => x.seg);
  }

  const droppedSegmentCount = Math.max(0, merged.length - retained.length);
  return {
    segments: retained,
    truncated: droppedSegmentCount > 0,
    droppedSegmentCount,
  };
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
  truncated: boolean;
  droppedSegmentCount: number;
} {
  const titleBlockTopNy = detectTitleBlockTopNy(allInternalSegments, rawNormalizedTextItems);
  const chromeCtx = detectSheetChromeContext(
    allInternalSegments,
    rawNormalizedTextItems,
    titleBlockTopNy
  );
  const drawingSegments = allInternalSegments.filter(
    (seg) => !isSheetChromeSegment(seg, titleBlockTopNy, chromeCtx)
  );

  const darkWidths = drawingSegments
    .filter((s) => s.strokeLuminance < 0.28 && !s.isDashed)
    .map((s) => s.effLineWidth);
  const primaryOutlineWidth = darkWidths.length > 0 ? Math.max(...darkWidths) : 0.6;

  const drawingLayers = drawingSegments.map((seg) => classifySegmentLayer(seg, primaryOutlineWidth));
  promoteDimensionGeometry(
    drawingSegments,
    drawingLayers,
    rawNormalizedTextItems,
    titleBlockTopNy,
    pageWidthPt * PT_TO_MM,
    pageHeightPt * PT_TO_MM,
    primaryOutlineWidth
  );

  const allNormalizedSegments: RawNormalizedSegment[] = drawingSegments.map((seg, idx) => ({
    nx1: seg.nx1,
    ny1: seg.ny1,
    nx2: seg.nx2,
    ny2: seg.ny2,
    x1Mm: seg.x1Mm,
    y1Mm: seg.y1Mm,
    x2Mm: seg.x2Mm,
    y2Mm: seg.y2Mm,
    layerHint: drawingLayers[idx],
    strokeStyleKey: makeStrokeStyleKey(seg),
  }));

  const prelimTitleMeta = parseTitleBlockMetadata(rawNormalizedTextItems, allNormalizedSegments);
  const compactedTotal = compactSegmentsForCap(
    allNormalizedSegments,
    MAX_TOTAL_VECTOR_SEGMENTS,
    prelimTitleMeta.scaleFactor || 1
  );
  const retainedSegs = compactedTotal.segments;

  const titleBlockMeta = parseTitleBlockMetadata(rawNormalizedTextItems, retainedSegs);
  const detectedSpecs = detectViewRegions(
    retainedSegs,
    rawNormalizedTextItems,
    titleBlockTopNy,
    { width: pageWidthPt * PT_TO_MM, height: pageHeightPt * PT_TO_MM }
  );
  const chunkBuild = buildViewChunksWithStats(
    detectedSpecs,
    pageNumber,
    pageWidthPt,
    pageHeightPt,
    retainedSegs,
    rawNormalizedTextItems,
    cropImage,
    titleBlockMeta.scaleFactor || 1
  );
  const viewChunks = chunkBuild.chunks;
  const calibrated = calibrateScaleFromViewChunks(viewChunks, titleBlockMeta);

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

  const droppedSegmentCount = compactedTotal.droppedSegmentCount + chunkBuild.droppedSegmentCount;

  return {
    rawNormalizedSegments: retainedSegs,
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
    truncated: droppedSegmentCount > 0,
    droppedSegmentCount,
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

const VIEW_MERGE_GAP_MM = 8;
const MAX_VIEW_GRID_DIM = 192;

function inferSheetSizeMm(segments: RawNormalizedSegment[]): { width: number; height: number } {
  let sumDxMm = 0;
  let sumDnx = 0;
  let sumDyMm = 0;
  let sumDny = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const dnx = Math.abs(s.nx2 - s.nx1);
    const dny = Math.abs(s.ny2 - s.ny1);
    const dxMm = Math.abs(s.x2Mm - s.x1Mm);
    const dyMm = Math.abs(s.y2Mm - s.y1Mm);
    if (dnx >= 1e-4 && dxMm > 0) {
      sumDnx += dnx;
      sumDxMm += dxMm;
    }
    if (dny >= 1e-4 && dyMm > 0) {
      sumDny += dny;
      sumDyMm += dyMm;
    }
  }
  const rawW = sumDnx > 0 ? sumDxMm / sumDnx : 297;
  const rawH = sumDny > 0 ? sumDyMm / sumDny : 210;
  return {
    width: Math.max(40, Math.min(4000, rawW)),
    height: Math.max(40, Math.min(4000, rawH)),
  };
}

export function detectViewRegions(
  segments: RawNormalizedSegment[],
  textItems: RawNormalizedText[],
  titleBlockTopNy: number,
  sheetSizeMm: { width: number; height: number } | undefined = undefined
): Array<{ normBounds: NormalizedRect; viewKind: ViewChunkKind; label: string }> {
  const structuralIndices: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].layerHint !== 'dimension') {
      structuralIndices.push(i);
    }
  }

  const useStructural = structuralIndices.length >= 6;
  const n = useStructural ? structuralIndices.length : segments.length;

  if (n === 0) {
    return [
      {
        normBounds: { x: 0.05, y: 0.06, w: 0.9, h: Math.max(0.4, titleBlockTopNy - 0.08) },
        viewKind: 'orthogonal',
        label: 'Primary Drawing View',
      },
    ];
  }

  const resolvedSize = sheetSizeMm ?? inferSheetSizeMm(segments);
  const gapX = Math.max(0.004, Math.min(0.15, VIEW_MERGE_GAP_MM / Math.max(1, resolvedSize.width)));
  const gapY = Math.max(0.004, Math.min(0.15, VIEW_MERGE_GAP_MM / Math.max(1, resolvedSize.height)));

  const cellW = Math.max(gapX, 1 / MAX_VIEW_GRID_DIM);
  const cellH = Math.max(gapY, 1 / MAX_VIEW_GRID_DIM);
  const cols = Math.min(MAX_VIEW_GRID_DIM, Math.max(1, Math.ceil(1 / cellW)));
  const rows = Math.min(MAX_VIEW_GRID_DIM, Math.max(1, Math.ceil(1 / cellH)));
  const gridSize = cols * rows;

  const parent = new Int32Array(n);
  const size = new Int32Array(n);
  const minX = new Float32Array(n);
  const minY = new Float32Array(n);
  const maxX = new Float32Array(n);
  const maxY = new Float32Array(n);
  const lenSum = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const s = segments[useStructural ? structuralIndices[i] : i];
    parent[i] = i;
    size[i] = 1;
    minX[i] = s.nx1 < s.nx2 ? s.nx1 : s.nx2;
    minY[i] = s.ny1 < s.ny2 ? s.ny1 : s.ny2;
    maxX[i] = s.nx1 > s.nx2 ? s.nx1 : s.nx2;
    maxY[i] = s.ny1 > s.ny2 ? s.ny1 : s.ny2;
    lenSum[i] = Math.hypot(s.x2Mm - s.x1Mm, s.y2Mm - s.y1Mm);
  }

  const find = (x: number): number => {
    let cur = x;
    while (parent[cur] !== cur) {
      parent[cur] = parent[parent[cur]];
      cur = parent[cur];
    }
    return cur;
  };

  const union = (a: number, b: number): number => {
    let ra = find(a);
    let rb = find(b);
    if (ra === rb) return ra;
    if (size[ra] < size[rb]) {
      const tmp = ra;
      ra = rb;
      rb = tmp;
    }
    parent[rb] = ra;
    size[ra] += size[rb];
    if (minX[rb] < minX[ra]) minX[ra] = minX[rb];
    if (minY[rb] < minY[ra]) minY[ra] = minY[rb];
    if (maxX[rb] > maxX[ra]) maxX[ra] = maxX[rb];
    if (maxY[rb] > maxY[ra]) maxY[ra] = maxY[rb];
    lenSum[ra] += lenSum[rb];
    return ra;
  };

  const cellRep = new Int32Array(gridSize).fill(-1);
  const cellMinX = new Float32Array(gridSize).fill(Infinity);
  const cellMinY = new Float32Array(gridSize).fill(Infinity);
  const cellMaxX = new Float32Array(gridSize).fill(-Infinity);
  const cellMaxY = new Float32Array(gridSize).fill(-Infinity);

  // Uniform grid pass: segments sharing a (gapX x gapY) cell are within (gapX, gapY)
  for (let i = 0; i < n; i++) {
    const sx1 = minX[i];
    const sy1 = minY[i];
    const sx2 = maxX[i];
    const sy2 = maxY[i];
    const c1 = Math.min(cols - 1, Math.max(0, Math.floor(sx1 / cellW)));
    const c2 = Math.min(cols - 1, Math.max(0, Math.floor(sx2 / cellW)));
    const r1 = Math.min(rows - 1, Math.max(0, Math.floor(sy1 / cellH)));
    const r2 = Math.min(rows - 1, Math.max(0, Math.floor(sy2 / cellH)));

    for (let r = r1; r <= r2; r++) {
      const rowBase = r * cols;
      const cellY0 = r * cellH;
      const cellY1 = cellY0 + cellH;
      const cy1 = sy1 > cellY0 ? sy1 : cellY0;
      const cy2 = sy2 < cellY1 ? sy2 : cellY1;
      for (let c = c1; c <= c2; c++) {
        const cellIdx = rowBase + c;
        const cellX0 = c * cellW;
        const cellX1 = cellX0 + cellW;
        const cx1 = sx1 > cellX0 ? sx1 : cellX0;
        const cx2 = sx2 < cellX1 ? sx2 : cellX1;
        if (cx1 < cellMinX[cellIdx]) cellMinX[cellIdx] = cx1;
        if (cx2 > cellMaxX[cellIdx]) cellMaxX[cellIdx] = cx2;
        if (cy1 < cellMinY[cellIdx]) cellMinY[cellIdx] = cy1;
        if (cy2 > cellMaxY[cellIdx]) cellMaxY[cellIdx] = cy2;
        const rep = cellRep[cellIdx];
        if (rep === -1) {
          cellRep[cellIdx] = i;
        } else {
          union(i, rep);
        }
      }
    }
  }

  // Forward-neighbor pass catches pairs within (gapX, gapY) across cell boundaries without quantization overshoot
  const neighborOffsets: Array<[number, number]> = [
    [1, 0],
    [0, 1],
    [1, 1],
    [-1, 1],
  ];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idxA = r * cols + c;
      const repA = cellRep[idxA];
      if (repA === -1) continue;
      const ax1 = cellMinX[idxA];
      const ay1 = cellMinY[idxA];
      const ax2 = cellMaxX[idxA];
      const ay2 = cellMaxY[idxA];
      for (let k = 0; k < 4; k++) {
        const nc = c + neighborOffsets[k][0];
        const nr = r + neighborOffsets[k][1];
        if (nc < 0 || nc >= cols || nr >= rows) continue;
        const idxB = nr * cols + nc;
        const repB = cellRep[idxB];
        if (repB === -1 || find(repA) === find(repB)) continue;
        const bx1 = cellMinX[idxB];
        const by1 = cellMinY[idxB];
        const bx2 = cellMaxX[idxB];
        const by2 = cellMaxY[idxB];
        if (!(ax2 + gapX < bx1 || bx2 + gapX < ax1 || ay2 + gapY < by1 || by2 + gapY < ay1)) {
          union(repA, repB);
        }
      }
    }
  }

  // Sweep-and-prune pass merges isolated interior features (e.g. concentric holes) enclosed in outer view bboxes
  const rawRoots: number[] = [];
  for (let i = 0; i < n; i++) {
    if (parent[i] === i) rawRoots.push(i);
  }
  let sweepMerged = true;
  let activeRoots = rawRoots;
  while (sweepMerged && activeRoots.length > 1) {
    sweepMerged = false;
    activeRoots.sort((a, b) => minX[a] - minX[b]);
    const nextRoots: number[] = [];
    for (let idx = 0; idx < activeRoots.length; idx++) {
      let cur = find(activeRoots[idx]);
      if (cur !== activeRoots[idx]) continue;
      for (let j = idx + 1; j < activeRoots.length; j++) {
        const other = find(activeRoots[j]);
        if (other === cur) continue;
        if (minX[other] > maxX[cur] + gapX) break;
        if (!(maxY[cur] + gapY < minY[other] || maxY[other] + gapY < minY[cur])) {
          cur = union(cur, other);
          sweepMerged = true;
        }
      }
      nextRoots.push(cur);
    }
    activeRoots = nextRoots;
  }

  interface ClusterSummary {
    root: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    count: number;
    lenSum: number;
  }

  const significantAll: ClusterSummary[] = [];
  for (const r of activeRoots) {
    const root = find(r);
    if (root !== r) continue;
    const x1 = minX[root];
    const y1 = minY[root];
    const x2 = maxX[root];
    const y2 = maxY[root];
    if (size[root] >= 3 && (x2 - x1 >= 0.04 || y2 - y1 >= 0.04)) {
      significantAll.push({
        root,
        x1,
        y1,
        x2,
        y2,
        count: size[root],
        lenSum: lenSum[root],
      });
    }
  }

  if (significantAll.length === 0) {
    return [
      {
        normBounds: { x: 0.05, y: 0.06, w: 0.9, h: Math.max(0.4, titleBlockTopNy - 0.08) },
        viewKind: 'orthogonal',
        label: 'Primary Drawing View',
      },
    ];
  }

  significantAll.sort((a, b) => {
    const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
    const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
    if (Math.abs(areaB - areaA) > 1e-6) return areaB - areaA;
    return b.lenSum - a.lenSum;
  });

  const significant = significantAll
    .slice(0, 6)
    .sort((a, b) => (Math.abs(a.y1 - b.y1) > 0.14 ? a.y1 - b.y1 : a.x1 - b.x1));

  const rootToSelected = new Map<number, number>();
  const clusterSegBuckets: RawNormalizedSegment[][] = significant.map((c, idx) => {
    rootToSelected.set(c.root, idx);
    return [];
  });
  for (let i = 0; i < n; i++) {
    const selIdx = rootToSelected.get(find(i));
    if (selIdx !== undefined) {
      clusterSegBuckets[selIdx].push(segments[useStructural ? structuralIndices[i] : i]);
    }
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

    const classified = classifyViewFromFeatures(nearbyTokens, normBounds, clusterSegBuckets[idx], idx);
    return {
      normBounds,
      viewKind: classified.viewKind,
      label: classified.label,
    };
  });
}

function buildViewChunksWithStats(
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
  cropImage: (normBounds: NormalizedRect) => string,
  scaleFactor = 1
): { chunks: PdfViewChunk[]; droppedSegmentCount: number } {
  const pageWmm = pageWidthPt * PT_TO_MM;
  const pageHmm = pageHeightPt * PT_TO_MM;
  let droppedSegmentCount = 0;

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

  const chunks = specs.map((spec, idx) => {
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

    const compactedChunk = compactSegmentsForCap(
      chunkBuckets[idx],
      MAX_CHUNK_VECTOR_SEGMENTS,
      scaleFactor
    );
    droppedSegmentCount += compactedChunk.droppedSegmentCount;
    const enclosedSegs = compactedChunk.segments;

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

    const vectorEntities: CadEntity[] = enclosedSegs.map((s, sIdx) => ({
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

  return { chunks, droppedSegmentCount };
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
  return buildViewChunksWithStats(
    specs,
    pageNumber,
    pageWidthPt,
    pageHeightPt,
    segments,
    textItems,
    cropImage
  ).chunks;
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
