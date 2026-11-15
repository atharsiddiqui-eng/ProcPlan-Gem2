import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  Layers,
  LayoutGrid,
  Maximize2,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  Ruler,
  ScanSearch,
  Sparkles,
  Square,
  SquarePen,
  Sun,
  Trash2,
} from 'lucide-react';
import type {
  CadLayer,
  DrawingAnalysisResult,
  PdfExtractionPayload,
  PdfViewBox,
  PdfViewChunkSummary,
  ViewChunkKind,
} from '../types/cad';
import { repartitionPdfChunks } from '../utils/pdfEngine';
import {
  CadPlotCanvas,
  computeEntitiesBounds,
  safeNum,
  type ViewFrameBox,
} from './CadPlotCanvas';
import { PdfSheetBoxEditor, VIEW_KIND_OPTIONS } from './PdfSheetBoxEditor';

interface CadViewportProps {
  analysis: DrawingAnalysisResult;
  pdfPayload: PdfExtractionPayload | null;
  visibleLayers: Record<CadLayer, boolean>;
  selectedFeatureId: string | null;
  selectedOpId: string | null;
  onSelectFeature: (featureId: string | null) => void;
  showStockEnvelope: boolean;
  activeViewId?: string | null;
  onSelectViewId?: (viewId: string | null) => void;
  onUpdatePdfPayload?: (nextPayload: PdfExtractionPayload) => void;
  onPlotChunkVectors?: (payload: PdfExtractionPayload) => void;
  onReanalyzeWithChunks?: (payload: PdfExtractionPayload) => void;
  scaleMode?: 'real' | 'paper';
  onChangeScaleMode?: (mode: 'real' | 'paper') => void;
  detectedScaleLabel?: string;
  detectedScaleFactor?: number;
}

type ViewMode = 'cad' | 'split' | 'underlay';
type ChunkScopeMode = 'combined' | 'multi-plot' | 'single';

