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
  scale?: number;
  transform?: number[];
  viewBox?: number[];
  rotation?: number;
  convertToViewportPoint?(x: number, y: number): number[];
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

  let minAnchorY = Infinity;
  for (let i = 0; i < anchorYs.length; i++) {
    if (anchorYs[i] < minAnchorY) minAnchorY = anchorYs[i];
  }
  let minWideY = Infinity;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const spanX = Math.abs(s.nx2 - s.nx1);
    const spanY = Math.abs(s.ny2 - s.ny1);
    const midY = (s.ny1 + s.ny2) / 2;
    if (spanX > 0.48 && spanY < 0.01 && midY >= 0.7 && midY <= minAnchorY + 0.015) {
      const topY = s.ny1 < s.ny2 ? s.ny1 : s.ny2;
      if (topY < minWideY) minWideY = topY;
    }
  }

  if (Number.isFinite(minWideY)) {
    return Math.max(0.7, minWideY - 0.004);
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

interface TransientArrowHint {
  tipNx: number;
  tipNy: number;
  tailNx: number;
  tailNy: number;
}

const fillOnlyArrowHintsMap = new WeakMap<InternalSegment[], TransientArrowHint[]>();

function detectArrowTipInSmallSubpath(segs: InternalSegment[]): TransientArrowHint | null {
  if (segs.length < 2 || segs.length > 4) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxLen = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.x1Mm < minX) minX = s.x1Mm;
    if (s.x2Mm < minX) minX = s.x2Mm;
    if (s.y1Mm < minY) minY = s.y1Mm;
    if (s.y2Mm < minY) minY = s.y2Mm;
    if (s.x1Mm > maxX) maxX = s.x1Mm;
    if (s.x2Mm > maxX) maxX = s.x2Mm;
    if (s.y1Mm > maxY) maxY = s.y1Mm;
    if (s.y2Mm > maxY) maxY = s.y2Mm;
    if (s.lenMm > maxLen) maxLen = s.lenMm;
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (span < 0.65 || span > 6.5 || maxLen > 6.5) return null;

  const pts: Array<{
    x: number;
    y: number;
    nx: number;
    ny: number;
    others: Array<{ x: number; y: number; nx: number; ny: number; len: number }>;
  }> = [];
  for (const s of segs) {
    const addEnd = (px: number, py: number, pnx: number, pny: number, ox: number, oy: number, onx: number, ony: number) => {
      const existing = pts.find((p) => Math.hypot(p.x - px, p.y - py) <= 0.35);
      if (existing) existing.others.push({ x: ox, y: oy, nx: onx, ny: ony, len: s.lenMm });
      else pts.push({ x: px, y: py, nx: pnx, ny: pny, others: [{ x: ox, y: oy, nx: onx, ny: ony, len: s.lenMm }] });
    };
    addEnd(s.x1Mm, s.y1Mm, s.nx1, s.ny1, s.x2Mm, s.y2Mm, s.nx2, s.ny2);
    addEnd(s.x2Mm, s.y2Mm, s.nx2, s.ny2, s.x1Mm, s.y1Mm, s.nx1, s.ny1);
  }

  for (const p of pts) {
    if (p.others.length !== 2) continue;
    const [a, b] = p.others;
    if (a.len < 0.6 || b.len < 0.6) continue;
    const v1x = (a.x - p.x) / a.len;
    const v1y = (a.y - p.y) / a.len;
    const v2x = (b.x - p.x) / b.len;
    const v2y = (b.y - p.y) / b.len;
    const cosA = v1x * v2x + v1y * v2y;
    if (cosA >= 0.53 && cosA <= 0.988) {
      return {
        tipNx: p.nx,
        tipNy: p.ny,
        tailNx: (a.nx + b.nx) * 0.5,
        tailNy: (a.ny + b.ny) * 0.5,
      };
    }
  }
  return null;
}

