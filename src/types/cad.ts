export type CadLayer =
  | 'outline'
  | 'centerline'
  | 'hidden'
  | 'hole'
  | 'dimension'
  | 'toolpath';

export type ViewChunkKind =
  | 'orthogonal'
  | 'longitudinal-section'
  | 'cross-section'
  | 'detail'
  | 'isometric';

export interface NormalizedRect {
  x: number; // 0..1 from left of PDF page
  y: number; // 0..1 from top of PDF page
  w: number; // 0..1 width fraction
  h: number; // 0..1 height fraction
}

export interface PdfViewBox {
  id: string;
  label: string;
  viewKind: ViewChunkKind;
  normBounds: NormalizedRect;
}

export interface PdfViewChunkSummary {
  id: string;
  label: string;
  viewKind: ViewChunkKind;
  pageNumber: number;
  normBounds: NormalizedRect;
  sheetOffset: { dx: number; dy: number };
}

export interface PdfViewChunk extends PdfViewChunkSummary {
  croppedImageDataUrl: string;
  extractedText: string[];
  vectorEntities: CadEntity[];
  boundingBox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

export interface RawNormalizedSegment {
  nx1: number;
  ny1: number;
  nx2: number;
  ny2: number;
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
  layerHint?: CadLayer;
}

export interface RawNormalizedText {
  text: string;
  nx: number;
  ny: number;
}

export interface CadLineEntity {
  id: string;
  featureId?: string;
  viewId?: string;
  layer: CadLayer;
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface CadCircleEntity {
  id: string;
  featureId?: string;
  viewId?: string;
  layer: CadLayer;
  type: 'circle';
  cx: number;
  cy: number;
  r: number;
}

export interface CadArcEntity {
  id: string;
  featureId?: string;
  viewId?: string;
  layer: CadLayer;
  type: 'arc';
  cx: number;
  cy: number;
  r: number;
  startAngle: number; // degrees CCW from +X
  endAngle: number;   // degrees CCW from +X
}

export interface CadRectEntity {
  id: string;
  featureId?: string;
  viewId?: string;
  layer: CadLayer;
  type: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
}

export interface CadPolylineEntity {
  id: string;
  featureId?: string;
  viewId?: string;
  layer: CadLayer;
  type: 'polyline';
  points: { x: number; y: number }[];
  closed?: boolean;
}

export type CadEntity =
  | CadLineEntity
  | CadCircleEntity
  | CadArcEntity
  | CadRectEntity
  | CadPolylineEntity;

export interface CadDimension {
  id: string;
  featureId?: string;
  viewId?: string;
  kind: 'linear' | 'diameter' | 'radius' | 'note';
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  offset?: number;
}

export type FeatureCategory =
  | 'contour'
  | 'bore'
  | 'hole'
  | 'pocket'
  | 'slot'
  | 'thread'
  | 'chamfer'
  | 'turning'
  | 'groove'
  | 'gear'
  | 'grinding';

export type MachineCategory =
  | 'Lathe Machine'
  | 'Milling'
  | 'Grinding Finishing'
  | 'Gear Hobbing'
  | 'Band Saw'
  | 'Inspection';

export interface MachinedFeature {
  id: string;
  name: string;
  category: FeatureCategory;
  dimensions: string;
  depthMm?: number;
  tolerance?: string;
  surfaceFinishRa?: string;
  notes?: string;
}

export interface ProcessOperation {
  id: string;
  opNumber: number;
  operationName: string;
  machineType: string;
  setupName: string;
  targetFeatureId?: string;
  targetFeatureName: string;
  toolSpec: string;
  toolDiameterMm: number;
  flutes: number;
  spindleRpm: number;
  feedRateMmMin: number;
  depthOfCutMm: number;
  coolant: 'Flood' | 'Mist' | 'Air Blast' | 'Dry';
  setupTimeMin: number;
  cycleTimeMin: number;
  inspectionNote: string;
}

export interface StockEnvelope {
  length: number;
  width: number;
  thickness: number;
  form: 'Plate / Bar' | 'Round Bar' | 'Tube';
}

export interface DrawingAnalysisResult {
  partName: string;
  partNumber: string;
  revision: string;
  units: 'mm' | 'in';
  material: string;
  stockEnvelope: StockEnvelope;
  generalTolerance: string;
  surfaceFinishDefault: string;
  boundingBox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  viewChunks?: PdfViewChunkSummary[];
  entities: CadEntity[];
  dimensions: CadDimension[];
  features: MachinedFeature[];
  processPlan: ProcessOperation[];
  dfmNotes: string[];
  extractionSource: 'gemini-pdf' | 'pdf-vector' | 'hybrid-pdf';
  detectedScaleLabel?: string;
  detectedScaleFactor?: number;
}

export interface PdfTitleBlockMeta {
  partName?: string;
  partNumber?: string;
  revision?: string;
  material?: string;
  units?: 'mm' | 'in';
  weight?: string;
  scaleLabel?: string;
  scaleFactor?: number;
}

export interface PdfExtractionPayload {
  fileName: string;
  pageCount: number;
  selectedPage: number;
  pageWidthPt: number;
  pageHeightPt: number;
  renderedImageDataUrl: string;
  extractedText: string[];
  vectorEntityCount: number;
  vectorEntities: CadEntity[];
  vectorBoundingBox: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  hasMultipleViews: boolean;
  viewChunks: PdfViewChunk[];
  rawNormalizedSegments: RawNormalizedSegment[];
  rawNormalizedTextItems: RawNormalizedText[];
  detectedScaleLabel?: string;
  detectedScaleFactor?: number;
  titleBlockMeta?: PdfTitleBlockMeta;
}

export interface MaterialMachiningPreset {
  id: string;
  name: string;
  isoGroup: 'N' | 'P' | 'M' | 'K';
  surfaceSpeedMMin: number;
  chipLoadMmTooth: number;
  densityGcm3: number;
  costPerKgUsd: number;
  machinabilityNote: string;
}

export type UploadExtractionEngine = 'vector' | 'ai';

export type ViewDefinitionMode = 'auto' | 'manual';

export interface PipelineModulesConfig {
  cadPlotting: boolean;
  processPlan: boolean;
  toolingFeeds: boolean;
}

export interface UploadPipelineConfig {
  engine: UploadExtractionEngine;
  viewMode: ViewDefinitionMode;
  modules: PipelineModulesConfig;
  scaleMode: 'real' | 'paper';
  customScaleRatio?: number;
  unitsOverride: 'auto' | 'mm' | 'in';
  preferredMaterial?: string;
  preferredMachines: MachineCategory[];
  batchSize: number;
}

export type WorkspaceTab =
  | 'upload'
  | 'cad'
  | 'process'
  | 'tooling'
  | 'export'
  | 'flow'
  | 'manual';

