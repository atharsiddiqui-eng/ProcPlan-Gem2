import type {
  CadDimension,
  CadEntity,
  CadLayer,
  DrawingAnalysisResult,
  MachinedFeature,
  PdfViewChunkSummary,
  ProcessOperation,
  ViewChunkKind,
} from '../types/cad';

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

const VALID_LAYERS = new Set<CadLayer>([
  'outline',
  'centerline',
  'hidden',
  'hole',
  'dimension',
  'toolpath',
]);

const VALID_VIEW_KINDS = new Set<ViewChunkKind>([
  'orthogonal',
  'longitudinal-section',
  'cross-section',
  'detail',
  'isometric',
]);

export function sanitizeAnalysisResult(raw: Partial<DrawingAnalysisResult>): DrawingAnalysisResult {
  const rawEntities = Array.isArray(raw.entities) ? raw.entities : [];
  const entities: CadEntity[] = [];

  for (let i = 0; i < rawEntities.length; i++) {
    const e = rawEntities[i] as unknown as Record<string, unknown>;
    if (!e || typeof e !== 'object') continue;
    const id = typeof e.id === 'string' && e.id ? e.id : `ent-${i + 1}`;
    const featureId = typeof e.featureId === 'string' && e.featureId ? e.featureId : undefined;
    const viewId = typeof e.viewId === 'string' && e.viewId ? e.viewId : undefined;
    const layer: CadLayer = VALID_LAYERS.has(e.layer as CadLayer)
      ? (e.layer as CadLayer)
      : 'outline';
    const type = e.type;

    if (type === 'line') {
      const x1 = Number(e.x1);
      const y1 = Number(e.y1);
      const x2 = Number(e.x2);
      const y2 = Number(e.y2);
      if (isFiniteNum(x1) && isFiniteNum(y1) && isFiniteNum(x2) && isFiniteNum(y2)) {
        entities.push({ id, featureId, viewId, layer, type: 'line', x1, y1, x2, y2 });
      }
    } else if (type === 'circle') {
      const cx = Number(e.cx);
      const cy = Number(e.cy);
      const r = Number(e.r);
      if (isFiniteNum(cx) && isFiniteNum(cy) && isFiniteNum(r) && r > 0) {
        entities.push({ id, featureId, viewId, layer, type: 'circle', cx, cy, r });
      }
    } else if (type === 'arc') {
      const cx = Number(e.cx);
      const cy = Number(e.cy);
      const r = Number(e.r);
      const startAngle = num(e.startAngle, 0);
      const endAngle = num(e.endAngle, 90);
      if (isFiniteNum(cx) && isFiniteNum(cy) && isFiniteNum(r) && r > 0) {
        entities.push({ id, featureId, viewId, layer, type: 'arc', cx, cy, r, startAngle, endAngle });
      }
    } else if (type === 'rect') {
      const x = Number(e.x);
      const y = Number(e.y);
      const width = Number(e.width);
      const height = Number(e.height);
      const rx = num(e.rx, 0);
      if (
        isFiniteNum(x) &&
        isFiniteNum(y) &&
        isFiniteNum(width) &&
        isFiniteNum(height) &&
        width > 0 &&
        height > 0
      ) {
        entities.push({ id, featureId, viewId, layer, type: 'rect', x, y, width, height, rx });
      }
    } else if (type === 'polyline' && Array.isArray(e.points)) {
      const points = e.points
        .map((p: unknown) => {
          const pt = p as Record<string, unknown>;
          const px = Number(pt?.x);
          const py = Number(pt?.y);
          return isFiniteNum(px) && isFiniteNum(py) ? { x: px, y: py } : null;
        })
        .filter((p): p is { x: number; y: number } => p !== null);
      if (points.length >= 2) {
        entities.push({
          id,
          featureId,
          viewId,
          layer,
          type: 'polyline',
          points,
          closed: Boolean(e.closed),
        });
      }
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const ent of entities) {
    if (ent.type === 'line') {
      minX = Math.min(minX, ent.x1, ent.x2);
      minY = Math.min(minY, ent.y1, ent.y2);
      maxX = Math.max(maxX, ent.x1, ent.x2);
      maxY = Math.max(maxY, ent.y1, ent.y2);
    } else if (ent.type === 'circle' || ent.type === 'arc') {
      minX = Math.min(minX, ent.cx - ent.r);
      minY = Math.min(minY, ent.cy - ent.r);
      maxX = Math.max(maxX, ent.cx + ent.r);
      maxY = Math.max(maxY, ent.cy + ent.r);
    } else if (ent.type === 'rect') {
      minX = Math.min(minX, ent.x);
      minY = Math.min(minY, ent.y);
      maxX = Math.max(maxX, ent.x + ent.width);
      maxY = Math.max(maxY, ent.y + ent.height);
    } else if (ent.type === 'polyline') {
      for (const p of ent.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
  }

  if (!Number.isFinite(minX)) {
    minX = num(raw.boundingBox?.minX, -50);
    minY = num(raw.boundingBox?.minY, -50);
    maxX = num(raw.boundingBox?.maxX, 50);
    maxY = num(raw.boundingBox?.maxY, 50);
  }

  const boundingBox = {
    minX: isFiniteNum(raw.boundingBox?.minX) ? raw.boundingBox!.minX : minX,
    minY: isFiniteNum(raw.boundingBox?.minY) ? raw.boundingBox!.minY : minY,
    maxX: isFiniteNum(raw.boundingBox?.maxX) ? raw.boundingBox!.maxX : maxX,
    maxY: isFiniteNum(raw.boundingBox?.maxY) ? raw.boundingBox!.maxY : maxY,
  };
  if (boundingBox.maxX <= boundingBox.minX) boundingBox.maxX = boundingBox.minX + 100;
  if (boundingBox.maxY <= boundingBox.minY) boundingBox.maxY = boundingBox.minY + 100;

  const spanX = boundingBox.maxX - boundingBox.minX;
  const spanY = boundingBox.maxY - boundingBox.minY;

  const rawDims = Array.isArray(raw.dimensions) ? raw.dimensions : [];
  const dimensions: CadDimension[] = [];
  for (let i = 0; i < rawDims.length; i++) {
    const d = rawDims[i] as unknown as Record<string, unknown>;
    if (!d || typeof d !== 'object') continue;
    const x1 = Number(d.x1);
    const y1 = Number(d.y1);
    if (!isFiniteNum(x1) || !isFiniteNum(y1)) continue;
    const x2 = isFiniteNum(Number(d.x2)) ? Number(d.x2) : x1 + 15;
    const y2 = isFiniteNum(Number(d.y2)) ? Number(d.y2) : y1 + 15;
    const kind =
      d.kind === 'linear' || d.kind === 'diameter' || d.kind === 'radius' || d.kind === 'note'
        ? d.kind
        : 'linear';
    dimensions.push({
      id: typeof d.id === 'string' && d.id ? d.id : `dim-${i + 1}`,
      featureId: typeof d.featureId === 'string' && d.featureId ? d.featureId : undefined,
      viewId: typeof d.viewId === 'string' && d.viewId ? d.viewId : undefined,
      kind,
      label: typeof d.label === 'string' && d.label ? d.label : 'Dim',
      x1,
      y1,
      x2,
      y2,
      offset: num(d.offset, 0),
    });
  }

  const rawChunks = Array.isArray(raw.viewChunks) ? raw.viewChunks : [];
  const viewChunks: PdfViewChunkSummary[] | undefined =
    rawChunks.length > 0
      ? rawChunks.map((c, idx) => ({
          id: typeof c.id === 'string' && c.id ? c.id : `view-${idx + 1}`,
          label: typeof c.label === 'string' && c.label ? c.label : `View ${idx + 1}`,
          viewKind: VALID_VIEW_KINDS.has(c.viewKind) ? c.viewKind : 'orthogonal',
          pageNumber: Math.max(1, Math.round(num(c.pageNumber, 1))),
          normBounds: {
            x: Math.max(0, Math.min(0.95, num(c.normBounds?.x, 0.05))),
            y: Math.max(0, Math.min(0.95, num(c.normBounds?.y, 0.08))),
            w: Math.max(0.05, Math.min(1, num(c.normBounds?.w, 0.4))),
            h: Math.max(0.05, Math.min(1, num(c.normBounds?.h, 0.4))),
          },
          sheetOffset: {
            dx: num(c.sheetOffset?.dx, 0),
            dy: num(c.sheetOffset?.dy, 0),
          },
        }))
      : undefined;

  const rawFeatures = Array.isArray(raw.features) ? raw.features : [];
  const features: MachinedFeature[] = rawFeatures.map((f, i) => ({
    id: f.id || `feat-${i + 1}`,
    name: f.name || `Feature ${i + 1}`,
    category: f.category || 'contour',
    dimensions: f.dimensions || '—',
    depthMm: isFiniteNum(Number(f.depthMm)) ? Number(f.depthMm) : undefined,
    tolerance: f.tolerance,
    surfaceFinishRa: f.surfaceFinishRa,
    notes: f.notes,
  }));

  const rawOps = Array.isArray(raw.processPlan) ? raw.processPlan : [];
  const processPlan: ProcessOperation[] = rawOps.map((op, i) => ({
    id: op.id || `op-${i + 1}`,
    opNumber: Math.max(10, Math.round(num(op.opNumber, (i + 1) * 10))),
    operationName: op.operationName || `Operation ${i + 1}`,
    machineType: op.machineType || 'Milling',
    setupName: op.setupName || 'OP-10: Vise Datum',
    targetFeatureId: op.targetFeatureId,
    targetFeatureName: op.targetFeatureName || 'Part Feature',
    toolSpec: op.toolSpec || 'Ø10 mm Carbide Endmill',
    toolDiameterMm: Math.max(0.5, num(op.toolDiameterMm, 10)),
    flutes: Math.max(1, Math.round(num(op.flutes, 3))),
    spindleRpm: Math.max(100, Math.round(num(op.spindleRpm, 4500))),
    feedRateMmMin: Math.max(10, Math.round(num(op.feedRateMmMin, 800))),
    depthOfCutMm: Math.max(0.05, num(op.depthOfCutMm, 1.5)),
    coolant:
      op.coolant === 'Flood' ||
      op.coolant === 'Mist' ||
      op.coolant === 'Air Blast' ||
      op.coolant === 'Dry'
        ? op.coolant
        : 'Flood',
    setupTimeMin: Math.max(0, num(op.setupTimeMin, 10)),
    cycleTimeMin: Math.max(0.1, num(op.cycleTimeMin, 2.0)),
    inspectionNote: op.inspectionNote || 'Verify nominal dimensions.',
  }));

  const stockLen = Math.max(5, num(raw.stockEnvelope?.length, Math.ceil(spanX + 6)));
  const stockWid = Math.max(5, num(raw.stockEnvelope?.width, Math.ceil(spanY + 6)));
  const stockThk = Math.max(1, num(raw.stockEnvelope?.thickness, 15));

  return {
    partName: raw.partName || 'Mechanical Part',
    partNumber: raw.partNumber || 'DWG-001',
    revision: raw.revision || 'Rev A',
    units: raw.units === 'in' ? 'in' : 'mm',
    material: raw.material || '6061-T6 Aluminum',
    stockEnvelope: {
      length: stockLen,
      width: stockWid,
      thickness: stockThk,
      form:
        raw.stockEnvelope?.form === 'Round Bar' || raw.stockEnvelope?.form === 'Tube'
          ? raw.stockEnvelope.form
          : 'Plate / Bar',
    },
    generalTolerance: raw.generalTolerance || 'ISO 2768-m',
    surfaceFinishDefault: raw.surfaceFinishDefault || 'Ra 1.6 µm',
    boundingBox,
    viewChunks,
    entities,
    dimensions,
    features,
    processPlan,
    dfmNotes: Array.isArray(raw.dfmNotes) ? raw.dfmNotes.filter((n) => typeof n === 'string') : [],
    extractionSource: raw.extractionSource || 'gemini-pdf',
    detectedScaleLabel:
      typeof raw.detectedScaleLabel === 'string' && raw.detectedScaleLabel
        ? raw.detectedScaleLabel
        : undefined,
    detectedScaleFactor:
      isFiniteNum(Number(raw.detectedScaleFactor)) && Number(raw.detectedScaleFactor) > 0
        ? Number(raw.detectedScaleFactor)
        : undefined,
  };
}