function computePrimaryOutlineWidth(segments: InternalSegment[]): number {
  const weightByWidthBucket = new Map<number, number>();
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (
      s.strokeLuminance >= 0.28 ||
      s.isDashed ||
      !Number.isFinite(s.effLineWidth) ||
      s.effLineWidth <= 0
    ) {
      continue;
    }
    const bucket = Math.round(s.effLineWidth * 20) / 20;
    weightByWidthBucket.set(bucket, (weightByWidthBucket.get(bucket) ?? 0) + s.lenMm);
  }
  if (weightByWidthBucket.size === 0) return 0.6;

  let bestWidth = 0.6;
  let bestWeight = -1;
  for (const [width, totalLen] of weightByWidthBucket.entries()) {
    if (totalLen > bestWeight || (Math.abs(totalLen - bestWeight) <= 1e-6 && width > bestWidth)) {
      bestWeight = totalLen;
      bestWidth = width;
    }
  }
  return bestWidth;
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
  // Short thin non-dashed lines are only promoted to centerline when verified as axis-aligned crosshairs or circle centers
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

  const resolveViewportScale = (): number => {
    if (typeof viewport.scale === 'number' && Number.isFinite(viewport.scale) && viewport.scale > 0) {
      return viewport.scale;
    }
    if (Array.isArray(viewport.transform) && viewport.transform.length >= 4) {
      const s = Math.hypot(viewport.transform[0], viewport.transform[1]);
      if (Number.isFinite(s) && s > 0) return s;
    }
    if (Array.isArray(viewport.viewBox) && viewport.viewBox.length >= 4 && viewport.width > 0) {
      const vbW = Math.abs(viewport.viewBox[2] - viewport.viewBox[0]);
      const vbH = Math.abs(viewport.viewBox[3] - viewport.viewBox[1]);
      const rot = (((viewport.rotation ?? 0) % 360) + 360) % 360;
      const unscaledW = rot === 90 || rot === 270 ? vbH : vbW;
      if (unscaledW > 0) return viewport.width / unscaledW;
    }
    return 1;
  };
  const vpScale = resolveViewportScale();

  const toViewportPoint = (x: number, y: number): [number, number] => {
    if (typeof viewport.convertToViewportPoint === 'function') {
      const pt = viewport.convertToViewportPoint(x, y);
      return [pt[0], pt[1]];
    }
    if (Array.isArray(viewport.transform) && viewport.transform.length >= 6) {
      const t = viewport.transform;
      return [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
    }
    if (Array.isArray(viewport.viewBox) && viewport.viewBox.length >= 4) {
      const [vx0, vy0, vx1, vy1] = viewport.viewBox;
      const rot = (((viewport.rotation ?? 0) % 360) + 360) % 360;
      if (rot === 90) return [(y - vy0) * vpScale, (x - vx0) * vpScale];
      if (rot === 180) return [(vx1 - x) * vpScale, (y - vy0) * vpScale];
      if (rot === 270) return [(vy1 - y) * vpScale, (vx1 - x) * vpScale];
      return [(x - vx0) * vpScale, (vy1 - y) * vpScale];
    }
    return [x * vpScale, viewport.height - y * vpScale];
  };

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

    const [vx1, vy1] = toViewportPoint(p1.x, p1.y);
    const [vx2, vy2] = toViewportPoint(p2.x, p2.y);
    if (
      !Number.isFinite(vx1) ||
      !Number.isFinite(vy1) ||
      !Number.isFinite(vx2) ||
      !Number.isFinite(vy2)
    ) {
      return;
    }
    // Compute mm and normalized coords in the exact same rotated & MediaBox-adjusted viewport frame
    const x1Mm = (vx1 / vpScale) * PT_TO_MM;
    const y1Mm = ((viewport.height - vy1) / vpScale) * PT_TO_MM;
    const x2Mm = (vx2 / vpScale) * PT_TO_MM;
    const y2Mm = ((viewport.height - vy2) / vpScale) * PT_TO_MM;
    const lenMm = Math.hypot(x2Mm - x1Mm, y2Mm - y1Mm);
    if (!Number.isFinite(lenMm) || lenMm < 0.08) return;

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
  const transientFillArrows: TransientArrowHint[] = [];

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
        const isStroked = isStrokedPaintOp(paintOp);
        const isFilled = isFilledPaintOp(paintOp);
        if (!isStroked && !isFilled) {
          continue; // Ignore clip-only (W n / endPath) paths
        }
        let pathSegs: InternalSegment[] = [];
        const recordPath = (segs: InternalSegment[]) => {
          if (segs.length === 0) return;
          if (isStroked) {
            commitPathSegments(segs, isFilled);
          } else {
            // Fill-only paths emit zero segments, but small triangles record transient arrowhead hints for dim-line promotion
            const hint = detectArrowTipInSmallSubpath(segs);
            if (hint) transientFillArrows.push(hint);
          }
        };
        const arr = args[1][0] as Float32Array | number[];
        let k = 0;
        while (k < arr.length) {
          const sub = arr[k++];
          if (sub === 0) {
            if (pathSegs.length > 0) {
              recordPath(pathSegs);
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
        recordPath(pathSegs);
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
      if (curLegacySegs.length > 0) {
        pendingLegacySubpaths.push(curLegacySegs);
        curLegacySegs = [];
      }
      if (isFilledPaintOp(fn)) {
        for (const sub of pendingLegacySubpaths) {
          const hint = detectArrowTipInSmallSubpath(sub);
          if (hint) transientFillArrows.push(hint);
        }
      }
      pendingLegacySubpaths = [];
      curLegacySegs = [];
    }
  }

  if (transientFillArrows.length > 0) {
    fillOnlyArrowHintsMap.set(allInternalSegments, transientFillArrows);
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
    /^(?:[ØøRrMm±]?\s*\d{1,5}(?:\.\d+)?(?:\s*[°"'])?|\d+(?:\.\d+)?\s*[x×]\s*[ØøRrMm]?\s*\d+(?:\.\d+)?)$/i.test(
      trimmed
    ) || /(?:[Øø°±]\s*\d|\d\s*(?:[Øø°±]|\+\s*\/\s*-))/.test(trimmed)
  );
}

// shortcut: detects CAD wedge/V-tick arrowheads (stroked or transient fill-only hints) + parallel offset thin lines with dim text; upgrade if curved/dot tick terminators are needed
function promoteDimensionGeometry(
  segments: InternalSegment[],
  layers: CadLayer[],
  textItems: RawNormalizedText[],
  titleBlockTopNy: number,
  pageWmm: number,
  pageHmm: number,
  primaryOutlineWidth: number,
  fillArrowHints: TransientArrowHint[] = []
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

  // 1. Group into subpaths to detect stroked arrowheads (triangles or V-ticks) plus transient fill-only arrow hints
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

    const isClosedOrFilled = segments[idxs[0]].isFilled || pts.every((p) => p.others.length >= 2);
    if (bestTip && (idxs.length === 2 || isClosedOrFilled)) {
      arrows.push(bestTip);
      for (const idx of idxs) arrowSegSet.add(idx);
    }
  }

  for (const hint of fillArrowHints) {
    if (hint.tipNy >= titleBlockTopNy) continue;
    const tipX = hint.tipNx * pageWmm;
    const tipY = hint.tipNy * pageHmm;
    const dx = hint.tailNx * pageWmm - tipX;
    const dy = hint.tailNy * pageHmm - tipY;
    const dLen = Math.hypot(dx, dy);
    if (dLen > 1e-4) {
      arrows.push({
        segIndices: [],
        tipX,
        tipY,
        axisX: dx / dLen,
        axisY: dy / dLen,
        confirmed: false,
      });
    }
  }

  const nearDimText = (x: number, y: number, maxDist: number) =>
    dimTexts.some((t) => Math.hypot(t.x - x, t.y - y) <= maxDist);

  const lineNearDimText = (si: number, maxDist: number) => {
    const c = coords[si];
    return dimTexts.some((t) => pointToSegMetrics(t.x, t.y, c.x1, c.y1, c.x2, c.y2).dist <= maxDist);
  };

  const promotedLines = new Set<number>();
  const confirmedArrows: ArrowCandidate[] = [];

  if (arrows.length > 0) {
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
        confirmedArrows.push(ar);
      }
    }

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
  }

  // 3. Multi-signal fallback: thin non-dashed single/two-seg lines parallel to & offset (3..45 mm) from an outline with nearby numeric dim text
  if (dimTexts.length > 0) {
    const thinThreshold = Math.max(0.55, primaryOutlineWidth * 0.88);
    const outlineCandidates: number[] = [];
    for (let pi = 0; pi < segments.length; pi++) {
      if (
        !arrowSegSet.has(pi) &&
        layers[pi] === 'outline' &&
        !segments[pi].isDashed &&
        coords[pi].len >= 4.0 &&
        (segments[pi].effLineWidth > thinThreshold + 0.03 || segments[pi].pathSegCount >= 2)
      ) {
        outlineCandidates.push(pi);
      }
    }

    if (outlineCandidates.length > 0) {
      for (let si = 0; si < segments.length; si++) {
        if (arrowSegSet.has(si) || layers[si] !== 'outline' || segments[si].isDashed) continue;
        if (segments[si].pathSegCount > 2 || segments[si].effLineWidth > thinThreshold) continue;
        const c = coords[si];
        if (c.len < 4.0) continue;

        let closestDimDist = Infinity;
        let closestDimText: { x: number; y: number } | null = null;
        for (let ti = 0; ti < dimTexts.length; ti++) {
          const t = dimTexts[ti];
          const m = pointToSegMetrics(t.x, t.y, c.x1, c.y1, c.x2, c.y2);
          if (m.dist <= 6.0 && m.tRaw >= -0.15 && m.tRaw <= 1.15 && m.dist < closestDimDist) {
            closestDimDist = m.dist;
            closestDimText = t;
          }
        }
        if (!closestDimText) continue;

        let hasParallelOutline = false;
        for (let oi = 0; oi < outlineCandidates.length; oi++) {
          const pi = outlineCandidates[oi];
          if (pi === si) continue;
          const p = coords[pi];
          if (Math.abs(c.ux * p.ux + c.uy * p.uy) < 0.96) continue;
          const perpDist = Math.abs((c.x1 - p.x1) * -p.uy + (c.y1 - p.y1) * p.ux);
          if (perpDist < 3.0 || perpDist > 45.0) continue;
          const t1 = (c.x1 - p.x1) * p.ux + (c.y1 - p.y1) * p.uy;
          const t2 = (c.x2 - p.x1) * p.ux + (c.y2 - p.y1) * p.uy;
          const overlap = Math.min(Math.max(t1, t2), p.len) - Math.max(Math.min(t1, t2), 0);
          if (overlap < Math.min(c.len, p.len) * 0.35) continue;
          const textToOutlineDist = pointToSegMetrics(
            closestDimText.x,
            closestDimText.y,
            p.x1,
            p.y1,
            p.x2,
            p.y2
          ).dist;
          if (closestDimDist + 1.2 < textToOutlineDist) {
            hasParallelOutline = true;
            break;
          }
        }

        if (hasParallelOutline) {
          layers[si] = 'dimension';
          promotedLines.add(si);
        }
      }
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

  // 4. Detect orthogonal extension (witness) lines framing confirmed arrowheads or signal-3 dimension endpoints
  const endpointAnchors: Array<{ tipX: number; tipY: number; axisX: number; axisY: number }> =
    confirmedArrows.map((a) => ({ tipX: a.tipX, tipY: a.tipY, axisX: a.axisX, axisY: a.axisY }));
  for (const di of promotedLines) {
    const dc = coords[di];
    endpointAnchors.push(
      { tipX: dc.x1, tipY: dc.y1, axisX: dc.ux, axisY: dc.uy },
      { tipX: dc.x2, tipY: dc.y2, axisX: -dc.ux, axisY: -dc.uy }
    );
  }

  if (endpointAnchors.length === 0) return;

  for (let si = 0; si < segments.length; si++) {
    if (arrowSegSet.has(si) || layers[si] === 'dimension' || segments[si].isDashed) continue;
    if (segments[si].pathSegCount > 2) continue;
    const c = coords[si];
    if (c.len < 2.0) continue;

    const isThin = segments[si].effLineWidth <= primaryOutlineWidth * 0.90;
    const isWitness = endpointAnchors.some((ar) => {
      const cosOrth = Math.abs(c.ux * ar.axisX + c.uy * ar.axisY);
      if (cosOrth > 0.42) return false;
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

function promoteCenterlineCrosshairs(
  segments: InternalSegment[],
  layers: CadLayer[],
  primaryOutlineWidth: number,
  pageWmm: number,
  pageHmm: number
): void {
  if (segments.length === 0) return;

  // Identify centers of closed curved/circular subpaths (e.g. bolt holes, bores) in sheet mm
  const bySubpath = new Map<number, InternalSegment[]>();
  for (let i = 0; i < segments.length; i++) {
    const sid = segments[i].subpathId;
    if (!sid) continue;
    const list = bySubpath.get(sid);
    if (list) list.push(segments[i]);
    else bySubpath.set(sid, [segments[i]]);
  }

  const circleCenters: Array<{ cx: number; cy: number; r: number }> = [];
  for (const sub of bySubpath.values()) {
    if (sub.length < 6) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < sub.length; i++) {
      const s = sub[i];
      const x1 = s.nx1 * pageWmm;
      const y1 = s.ny1 * pageHmm;
      const x2 = s.nx2 * pageWmm;
      const y2 = s.ny2 * pageHmm;
      if (x1 < minX) minX = x1;
      if (x2 < minX) minX = x2;
      if (x1 > maxX) maxX = x1;
      if (x2 > maxX) maxX = x2;
      if (y1 < minY) minY = y1;
      if (y2 < minY) minY = y2;
      if (y1 > maxY) maxY = y1;
      if (y2 > maxY) maxY = y2;
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (w >= 1.5 && h >= 1.5 && w / h >= 0.78 && w / h <= 1.28) {
      circleCenters.push({ cx: (minX + maxX) * 0.5, cy: (minY + maxY) * 0.5, r: (w + h) * 0.25 });
    }
  }

  const thinWidthCap = Math.max(0.5, primaryOutlineWidth * 0.86);
  interface AxisCand {
    idx: number;
    isHoriz: boolean;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    mx: number;
    my: number;
    len: number;
  }

  const horizCands: AxisCand[] = [];
  const vertCands: AxisCand[] = [];

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (layers[i] !== 'outline' || s.isDashed) continue;
    if (s.pathSegCount !== 1 || s.effLineWidth > thinWidthCap || s.lenMm > 14 || s.lenMm < 0.5) {
      continue;
    }
    const x1 = s.nx1 * pageWmm;
    const y1 = s.ny1 * pageHmm;
    const x2 = s.nx2 * pageWmm;
    const y2 = s.ny2 * pageHmm;
    const dx = Math.abs(x2 - x1);
    const dy = Math.abs(y2 - y1);
    const len = Math.hypot(dx, dy);
    if (len < 0.5) continue;

    const isHoriz = dy <= 0.08 * len;
    const isVert = dx <= 0.08 * len;
    if (!isHoriz && !isVert) continue;

    const mx = (x1 + x2) * 0.5;
    const my = (y1 + y2) * 0.5;

    // Consistent with a circular bore center
    const nearCircleCenter = circleCenters.some(
      (c) => Math.hypot(mx - c.cx, my - c.cy) <= Math.max(1.0, c.r * 0.18) && len <= c.r * 3.6
    );
    if (nearCircleCenter) {
      layers[i] = 'centerline';
      continue;
    }

    const cand: AxisCand = {
      idx: i,
      isHoriz,
      x1: Math.min(x1, x2),
      y1: Math.min(y1, y2),
      x2: Math.max(x1, x2),
      y2: Math.max(y1, y2),
      mx,
      my,
      len,
    };
    if (isHoriz) horizCands.push(cand);
    else vertCands.push(cand);
  }

  // Also allow dashed centerline crosshairs to confirm an orthogonal non-dashed axis pair
  vertCands.sort((a, b) => a.mx - b.mx);
  for (let hi = 0; hi < horizCands.length; hi++) {
    const h = horizCands[hi];
    for (let vi = 0; vi < vertCands.length; vi++) {
      const v = vertCands[vi];
      if (v.mx < h.x1 + h.len * 0.15) continue;
      if (v.mx > h.x2 - h.len * 0.15) break;
      if (h.my >= v.y1 + v.len * 0.15 && h.my <= v.y2 - v.len * 0.15) {
        layers[h.idx] = 'centerline';
        layers[v.idx] = 'centerline';
      }
    }
  }
}

interface CollinearEndpoint {
  xMm: number;
  yMm: number;
  nx: number;
  ny: number;
}

const sameSubpathCollinearMergedSet = new WeakSet<RawNormalizedSegment>();

function makeStrokeStyleKey(seg: InternalSegment): string {
  return `${seg.effLineWidth.toFixed(2)}:${seg.strokeLuminance.toFixed(2)}:${seg.isDashed ? 1 : 0}`;
}

function mergeCollinearSegments(segments: RawNormalizedSegment[]): RawNormalizedSegment[] {
  if (segments.length <= 1) return segments;

  // Count how many segments share each subpathId so multi-segment contours preserve ordered vertex chains
  const subpathCounts = new Map<number, number>();
  for (const s of segments) {
    if (s.subpathId && s.subpathId > 0) {
      subpathCounts.set(s.subpathId, (subpathCounts.get(s.subpathId) ?? 0) + 1);
    }
  }

  const out: RawNormalizedSegment[] = [];
  const mergeEligible: RawNormalizedSegment[] = [];
  for (const s of segments) {
    if (s.subpathId && s.subpathId > 0 && (subpathCounts.get(s.subpathId) ?? 0) >= 2) {
      out.push(s);
    } else {
      mergeEligible.push(s);
    }
  }

  if (mergeEligible.length <= 1) {
    for (const s of mergeEligible) out.push(s);
    return out;
  }

  const groups = new Map<string, RawNormalizedSegment[]>();
  for (const s of mergeEligible) {
    const key = `${s.layerHint || 'outline'}|${s.strokeStyleKey || 'default'}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(s);
    else groups.set(key, [s]);
  }

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
      subpathId?: number;
      mergedCount: number;
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
        subpathId: s.subpathId,
        mergedCount: 1,
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
      const seg: RawNormalizedSegment = {
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
        ...(it.subpathId !== undefined ? { subpathId: it.subpathId } : {}),
      };
      if (it.subpathId && it.subpathId > 0 && it.mergedCount >= 2) {
        sameSubpathCollinearMergedSet.add(seg);
      }
      out.push(seg);
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
          cur.mergedCount += it.mergedCount;
          if (cur.subpathId !== it.subpathId) {
            cur.subpathId = undefined;
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

interface CircleFitResult {
  cx: number;
  cy: number;
  r: number;
  rmsErr: number;
  maxErr: number;
}

function fitCircleLeastSquares(pts: ReadonlyArray<{ x: number; y: number }>): CircleFitResult | null {
  const n = pts.length;
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += pts[i].x;
    sy += pts[i].y;
  }
  const mx = sx / n;
  const my = sy / n;
  let suu = 0;
  let suv = 0;
  let svv = 0;
  let suuu = 0;
  let suvv = 0;
  let svvv = 0;
  let svuu = 0;
  for (let i = 0; i < n; i++) {
    const u = pts[i].x - mx;
    const v = pts[i].y - my;
    const uu = u * u;
    const vv = v * v;
    suu += uu;
    svv += vv;
    suv += u * v;
    suuu += uu * u;
    suvv += u * vv;
    svvv += vv * v;
    svuu += v * uu;
  }
  const denom = 2 * (suu * svv - suv * suv);
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-10) return null;
  const uc = (svv * (suuu + suvv) - suv * (svvv + svuu)) / denom;
  const vc = (suu * (svvv + svuu) - suv * (suuu + suvv)) / denom;
  const cx = mx + uc;
  const cy = my + vc;
  const rSq = uc * uc + vc * vc + (suu + svv) / n;
  if (!Number.isFinite(rSq) || rSq <= 0) return null;
  const r = Math.sqrt(rSq);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || r <= 0) return null;

  let maxErr = 0;
  let sumSqErr = 0;
  for (let i = 0; i < n; i++) {
    const err = Math.abs(Math.hypot(pts[i].x - cx, pts[i].y - cy) - r);
    if (err > maxErr) maxErr = err;
    sumSqErr += err * err;
  }
  return { cx, cy, r, rmsErr: Math.sqrt(sumSqErr / n), maxErr };
}

function normDeg(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return Number(d.toFixed(3));
}

function signedStepTurnRad(a: RawNormalizedSegment, b: RawNormalizedSegment): number {
  const ax = a.x2Mm - a.x1Mm;
  const ay = a.y2Mm - a.y1Mm;
  const bx = b.x2Mm - b.x1Mm;
  const by = b.y2Mm - b.y1Mm;
  return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
}

function isClosedCircleCandidate(
  segs: RawNormalizedSegment[],
  rmsTolPaper: number
): CircleFitResult | null {
  if (segs.length < 6) return null;
  const first = segs[0];
  const last = segs[segs.length - 1];
  if (Math.hypot(first.x1Mm - last.x2Mm, first.y1Mm - last.y2Mm) > 0.12) return null;
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < segs.length; i++) {
    if (i > 0) {
      const prev = segs[i - 1];
      if (Math.hypot(prev.x2Mm - segs[i].x1Mm, prev.y2Mm - segs[i].y1Mm) > 0.12) {
        return null;
      }
    }
    pts.push({ x: segs[i].x1Mm, y: segs[i].y1Mm });
  }
  const fit = fitCircleLeastSquares(pts);
  if (!fit || fit.r < 0.4 || fit.r > 2000) return null;
  const maxAllowedErr = Math.max(0.038, rmsTolPaper * 1.9, fit.r * 0.0025);
  if (fit.rmsErr > rmsTolPaper || fit.maxErr > maxAllowedErr) return null;

  // Verify vertices span all around the circle and no long flat chord cuts across
  for (let i = 0; i < segs.length; i++) {
    const segLen = Math.hypot(segs[i].x2Mm - segs[i].x1Mm, segs[i].y2Mm - segs[i].y1Mm);
    const chordAng = 2 * Math.asin(Math.min(1, segLen / (2 * fit.r)));
    if (chordAng > Math.PI / 3) return null;
  }
  const angles = pts
    .map((p) => Math.atan2(p.y - fit.cy, p.x - fit.cx))
    .sort((a, b) => a - b);
  let maxGap = Math.PI * 2 - (angles[angles.length - 1] - angles[0]);
  for (let i = 1; i < angles.length; i++) {
    const gap = angles[i] - angles[i - 1];
    if (gap > maxGap) maxGap = gap;
  }
  if (maxGap > Math.PI * 0.45) return null;
  return fit;
}

export function recoverPrimitivesFromSegments(
  segments: RawNormalizedSegment[],
  opts: {
    idPrefix?: string;
    viewId?: string;
    offsetX?: number;
    offsetY?: number;
    scaleFactor?: number;
    toleranceRealMm?: number;
  } = {}
): CadEntity[] {
  const idPrefix = opts.idPrefix || 'pdf-vec';
  const viewId = opts.viewId;
  const ox = opts.offsetX ?? 0;
  const oy = opts.offsetY ?? 0;
  const rmsTolPaper =
    opts.toleranceRealMm !== undefined && opts.scaleFactor && opts.scaleFactor <= 1.05
      ? opts.toleranceRealMm
      : 0.02;

  // Group segments by subpathId; segments without a subpathId stay standalone unless contiguous
  const orderedGroups: RawNormalizedSegment[][] = [];
  const subpathBucketIdx = new Map<number, number>();
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.subpathId && seg.subpathId > 0) {
      const existing = subpathBucketIdx.get(seg.subpathId);
      if (existing !== undefined) {
        orderedGroups[existing].push(seg);
      } else {
        subpathBucketIdx.set(seg.subpathId, orderedGroups.length);
        orderedGroups.push([seg]);
      }
    } else {
      const prevGroup = orderedGroups.length > 0 ? orderedGroups[orderedGroups.length - 1] : null;
      const prevSeg = prevGroup && !prevGroup[0].subpathId ? prevGroup[prevGroup.length - 1] : null;
      if (
        prevGroup &&
        prevSeg &&
        (prevSeg.layerHint || 'outline') === (seg.layerHint || 'outline') &&
        (prevSeg.strokeStyleKey || '') === (seg.strokeStyleKey || '') &&
        Math.hypot(prevSeg.x2Mm - seg.x1Mm, prevSeg.y2Mm - seg.y1Mm) <= 0.08
      ) {
        prevGroup.push(seg);
      } else {
        orderedGroups.push([seg]);
      }
    }
  }

  const out: CadEntity[] = [];
  let seq = 1;
  const nextId = () => `${idPrefix}-${seq++}`;
  const baseFields = (layer: CadLayer, source: 'vector' | 'recovered') => ({
    id: nextId(),
    ...(viewId ? { viewId } : {}),
    layer,
    source,
  });

  const emitLineOrMergedPolyline = (s: RawNormalizedSegment) => {
    const layer = s.layerHint || 'outline';
    if (sameSubpathCollinearMergedSet.has(s)) {
      out.push({
        ...baseFields(layer, 'recovered'),
        type: 'polyline',
        points: [
          { x: Number((s.x1Mm + ox).toFixed(3)), y: Number((s.y1Mm + oy).toFixed(3)) },
          { x: Number((s.x2Mm + ox).toFixed(3)), y: Number((s.y2Mm + oy).toFixed(3)) },
        ],
        closed: false,
      });
    } else {
      out.push({
        ...baseFields(layer, 'vector'),
        type: 'line',
        x1: Number((s.x1Mm + ox).toFixed(3)),
        y1: Number((s.y1Mm + oy).toFixed(3)),
        x2: Number((s.x2Mm + ox).toFixed(3)),
        y2: Number((s.y2Mm + oy).toFixed(3)),
      });
    }
  };

  for (const group of orderedGroups) {
    if (group.length === 1) {
      emitLineOrMergedPolyline(group[0]);
      continue;
    }

    const uniformLayer = group.every((s) => (s.layerHint || 'outline') === (group[0].layerHint || 'outline'));
    const uniformStyle = group.every((s) => (s.strokeStyleKey || '') === (group[0].strokeStyleKey || ''));
    if (uniformLayer && uniformStyle) {
      const circleFit = isClosedCircleCandidate(group, rmsTolPaper);
      if (circleFit) {
        out.push({
          ...baseFields(group[0].layerHint || 'outline', 'recovered'),
          type: 'circle',
          cx: Number((circleFit.cx + ox).toFixed(3)),
          cy: Number((circleFit.cy + oy).toFixed(3)),
          r: Number(circleFit.r.toFixed(3)),
        });
        continue;
      }
    }

    // Split into contiguous chains with uniform layer & style
    const chains: RawNormalizedSegment[][] = [];
    for (const seg of group) {
      const cur = chains.length > 0 ? chains[chains.length - 1] : null;
      const prev = cur ? cur[cur.length - 1] : null;
      if (
        cur &&
        prev &&
        (prev.layerHint || 'outline') === (seg.layerHint || 'outline') &&
        (prev.strokeStyleKey || '') === (seg.strokeStyleKey || '') &&
        Math.hypot(prev.x2Mm - seg.x1Mm, prev.y2Mm - seg.y1Mm) <= 0.08
      ) {
        cur.push(seg);
      } else {
        chains.push([seg]);
      }
    }

    for (const chain of chains) {
      const m = chain.length;
      if (m === 1) {
        emitLineOrMergedPolyline(chain[0]);
        continue;
      }
      const layer = chain[0].layerHint || 'outline';
      let i = 0;
      while (i < m) {
        // 1. Try longest arc run of >= 3 consecutive chords (4+ points)
        let arcMatched = false;
        if (i + 2 < m) {
          const l0 = Math.hypot(chain[i].x2Mm - chain[i].x1Mm, chain[i].y2Mm - chain[i].y1Mm);
          const l1 = Math.hypot(chain[i + 1].x2Mm - chain[i + 1].x1Mm, chain[i + 1].y2Mm - chain[i + 1].y1Mm);
          const l2 = Math.hypot(chain[i + 2].x2Mm - chain[i + 2].x1Mm, chain[i + 2].y2Mm - chain[i + 2].y1Mm);
          const minL = Math.min(l0, l1, l2);
          const maxL = Math.max(l0, l1, l2);
          const t01 = signedStepTurnRad(chain[i], chain[i + 1]);
          const t12 = signedStepTurnRad(chain[i + 1], chain[i + 2]);
          const minTurnRad = (0.8 * Math.PI) / 180;
          const maxTurnRad = (50 * Math.PI) / 180;
          if (
            minL >= 0.12 &&
            maxL / minL <= 3.5 &&
            t01 * t12 > 0 &&
            Math.abs(t01) >= minTurnRad &&
            Math.abs(t01) <= maxTurnRad &&
            Math.abs(t12) >= minTurnRad &&
            Math.abs(t12) <= maxTurnRad
          ) {
            const pts: Array<{ x: number; y: number }> = [
              { x: chain[i].x1Mm, y: chain[i].y1Mm },
              { x: chain[i].x2Mm, y: chain[i].y2Mm },
              { x: chain[i + 1].x2Mm, y: chain[i + 1].y2Mm },
              { x: chain[i + 2].x2Mm, y: chain[i + 2].y2Mm },
            ];
            let bestFit = fitCircleLeastSquares(pts);
            let bestEndIdx = i + 2;
            const turnSign = t01 > 0 ? 1 : -1;
            let lenSum = l0 + l1 + l2;
            let count = 3;

            const isValidFit = (f: CircleFitResult | null) =>
              f !== null &&
              f.r >= 0.4 &&
              f.r <= 2000 &&
              f.rmsErr <= rmsTolPaper &&
              f.maxErr <= Math.max(0.038, rmsTolPaper * 1.9, f.r * 0.0025);

            if (isValidFit(bestFit) && bestFit) {
              for (let j = i + 3; j < m; j++) {
                const lj = Math.hypot(chain[j].x2Mm - chain[j].x1Mm, chain[j].y2Mm - chain[j].y1Mm);
                const meanL = lenSum / count;
                if (lj < 0.12 || lj > meanL * 2.5 || lj < meanL * 0.35) break;
                const tj = signedStepTurnRad(chain[j - 1], chain[j]);
                if (tj * turnSign <= 0 || Math.abs(tj) < minTurnRad || Math.abs(tj) > maxTurnRad) break;
                pts.push({ x: chain[j].x2Mm, y: chain[j].y2Mm });
                const candFit = fitCircleLeastSquares(pts);
                if (
                  !isValidFit(candFit) ||
                  !candFit ||
                  Math.abs(candFit.r - bestFit.r) > Math.max(0.15, bestFit.r * 0.08)
                ) {
                  pts.pop();
                  break;
                }
                bestFit = candFit;
                bestEndIdx = j;
                lenSum += lj;
                count++;
              }

              // Compute total signed sweep around bestFit center
              let sweepRad = 0;
              for (let p = 0; p < pts.length - 1; p++) {
                const a0 = Math.atan2(pts[p].y - bestFit.cy, pts[p].x - bestFit.cx);
                const a1 = Math.atan2(pts[p + 1].y - bestFit.cy, pts[p + 1].x - bestFit.cx);
                let da = a1 - a0;
                while (da > Math.PI) da -= Math.PI * 2;
                while (da < -Math.PI) da += Math.PI * 2;
                sweepRad += da;
              }
              const absSweepRad = Math.abs(sweepRad);
              const sagitta = bestFit.r * (1 - Math.cos(Math.min(Math.PI, absSweepRad) / 2));
              if (absSweepRad >= (10 * Math.PI) / 180 && sagitta >= 0.05) {
                const startPt = pts[0];
                const endPt = pts[pts.length - 1];
                const closeGap = Math.hypot(startPt.x - endPt.x, startPt.y - endPt.y);
                if (absSweepRad >= (352 * Math.PI) / 180 && closeGap <= 0.15) {
                  out.push({
                    ...baseFields(layer, 'recovered'),
                    type: 'circle',
                    cx: Number((bestFit.cx + ox).toFixed(3)),
                    cy: Number((bestFit.cy + oy).toFixed(3)),
                    r: Number(bestFit.r.toFixed(3)),
                  });
                } else {
                  const ang0 = normDeg((Math.atan2(startPt.y - bestFit.cy, startPt.x - bestFit.cx) * 180) / Math.PI);
                  const ang1 = normDeg((Math.atan2(endPt.y - bestFit.cy, endPt.x - bestFit.cx) * 180) / Math.PI);
                  const isCcw = sweepRad >= 0;
                  out.push({
                    ...baseFields(layer, 'recovered'),
                    type: 'arc',
                    cx: Number((bestFit.cx + ox).toFixed(3)),
                    cy: Number((bestFit.cy + oy).toFixed(3)),
                    r: Number(bestFit.r.toFixed(3)),
                    startAngle: isCcw ? ang0 : ang1,
                    endAngle: isCcw ? ang1 : ang0,
                  });
                }
                i = bestEndIdx + 1;
                arcMatched = true;
              }
            }
          }
        }
        if (arcMatched) continue;

        // 2. Merge consecutive collinear runs (>= 2 segments) into CadPolylineEntity
        const s0 = chain[i];
        const dx0 = s0.x2Mm - s0.x1Mm;
        const dy0 = s0.y2Mm - s0.y1Mm;
        const len0 = Math.hypot(dx0, dy0) || 1e-6;
        const ux0 = dx0 / len0;
        const uy0 = dy0 / len0;
        let colEnd = i;
        while (colEnd + 1 < m) {
          const sn = chain[colEnd + 1];
          const dxn = sn.x2Mm - sn.x1Mm;
          const dyn = sn.y2Mm - sn.y1Mm;
          const lenn = Math.hypot(dxn, dyn) || 1e-6;
          const dot = (dxn / lenn) * ux0 + (dyn / lenn) * uy0;
          if (dot < 0.9999) break;
          const perp = Math.abs((sn.x2Mm - s0.x1Mm) * -uy0 + (sn.y2Mm - s0.y1Mm) * ux0);
          if (perp > 0.035) break;
          colEnd++;
        }

        if (colEnd > i) {
          out.push({
            ...baseFields(layer, 'recovered'),
            type: 'polyline',
            points: [
              { x: Number((chain[i].x1Mm + ox).toFixed(3)), y: Number((chain[i].y1Mm + oy).toFixed(3)) },
              { x: Number((chain[colEnd].x2Mm + ox).toFixed(3)), y: Number((chain[colEnd].y2Mm + oy).toFixed(3)) },
            ],
            closed: false,
          });
          i = colEnd + 1;
        } else {
          emitLineOrMergedPolyline(s0);
          i++;
        }
      }
    }
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

  const primaryOutlineWidth = computePrimaryOutlineWidth(drawingSegments);
  const fillArrowHints = fillOnlyArrowHintsMap.get(allInternalSegments) ?? [];

  const drawingLayers = drawingSegments.map((seg) => classifySegmentLayer(seg, primaryOutlineWidth));
  const pageWmm = pageWidthPt * PT_TO_MM;
  const pageHmm = pageHeightPt * PT_TO_MM;
  promoteDimensionGeometry(
    drawingSegments,
    drawingLayers,
    rawNormalizedTextItems,
    titleBlockTopNy,
    pageWmm,
    pageHmm,
    primaryOutlineWidth,
    fillArrowHints
  );
  promoteCenterlineCrosshairs(
    drawingSegments,
    drawingLayers,
    primaryOutlineWidth,
    pageWmm,
    pageHmm
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
    subpathId: seg.subpathId,
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

  const centeredEntities = recoverPrimitivesFromSegments(retainedSegs, {
    idPrefix: 'pdf-vec',
    offsetX: -centerX,
    offsetY: -centerY,
    scaleFactor: calibrated.scaleFactor || titleBlockMeta.scaleFactor || 1,
  });

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
    let maxDimVal = -Infinity;
    for (let i = 0; i < textItems.length; i++) {
      const t = textItems[i];
      if (t.ny < 0.76 && /^\d{2,4}(?:\.\d+)?$/.test(t.text.trim())) {
        const n = Number(t.text.trim());
        if (Number.isFinite(n) && n >= 20 && n <= 10000 && n > maxDimVal) {
          maxDimVal = n;
        }
      }
    }
    if (Number.isFinite(maxDimVal)) {
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = 0; i < segments.length; i++) {
        const s = segments[i];
        if (s.layerHint === 'dimension') continue;
        if (s.x1Mm < minX) minX = s.x1Mm;
        if (s.x2Mm < minX) minX = s.x2Mm;
        if (s.x1Mm > maxX) maxX = s.x1Mm;
        if (s.x2Mm > maxX) maxX = s.x2Mm;
      }
      if (Number.isFinite(minX)) {
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

  const isTitleBlockFieldLabel = (rawText: string): boolean => {
    const trimmed = rawText.trim();
    if (!trimmed) return true;
    if (/[:=]$/.test(trimmed)) return true;
    return /^(?:TITLE|PART\s*NAME|DESCRIPTION|DWG\s*NO\.?|DRAWING\s*NO\.?|PART\s*NO\.?|REV(?:ISION)?|MAT(?:ERIAL)?|WEIGHT|MASS|SCALE|SHEET(?:\s*\d+\s*OF\s*\d+)?|SIZE|DRAWN(?:\s*BY)?|CHK'?D|CHECKED(?:\s*BY)?|APPV'?D|APPROVED(?:\s*BY)?|ENG(?:INEER)?|MFG|Q\.?A\.?|DATE|NAME|SIGNATURE|FINISH|SURFACE\s+FINISH|TOLERANCES?|ANGULAR|LINEAR|DO\s+NOT\s+SCALE(?:\s+DRAWING)?|DIMENSIONS\s+ARE\s+IN\s+\w+|UNLESS\s+OTHERWISE\s+SPECIFIED|THIRD\s+ANGLE\s+PROJECTION|FIRST\s+ANGLE\s+PROJECTION|PROPRIETARY|CONFIDENTIAL|DEBURR\s+AND|BREAK\s+SHARP|EDGES?|A[0-4])$/i.test(
      trimmed
    );
  };

  const findNearbyValue = (
    labelRegex: RegExp,
    opts: { maxDx?: number; minDx?: number; maxDy?: number } = {}
  ): string | undefined => {
    const anchor = textItems.find((t) => labelRegex.test(t.text.trim()));
    if (!anchor) return undefined;
    const inlineMatch = anchor.text.match(/[:=]\s*(.+)$/);
    if (inlineMatch) {
      const inlineVal = inlineMatch[1].trim();
      if (inlineVal.length >= 1 && !isTitleBlockFieldLabel(inlineVal)) {
        return inlineVal;
      }
    }
    const maxDx = opts.maxDx ?? 0.22;
    const minDx = opts.minDx ?? -0.02;
    const maxDy = opts.maxDy ?? 0.05;

    const candidates = textItems
      .filter((t) => {
        if (t === anchor) return false;
        const val = t.text.trim();
        if (!val || isTitleBlockFieldLabel(val)) return false;
        const dx = t.nx - anchor.nx;
        const dy = t.ny - anchor.ny;
        // Reject items on rows above the label; same row must be to the right, lower rows within cell bounds
        if (dy < -0.008 || dy > maxDy || dx > maxDx) return false;
        if (dy <= 0.008) {
          if (dx <= 0.004) return false;
        } else if (dx < minDx) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const da = Math.hypot(a.nx - anchor.nx, (a.ny - anchor.ny) * 2.5);
        const db = Math.hypot(b.nx - anchor.nx, (b.ny - anchor.ny) * 2.5);
        return da - db;
      });

    return candidates[0]?.text.trim();
  };

  return {
    partName: findNearbyValue(/^(?:TITLE|PART\s*NAME)\s*[:.]?$/i, {
      maxDx: 0.25,
      maxDy: 0.06,
    }),
    partNumber: findNearbyValue(/(?:DWG\s*NO\.?|PART\s*NO\.?)/i, {
      maxDx: 0.22,
      maxDy: 0.045,
    }),
    revision: findNearbyValue(/^REV(?:ISION)?\s*[:.]?$/i, {
      maxDx: 0.14,
      maxDy: 0.025,
    }),
    material: findNearbyValue(/^MAT(?:ERIAL)?\s*[:.]?$/i, {
      maxDx: 0.2,
      maxDy: 0.045,
    }),
    units,
    weight: findNearbyValue(/^WEIGHT\s*[:.]?$/i, {
      maxDx: 0.14,
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
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < clusterSegs.length; i++) {
      const s = clusterSegs[i];
      if (s.x1Mm < minX) minX = s.x1Mm;
      if (s.x2Mm < minX) minX = s.x2Mm;
      if (s.x1Mm > maxX) maxX = s.x1Mm;
      if (s.x2Mm > maxX) maxX = s.x2Mm;
      if (s.y1Mm < minY) minY = s.y1Mm;
      if (s.y2Mm < minY) minY = s.y2Mm;
      if (s.y1Mm > maxY) maxY = s.y1Mm;
      if (s.y2Mm > maxY) maxY = s.y2Mm;
    }
    const wMm = Math.max(1, maxX - minX);
    const hMm = Math.max(1, maxY - minY);
    const aspect = wMm / hMm;
    const hasCenterlines = clusterSegs.some((s) => s.layerHint === 'centerline');
    const numericDimTokens = tokens.filter((t) => /^\d{2,4}(?:\.\d+)?$/.test(t.trim()));

    const hasTrueCircle = (() => {
      const bySid = new Map<number, RawNormalizedSegment[]>();
      for (let i = 0; i < clusterSegs.length; i++) {
        const s = clusterSegs[i];
        if (!s.subpathId || s.layerHint === 'dimension') continue;
        const arr = bySid.get(s.subpathId);
        if (arr) arr.push(s);
        else bySid.set(s.subpathId, [s]);
      }
      for (const bucket of bySid.values()) {
        if (isClosedCircleCandidate(bucket, 0.02)) return true;
      }
      return false;
    })();

    let outlineCount = 0;
    let diagOutlineCount = 0;
    for (let i = 0; i < clusterSegs.length; i++) {
      const s = clusterSegs[i];
      if (s.layerHint === 'dimension' || s.layerHint === 'centerline') continue;
      const dx = Math.abs(s.x2Mm - s.x1Mm);
      const dy = Math.abs(s.y2Mm - s.y1Mm);
      const len = Math.hypot(dx, dy);
      if (len < 0.1) continue;
      outlineCount++;
      // Diagonal if > ~6 degrees off both X and Y axes
      if (dx > len * 0.105 && dy > len * 0.105) {
        diagOutlineCount++;
      }
    }
    const diagFrac = outlineCount > 0 ? diagOutlineCount / outlineCount : 0;

    if (
      normBounds.y < 0.35 &&
      clusterSegs.length >= 25 &&
      (numericDimTokens.length === 0 || (!hasTrueCircle && diagFrac >= 0.45))
    ) {
      return { viewKind: 'isometric', label: 'Isometric 3D View' };
    }
    if (aspect >= 0.78 && aspect <= 1.28 && (hasCenterlines || hasTrueCircle || clusterSegs.length >= 40)) {
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
const SMALL_ENCLOSURE_AREA_RATIO = 0.03;
const MIN_CLUSTER_BRIDGE_MM = 0.5;
const ROW_BAND_CENTER_TOLERANCE = 0.14;

export function inferSheetSizeMm(segments: RawNormalizedSegment[]): { width: number; height: number } {
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

function forEachLineGridCell(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cellW: number,
  cellH: number,
  cols: number,
  rows: number,
  visit: (cellIdx: number, c: number, r: number, cx1: number, cy1: number, cx2: number, cy2: number) => void
): void {
  const gx0 = Math.max(0, Math.min(cols - 1e-6, x0 / cellW));
  const gy0 = Math.max(0, Math.min(rows - 1e-6, y0 / cellH));
  const gx1 = Math.max(0, Math.min(cols - 1e-6, x1 / cellW));
  const gy1 = Math.max(0, Math.min(rows - 1e-6, y1 / cellH));

  let c = Math.max(0, Math.min(cols - 1, Math.floor(gx0)));
  let r = Math.max(0, Math.min(rows - 1, Math.floor(gy0)));
  const cEnd = Math.max(0, Math.min(cols - 1, Math.floor(gx1)));
  const rEnd = Math.max(0, Math.min(rows - 1, Math.floor(gy1)));

  if (c === cEnd && r === rEnd) {
    visit(
      r * cols + c,
      c,
      r,
      x0 < x1 ? x0 : x1,
      y0 < y1 ? y0 : y1,
      x0 > x1 ? x0 : x1,
      y0 > y1 ? y0 : y1
    );
    return;
  }

  const dgx = gx1 - gx0;
  const dgy = gy1 - gy0;
  const stepC = cEnd > c ? 1 : cEnd < c ? -1 : 0;
  const stepR = rEnd > r ? 1 : rEnd < r ? -1 : 0;
  const tDeltaC = stepC !== 0 && dgx !== 0 ? Math.abs(1 / dgx) : Infinity;
  const tDeltaR = stepR !== 0 && dgy !== 0 ? Math.abs(1 / dgy) : Infinity;
  let tMaxC =
    stepC > 0 ? Math.max(0, (c + 1 - gx0) / dgx) : stepC < 0 ? Math.max(0, (c - gx0) / dgx) : Infinity;
  let tMaxR =
    stepR > 0 ? Math.max(0, (r + 1 - gy0) / dgy) : stepR < 0 ? Math.max(0, (r - gy0) / dgy) : Infinity;

  let ax = x0;
  let ay = y0;
  const maxSteps = Math.abs(cEnd - c) + Math.abs(rEnd - r) + 4;

  for (let step = 0; step < maxSteps; step++) {
    const hitEnd = c === cEnd && r === rEnd;
    const tNext = hitEnd ? 1 : Math.min(1, tMaxC, tMaxR);
    const bx = x0 + (x1 - x0) * tNext;
    const by = y0 + (y1 - y0) * tNext;

    visit(
      r * cols + c,
      c,
      r,
      ax < bx ? ax : bx,
      ay < by ? ay : by,
      ax > bx ? ax : bx,
      ay > by ? ay : by
    );

    if (hitEnd || tNext >= 1 - 1e-9) {
      break;
    }

    if (Math.abs(tMaxC - tMaxR) <= 1e-9 && stepC !== 0 && stepR !== 0) {
      const nc = c + stepC;
      const nr = r + stepR;
      if (nc >= 0 && nc < cols) visit(r * cols + nc, nc, r, bx, by, bx, by);
      if (nr >= 0 && nr < rows) visit(nr * cols + c, c, nr, bx, by, bx, by);
      c = Math.max(0, Math.min(cols - 1, nc));
      r = Math.max(0, Math.min(rows - 1, nr));
      tMaxC += tDeltaC;
      tMaxR += tDeltaR;
    } else if (tMaxC <= tMaxR && c !== cEnd) {
      c = Math.max(0, Math.min(cols - 1, c + stepC));
      tMaxC += tDeltaC;
    } else if (r !== rEnd) {
      r = Math.max(0, Math.min(rows - 1, r + stepR));
      tMaxR += tDeltaR;
    } else if (c !== cEnd) {
      c = Math.max(0, Math.min(cols - 1, c + stepC));
      tMaxC += tDeltaC;
    } else {
      break;
    }

    ax = bx;
    ay = by;
  }
}

function sortClustersInReadingOrder<T extends { x1: number; y1: number; x2: number; y2: number }>(
  clusters: T[]
): T[] {
  if (clusters.length <= 1) return clusters;
  const items = clusters.map((cluster) => ({
    cluster,
    cx: (cluster.x1 + cluster.x2) / 2,
    cy: (cluster.y1 + cluster.y2) / 2,
  }));
  items.sort((a, b) => a.cy - b.cy);

  const bands: Array<{ anchorCy: number; entries: typeof items }> = [];
  for (const entry of items) {
    const curBand = bands[bands.length - 1];
    if (!curBand || entry.cy - curBand.anchorCy > ROW_BAND_CENTER_TOLERANCE) {
      bands.push({ anchorCy: entry.cy, entries: [entry] });
    } else {
      curBand.entries.push(entry);
    }
  }

  bands.sort((a, b) => a.anchorCy - b.anchorCy);
  const ordered: T[] = [];
  for (const band of bands) {
    band.entries.sort((a, b) => a.cx - b.cx || a.cluster.x1 - b.cluster.x1);
    for (const entry of band.entries) {
      ordered.push(entry.cluster);
    }
  }
  return ordered;
}

export function detectViewRegions(
  segments: RawNormalizedSegment[],
  textItems: RawNormalizedText[],
  titleBlockTopNy: number,
  sheetSizeMm: { width: number; height: number }
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

  const gapX = Math.max(0.004, Math.min(0.15, VIEW_MERGE_GAP_MM / Math.max(1, sheetSizeMm.width)));
  const gapY = Math.max(0.004, Math.min(0.15, VIEW_MERGE_GAP_MM / Math.max(1, sheetSizeMm.height)));

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
  const isBridge = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const s = segments[useStructural ? structuralIndices[i] : i];
    const segLenMm = Math.hypot(s.x2Mm - s.x1Mm, s.y2Mm - s.y1Mm);
    parent[i] = i;
    size[i] = 1;
    minX[i] = s.nx1 < s.nx2 ? s.nx1 : s.nx2;
    minY[i] = s.ny1 < s.ny2 ? s.ny1 : s.ny2;
    maxX[i] = s.nx1 > s.nx2 ? s.nx1 : s.nx2;
    maxY[i] = s.ny1 > s.ny2 ? s.ny1 : s.ny2;
    lenSum[i] = segLenMm;
    isBridge[i] = segLenMm >= MIN_CLUSTER_BRIDGE_MM ? 1 : 0;
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

  // Uniform grid pass: walk only the cells each bridge-eligible segment (>= MIN_CLUSTER_BRIDGE_MM) crosses
  for (let i = 0; i < n; i++) {
    if (!isBridge[i]) continue;
    const s = segments[useStructural ? structuralIndices[i] : i];
    forEachLineGridCell(s.nx1, s.ny1, s.nx2, s.ny2, cellW, cellH, cols, rows, (cellIdx, _c, _r, cx1, cy1, cx2, cy2) => {
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
    });
  }

  // Forward-neighbor pass catches bridge-eligible pairs within (gapX, gapY) across cell boundaries
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

  // Attach sub-threshold segments (< MIN_CLUSTER_BRIDGE_MM) to at most one directly touched cluster; never bridge clusters
  for (let i = 0; i < n; i++) {
    if (isBridge[i]) continue;
    const s = segments[useStructural ? structuralIndices[i] : i];
    const sx1 = minX[i];
    const sy1 = minY[i];
    const sx2 = maxX[i];
    const sy2 = maxY[i];
    let attachedRoot = -1;
    forEachLineGridCell(s.nx1, s.ny1, s.nx2, s.ny2, cellW, cellH, cols, rows, (cellIdx) => {
      if (attachedRoot !== -1) return;
      const rep = cellRep[cellIdx];
      if (rep === -1) return;
      if (
        !(
          sx2 + gapX * 0.25 < cellMinX[cellIdx] ||
          cellMaxX[cellIdx] + gapX * 0.25 < sx1 ||
          sy2 + gapY * 0.25 < cellMinY[cellIdx] ||
          cellMaxY[cellIdx] + gapY * 0.25 < sy1
        )
      ) {
        attachedRoot = find(rep);
      }
    });
    if (attachedRoot !== -1) {
      parent[i] = attachedRoot;
      size[attachedRoot] += 1;
      lenSum[attachedRoot] += lenSum[i];
    }
  }

  // Lazy index of closed outline subpaths per cluster root, built only if an enclosed cluster >= SMALL_ENCLOSURE_AREA_RATIO appears
  let rootOutlineCache: Map<number, RawNormalizedSegment[]> | null = null;
  const getRootOutlineCache = (): Map<number, RawNormalizedSegment[]> => {
    if (!rootOutlineCache) {
      rootOutlineCache = new Map<number, RawNormalizedSegment[]>();
      for (let idx = 0; idx < n; idx++) {
        const s = segments[useStructural ? structuralIndices[idx] : idx];
        if (s.layerHint && s.layerHint !== 'outline') continue;
        const r = find(idx);
        const list = rootOutlineCache.get(r);
        if (list) list.push(s);
        else rootOutlineCache.set(r, [s]);
      }
    }
    return rootOutlineCache;
  };
  const isClosedLoop = (bucket: RawNormalizedSegment[]): boolean => {
    if (bucket.length < 3) return false;
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    return Math.hypot(first.nx1 - last.nx2, first.ny1 - last.ny2) <= 2e-3;
  };
  const isPointInBucket = (qx: number, qy: number, segs: RawNormalizedSegment[]): boolean => {
    let crossRight = 0;
    let crossLeft = 0;
    let crossDown = 0;
    let crossUp = 0;
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      if ((s.ny1 > qy) !== (s.ny2 > qy)) {
        const xInt = s.nx1 + ((qy - s.ny1) * (s.nx2 - s.nx1)) / (s.ny2 - s.ny1);
        if (xInt > qx) crossRight++;
        else crossLeft++;
      }
      if ((s.nx1 > qx) !== (s.nx2 > qx)) {
        const yInt = s.ny1 + ((qx - s.nx1) * (s.ny2 - s.ny1)) / (s.nx2 - s.nx1);
        if (yInt > qy) crossDown++;
        else crossUp++;
      }
    }
    return (
      (crossRight & 1) === 1 &&
      (crossLeft & 1) === 1 &&
      (crossDown & 1) === 1 &&
      (crossUp & 1) === 1
    );
  };
  const isInsideClusterOutline = (px: number, py: number, root: number): boolean => {
    const segs = getRootOutlineCache().get(root);
    if (!segs || segs.length < 3) return false;
    const bySubpath = new Map<number, RawNormalizedSegment[]>();
    const unkeyed: RawNormalizedSegment[] = [];
    for (let k = 0; k < segs.length; k++) {
      const s = segs[k];
      if (s.subpathId && s.subpathId > 0) {
        const b = bySubpath.get(s.subpathId);
        if (b) b.push(s);
        else bySubpath.set(s.subpathId, [s]);
      } else {
        unkeyed.push(s);
      }
    }
    // Slight asymmetric offset avoids landing exactly on horizontal/vertical vertices
    const qx = px + 1.37e-5;
    const qy = py + 1.73e-5;
    for (const bucket of bySubpath.values()) {
      if (isClosedLoop(bucket) && isPointInBucket(qx, qy, bucket)) {
        return true;
      }
    }
    if (unkeyed.length >= 3 && isPointInBucket(qx, qy, unkeyed)) {
      return true;
    }
    return false;
  };

  // Sweep-and-prune pass merges small enclosed sub-clusters (< 3% bbox area) or internal features inside a solid closed outline
  const rawRoots: number[] = [];
  for (let i = 0; i < n; i++) {
    if (parent[i] === i) rawRoots.push(i);
  }
  rawRoots.sort((a, b) => {
    if (minX[a] !== minX[b]) return minX[a] - minX[b];
    const areaA = (maxX[a] - minX[a]) * (maxY[a] - minY[a]);
    const areaB = (maxX[b] - minX[b]) * (maxY[b] - minY[b]);
    return areaB - areaA;
  });

  const absorbed = new Uint8Array(rawRoots.length);
  const activeRoots: number[] = [];
  for (let i = 0; i < rawRoots.length; i++) {
    if (absorbed[i]) continue;
    let cur = find(rawRoots[i]);
    const curX1 = minX[cur];
    const curY1 = minY[cur];
    const curX2 = maxX[cur];
    const curY2 = maxY[cur];
    const curArea = (curX2 - curX1) * (curY2 - curY1);

    if (curArea > 0) {
      for (let j = i + 1; j < rawRoots.length; j++) {
        if (absorbed[j]) continue;
        const other = find(rawRoots[j]);
        if (other === cur) {
          absorbed[j] = 1;
          continue;
        }
        if (minX[other] > curX2 + 1e-6) break;
        const ox1 = minX[other];
        const oy1 = minY[other];
        const ox2 = maxX[other];
        const oy2 = maxY[other];
        const oArea = (ox2 - ox1) * (oy2 - oy1);
        if (
          ox1 >= curX1 - 1e-6 &&
          ox2 <= curX2 + 1e-6 &&
          oy1 >= curY1 - 1e-6 &&
          oy2 <= curY2 + 1e-6 &&
          (oArea < SMALL_ENCLOSURE_AREA_RATIO * curArea ||
            isInsideClusterOutline((ox1 + ox2) * 0.5, (oy1 + oy2) * 0.5, cur))
        ) {
          const prevCur = cur;
          cur = union(cur, other);
          if (rootOutlineCache !== null) {
            const cache = getRootOutlineCache();
            const absorbedRoot = cur === prevCur ? other : prevCur;
            const keepList = cache.get(cur);
            const moveList = cache.get(absorbedRoot);
            if (keepList && moveList) {
              for (let m = 0; m < moveList.length; m++) keepList.push(moveList[m]);
            } else if (moveList) {
              cache.set(cur, moveList);
            }
            cache.delete(absorbedRoot);
          }
          absorbed[j] = 1;
        }
      }
    }
    activeRoots.push(cur);
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

  const significant = sortClustersInReadingOrder(significantAll.slice(0, 6));

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

    const vectorEntities = recoverPrimitivesFromSegments(enclosedSegs, {
      idPrefix: `${id}-vec`,
      viewId: id,
      offsetX: -cx,
      offsetY: -cy,
      scaleFactor,
    });

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

export function extractNumericDimCallouts(
  tokens: string[],
  opts: { excludeTolerances?: boolean } = {}
): number[] {
  const vals: number[] = [];
  const parsePartPieces = (rawPart: string, isTolerance: boolean) => {
    const pieces = rawPart.replace(/(\d)\s*[x×]\s*(?=[ØøRrMm]?\s*\d)/gi, '$1\0').split('\0');
    for (const piece of pieces) {
      const cleaned = piece.replace(/^[ØøRrMm+\s]+|[°"'\s]+$/g, '').trim();
      if (/^\d{1,4}(?:\.\d+)?$/.test(cleaned)) {
        const n = Number(cleaned);
        if (Number.isFinite(n) && (isTolerance ? n > 0 : n >= 1) && n <= 10000) {
          vals.push(n);
        }
      }
    }
  };

  for (const tok of tokens) {
    const trimmed = tok.trim();
    if (!trimmed) continue;
    // Skip scale ratios like "1:20"
    if (/^\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?$/.test(trimmed)) continue;
    const tolSplit = trimmed.split(/(?:\+\s*\/\s*-|±)/);
    if (tolSplit[0].trim().length > 0) {
      parsePartPieces(tolSplit[0], false);
    }
    if (!opts.excludeTolerances && tolSplit.length > 1) {
      for (let i = 1; i < tolSplit.length; i++) {
        if (tolSplit[i].trim().length > 0) {
          parsePartPieces(tolSplit[i], true);
        }
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
    const dims = extractNumericDimCallouts(chunk.extractedText, { excludeTolerances: true }).filter(
      (d) => d >= 15
    );
    if (dims.length === 0) continue;
    const wPaper = chunk.boundingBox.maxX - chunk.boundingBox.minX;
    const hPaper = chunk.boundingBox.maxY - chunk.boundingBox.minY;
    const maxPaper = Math.max(wPaper, hPaper);
    const minPaper = Math.min(wPaper, hPaper);
    if (maxPaper < 4) continue;

    // Prefer exact outer recovered circle diameters when they dominate the view bounding box
    const circleDias: number[] = [];
    for (const ent of chunk.vectorEntities) {
      if (ent.type === 'circle' && ent.layer !== 'dimension' && ent.r > 0) {
        circleDias.push(ent.r * 2);
      }
    }
    circleDias.sort((a, b) => b - a);
    const useCircleRefs = circleDias.length > 0 && circleDias[0] >= maxPaper * 0.85;
    const primaryPaper = useCircleRefs ? circleDias[0] : maxPaper;
    const secondaryPaper =
      useCircleRefs && circleDias.length >= 2 ? circleDias[1] : minPaper;

    const rMax = dims[0] / primaryPaper;
    if (rMax >= 0.4 && rMax <= 200) {
      candidateRatios.push(rMax);
    }
    if (dims.length >= 2 && secondaryPaper >= 4) {
      const rMin = dims[1] / secondaryPaper;
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

  const scaleNum = (n: number) => Number((n * scaleFactor).toFixed(2));
  const placeScaledEntity = (
    ent: CadEntity,
    dx: number,
    dy: number,
    viewId?: string,
    featureId?: string
  ): CadEntity => {
    const common = {
      id: ent.id,
      layer: ent.layer,
      ...(ent.source ? { source: ent.source } : {}),
      ...(viewId ? { viewId } : ent.viewId ? { viewId: ent.viewId } : {}),
      ...(featureId ? { featureId } : ent.featureId ? { featureId: ent.featureId } : {}),
    };
    if (ent.type === 'line') {
      return {
        ...common,
        type: 'line',
        x1: Number((ent.x1 * scaleFactor + dx).toFixed(2)),
        y1: Number((ent.y1 * scaleFactor + dy).toFixed(2)),
        x2: Number((ent.x2 * scaleFactor + dx).toFixed(2)),
        y2: Number((ent.y2 * scaleFactor + dy).toFixed(2)),
      };
    }
    if (ent.type === 'circle') {
      return {
        ...common,
        type: 'circle',
        cx: Number((ent.cx * scaleFactor + dx).toFixed(2)),
        cy: Number((ent.cy * scaleFactor + dy).toFixed(2)),
        r: scaleNum(ent.r),
      };
    }
    if (ent.type === 'arc') {
      return {
        ...common,
        type: 'arc',
        cx: Number((ent.cx * scaleFactor + dx).toFixed(2)),
        cy: Number((ent.cy * scaleFactor + dy).toFixed(2)),
        r: scaleNum(ent.r),
        startAngle: ent.startAngle,
        endAngle: ent.endAngle,
      };
    }
    if (ent.type === 'rect') {
      return {
        ...common,
        type: 'rect',
        x: Number((ent.x * scaleFactor + dx).toFixed(2)),
        y: Number((ent.y * scaleFactor + dy).toFixed(2)),
        width: scaleNum(ent.width),
        height: scaleNum(ent.height),
        ...(ent.rx !== undefined ? { rx: scaleNum(ent.rx) } : {}),
      };
    }
    return {
      ...common,
      type: 'polyline',
      points: ent.points.map((p) => ({
        x: Number((p.x * scaleFactor + dx).toFixed(2)),
        y: Number((p.y * scaleFactor + dy).toFixed(2)),
      })),
      ...(ent.closed !== undefined ? { closed: ent.closed } : {}),
    };
  };

  const getEntityBounds = (
    ent: CadEntity
  ): { minX: number; minY: number; maxX: number; maxY: number } | null => {
    if (ent.type === 'line') {
      return {
        minX: Math.min(ent.x1, ent.x2),
        minY: Math.min(ent.y1, ent.y2),
        maxX: Math.max(ent.x1, ent.x2),
        maxY: Math.max(ent.y1, ent.y2),
      };
    }
    if (ent.type === 'circle') {
      return {
        minX: ent.cx - ent.r,
        minY: ent.cy - ent.r,
        maxX: ent.cx + ent.r,
        maxY: ent.cy + ent.r,
      };
    }
    if (ent.type === 'arc') {
      const a0 = (ent.startAngle * Math.PI) / 180;
      const a1 = (ent.endAngle * Math.PI) / 180;
      const x0 = ent.cx + ent.r * Math.cos(a0);
      const y0 = ent.cy + ent.r * Math.sin(a0);
      const x1 = ent.cx + ent.r * Math.cos(a1);
      const y1 = ent.cy + ent.r * Math.sin(a1);
      let bMinX = Math.min(x0, x1);
      let bMaxX = Math.max(x0, x1);
      let bMinY = Math.min(y0, y1);
      let bMaxY = Math.max(y0, y1);
      const normA = (deg: number) => ((deg % 360) + 360) % 360;
      const sDeg = normA(ent.startAngle);
      let sweepDeg = normA(ent.endAngle - ent.startAngle);
      if (sweepDeg === 0 && ent.endAngle !== ent.startAngle) sweepDeg = 360;
      const hasDeg = (d: number) => normA(d - sDeg) <= sweepDeg + 1e-6;
      if (hasDeg(0)) bMaxX = ent.cx + ent.r;
      if (hasDeg(90)) bMaxY = ent.cy + ent.r;
      if (hasDeg(180)) bMinX = ent.cx - ent.r;
      if (hasDeg(270)) bMinY = ent.cy - ent.r;
      return { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY };
    }
    if (ent.type === 'rect') {
      return {
        minX: ent.x,
        minY: ent.y,
        maxX: ent.x + ent.width,
        maxY: ent.y + ent.height,
      };
    }
    if (ent.type === 'polyline' && ent.points.length > 0) {
      let bMinX = Infinity;
      let bMinY = Infinity;
      let bMaxX = -Infinity;
      let bMaxY = -Infinity;
      for (let i = 0; i < ent.points.length; i++) {
        const p = ent.points[i];
        if (p.x < bMinX) bMinX = p.x;
        if (p.y < bMinY) bMinY = p.y;
        if (p.x > bMaxX) bMaxX = p.x;
        if (p.y > bMaxY) bMaxY = p.y;
      }
      return { minX: bMinX, minY: bMinY, maxX: bMaxX, maxY: bMaxY };
    }
    return null;
  };

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
        const placed = placeScaledEntity(ent, dx, dy, chunk.id, featId);
        entities.push(placed);
        const eb = getEntityBounds(placed);
        if (!eb) continue;
        const countsTowardBounds = chunkHasOutlines
          ? placed.layer === 'outline' || placed.layer === 'hidden'
          : placed.layer !== 'dimension';
        if (countsTowardBounds) {
          cMinX = Math.min(cMinX, eb.minX);
          cMinY = Math.min(cMinY, eb.minY);
          cMaxX = Math.max(cMaxX, eb.maxX);
          cMaxY = Math.max(cMaxY, eb.maxY);
        }
        minX = Math.min(minX, eb.minX);
        minY = Math.min(minY, eb.minY);
        maxX = Math.max(maxX, eb.maxX);
        maxY = Math.max(maxY, eb.maxY);
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

      const callouts = extractNumericDimCallouts(chunk.extractedText, { excludeTolerances: true });
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
      entities.push(placeScaledEntity(ent, 0, 0));
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
