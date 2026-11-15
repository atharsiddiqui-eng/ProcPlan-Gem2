export type FlowDiagramMode = 'process' | 'code';

export type FlowNodeKind = 'input' | 'process' | 'decision' | 'server' | 'output';

export type WorkspaceTabTarget = 'upload' | 'cad' | 'process' | 'tooling' | 'export' | 'manual';

export interface FlowLane {
  id: string;
  title: string;
  x: number;
  width: number;
}

export interface FlowNode {
  id: string;
  stepCode: string;
  title: string;
  subtitle: string;
  lane: string;
  kind: FlowNodeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  summary: string;
  inputs: string[];
  outputs: string[];
  details: string[];
  targetTab?: WorkspaceTabTarget;
  targetTabLabel?: string;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  style: 'primary' | 'fallback' | 'feedback';
  fromSide?: 'right' | 'bottom' | 'top' | 'left';
  toSide?: 'left' | 'top' | 'bottom' | 'right';
}

export interface FlowDiagramSpec {
  mode: FlowDiagramMode;
  title: string;
  description: string;
  viewBoxWidth: number;
  viewBoxHeight: number;
  lanes: FlowLane[];
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export const PROCESS_FLOW_DIAGRAM: FlowDiagramSpec = {
  mode: 'process',
  title: 'End-to-End PDF-to-CNC Manufacturing Workflow',
  description:
    'Traces how a 2D mechanical drawing PDF is ingested, parsed into verified millimeter geometry, plotted in interactive CAD, converted to CNC operations, and exported to shop-floor formats.',
  viewBoxWidth: 1120,
  viewBoxHeight: 540,
  lanes: [
    { id: 'ingest', title: '01. PDF Ingestion', x: 16, width: 256 },
    { id: 'extract', title: '02. Extraction & Guard', x: 288, width: 284 },
    { id: 'cadcam', title: '03. CAD & Process Plan', x: 588, width: 276 },
    { id: 'export', title: '04. Shop-Floor Export', x: 880, width: 224 },
  ],
  nodes: [
    {
      id: 'proc-upload',
      stepCode: 'STEP 01',
      title: 'Upload Drawing Studio',
      subtitle: 'Stage PDF, Mode & Modules',
      lane: 'ingest',
      kind: 'input',
      x: 34,
      y: 78,
      width: 220,
      height: 82,
      summary:
        'Stages any 2D mechanical PDF or sample preset, configures Vector Plotting vs. AI Analysis, Auto vs. Manual view boxes, and checks CAD Plotting / Process Plan / Tooling & Feeds modules.',
      inputs: ['User-selected .pdf ArrayBuffer', 'Sample presets & shell PDF'],
      outputs: ['UploadPipelineConfig', 'Staged sheet + manual/auto view boxes'],
      details: [
        'Stages PDF preflight stats (vectors, scale, material) before execution.',
        'Supports interactive click-and-drag Manual View Definition on the sheet preview.',
        'Allows skipping unused CAD, Process, or Tooling modules on demand.',
      ],
      targetTab: 'upload',
      targetTabLabel: 'Open Upload Drawing',
    },
    {
      id: 'proc-pdfjs',
      stepCode: 'STEP 02',
      title: 'PDF.js Multi-View & Stream',
      subtitle: 'DrawOPS v5, Borders & Chunks',
      lane: 'ingest',
      kind: 'process',
      x: 34,
      y: 236,
      width: 220,
      height: 90,
      summary:
        'Decodes pdfjs-dist v5 packed DrawOPS vectors, filters SolidWorks borders/zone ticks/title blocks, classifies outlines/centerlines/dims, parses SCALE (e.g. 1:20), and clusters view chunks.',
      inputs: ['PDF byte stream', 'Local pdf.worker.min.mjs worker'],
      outputs: ['Linked viewChunks[] + titleBlockMeta', 'Scale factor & classified vectors'],
      details: [
        'Decodes pdfjs v5 Float32Array DrawOPS and strips #c0c0c0 borders & title blocks.',
        'Classifies dark outlines, #808080 dimensions, and dashed/axis centerlines.',
        'Parses SCALE (e.g. 1:20), material (M.S IS:2062), and clusters structural views.',
      ],
    },
    {
      id: 'proc-decision',
      stepCode: 'GATE 03',
      title: 'Extraction Strategy',
      subtitle: 'AI Vision vs. Raw Vectors',
      lane: 'extract',
      kind: 'decision',
      x: 312,
      y: 78,
      width: 236,
      height: 82,
      summary:
        'Routes the full PDF plus every linked view chunk through multimodal AI analysis, or plots partitioned PDF vectors directly when requested or as a fallback.',
      inputs: ['Full sheet PNG/PDF + viewChunks[]', 'Vector segment count & bounds'],
      outputs: ['Multi-view AI blueprint request', 'Or linked vector fallback path'],
      details: [
        'Sends compact PDF/JPEG + chunk previews + text/vector hints to /api/analyze-drawing.',
        'If AI analysis fails and embedded vectors exist, falls back to Plot Raw PDF Vectors.',
        'Users can re-partition chunks and re-run either Vectors or AI at any time.',
      ],
    },
    {
      id: 'proc-ai',
      stepCode: 'STEP 04A',
      title: 'AI Blueprint Comprehension',
      subtitle: 'Multi-View Chunks + Full PDF',
      lane: 'extract',
      kind: 'server',
      x: 312,
      y: 204,
      width: 236,
      height: 84,
      summary:
        'Cross-references individual view chunks (Orthogonal, Longitudinal, Cross-Section) with the complete original PDF to unify external profiles, internal bores, GD&T, and shop routing.',
      inputs: ['Original PDF/sheet image', 'Cropped viewChunks[] + text/vectors'],
      outputs: ['viewId-tagged CAD entities & dims', 'Features & multi-machine ops'],
      details: [
        'Links internal features from section views to outer orthographic geometry.',
        'Tags every entity and dimension with its viewId and sheetOffset.',
        'Assigns Lathe Machine, Milling, Grinding Finishing, and Gear Hobbing ops.',
      ],
    },
    {
      id: 'proc-vector',
      stepCode: 'STEP 04B',
      title: 'Direct Vector Plotter',
      subtitle: 'Scaled & Layered Assembly',
      lane: 'extract',
      kind: 'process',
      x: 312,
      y: 320,
      width: 236,
      height: 78,
      summary:
        'Applies detected drawing scale (1:1 Real vs. Paper) and chunk sheetOffsets to classified outline, centerline, and dimension vectors with alloy-matched routing.',
      inputs: ['Classified viewChunks[] vectors', 'Detected scaleFactor & titleBlockMeta'],
      outputs: ['1:1 Real or Paper CAD model', 'M.S IS:2062 / alloy baseline ops'],
      details: [
        'Scales geometry by drawing scale (e.g. ×20 for SCALE 1:20) into real mm.',
        'Derives cylindrical/tube stock envelopes and alloy-matched process ops.',
      ],
    },
    {
      id: 'proc-sanitize',
      stepCode: 'STEP 05',
      title: 'Coordinate & Schema Guard',
      subtitle: 'Finite Bounds & Safe Defaults',
      lane: 'extract',
      kind: 'process',
      x: 312,
      y: 430,
      width: 236,
      height: 78,
      summary:
        'Validates every numeric coordinate, radius, bounding box, stock dimension, and operation parameter so zero NaN or malformed geometry reaches the SVG canvas.',
      inputs: ['Raw AI or vector analysis payload'],
      outputs: ['Verified DrawingAnalysisResult'],
      details: [
        'Drops incomplete entities and defaults missing arc angles or offsets.',
        'Recomputes boundingBox from valid entities if bounds are degenerate.',
        'Ensures RPM, feed rate, DOC, and setup/cycle times are positive finite numbers.',
      ],
    },
    {
      id: 'proc-cad',
      stepCode: 'STEP 06',
      title: 'Interactive 2D CAD Plotter',
      subtitle: 'Multi-Plot · 1:1 Real vs. Paper',
      lane: 'cadcam',
      kind: 'process',
      x: 608,
      y: 96,
      width: 236,
      height: 92,
      summary:
        'Plots verified layered entities across Combined Sheet, Separate Plots, and Single View modes with instant 1:1 Real vs. Paper scale toggling and manual PDF box adjustment.',
      inputs: ['Layered viewId-tagged entities', 'scaleMode (real | paper) & pdfPayload'],
      outputs: ['Separate per-view or unified plots', 'Real-scale ΔX / ΔY / Dist measure'],
      details: [
        'Toggle 1:1 Real (e.g. 1000 × 440 mm) vs. Paper (50 × 22 mm) on scaled drawings.',
        'Switch between Combined Sheet, Separate Plots (multi-plot grid), and Single View.',
        'Adjust View Boxes on the PDF sheet to drag/resize view boundaries live.',
      ],
      targetTab: 'cad',
      targetTabLabel: 'Open CAD Plotter',
    },
    {
      id: 'proc-cam',
      stepCode: 'STEP 07',
      title: 'Process & Tooling Planner',
      subtitle: 'Lathe · Mill · Grind · Hob',
      lane: 'cadcam',
      kind: 'process',
      x: 608,
      y: 254,
      width: 236,
      height: 94,
      summary:
        'Plans shop-floor operations across Lathe Machine, Milling, Grinding Finishing, Gear Hobbing, Band Saw, and Inspection with header machine filtering and live 2D toolpath simulation.',
      inputs: ['Machined features & material', 'Machine filter & batch qty'],
      outputs: ['Multi-machine routing sequence', 'Rapid (G00) & Cut (G01) overlay'],
      details: [
        'Includes Machine Selection Filter in the Process Plan header.',
        'Supports Lathe Machine, Milling, Grinding Finishing, and Gear Hobbing templates.',
        'Computes alloy-specific RPM/feed/MRR and animates cutter travel in CAD.',
      ],
      targetTab: 'process',
      targetTabLabel: 'Open Process Plan',
    },
    {
      id: 'proc-export',
      stepCode: 'STEP 08',
      title: 'CAD & CNC Deliverables',
      subtitle: 'DXF · SVG · G-Code · CSV · PDF',
      lane: 'export',
      kind: 'output',
      x: 898,
      y: 174,
      width: 190,
      height: 112,
      summary:
        'Compiles plotted 2D entities and planned machining operations into downloadable industry-standard engineering and CNC shop-floor files.',
      inputs: ['Verified CAD entities', 'Ordered ProcessPlan & batch qty'],
      outputs: ['.DXF (AutoCAD)', '.SVG (Scaled)', '.NC (Fanuc/GRBL)', '.CSV (Routing)'],
      details: [
        'DXF writer outputs HEADER ($INSUNITS) and ENTITIES (LINE, CIRCLE, ARC).',
        'G-code generator emits G90 G21 G17 G54 headers, tool calls (T01 M06), and toolpath moves.',
        'Routing CSV includes setup time, per-piece cycle time, and total batch hours.',
      ],
      targetTab: 'export',
      targetTabLabel: 'Open Export & G-Code',
    },
  ],
  edges: [
    { id: 'pe-1', from: 'proc-upload', to: 'proc-pdfjs', style: 'primary', fromSide: 'bottom', toSide: 'top' },
    { id: 'pe-2', from: 'proc-pdfjs', to: 'proc-decision', label: 'PNG + Tokens', style: 'primary', fromSide: 'right', toSide: 'left' },
    { id: 'pe-3', from: 'proc-decision', to: 'proc-ai', label: 'AI Mode', style: 'primary', fromSide: 'bottom', toSide: 'top' },
    { id: 'pe-4', from: 'proc-decision', to: 'proc-vector', label: 'Vector Fallback', style: 'fallback', fromSide: 'right', toSide: 'right' },
    { id: 'pe-5', from: 'proc-ai', to: 'proc-sanitize', style: 'primary', fromSide: 'bottom', toSide: 'top' },
    { id: 'pe-6', from: 'proc-vector', to: 'proc-sanitize', style: 'fallback', fromSide: 'bottom', toSide: 'top' },
    { id: 'pe-7', from: 'proc-sanitize', to: 'proc-cad', label: 'Verified Geometry', style: 'primary', fromSide: 'right', toSide: 'left' },
    { id: 'pe-8', from: 'proc-sanitize', to: 'proc-cam', label: 'Features + Ops', style: 'primary', fromSide: 'right', toSide: 'left' },
    { id: 'pe-9', from: 'proc-cam', to: 'proc-cad', label: 'Toolpath Sim', style: 'feedback', fromSide: 'top', toSide: 'bottom' },
    { id: 'pe-10', from: 'proc-cad', to: 'proc-export', label: 'Entities', style: 'primary', fromSide: 'right', toSide: 'left' },
    { id: 'pe-11', from: 'proc-cam', to: 'proc-export', label: 'Routing + Params', style: 'primary', fromSide: 'right', toSide: 'left' },
  ],
};

export const CODE_FLOW_DIAGRAM: FlowDiagramSpec = {
  mode: 'code',
  title: 'Application Code Architecture & Data Flow',
  description:
    'Maps how the React workspace shell, client PDF/CAM/sanitizer utilities, Express backend endpoints, and Gemini SDK interact across client and server boundaries.',
  viewBoxWidth: 1120,
  viewBoxHeight: 540,
  lanes: [
    { id: 'shell', title: '01. Workspace & Presets', x: 16, width: 256 },
    { id: 'engines', title: '02. Client Engines', x: 288, width: 276 },
    { id: 'backend', title: '03. Express & Gemini API', x: 580, width: 266 },
    { id: 'views', title: '04. Views & Exporters', x: 862, width: 242 },
  ],
  nodes: [
    {
      id: 'code-app',
      stepCode: 'SHELL',
      title: 'App.tsx & Upload Studio',
      subtitle: 'Staging, Modules & User Manual',
      lane: 'shell',
      kind: 'input',
      x: 34,
      y: 84,
      width: 220,
      height: 92,
      summary:
        'Coordinates UploadDrawingPanel staging, active/skipped pipeline modules, DrawingAnalysisResult, CAD/CAM panels, FlowChart, and the searchable UserManualPanel.',
      inputs: ['Staged PDF & UploadPipelineConfig', 'Sample presets', 'Module checkboxes'],
      outputs: ['Props to Upload / CAD / CAM / Manual', 'Fetch calls to /api/*'],
      details: [
        'Routes Run Pipeline to the first enabled output tab (CAD -> Process -> Tooling).',
        'Provides on-demand Enable & Generate recovery inside any skipped tab.',
        'Includes a 9-chapter searchable User Manual with direct tab deep links.',
      ],
      targetTab: 'upload',
      targetTabLabel: 'Open Upload Drawing',
    },
    {
      id: 'code-samples',
      stepCode: 'PRESETS',
      title: 'sampleDrawings.ts',
      subtitle: 'Presets, Shell.pdf & %PDF-1.4',
      lane: 'shell',
      kind: 'input',
      x: 34,
      y: 252,
      width: 220,
      height: 88,
      summary:
        'Provides built-in %PDF-1.4 mechanical presets plus the Bend Pulley Shell SolidWorks PDF reference asset loaded directly through pdfEngine.ts.',
      inputs: ['SampleDrawingPreset specs & assetUrl', 'Bend Pulley Shell reference PDF'],
      outputs: ['Live PDF ArrayBuffer', 'Initial DrawingAnalysisResult'],
      details: [
        'Supports both programmatic %PDF-1.4 presets and real SolidWorks PDF assets.',
        'Allows instant testing of DrawOPS v5 decoding, scale 1:20, and 3-view chunking.',
      ],
    },
    {
      id: 'code-pdfengine',
      stepCode: 'PDF.JS',
      title: 'pdfEngine.ts',
      subtitle: 'DrawOPS v5, Filter & Scale Engine',
      lane: 'engines',
      kind: 'process',
      x: 308,
      y: 84,
      width: 236,
      height: 92,
      summary:
        'Decodes pdfjs v5 Float32Array DrawOPS, filters SolidWorks borders/title blocks, classifies layers, parses SCALE/material metadata, and builds 1:1 Real or Paper vector models.',
      inputs: ['PDF ArrayBuffer', 'Edited chunk bounds & scaleMode'],
      outputs: ['PdfExtractionPayload + titleBlockMeta', 'buildRawVectorAnalysis(payload, scaleMode)'],
      details: [
        'isSheetChromeSegment() + classifySegmentLayer() strip borders and tag dims/axes.',
        'detectViewRegions() clusters structural entities so dim lines never merge views.',
      ],
    },
    {
      id: 'code-sanitizer',
      stepCode: 'GUARD',
      title: 'sanitizeAnalysis.ts',
      subtitle: 'Strict Schema & NaN Guard',
      lane: 'engines',
      kind: 'process',
      x: 308,
      y: 236,
      width: 236,
      height: 88,
      summary:
        'Normalizes AI and raw-vector payloads into valid DrawingAnalysisResult objects, validating finite coordinates, viewId links, viewChunks bounds, and operation parameters.',
      inputs: ['Partial<DrawingAnalysisResult> from API or vector parser'],
      outputs: ['Sanitized DrawingAnalysisResult'],
      details: [
        'Filters line/circle/arc/rect/polyline records lacking finite coordinates.',
        'Clamps viewChunks normBounds and preserves sheetOffset & viewId linkage.',
      ],
    },
    {
      id: 'code-camengine',
      stepCode: 'CAM MATH',
      title: 'camEngine.ts',
      subtitle: 'Machines, M.S IS:2062 & Export',
      lane: 'engines',
      kind: 'process',
      x: 308,
      y: 382,
      width: 236,
      height: 92,
      summary:
        'Defines SHOP_MACHINES (Lathe, Milling, Grinding Finishing, Gear Hobbing, Band Saw, Inspection), M.S IS:2062 & alloy presets, toolpath simulation, and DXF/SVG/NC/CSV exporters.',
      inputs: ['DrawingAnalysisResult', 'MachineCategory & MaterialPreset'],
      outputs: ['ToolpathSegment[] (view-aware)', 'DXF / SVG / NC / CSV strings'],
      details: [
        'matchMaterialPreset() recognizes M.S IS:2062 mild steel alongside aluminum/4140/SS.',
        'generateToolpathOverlay() filters toolpaths cleanly when isolating a Single View.',
      ],
      targetTab: 'tooling',
      targetTabLabel: 'Open Tooling & Feeds',
    },
    {
      id: 'code-express',
      stepCode: 'SERVER',
      title: 'server.ts (Express)',
      subtitle: 'Port 3000 + Retry /api/* Proxy',
      lane: 'backend',
      kind: 'server',
      x: 598,
      y: 104,
      width: 230,
      height: 96,
      summary:
        'Runs Express with Vite middleware on port 3000, accepting PDF/sheet image + viewChunks[] in /api/analyze-drawing with retry backoff and slim fallback against ECONNRESET.',
      inputs: ['POST JSON (pdfBase64, pageImage, viewChunks[])'],
      outputs: ['Multi-view DrawingAnalysisResult JSON', 'Replanned processPlan'],
      details: [
        'Keeps GEMINI_API_KEY strictly on the server; never exposed to browser.',
        'Uses exponential backoff retries and slim-image fallback on transient socket resets.',
      ],
    },
    {
      id: 'code-gemini',
      stepCode: 'GEMINI',
      title: '@google/genai SDK',
      subtitle: 'gemini-4-hydrogen + Schema',
      lane: 'backend',
      kind: 'server',
      x: 598,
      y: 266,
      width: 230,
      height: 96,
      summary:
        'Server-side GoogleGenAI client calling gemini-4-hydrogen with multimodal PDF + chunk images, 90s HTTP timeout, ThinkingLevel.MEDIUM/LOW, and strict Type.OBJECT schema.',
      inputs: ['Multimodal PDF + Chunk Images + prompt', 'drawingAnalysisSchema'],
      outputs: ['viewId-linked CAD + Multi-Machine CAM JSON'],
      details: [
        'Uses User-Agent: aistudio-build header and preserves viewChunks linkage.',
        '/api/replan-process routes ops across Lathe, Milling, Grinding & Hobbing.',
      ],
    },
    {
      id: 'code-cadview',
      stepCode: 'VIEW 01',
      title: 'CadViewport & CadPlotCanvas',
      subtitle: 'Multi-Plot, Scale Toggle & Boxes',
      lane: 'views',
      kind: 'output',
      x: 880,
      y: 78,
      width: 206,
      height: 88,
      summary:
        'Renders interactive SVG CAD plots via CadPlotCanvas in Combined Sheet, Separate Plots, or Single View mode, with 1:1 Real vs. Paper scale switching and draggable PDF view boxes.',
      inputs: ['viewId-tagged entities & dims', 'scaleMode & detectedScaleLabel', 'pdfPayload'],
      outputs: ['Repartitioned PdfExtractionPayload', 'Rescaled multi-view CAD plots'],
      details: [
        'Toggles 1:1 Real vs. Paper coordinates smoothly across vectors and AI analyses.',
        'Applies safeScale / safeNum guards across every SVG coordinate attribute.',
      ],
      targetTab: 'cad',
      targetTabLabel: 'Open CAD Plotter',
    },
    {
      id: 'code-planning-views',
      stepCode: 'VIEW 02',
      title: 'Process & Tooling Panels',
      subtitle: 'Machine Filter + Feeds Calc',
      lane: 'views',
      kind: 'output',
      x: 880,
      y: 214,
      width: 206,
      height: 92,
      summary:
        'Provides Process Plan header machine filtering (Lathe Machine, Milling, Grinding Finishing, Gear Hobbing, Band Saw, Inspection), inline editing, and MRR speeds/feeds calculation.',
      inputs: ['processPlan[]', 'SHOP_MACHINES', 'calculateCuttingParams()'],
      outputs: ['Updated DrawingAnalysisResult', 'Machine-aware AI replan'],
      details: [
        'Filters routing table by machine category and adds machine-specific ops.',
        'Clicking any operation row isolates its toolpath in CadViewport.',
      ],
      targetTab: 'process',
      targetTabLabel: 'Open Process Plan',
    },
    {
      id: 'code-export-view',
      stepCode: 'VIEW 03',
      title: 'ExportPanel.tsx',
      subtitle: 'Code Preview & Downloads',
      lane: 'views',
      kind: 'output',
      x: 880,
      y: 354,
      width: 206,
      height: 88,
      summary:
        'Displays live syntax-clean previews for G-Code, DXF entities, Routing CSV, and SVG markup with clipboard copy and Blob file downloads.',
      inputs: ['camEngine exporters', 'currentPdfBytes'],
      outputs: ['.dxf, .svg, .nc, .csv, .pdf files'],
      details: [
        'Triggers client-side Blob URL downloads without server round-trips.',
      ],
      targetTab: 'export',
      targetTabLabel: 'Open Export & G-Code',
    },
  ],
  edges: [
    { id: 'ce-1', from: 'code-samples', to: 'code-app', label: 'Preset + PDF Bytes', style: 'primary', fromSide: 'top', toSide: 'bottom' },
    { id: 'ce-2', from: 'code-app', to: 'code-pdfengine', label: 'ArrayBuffer', style: 'primary', fromSide: 'right', toSide: 'left' },
    { id: 'ce-3', from: 'code-pdfengine', to: 'code-sanitizer', label: 'Raw Vectors', style: 'fallback', fromSide: 'bottom', toSide: 'top' },
    { id: 'ce-4', from: 'code-app', to: 'code-express', label: 'POST /api/analyze', style: 'primary', fromSide: 'right', toSide: 'left' },
    { id: 'ce-5', from: 'code-express', to: 'code-gemini', label: 'generateContent', style: 'primary', fromSide: 'bottom', toSide: 'top' },
    { id: 'ce-6', from: 'code-gemini', to: 'code-sanitizer', label: 'JSON Response', style: 'primary', fromSide: 'left', toSide: 'right' },
    { id: 'ce-7', from: 'code-sanitizer', to: 'code-cadview', label: 'Safe Entities', style: 'primary', fromSide: 'right', toSide: 'left' },
    { id: 'ce-8', from: 'code-camengine', to: 'code-cadview', label: 'Toolpath Overlay', style: 'feedback', fromSide: 'right', toSide: 'left' },
    { id: 'ce-9', from: 'code-camengine', to: 'code-planning-views', label: 'RPM / Feed Math', style: 'primary', fromSide: 'right', toSide: 'left' },
    { id: 'ce-10', from: 'code-camengine', to: 'code-export-view', label: 'DXF / NC / CSV', style: 'primary', fromSide: 'right', toSide: 'left' },
    { id: 'ce-11', from: 'code-planning-views', to: 'code-express', label: 'POST /api/replan', style: 'fallback', fromSide: 'left', toSide: 'right' },
  ],
};

export const FLOW_DIAGRAMS: Record<FlowDiagramMode, FlowDiagramSpec> = {
  process: PROCESS_FLOW_DIAGRAM,
  code: CODE_FLOW_DIAGRAM,
};
