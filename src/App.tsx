import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Eye,
  EyeOff,
  FileText,
  Layers,
  Loader2,
  Upload,
} from 'lucide-react';
import { CadViewport } from './components/CadViewport';
import { ExportPanel } from './components/ExportPanel';
import { FlowChartPanel } from './components/FlowChartPanel';
import { ProcessPlanPanel } from './components/ProcessPlanPanel';
import { ToolingFeedsPanel } from './components/ToolingFeedsPanel';
import { UploadDrawingPanel } from './components/UploadDrawingPanel';
import { UserManualPanel } from './components/UserManualPanel';
import type {
  CadLayer,
  DrawingAnalysisResult,
  MachineCategory,
  PdfExtractionPayload,
  PdfViewBox,
  PipelineModulesConfig,
  UploadPipelineConfig,
  WorkspaceTab,
} from './types/cad';
import {
  buildRawVectorAnalysis,
  extractPdfPage,
  repartitionPdfChunks,
  type VectorAnalysisOptions,
} from './utils/pdfEngine';
import { sanitizeAnalysisResult } from './utils/sanitizeAnalysis';
import {
  SAMPLE_DRAWINGS,
  generateSampleMechanicalPdfBytes,
  type SampleDrawingPreset,
} from './utils/sampleDrawings';