export const CadViewport: React.FC<CadViewportProps> = ({
  analysis,
  pdfPayload,
  visibleLayers,
  selectedFeatureId,
  selectedOpId,
  onSelectFeature,
  showStockEnvelope,
  activeViewId: controlledViewId,
  onSelectViewId,
  onUpdatePdfPayload,
  onPlotChunkVectors,
  onReanalyzeWithChunks,
  scaleMode = 'real',
  onChangeScaleMode,
  detectedScaleLabel,
  detectedScaleFactor,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('cad');
  const [darkCanvas, setDarkCanvas] = useState<boolean>(true);
  const [unitDisplay, setUnitDisplay] = useState<'mm' | 'in'>(analysis.units);
  const [measureMode, setMeasureMode] = useState<boolean>(false);
  const [simPlaying, setSimPlaying] = useState<boolean>(false);

  // Multi-view CAD layout state: Combined Sheet | Separate Plots | Single View
  const [chunkScope, setChunkScope] = useState<ChunkScopeMode>('combined');
  const [internalViewId, setInternalViewId] = useState<string | null>(null);
  const [selectedPlotViewIds, setSelectedPlotViewIds] = useState<string[]>([]);
  const [highlightedPlotId, setHighlightedPlotId] = useState<string | null>(null);

  // Global toolbar zoom/fit signals forwarded to active plot canvas(es)
  const [fitSignal, setFitSignal] = useState<number>(0);
  const [zoomAction, setZoomAction] = useState<{ seq: number; factor: number }>({
    seq: 0,
    factor: 1,
  });

  // Manual PDF View Box editor state
  const [editingBoxes, setEditingBoxes] = useState<boolean>(false);
  const [draftBoxes, setDraftBoxes] = useState<PdfViewBox[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [repartitionBusy, setRepartitionBusy] = useState<boolean>(false);

  const linkedViews = useMemo<PdfViewChunkSummary[]>(() => {
    if (analysis.viewChunks && analysis.viewChunks.length > 0) {
      return analysis.viewChunks;
    }
    if (pdfPayload?.viewChunks && pdfPayload.viewChunks.length > 0) {
      return pdfPayload.viewChunks;
    }
    return [];
  }, [analysis.viewChunks, pdfPayload?.viewChunks]);

  const hasMultiViews = linkedViews.length > 1;
  const resolvedViewId = controlledViewId ?? internalViewId ?? linkedViews[0]?.id ?? null;

  const setActiveView = (nextId: string | null) => {
    setInternalViewId(nextId);
    onSelectViewId?.(nextId);
  };

  // Keep Separate Plots selection synced when linkedViews change
  useEffect(() => {
    setSelectedPlotViewIds(linkedViews.map((v) => v.id));
    setHighlightedPlotId(null);
  }, [linkedViews]);

  // Sync scope when external controlledViewId is selected from inspector rail
  const prevControlledViewIdRef = useRef<string | null | undefined>(controlledViewId);
  useEffect(() => {
    const prev = prevControlledViewIdRef.current;
    prevControlledViewIdRef.current = controlledViewId;
    if (controlledViewId) {
      setChunkScope('single');
      setInternalViewId(controlledViewId);
    } else if (controlledViewId === null && prev) {
      setChunkScope((curr) => (curr === 'multi-plot' ? 'multi-plot' : 'combined'));
    }
  }, [controlledViewId]);

  // Sync draft boxes whenever pdfPayload updates
  useEffect(() => {
    if (pdfPayload?.viewChunks && pdfPayload.viewChunks.length > 0) {
      const mapped = pdfPayload.viewChunks.map((c) => ({
        id: c.id,
        label: c.label,
        viewKind: c.viewKind,
        normBounds: { ...c.normBounds },
      }));
      setDraftBoxes(mapped);
      setSelectedBoxId(mapped[0].id);
    } else {
      setDraftBoxes([]);
      setSelectedBoxId(null);
    }
  }, [pdfPayload]);

  // Reset per-analysis defaults when a new analysis loads
  useEffect(() => {
    setUnitDisplay(analysis.units === 'in' ? 'in' : 'mm');
    setChunkScope((curr) =>
      curr === 'multi-plot' && (analysis.viewChunks?.length ?? 0) > 1 ? 'multi-plot' : 'combined'
    );
    setInternalViewId(analysis.viewChunks?.[0]?.id ?? null);
    setSimPlaying(false);
  }, [analysis]);

  const safeBB = useMemo(() => {
    const minX = safeNum(analysis.boundingBox?.minX, -50);
    const minY = safeNum(analysis.boundingBox?.minY, -50);
    const rawMaxX = safeNum(analysis.boundingBox?.maxX, minX + 100);
    const rawMaxY = safeNum(analysis.boundingBox?.maxY, minY + 100);
    return {
      minX,
      minY,
      maxX: rawMaxX > minX ? rawMaxX : minX + 100,
      maxY: rawMaxY > minY ? rawMaxY : minY + 100,
    };
  }, [analysis.boundingBox]);

  const isSingleView = hasMultiViews && chunkScope === 'single' && Boolean(resolvedViewId);
  const isMultiPlot = hasMultiViews && chunkScope === 'multi-plot';

  const visibleEntities = useMemo(() => {
    if (!isSingleView || !resolvedViewId) return analysis.entities;
    const matched = analysis.entities.filter((e) => !e.viewId || e.viewId === resolvedViewId);
    return matched.length > 0 ? matched : analysis.entities;
  }, [analysis.entities, isSingleView, resolvedViewId]);

  const visibleDimensions = useMemo(() => {
    if (!isSingleView || !resolvedViewId) return analysis.dimensions;
    return analysis.dimensions.filter((d) => !d.viewId || d.viewId === resolvedViewId);
  }, [analysis.dimensions, isSingleView, resolvedViewId]);

  const activeBB = useMemo(() => {
    if (!isSingleView) return safeBB;
    return computeEntitiesBounds(visibleEntities, safeBB);
  }, [isSingleView, visibleEntities, safeBB]);

  // Per-view frame boxes for Combined Sheet visual grouping
  const viewFrameBoxes = useMemo<ViewFrameBox[]>(() => {
    if (!hasMultiViews || isSingleView || isMultiPlot) return [];
    return linkedViews
      .map((vc) => {
        const viewEnts = analysis.entities.filter((e) => e.viewId === vc.id);
        if (viewEnts.length === 0) return null;
        const bb = computeEntitiesBounds(viewEnts, safeBB);
        return {
          id: vc.id,
          label: vc.label,
          viewKind: vc.viewKind,
          minX: bb.minX - 6,
          minY: bb.minY - 6,
          maxX: bb.maxX + 6,
          maxY: bb.maxY + 8,
        };
      })
      .filter((b): b is ViewFrameBox => b !== null);
  }, [hasMultiViews, isSingleView, isMultiPlot, linkedViews, analysis.entities, safeBB]);

  // Separate plot definitions for Multi-Plot Grid mode
  const multiPlotCards = useMemo(() => {
    if (!isMultiPlot) return [];
    const activeIds =
      selectedPlotViewIds.length > 0 ? selectedPlotViewIds : linkedViews.map((v) => v.id);
    const chosenViews = linkedViews.filter((v) => activeIds.includes(v.id));
    const list = chosenViews.length > 0 ? chosenViews : linkedViews;

    return list.map((vc, idx) => {
      const taggedEnts = analysis.entities.filter((e) => e.viewId === vc.id);
      const untaggedEnts = analysis.entities.filter((e) => !e.viewId);
      const entities =
        taggedEnts.length > 0 ? taggedEnts : idx === 0 ? untaggedEnts : [];

      const taggedDims = analysis.dimensions.filter((d) => d.viewId === vc.id);
      const untaggedDims = analysis.dimensions.filter((d) => !d.viewId);
      const dimensions =
        taggedDims.length > 0 ? taggedDims : idx === 0 ? untaggedDims : [];

      const fallbackBox = {
        minX: vc.sheetOffset.dx - 40,
        minY: vc.sheetOffset.dy - 30,
        maxX: vc.sheetOffset.dx + 40,
        maxY: vc.sheetOffset.dy + 30,
      };
      const bounds = computeEntitiesBounds(entities, entities.length > 0 ? safeBB : fallbackBox);

      return {
        view: vc,
        entities,
        dimensions,
        bounds,
      };
    });
  }, [isMultiPlot, selectedPlotViewIds, linkedViews, analysis.entities, analysis.dimensions, safeBB]);

  const togglePlotViewSelection = (viewId: string) => {
    setSelectedPlotViewIds((prev) => {
      const exists = prev.includes(viewId);
      if (exists) {
        if (prev.length <= 1) return prev;
        return prev.filter((id) => id !== viewId);
      }
      return [...prev, viewId];
    });
  };

  const selectedBox = draftBoxes.find((b) => b.id === selectedBoxId) || draftBoxes[0] || null;

  const addCustomBox = () => {
    const idx = draftBoxes.length + 1;
    const newBox: PdfViewBox = {
      id: `view-custom-${Date.now()}`,
      label: `Detail / Section ${idx}`,
      viewKind: 'detail',
      normBounds: { x: 0.25, y: 0.25, w: 0.35, h: 0.3 },
    };
    setDraftBoxes((prev) => [...prev, newBox]);
    setSelectedBoxId(newBox.id);
  };

  const deleteSelectedBox = () => {
    if (draftBoxes.length <= 1 || !selectedBox) return;
    const next = draftBoxes.filter((b) => b.id !== selectedBox.id);
    setDraftBoxes(next);
    setSelectedBoxId(next[0]?.id || null);
  };

  const applyBoxesAndAction = async (action: 'vectors' | 'ai') => {
    if (!pdfPayload || draftBoxes.length === 0) return;
    setRepartitionBusy(true);
    try {
      const updated = await repartitionPdfChunks(pdfPayload, draftBoxes);
      onUpdatePdfPayload?.(updated);
      if (action === 'vectors') {
        onPlotChunkVectors?.(updated);
      } else {
        onReanalyzeWithChunks?.(updated);
      }
      setEditingBoxes(false);
    } finally {
      setRepartitionBusy(false);
    }
  };

  const multiPlotGridClass =
    multiPlotCards.length <= 1
      ? 'grid-cols-1'
      : multiPlotCards.length >= 5 && viewMode !== 'split'
        ? 'grid-cols-1 md:grid-cols-2 2xl:grid-cols-3'
        : 'grid-cols-1 md:grid-cols-2';

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
      {/* CAD Viewport Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary Viewport Mode Switch */}
          <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 dark:bg-slate-800 rounded-md">
            <button
              type="button"
              onClick={() => setViewMode('cad')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                viewMode === 'cad'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              CAD Plot
            </button>
            <button
              type="button"
              disabled={!pdfPayload}
              onClick={() => setViewMode('split')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
                viewMode === 'split'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Split PDF + CAD
            </button>
            <button
              type="button"
              disabled={!pdfPayload}
              onClick={() => setViewMode('underlay')}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 ${
                viewMode === 'underlay'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              PDF Sheet
            </button>
          </div>

          {/* Multi-View Plot Layout Toggle: Combined Sheet vs Separate Plots vs Single View */}
          {hasMultiViews && viewMode !== 'underlay' && (
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-0.5 p-0.5 bg-slate-200/70 dark:bg-slate-800 rounded-md">
                <button
                  type="button"
                  onClick={() => {
                    setChunkScope('combined');
                    onSelectViewId?.(null);
                  }}
                  title="Plot all views together on one unified sheet"
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    chunkScope === 'combined'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Layers className="w-3 h-3" />
                  <span>Combined Sheet</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChunkScope('multi-plot');
                    onSelectViewId?.(null);
                  }}
                  title="Plot each drawing view in its own separate CAD plot"
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    chunkScope === 'multi-plot'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <LayoutGrid className="w-3 h-3" />
                  <span>Separate Plots</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setChunkScope('single');
                    const firstId = resolvedViewId || linkedViews[0]?.id || null;
                    setActiveView(firstId);
                  }}
                  title="Focus one view full-screen"
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    chunkScope === 'single'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <ScanSearch className="w-3 h-3" />
                  <span>Single View</span>
                </button>
              </div>

              {chunkScope === 'single' && (
                <select
                  value={resolvedViewId || ''}
                  onChange={(e) => setActiveView(e.target.value)}
                  className="h-7 px-2 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  {linkedViews.map((vc) => (
                    <option key={vc.id} value={vc.id}>
                      {vc.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMeasureMode((v) => !v)}
            title="Measure distance between two points"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
              measureMode
                ? 'bg-cyan-600 text-white border-cyan-600'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
            }`}
          >
            <Ruler className="w-3.5 h-3.5" />
            <span>Measure</span>
          </button>

          {visibleLayers.toolpath && (
            <button
              type="button"
              onClick={() => setSimPlaying((p) => !p)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                simPlaying
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
              }`}
            >
              {simPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{simPlaying ? 'Pause CAM' : 'Simulate CAM'}</span>
            </button>
          )}

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />

          <button
            type="button"
            onClick={() => setUnitDisplay((u) => (u === 'mm' ? 'in' : 'mm'))}
            className="px-2 py-1 text-xs font-mono font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            {unitDisplay.toUpperCase()}
          </button>

          <button
            type="button"
            onClick={() => setDarkCanvas((d) => !d)}
            title="Toggle Blueprint Dark / Drafting Light canvas"
            className="p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50"
          >
            {darkCanvas ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          <button
            type="button"
            onClick={() => setZoomAction((z) => ({ seq: z.seq + 1, factor: 1.25 }))}
            title="Zoom in"
            className="p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoomAction((z) => ({ seq: z.seq + 1, factor: 0.8 }))}
            title="Zoom out"
            className="p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setFitSignal((s) => s + 1)}
            title="Fit drawing to viewport"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Fit</span>
          </button>

          {detectedScaleFactor && detectedScaleFactor !== 1 && onChangeScaleMode && (
            <>
              <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />
              <div
                className="flex items-center gap-0.5 p-0.5 bg-slate-200/70 dark:bg-slate-800 rounded-md"
                title={`Drawing scale ${detectedScaleLabel || `1:${detectedScaleFactor}`}`}
              >
                <button
                  type="button"
                  onClick={() => onChangeScaleMode('real')}
                  className={`px-2 py-1 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    scaleMode === 'real'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  1:1 Real ({detectedScaleLabel?.split(' · ')[0] || `1:${detectedScaleFactor}`})
                </button>
                <button
                  type="button"
                  onClick={() => onChangeScaleMode('paper')}
                  className={`px-2 py-1 text-xs font-mono font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    scaleMode === 'paper'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Paper
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Separate Plots View Selector Bar */}
      {isMultiPlot && viewMode !== 'underlay' && (
        <div className="px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/95 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mr-1">
              Plots ({multiPlotCards.length}/{linkedViews.length}):
            </span>
            {linkedViews.map((vc) => {
              const checked = selectedPlotViewIds.includes(vc.id);
              return (
                <button
                  key={vc.id}
                  type="button"
                  onClick={() => togglePlotViewSelection(vc.id)}
                  className={`inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium rounded border transition-colors whitespace-nowrap ${
                    checked
                      ? 'border-cyan-600 bg-cyan-50/70 dark:bg-cyan-950/30 text-cyan-900 dark:text-cyan-200'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {checked ? (
                    <CheckSquare className="w-3 h-3 text-cyan-600 dark:text-cyan-400 shrink-0" />
                  ) : (
                    <Square className="w-3 h-3 shrink-0" />
                  )}
                  <span>{vc.label}</span>
                </button>
              );
            })}
          </div>
          {selectedPlotViewIds.length < linkedViews.length && (
            <button
              type="button"
              onClick={() => setSelectedPlotViewIds(linkedViews.map((v) => v.id))}
              className="text-[11px] font-medium text-cyan-700 dark:text-cyan-400 hover:underline whitespace-nowrap"
            >
              Show All Views
            </button>
          )}
        </div>
      )}

      {/* Main Canvas Stage */}
      <div className="flex-1 min-h-[380px] flex overflow-hidden">
        {/* PDF Side Panel in Split or Full PDF Sheet with Interactive View Box Overlay */}
        {pdfPayload && (viewMode === 'split' || viewMode === 'underlay') && (
          <div
            className={`${
              viewMode === 'underlay' ? 'w-full' : 'w-1/2 border-r border-slate-200 dark:border-slate-800'
            } bg-slate-100 dark:bg-slate-950 flex flex-col overflow-hidden`}
          >
            <div className="px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate font-medium text-slate-700 dark:text-slate-300">
                  {pdfPayload.fileName}
                </span>
                <span className="font-mono tabular-nums text-[11px] shrink-0">
                  P{pdfPayload.selectedPage}/{pdfPayload.pageCount} · {draftBoxes.length} view
                  {draftBoxes.length === 1 ? '' : 's'}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setEditingBoxes((v) => !v)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                  editingBoxes
                    ? 'bg-cyan-600 text-white border-cyan-600'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50'
                }`}
              >
                <SquarePen className="w-3 h-3" />
                <span>{editingBoxes ? 'Done Adjusting' : 'Adjust View Boxes'}</span>
              </button>
            </div>

            <div className="flex-1 overflow-auto p-3 flex items-center justify-center">
              <PdfSheetBoxEditor
                imageDataUrl={pdfPayload.renderedImageDataUrl}
                alt={`Mechanical drawing ${pdfPayload.fileName}`}
                boxes={draftBoxes}
                selectedBoxId={selectedBox?.id ?? null}
                highlightedBoxId={
                  isSingleView ? resolvedViewId : isMultiPlot ? highlightedPlotId : null
                }
                editable={editingBoxes}
                allowDraw={editingBoxes}
                maxHeightClass="max-h-[460px]"
                onSelectBox={(boxId) => {
                  setSelectedBoxId(boxId);
                  if (!editingBoxes) {
                    if (isMultiPlot) {
                      setHighlightedPlotId(boxId);
                      if (!selectedPlotViewIds.includes(boxId)) {
                        setSelectedPlotViewIds((prev) => [...prev, boxId]);
                      }
                    } else {
                      setChunkScope('single');
                      setActiveView(boxId);
                    }
                  }
                }}
                onChangeBoxes={setDraftBoxes}
              />
            </div>

            {/* Manual Chunk Box Inspector & Re-Extraction Controls */}
            {editingBoxes && (
              <div className="px-3 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col gap-2 text-xs">
                {selectedBox && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={selectedBox.label}
                      onChange={(e) =>
                        setDraftBoxes((prev) =>
                          prev.map((b) =>
                            b.id === selectedBox.id ? { ...b, label: e.target.value } : b
                          )
                        )
                      }
                      className="flex-1 min-w-[140px] h-7 px-2 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                      placeholder="View Label"
                    />
                    <select
                      value={selectedBox.viewKind}
                      onChange={(e) =>
                        setDraftBoxes((prev) =>
                          prev.map((b) =>
                            b.id === selectedBox.id
                              ? { ...b, viewKind: e.target.value as ViewChunkKind }
                              : b
                          )
                        )
                      }
                      className="h-7 px-2 text-xs rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                    >
                      {VIEW_KIND_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={addCustomBox}
                      className="h-7 px-2 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 whitespace-nowrap"
                    >
                      + Add Box
                    </button>
                    <button
                      type="button"
                      disabled={draftBoxes.length <= 1}
                      onClick={deleteSelectedBox}
                      title="Delete selected box"
                      className="h-7 px-2 text-xs rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-rose-600 disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    Drag box to move · Corner handle to resize
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={repartitionBusy}
                      onClick={() => applyBoxesAndAction('vectors')}
                      className="px-2.5 py-1 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                    >
                      {repartitionBusy ? 'Updating...' : 'Apply & Plot Vectors'}
                    </button>
                    <button
                      type="button"
                      disabled={repartitionBusy}
                      onClick={() => applyBoxesAndAction('ai')}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded bg-slate-900 dark:bg-cyan-600 text-white hover:bg-slate-800 dark:hover:bg-cyan-500 disabled:opacity-50 whitespace-nowrap"
                    >
                      <Sparkles className="w-3 h-3" />
                      <span>Apply &amp; Re-Analyze Chunks</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Interactive 2D CAD Plotter: Either Separate Multi-View Plots OR Unified / Single Plot */}
        {viewMode !== 'underlay' && (
          isMultiPlot ? (
            <div className="flex-1 min-h-0 overflow-y-auto p-2.5 bg-slate-100/80 dark:bg-slate-950">
              <div className={`grid ${multiPlotGridClass} gap-2.5 h-full auto-rows-[minmax(255px,1fr)]`}>
                {multiPlotCards.map(({ view, entities, dimensions, bounds }) => (
                  <div
                    key={view.id}
                    onClick={() => setHighlightedPlotId(view.id)}
                    className="min-h-[255px] h-full"
                  >
                    <CadPlotCanvas
                      analysis={analysis}
                      entities={entities}
                      dimensions={dimensions}
                      bounds={bounds}
                      visibleLayers={visibleLayers}
                      selectedFeatureId={selectedFeatureId}
                      selectedOpId={selectedOpId}
                      onSelectFeature={onSelectFeature}
                      showStockEnvelope={showStockEnvelope}
                      darkCanvas={darkCanvas}
                      unitDisplay={unitDisplay}
                      measureMode={measureMode}
                      simPlaying={simPlaying}
                      activeViewId={view.id}
                      fitSignal={fitSignal}
                      zoomAction={zoomAction}
                      compactHud
                      plotHeader={{
                        title: view.label,
                        subtitle: `${view.viewKind.toUpperCase()} · ${entities.length} entities · ${dimensions.length} dim${dimensions.length === 1 ? '' : 's'}`,
                        isHighlighted: highlightedPlotId === view.id,
                        onFocusView: () => {
                          setChunkScope('single');
                          setActiveView(view.id);
                        },
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0">
              <CadPlotCanvas
                analysis={analysis}
                entities={visibleEntities}
                dimensions={visibleDimensions}
                bounds={activeBB}
                visibleLayers={visibleLayers}
                selectedFeatureId={selectedFeatureId}
                selectedOpId={selectedOpId}
                onSelectFeature={onSelectFeature}
                showStockEnvelope={showStockEnvelope}
                darkCanvas={darkCanvas}
                unitDisplay={unitDisplay}
                measureMode={measureMode}
                simPlaying={simPlaying}
                activeViewId={isSingleView ? resolvedViewId : null}
                viewFrameBoxes={viewFrameBoxes}
                onSelectViewFrame={(vfId) => {
                  setChunkScope('single');
                  setActiveView(vfId);
                }}
                fitSignal={fitSignal}
                zoomAction={zoomAction}
                statusLabel={
                  [
                    hasMultiViews
                      ? isSingleView
                        ? linkedViews.find((v) => v.id === resolvedViewId)?.label || 'Single View'
                        : `${linkedViews.length} Views Linked`
                      : null,
                    detectedScaleFactor && detectedScaleFactor !== 1
                      ? scaleMode === 'real'
                        ? `1:1 Real (${detectedScaleLabel || `1:${detectedScaleFactor}`})`
                        : `Paper (${detectedScaleLabel || `1:${detectedScaleFactor}`})`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || undefined
                }
              />
            </div>
          )
        )}
      </div>
    </div>
  );
};