const WORKSPACE_TABS: ReadonlyArray<[WorkspaceTab, string]> = [
  ['upload', 'Upload Drawing'],
  ['cad', 'CAD Plotter'],
  ['process', 'Process Plan'],
  ['tooling', 'Tooling & Feeds'],
  ['export', 'Export & G-Code'],
  ['flow', 'Flow Chart'],
  ['manual', 'User Manual'],
];

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function compactDataUrlForAi(
  dataUrl: string,
  maxDim = 1280,
  quality = 0.85
): Promise<string> {
  if (!dataUrl || typeof document === 'undefined') return dataUrl;
  try {
    const img = new Image();
    img.src = dataUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image load failed'));
    });
    const w = img.naturalWidth || 1200;
    const h = img.naturalHeight || 850;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return dataUrl;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return dataUrl;
  }
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('upload');
  const [activeSampleId, setActiveSampleId] = useState<string>(SAMPLE_DRAWINGS[0].id);
  const [analysis, setAnalysis] = useState<DrawingAnalysisResult>(SAMPLE_DRAWINGS[0].analysis);
  const [pdfPayload, setPdfPayload] = useState<PdfExtractionPayload | null>(null);
  const [currentPdfBytes, setCurrentPdfBytes] = useState<ArrayBuffer | null>(null);
  const [currentPdfName, setCurrentPdfName] = useState<string>(SAMPLE_DRAWINGS[0].fileName);

  // Staged Upload Drawing Studio state
  const [stagedPdfBytes, setStagedPdfBytes] = useState<ArrayBuffer | null>(null);
  const [stagedPdfPayload, setStagedPdfPayload] = useState<PdfExtractionPayload | null>(null);
  const [stagedSampleId, setStagedSampleId] = useState<string>(SAMPLE_DRAWINGS[0].id);
  const [isStagingPdf, setIsStagingPdf] = useState<boolean>(false);
  const [uploadConfig, setUploadConfig] = useState<UploadPipelineConfig>({
    engine: 'vector',
    viewMode: 'auto',
    modules: {
      cadPlotting: true,
      processPlan: true,
      toolingFeeds: true,
    },
    scaleMode: 'real',
    unitsOverride: 'auto',
    preferredMachines: [],
    batchSize: 25,
  });
  const [enabledModules, setEnabledModules] = useState<PipelineModulesConfig>({
    cadPlotting: true,
    processPlan: true,
    toolingFeeds: true,
  });

  const [visibleLayers, setVisibleLayers] = useState<Record<CadLayer, boolean>>({
    outline: true,
    hole: true,
    centerline: true,
    hidden: true,
    dimension: true,
    toolpath: true,
  });
  const [showStockEnvelope, setShowStockEnvelope] = useState<boolean>(true);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [scaleMode, setScaleMode] = useState<'real' | 'paper'>('real');
  const [batchSize, setBatchSize] = useState<number>(25);

  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [replanning, setReplanning] = useState<boolean>(false);
  const [dragOver, setDragOver] = useState<boolean>(false);

  const stagedAutoBoxes: PdfViewBox[] = React.useMemo(() => {
    if (!stagedPdfPayload) return [];
    return stagedPdfPayload.viewChunks.map((c) => ({
      id: c.id,
      label: c.label,
      viewKind: c.viewKind,
      normBounds: { ...c.normBounds },
    }));
  }, [stagedPdfPayload]);

  const getVectorOptions = (
    mode: 'real' | 'paper' = scaleMode,
    modules: PipelineModulesConfig = enabledModules,
    materialOverride?: string,
    cfg: UploadPipelineConfig = uploadConfig
  ): VectorAnalysisOptions => ({
    scaleMode: mode,
    customScaleRatio: cfg.customScaleRatio,
    unitsOverride: cfg.unitsOverride,
    preferredMaterial: materialOverride ?? cfg.preferredMaterial,
    preferredMachines: cfg.preferredMachines,
    modules,
  });

  const firstEnabledTab = (modules: PipelineModulesConfig): WorkspaceTab =>
    modules.cadPlotting ? 'cad' : modules.processPlan ? 'process' : 'tooling';

  const syncEngineForPayload = (extracted: PdfExtractionPayload) => {
    setUploadConfig((prev) => ({
      ...prev,
      engine: extracted.vectorEntityCount > 0 ? 'vector' : 'ai',
    }));
  };

  const fetchSamplePdfBytes = async (preset: SampleDrawingPreset): Promise<ArrayBuffer> => {
    if (!preset.assetUrl) return generateSampleMechanicalPdfBytes(preset);
    const resp = await fetch(preset.assetUrl);
    if (!resp.ok) {
      throw new Error(`Failed to fetch reference PDF (${resp.status})`);
    }
    return resp.arrayBuffer();
  };

  // Stage a PDF buffer inside Upload Drawing without firing extraction yet
  const stagePdfBuffer = async (
    bytes: ArrayBuffer,
    fileName: string,
    pageNum = 1,
    sampleId = ''
  ) => {
    setIsStagingPdf(true);
    setErrorMsg(null);
    try {
      const extracted = await extractPdfPage(bytes, fileName, pageNum);
      setStagedPdfBytes(bytes);
      setStagedPdfPayload(extracted);
      setStagedSampleId(sampleId);
      syncEngineForPayload(extracted);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to render PDF preview.');
    } finally {
      setIsStagingPdf(false);
    }
  };

  const stageSamplePreset = async (preset: SampleDrawingPreset) => {
    setErrorMsg(null);
    setIsStagingPdf(true);
    try {
      const pdfBytes = await fetchSamplePdfBytes(preset);
      await stagePdfBuffer(pdfBytes, preset.fileName, 1, preset.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to stage sample PDF.');
      setIsStagingPdf(false);
    }
  };

  // Load a sample preset immediately (used from left rail quick-switcher and initial boot)
  const loadSamplePreset = async (preset: SampleDrawingPreset) => {
    setErrorMsg(null);
    setActiveSampleId(preset.id);
    setStagedSampleId(preset.id);
    setSelectedFeatureId(null);
    setSelectedOpId(null);
    setActiveViewId(null);
    setScaleMode('real');
    setEnabledModules({ cadPlotting: true, processPlan: true, toolingFeeds: true });
    setCurrentPdfName(preset.fileName);

    if (preset.assetUrl) {
      setLoadingStatus(`Loading reference PDF (${preset.fileName}) & extracting multi-view vectors...`);
    } else {
      setAnalysis(sanitizeAnalysisResult(preset.analysis));
    }

    try {
      const pdfBytes = await fetchSamplePdfBytes(preset);
      setCurrentPdfBytes(pdfBytes);
      setStagedPdfBytes(pdfBytes);
      const extracted = await extractPdfPage(pdfBytes, preset.fileName, 1);
      setPdfPayload(extracted);
      setStagedPdfPayload(extracted);
      syncEngineForPayload(extracted);
      if (preset.assetUrl) {
        setAnalysis(sanitizeAnalysisResult(buildRawVectorAnalysis(extracted, 'real')));
      }
    } catch (err) {
      console.error('Failed to load sample PDF:', err);
      if (preset.assetUrl) {
        setErrorMsg(err instanceof Error ? err.message : 'Unable to load reference PDF.');
        setAnalysis(sanitizeAnalysisResult(preset.analysis));
      }
    } finally {
      setLoadingStatus(null);
    }
  };

  useEffect(() => {
    loadSamplePreset(SAMPLE_DRAWINGS[0]);
  }, []);

  const runAiBlueprintAnalysis = async (
    extracted: PdfExtractionPayload,
    rawPdfBytes: ArrayBuffer | null,
    pipelineOpts?: UploadPipelineConfig
  ) => {
    const viewCount = extracted.viewChunks.length;
    setLoadingStatus(
      viewCount > 1
        ? `Analyzing ${viewCount} linked PDF view chunks (${extracted.viewChunks.map((c) => c.label).join(', ')})...`
        : 'Extracting 2D geometry & generating process plan...'
    );

    const canSendRawPdf = Boolean(rawPdfBytes && rawPdfBytes.byteLength <= 2 * 1024 * 1024);
    const vectorSummary =
      extracted.vectorEntityCount > 0
        ? `Detected ${extracted.vectorEntityCount} PDF vector segments spanning X:[${extracted.vectorBoundingBox.minX}, ${extracted.vectorBoundingBox.maxX}] mm, Y:[${extracted.vectorBoundingBox.minY}, ${extracted.vectorBoundingBox.maxY}] mm.`
        : 'Raster or outlined blueprint without raw PDF line operators.';

    const compactPageImage = await compactDataUrlForAi(extracted.renderedImageDataUrl, 1280, 0.85);
    const attachChunkImages = extracted.viewChunks.length > 1;
    const serializedChunks = await Promise.all(
      extracted.viewChunks.slice(0, 6).map(async (c) => ({
        id: c.id,
        label: c.label,
        viewKind: c.viewKind,
        pageNumber: c.pageNumber,
        normBounds: c.normBounds,
        sheetOffset: c.sheetOffset,
        croppedImageBase64: attachChunkImages
          ? await compactDataUrlForAi(c.croppedImageDataUrl, 900, 0.84)
          : undefined,
        extractedText: c.extractedText,
        vectorSummary: `${c.vectorEntities.length} segments spanning X:[${c.boundingBox.minX}, ${c.boundingBox.maxX}] Y:[${c.boundingBox.minY}, ${c.boundingBox.maxY}] mm`,
      }))
    );

    const resp = await fetch('/api/analyze-drawing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: extracted.fileName,
        pdfBase64: canSendRawPdf && rawPdfBytes ? arrayBufferToBase64(rawPdfBytes) : undefined,
        pageImageBase64: compactPageImage,
        extractedText: extracted.extractedText,
        vectorSummary,
        preferredMachines: pipelineOpts?.preferredMachines,
        preferredMaterial: pipelineOpts?.preferredMaterial,
        unitsOverride: pipelineOpts?.unitsOverride,
        modules: pipelineOpts?.modules,
        viewChunks: serializedChunks,
      }),
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || `Server returned ${resp.status}`);
    }

    const result = (await resp.json()) as DrawingAnalysisResult;
    setActiveViewId(null);
    const targetScaleMode = pipelineOpts?.scaleMode ?? 'real';
    setScaleMode(targetScaleMode);
    setAnalysis(
      sanitizeAnalysisResult({
        ...result,
        detectedScaleLabel: result.detectedScaleLabel || extracted.detectedScaleLabel,
        detectedScaleFactor:
          pipelineOpts?.customScaleRatio || result.detectedScaleFactor || extracted.detectedScaleFactor,
      })
    );
  };

  const handleRunConfiguredPipeline = async (boxesToUse: PdfViewBox[]) => {
    if (!stagedPdfPayload) return;
    setErrorMsg(null);
    setSelectedFeatureId(null);
    setSelectedOpId(null);
    setActiveViewId(null);

    let workingPayload = stagedPdfPayload;
    if (uploadConfig.viewMode === 'manual' && boxesToUse.length > 0) {
      setLoadingStatus('Repartitioning PDF with manual view regions...');
      try {
        workingPayload = await repartitionPdfChunks(stagedPdfPayload, boxesToUse);
        setStagedPdfPayload(workingPayload);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to apply manual view regions.');
        setLoadingStatus(null);
        return;
      }
    }

    setPdfPayload(workingPayload);
    setCurrentPdfBytes(stagedPdfBytes);
    setCurrentPdfName(workingPayload.fileName);
    setActiveSampleId(stagedSampleId);
    setScaleMode(uploadConfig.scaleMode);
    setBatchSize(uploadConfig.batchSize);
    setEnabledModules({ ...uploadConfig.modules });

    const useVectorEngine =
      uploadConfig.engine === 'vector' && workingPayload.vectorEntityCount > 0;
    const vectorOpts = getVectorOptions(uploadConfig.scaleMode, uploadConfig.modules);

    try {
      if (useVectorEngine) {
        setAnalysis(sanitizeAnalysisResult(buildRawVectorAnalysis(workingPayload, vectorOpts)));
      } else {
        await runAiBlueprintAnalysis(workingPayload, stagedPdfBytes, uploadConfig);
      }
      setActiveTab(firstEnabledTab(uploadConfig.modules));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pipeline execution failed.';
      setErrorMsg(msg);
      if (workingPayload.vectorEntityCount > 0) {
        setAnalysis(sanitizeAnalysisResult(buildRawVectorAnalysis(workingPayload, vectorOpts)));
        setActiveTab(firstEnabledTab(uploadConfig.modules));
      }
    } finally {
      setLoadingStatus(null);
    }
  };

  const handleEnableSkippedModule = async (moduleKey: keyof PipelineModulesConfig) => {
    const nextModules: PipelineModulesConfig = {
      ...enabledModules,
      [moduleKey]: true,
    };
    setEnabledModules(nextModules);
    setUploadConfig((prev) => ({
      ...prev,
      modules: nextModules,
    }));

    if (moduleKey === 'toolingFeeds') return;

    if (moduleKey === 'cadPlotting' && pdfPayload && pdfPayload.vectorEntityCount > 0) {
      const rebuilt = buildRawVectorAnalysis(
        pdfPayload,
        getVectorOptions(scaleMode, nextModules, analysis.material)
      );
      setAnalysis((prev) =>
        sanitizeAnalysisResult({
          ...prev,
          entities: rebuilt.entities,
          dimensions: rebuilt.dimensions,
          boundingBox: rebuilt.boundingBox,
        })
      );
      return;
    }

    if (moduleKey === 'processPlan') {
      if (pdfPayload && pdfPayload.vectorEntityCount > 0) {
        const rebuilt = buildRawVectorAnalysis(
          pdfPayload,
          getVectorOptions(scaleMode, nextModules, analysis.material)
        );
        setAnalysis((prev) =>
          sanitizeAnalysisResult({
            ...prev,
            processPlan: rebuilt.processPlan,
          })
        );
      } else {
        await handleReplanWithAi('Balanced multi-machine routing', uploadConfig.preferredMachines);
      }
      return;
    }

    if (pdfPayload) {
      await runAiBlueprintAnalysis(pdfPayload, currentPdfBytes, {
        ...uploadConfig,
        modules: nextModules,
      });
    }
  };

  const handleReanalyzeWithChunks = async (updatedPayload: PdfExtractionPayload) => {
    setPdfPayload(updatedPayload);
    setStagedPdfPayload(updatedPayload);
    setErrorMsg(null);
    setActiveSampleId('');
    setSelectedFeatureId(null);
    setSelectedOpId(null);
    try {
      await runAiBlueprintAnalysis(updatedPayload, currentPdfBytes, {
        ...uploadConfig,
        modules: enabledModules,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to re-analyze adjusted PDF chunks.';
      setErrorMsg(msg);
      if (updatedPayload.vectorEntityCount > 0) {
        setAnalysis(
          sanitizeAnalysisResult(buildRawVectorAnalysis(updatedPayload, getVectorOptions()))
        );
      }
    } finally {
      setLoadingStatus(null);
    }
  };

  const handlePlotChunkVectors = (updatedPayload: PdfExtractionPayload) => {
    setPdfPayload(updatedPayload);
    setStagedPdfPayload(updatedPayload);
    setActiveViewId(null);
    setSelectedFeatureId(null);
    setSelectedOpId(null);
    setAnalysis(
      sanitizeAnalysisResult(buildRawVectorAnalysis(updatedPayload, getVectorOptions()))
    );
  };

  const handleChangeScaleMode = (nextMode: 'real' | 'paper') => {
    if (nextMode === scaleMode) return;
    const prevMode = scaleMode;
    setScaleMode(nextMode);
    if (pdfPayload && analysis.extractionSource === 'pdf-vector') {
      setAnalysis(
        sanitizeAnalysisResult(buildRawVectorAnalysis(pdfPayload, getVectorOptions(nextMode)))
      );
      return;
    }
    const factor = analysis.detectedScaleFactor || pdfPayload?.detectedScaleFactor;
    if (!factor || factor === 1) return;
    const mult = nextMode === 'paper' && prevMode === 'real' ? 1 / factor : factor;
    setAnalysis((prev) =>
      sanitizeAnalysisResult({
        ...prev,
        boundingBox: {
          minX: Number((prev.boundingBox.minX * mult).toFixed(2)),
          minY: Number((prev.boundingBox.minY * mult).toFixed(2)),
          maxX: Number((prev.boundingBox.maxX * mult).toFixed(2)),
          maxY: Number((prev.boundingBox.maxY * mult).toFixed(2)),
        },
        stockEnvelope: {
          ...prev.stockEnvelope,
          length: Number((prev.stockEnvelope.length * mult).toFixed(2)),
          width: Number((prev.stockEnvelope.width * mult).toFixed(2)),
          thickness: Number((prev.stockEnvelope.thickness * mult).toFixed(2)),
        },
        entities: prev.entities.map((ent) => {
          if (ent.type === 'line') {
            return {
              ...ent,
              x1: Number((ent.x1 * mult).toFixed(2)),
              y1: Number((ent.y1 * mult).toFixed(2)),
              x2: Number((ent.x2 * mult).toFixed(2)),
              y2: Number((ent.y2 * mult).toFixed(2)),
            };
          }
          if (ent.type === 'circle' || ent.type === 'arc') {
            return {
              ...ent,
              cx: Number((ent.cx * mult).toFixed(2)),
              cy: Number((ent.cy * mult).toFixed(2)),
              r: Number((ent.r * mult).toFixed(2)),
            };
          }
          if (ent.type === 'rect') {
            return {
              ...ent,
              x: Number((ent.x * mult).toFixed(2)),
              y: Number((ent.y * mult).toFixed(2)),
              width: Number((ent.width * mult).toFixed(2)),
              height: Number((ent.height * mult).toFixed(2)),
            };
          }
          return {
            ...ent,
            points: ent.points.map((p) => ({
              x: Number((p.x * mult).toFixed(2)),
              y: Number((p.y * mult).toFixed(2)),
            })),
          };
        }),
        dimensions: prev.dimensions.map((d) => ({
          ...d,
          x1: Number((d.x1 * mult).toFixed(2)),
          y1: Number((d.y1 * mult).toFixed(2)),
          x2: Number((d.x2 * mult).toFixed(2)),
          y2: Number((d.y2 * mult).toFixed(2)),
          offset: d.offset !== undefined ? Number((d.offset * mult).toFixed(2)) : undefined,
        })),
      })
    );
  };

  const handleFileSelected = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setErrorMsg('Please select a valid .pdf mechanical drawing file.');
      return;
    }
    const buffer = await file.arrayBuffer();
    setActiveTab('upload');
    await stagePdfBuffer(buffer, file.name, 1, '');
  };

  const handlePageChange = async (newPage: number) => {
    if (!currentPdfBytes) return;
    setErrorMsg(null);
    setSelectedFeatureId(null);
    setSelectedOpId(null);
    setActiveViewId(null);
    setLoadingStatus(`Loading sheet page ${newPage}...`);
    try {
      const extracted = await extractPdfPage(currentPdfBytes, currentPdfName, newPage);
      setPdfPayload(extracted);
      setStagedPdfPayload(extracted);
      if (uploadConfig.engine === 'vector' && extracted.vectorEntityCount > 0) {
        setAnalysis(sanitizeAnalysisResult(buildRawVectorAnalysis(extracted, getVectorOptions())));
      } else {
        await runAiBlueprintAnalysis(extracted, currentPdfBytes, {
          ...uploadConfig,
          modules: enabledModules,
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to switch PDF page.');
    } finally {
      setLoadingStatus(null);
    }
  };

  const handleReplanWithAi = async (
    shopFocus: string,
    selectedMachines?: MachineCategory[]
  ) => {
    setReplanning(true);
    setErrorMsg(null);
    try {
      const resp = await fetch('/api/replan-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partName: analysis.partName,
          material: analysis.material,
          stockEnvelope: analysis.stockEnvelope,
          features: analysis.features,
          batchSize,
          shopMachineFocus: shopFocus,
          selectedMachines,
        }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to regenerate process routing.');
      }
      const data = await resp.json();
      setAnalysis((prev) =>
        sanitizeAnalysisResult({
          ...prev,
          processPlan: data.processPlan || prev.processPlan,
          dfmNotes: data.dfmNotes || prev.dfmNotes,
        })
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Process replanning failed.');
    } finally {
      setReplanning(false);
    }
  };

  const toggleLayer = (layer: CadLayer) => {
    setVisibleLayers((prev) => ({ ...prev, [layer]: !prev[layer] }));
  };

  const renderSkippedCard = (
    title: string,
    description: string,
    buttonLabel: string,
    moduleKey: keyof PipelineModulesConfig
  ) => (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-8 flex flex-col items-center justify-center text-center min-h-[360px]">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">{description}</p>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleEnableSkippedModule(moduleKey)}
          className="px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 dark:bg-cyan-600 text-white hover:bg-slate-800 dark:hover:bg-cyan-500"
        >
          {buttonLabel}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('upload')}
          className="px-3 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          Back to Upload Drawing
        </button>
      </div>
    </div>
  );

  const layerLabels: Array<{ key: CadLayer; label: string; swatch: string }> = [
    { key: 'outline', label: 'Part Outline', swatch: 'bg-slate-900 dark:bg-slate-100' },
    { key: 'hole', label: 'Holes & Bores', swatch: 'bg-sky-500' },
    { key: 'centerline', label: 'Centerlines', swatch: 'bg-slate-400' },
    { key: 'hidden', label: 'Hidden / Threads', swatch: 'bg-slate-400' },
    { key: 'dimension', label: 'Dimensions', swatch: 'bg-amber-500' },
    { key: 'toolpath', label: 'CAM Toolpaths', swatch: 'bg-cyan-500' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileSelected(f);
          e.target.value = '';
        }}
      />

      {/* Top Navigation Bar: Strict 3-Zone Contract */}
      <header className="h-14 px-5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-8 shrink-0">
        {/* Zone 1: Single-line Brand Wordmark */}
        <span className="text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
          DraftPlan CAD
        </span>

        {/* Zone 2: Concise Navigation Links */}
        <nav className="hidden md:flex items-center gap-4 lg:gap-5 text-xs lg:text-sm font-medium overflow-x-auto">
          {WORKSPACE_TABS.map(([tabKey, label]) => {
            const isSkipped =
              (tabKey === 'cad' && !enabledModules.cadPlotting) ||
              (tabKey === 'process' && !enabledModules.processPlan) ||
              (tabKey === 'tooling' && !enabledModules.toolingFeeds);
            return (
              <button
                key={tabKey}
                type="button"
                onClick={() => setActiveTab(tabKey)}
                className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 ${
                  activeTab === tabKey
                    ? 'border-cyan-600 text-slate-900 dark:text-white'
                    : isSkipped
                      ? 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                      : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span>{label}</span>
                {isSkipped && (
                  <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                    · Skipped
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveTab('upload');
              fileInputRef.current?.click();
            }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-md bg-slate-900 dark:bg-cyan-600 text-white hover:bg-slate-800 dark:hover:bg-cyan-500 transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload PDF</span>
          </button>
        </div>
      </header>

      {/* Mobile Tab Strip */}
      <div className="md:hidden flex items-center gap-1 px-3 py-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {WORKSPACE_TABS.map(([tabKey, label]) => {
          const isSkipped =
            (tabKey === 'cad' && !enabledModules.cadPlotting) ||
            (tabKey === 'process' && !enabledModules.processPlan) ||
            (tabKey === 'tooling' && !enabledModules.toolingFeeds);
          return (
            <button
              key={tabKey}
              type="button"
              onClick={() => setActiveTab(tabKey)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
                activeTab === tabKey
                  ? 'bg-slate-900 text-white'
                  : isSkipped
                    ? 'text-slate-400 hover:bg-slate-100'
                    : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
              {isSkipped ? ' · Skipped' : ''}
            </button>
          );
        })}
      </div>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Left Rail: Drawing Input, Specs, Layers & Feature Tree */}
        <aside className="w-full lg:w-[330px] shrink-0 bg-white dark:bg-slate-900 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 flex flex-col overflow-y-auto">
          {/* PDF Dropzone & Sample Blueprints */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFileSelected(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`cursor-pointer rounded-lg border border-dashed p-3.5 text-center transition-colors ${
                dragOver
                  ? 'border-cyan-500 bg-cyan-50/60 dark:bg-cyan-950/30'
                  : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-slate-50/70 dark:bg-slate-800/40'
              }`}
            >
              <FileText className="w-5 h-5 mx-auto text-slate-400 mb-1.5" />
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                Drop 2D Mechanical Drawing PDF
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Reads vector CAD sheets or scanned blueprints
              </div>
            </div>

            {/* Multi-page selector & raw vector switch when PDF is loaded */}
            {pdfPayload && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                {pdfPayload.pageCount > 1 ? (
                  <label className="inline-flex items-center gap-1.5">
                    <span>Sheet:</span>
                    <select
                      value={pdfPayload.selectedPage}
                      onChange={(e) => handlePageChange(Number(e.target.value))}
                      className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                    >
                      {Array.from({ length: pdfPayload.pageCount }, (_, idx) => (
                        <option key={idx + 1} value={idx + 1}>
                          Page {idx + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <span className="font-mono text-slate-500 truncate max-w-[165px]">
                    {pdfPayload.fileName}
                  </span>
                )}

                {currentPdfBytes && (
                  <div className="flex items-center gap-2.5 flex-wrap">
                    {pdfPayload.vectorEntityCount > 0 && (
                      <button
                        type="button"
                        onClick={() => handlePlotChunkVectors(pdfPayload)}
                        className="text-cyan-700 dark:text-cyan-400 hover:underline font-medium whitespace-nowrap"
                      >
                        Plot Raw PDF Vectors ({pdfPayload.vectorEntityCount})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleReanalyzeWithChunks(pdfPayload)}
                      className="text-slate-700 dark:text-slate-200 hover:underline font-medium whitespace-nowrap"
                    >
                      Run AI Analysis
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Linked Multi-View Chunks Quick Selector */}
            {((analysis.viewChunks && analysis.viewChunks.length > 1) ||
              (pdfPayload && pdfPayload.viewChunks.length > 1)) && (
              <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between text-[11px] mb-1.5">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">
                    Linked PDF Views ({(analysis.viewChunks || pdfPayload?.viewChunks || []).length})
                  </span>
                  {activeViewId && (
                    <button
                      type="button"
                      onClick={() => setActiveViewId(null)}
                      className="text-cyan-700 dark:text-cyan-400 hover:underline font-medium"
                    >
                      Combined Sheet
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {(analysis.viewChunks || pdfPayload?.viewChunks || []).map((vc) => {
                    const isActive = activeViewId === vc.id;
                    return (
                      <button
                        key={vc.id}
                        type="button"
                        onClick={() => {
                          setActiveTab('cad');
                          setActiveViewId(isActive ? null : vc.id);
                        }}
                        className={`px-2 py-1 text-[11px] rounded border transition-colors text-left truncate max-w-full ${
                          isActive
                            ? 'border-cyan-600 bg-cyan-50/70 dark:bg-cyan-950/30 text-cyan-900 dark:text-cyan-200 font-medium'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        {vc.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Sample Mechanical Drawings */}
            <div className="mt-3">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
                Sample Mechanical PDFs
              </div>
              <div className="flex flex-col gap-1">
                {SAMPLE_DRAWINGS.map((sample) => {
                  const isActive = activeSampleId === sample.id;
                  return (
                    <button
                      key={sample.id}
                      type="button"
                      onClick={() => loadSamplePreset(sample)}
                      className={`text-left px-2.5 py-2 rounded-md border text-xs transition-colors ${
                        isActive
                          ? 'border-cyan-600 bg-cyan-50/70 dark:bg-cyan-950/30 text-slate-900 dark:text-white'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="font-medium truncate">{sample.title}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {sample.subtitle}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Part Title Block Metadata (Zero-Pill Clean Text) */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
              {analysis.partName}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              <span>{analysis.partNumber}</span>
              <span aria-hidden="true">·</span>
              <span>{analysis.revision}</span>
              <span aria-hidden="true">·</span>
              <span>{analysis.generalTolerance}</span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <div className="text-[11px] text-slate-400">Material</div>
                <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                  {analysis.material}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Surface Finish</div>
                <div className="font-mono text-slate-800 dark:text-slate-200">
                  {analysis.surfaceFinishDefault}
                </div>
              </div>
              <div className="col-span-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Stock Billet ({analysis.stockEnvelope.form})</span>
                  <button
                    type="button"
                    onClick={() => setShowStockEnvelope((s) => !s)}
                    className="text-cyan-700 dark:text-cyan-400 hover:underline"
                  >
                    {showStockEnvelope ? 'Hide Box' : 'Show Box'}
                  </button>
                </div>
                <div className="font-mono tabular-nums text-slate-800 dark:text-slate-200 mt-0.5">
                  {analysis.stockEnvelope.length} × {analysis.stockEnvelope.width} ×{' '}
                  {analysis.stockEnvelope.thickness} mm
                </div>
              </div>
            </div>
          </div>

          {/* CAD Layer Visibility Controls */}
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
              <Layers className="w-3.5 h-3.5 text-slate-400" />
              <span>CAD Plot Layers</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {layerLabels.map(({ key, label, swatch }) => {
                const active = visibleLayers[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleLayer(key)}
                    className={`flex items-center justify-between px-2 py-1.5 rounded border text-[11px] font-medium transition-colors ${
                      active
                        ? 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100'
                        : 'border-transparent text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5 truncate">
                      <span className={`w-2 h-2 rounded-xs shrink-0 ${swatch}`} />
                      <span className="truncate">{label}</span>
                    </span>
                    {active ? (
                      <Eye className="w-3 h-3 text-slate-400 shrink-0" />
                    ) : (
                      <EyeOff className="w-3 h-3 text-slate-300 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Machined Feature Tree */}
          <div className="p-4 flex-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Extracted Features
              </span>
              <span className="text-[11px] font-mono tabular-nums text-slate-400">
                {analysis.features.length}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              {analysis.features.map((feat) => {
                const isSelected = selectedFeatureId === feat.id;
                return (
                  <button
                    key={feat.id}
                    type="button"
                    onClick={() => {
                      setSelectedFeatureId(isSelected ? null : feat.id);
                      setSelectedOpId(null);
                    }}
                    className={`text-left p-2.5 rounded-md border transition-colors ${
                      isSelected
                        ? 'border-cyan-600 bg-cyan-50/70 dark:bg-cyan-950/30'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-900 dark:text-white truncate">
                        {feat.name}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 uppercase shrink-0">
                        {feat.category}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                      {feat.dimensions}
                    </div>
                    {feat.tolerance && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Tol: {feat.tolerance}
                        {feat.surfaceFinishRa ? ` · ${feat.surfaceFinishRa}` : ''}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Right Primary Content Stage */}
        <main className="flex-1 p-4 flex flex-col gap-3 min-w-0 overflow-y-auto">
          {/* Status / Error Notifications */}
          {loadingStatus && (
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md border border-cyan-200 dark:border-cyan-900 bg-cyan-50 dark:bg-cyan-950/40 text-xs font-medium text-cyan-900 dark:text-cyan-200">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>{loadingStatus}</span>
            </div>
          )}

          {errorMsg && (
            <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 text-xs text-rose-800 dark:text-rose-200">
              <span className="inline-flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </span>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="text-rose-600 dark:text-rose-300 font-medium hover:underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {activeTab === 'upload' && (
            <UploadDrawingPanel
              stagedPdfPayload={stagedPdfPayload}
              autoDetectedBoxes={stagedAutoBoxes}
              activeSampleId={stagedSampleId}
              config={uploadConfig}
              isStaging={isStagingPdf}
              isRunning={Boolean(loadingStatus)}
              loadingStatus={loadingStatus}
              onChangeConfig={setUploadConfig}
              onStageFile={handleFileSelected}
              onStageSamplePreset={stageSamplePreset}
              onStagePageChange={(p) => {
                if (stagedPdfBytes && stagedPdfPayload) {
                  stagePdfBuffer(stagedPdfBytes, stagedPdfPayload.fileName, p, stagedSampleId);
                }
              }}
              onRunPipeline={handleRunConfiguredPipeline}
              onOpenManual={() => setActiveTab('manual')}
            />
          )}

          {activeTab === 'cad' &&
            (!enabledModules.cadPlotting ? (
              renderSkippedCard(
                'CAD Plotting Was Skipped',
                'CAD Plotting was unchecked in the Upload Drawing pipeline configuration. You can enable and generate 2D CAD geometry now without re-uploading your PDF.',
                'Enable & Generate CAD Plot',
                'cadPlotting'
              )
            ) : (
              <div className="flex-1 flex flex-col gap-3 min-h-[540px]">
                <div className="flex-1 min-h-[440px]">
                  <CadViewport
                    analysis={analysis}
                    pdfPayload={pdfPayload}
                    visibleLayers={visibleLayers}
                    selectedFeatureId={selectedFeatureId}
                    selectedOpId={selectedOpId}
                    onSelectFeature={(id) => {
                      setSelectedFeatureId(id);
                      setSelectedOpId(null);
                    }}
                    showStockEnvelope={showStockEnvelope}
                    activeViewId={activeViewId}
                    onSelectViewId={setActiveViewId}
                    onUpdatePdfPayload={setPdfPayload}
                    onPlotChunkVectors={handlePlotChunkVectors}
                    onReanalyzeWithChunks={handleReanalyzeWithChunks}
                    scaleMode={scaleMode}
                    onChangeScaleMode={handleChangeScaleMode}
                    detectedScaleLabel={
                      analysis.detectedScaleLabel || pdfPayload?.detectedScaleLabel
                    }
                    detectedScaleFactor={
                      analysis.detectedScaleFactor || pdfPayload?.detectedScaleFactor
                    }
                  />
                </div>

                {/* Compact Process Plan Strip below CAD Viewport */}
                {enabledModules.processPlan && analysis.processPlan.length > 0 && (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          Process Sequence
                        </span>
                        <span className="text-slate-400">·</span>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {analysis.processPlan.length} Ops ·{' '}
                          {analysis.processPlan
                            .reduce((s, o) => s + o.cycleTimeMin, 0)
                            .toFixed(1)}{' '}
                          min/pc cycle
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('process')}
                        className="text-xs font-medium text-cyan-700 dark:text-cyan-400 hover:underline whitespace-nowrap"
                      >
                        Edit Full Process Plan →
                      </button>
                    </div>

                    <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
                      {analysis.processPlan.map((op) => {
                        const isOpActive = selectedOpId === op.id;
                        return (
                          <button
                            key={op.id}
                            type="button"
                            onClick={() => {
                              if (isOpActive) {
                                setSelectedOpId(null);
                                setSelectedFeatureId(null);
                              } else {
                                setSelectedOpId(op.id);
                                setSelectedFeatureId(op.targetFeatureId || null);
                              }
                            }}
                            className={`min-w-[185px] max-w-[220px] text-left p-2.5 rounded-md border transition-colors shrink-0 ${
                              isOpActive
                                ? 'border-cyan-600 bg-cyan-50/70 dark:bg-cyan-950/30'
                                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                OP-{op.opNumber}
                              </span>
                              <span>{op.cycleTimeMin.toFixed(1)} min</span>
                            </div>
                            <div className="text-xs font-medium text-slate-900 dark:text-white truncate mt-0.5">
                              {op.operationName}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {op.machineType} · Ø{op.toolDiameterMm} mm
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}

          {activeTab === 'process' &&
            (!enabledModules.processPlan ? (
              renderSkippedCard(
                'Process Plan Was Skipped',
                'Process Plan was unchecked in the Upload Drawing pipeline configuration. Click below to generate shop-floor operations across Lathe, Milling, Grinding, and Gear Hobbing.',
                'Enable & Generate Process Plan',
                'processPlan'
              )
            ) : (
              <ProcessPlanPanel
                analysis={analysis}
                batchSize={batchSize}
                onChangeBatchSize={setBatchSize}
                selectedOpId={selectedOpId}
                onSelectOp={(opId, featureId) => {
                  setSelectedOpId(opId);
                  setSelectedFeatureId(featureId || null);
                }}
                onUpdateAnalysis={setAnalysis}
                onReplanWithAi={handleReplanWithAi}
                replanning={replanning}
              />
            ))}

          {activeTab === 'tooling' &&
            (!enabledModules.toolingFeeds ? (
              renderSkippedCard(
                'Tooling & Feeds Was Skipped',
                'Tooling & Feeds was unchecked in the Upload Drawing pipeline configuration. Enable it below to compute ISO material speeds, RPM, chip loads, MRR, and billet weight.',
                'Enable Tooling & Feeds',
                'toolingFeeds'
              )
            ) : (
              <ToolingFeedsPanel analysis={analysis} onUpdateAnalysis={setAnalysis} />
            ))}

          {activeTab === 'export' && (
            <ExportPanel
              analysis={analysis}
              batchSize={batchSize}
              currentPdfBytes={currentPdfBytes}
              currentPdfName={currentPdfName}
              enabledModules={enabledModules}
            />
          )}

          {activeTab === 'flow' && (
            <FlowChartPanel
              analysis={analysis}
              pdfPayload={pdfPayload}
              batchSize={batchSize}
              onNavigateTab={(target) => setActiveTab(target)}
            />
          )}

          {activeTab === 'manual' && (
            <UserManualPanel onNavigateTab={(target) => setActiveTab(target)} />
          )}
        </main>
      </div>
    </div>
  );
}
