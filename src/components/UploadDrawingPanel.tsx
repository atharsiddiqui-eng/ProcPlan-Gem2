import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Cpu,
  FileText,
  Layers,
  Loader2,
  MousePointerClick,
  Plus,
  RotateCcw,
  Scan,
  SlidersHorizontal,
  Square,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  MachineCategory,
  PdfExtractionPayload,
  PdfViewBox,
  UploadPipelineConfig,
  ViewChunkKind,
} from '../types/cad';
import { MATERIAL_PRESETS, SHOP_MACHINES } from '../utils/camEngine';
import { SAMPLE_DRAWINGS, type SampleDrawingPreset } from '../utils/sampleDrawings';
import { PdfSheetBoxEditor, VIEW_KIND_OPTIONS } from './PdfSheetBoxEditor';

interface UploadDrawingPanelProps {
  stagedPdfPayload: PdfExtractionPayload | null;
  autoDetectedBoxes: PdfViewBox[];
  activeSampleId: string;
  config: UploadPipelineConfig;
  isStaging: boolean;
  isRunning: boolean;
  loadingStatus: string | null;
  onChangeConfig: (next: UploadPipelineConfig) => void;
  onStageFile: (file: File) => void;
  onStageSamplePreset: (preset: SampleDrawingPreset) => void;
  onStagePageChange: (pageNum: number) => void;
  onRunPipeline: (boxesToUse: PdfViewBox[]) => void;
  onOpenManual: () => void;
}

export const UploadDrawingPanel: React.FC<UploadDrawingPanelProps> = ({
  stagedPdfPayload,
  autoDetectedBoxes,
  activeSampleId,
  config,
  isStaging,
  isRunning,
  loadingStatus,
  onChangeConfig,
  onStageFile,
  onStageSamplePreset,
  onStagePageChange,
  onRunPipeline,
  onOpenManual,
}) => {
  const localFileInputRef = useRef<HTMLInputElement | null>(null);

  const [dragOver, setDragOver] = useState(false);
  const [manualBoxes, setManualBoxes] = useState<PdfViewBox[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Sync manual boxes when a new PDF or page is staged
  useEffect(() => {
    const cloned = autoDetectedBoxes.map((b) => ({
      ...b,
      normBounds: { ...b.normBounds },
    }));
    setManualBoxes(cloned);
    setSelectedBoxId(cloned[0]?.id ?? null);
  }, [autoDetectedBoxes]);

  const activeBoxes = config.viewMode === 'auto' ? autoDetectedBoxes : manualBoxes;
  const selectedBox = activeBoxes.find((b) => b.id === selectedBoxId) || activeBoxes[0] || null;

  const hasVectors = (stagedPdfPayload?.vectorEntityCount ?? 0) > 0;
  const vectorDisabled = Boolean(stagedPdfPayload && !hasVectors);
  const effectiveEngine = vectorDisabled && config.engine === 'vector' ? 'ai' : config.engine;

  const noModuleSelected =
    !config.modules.cadPlotting && !config.modules.processPlan && !config.modules.toolingFeeds;

  const addFullSheetBox = () => {
    const newBox: PdfViewBox = {
      id: `manual-view-${Date.now().toString(36).slice(-4)}`,
      label: `View ${manualBoxes.length + 1}`,
      viewKind: 'orthogonal',
      normBounds: { x: 0.06, y: 0.08, w: 0.88, h: 0.72 },
    };
    setManualBoxes((prev) => [...prev, newBox]);
    setSelectedBoxId(newBox.id);
  };

  const resetToAutoBoxes = () => {
    const cloned = autoDetectedBoxes.map((b) => ({
      ...b,
      normBounds: { ...b.normBounds },
    }));
    setManualBoxes(cloned);
    setSelectedBoxId(cloned[0]?.id ?? null);
  };

  const updateBoxField = (id: string, patch: Partial<PdfViewBox>) => {
    setManualBoxes((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const deleteManualBox = (id: string) => {
    setManualBoxes((prev) => {
      const next = prev.filter((b) => b.id !== id);
      if (selectedBoxId === id) {
        setSelectedBoxId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const toggleModule = (key: keyof UploadPipelineConfig['modules']) => {
    onChangeConfig({
      ...config,
      modules: {
        ...config.modules,
        [key]: !config.modules[key],
      },
    });
  };

  const togglePreferredMachine = (machine: MachineCategory) => {
    const exists = config.preferredMachines.includes(machine);
    const next = exists
      ? config.preferredMachines.filter((m) => m !== machine)
      : [...config.preferredMachines, machine];
    onChangeConfig({ ...config, preferredMachines: next });
  };

  const firstEnabledTabLabel = config.modules.cadPlotting
    ? 'CAD Plotter'
    : config.modules.processPlan
      ? 'Process Plan'
      : 'Tooling & Feeds';

  const pageWidthMm = stagedPdfPayload
    ? ((stagedPdfPayload.pageWidthPt * 25.4) / 72).toFixed(0)
    : null;
  const pageHeightMm = stagedPdfPayload
    ? ((stagedPdfPayload.pageHeightPt * 25.4) / 72).toFixed(0)
    : null;

  return (
    <div className="flex flex-col gap-3 min-h-[560px]">
      <input
        ref={localFileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onStageFile(f);
          e.target.value = '';
        }}
      />

      {/* Studio Header Strip */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Drawing Ingestion &amp; Pipeline Configuration
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Stage a 2D PDF blueprint, choose Vector Plotting or AI Analysis, auto-detect or draw view boxes, and select workspace modules to generate.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenManual}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
        >
          <BookOpen className="w-3.5 h-3.5 text-cyan-600" />
          <span>Open User Manual</span>
        </button>
      </div>

      {/* Main 2-Column Staging Workbench */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 flex-1 min-h-0 items-stretch">
        {/* Left Control Column */}
        <div className="xl:col-span-5 flex flex-col gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
          {/* 1. Upload & Sample Blueprints */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                1. Blueprint PDF Source
              </span>
              {stagedPdfPayload && stagedPdfPayload.pageCount > 1 && (
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <span>Sheet:</span>
                  <select
                    value={stagedPdfPayload.selectedPage}
                    onChange={(e) => onStagePageChange(Number(e.target.value))}
                    className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono tabular-nums"
                  >
                    {Array.from({ length: stagedPdfPayload.pageCount }, (_, idx) => (
                      <option key={idx + 1} value={idx + 1}>
                        Page {idx + 1} / {stagedPdfPayload.pageCount}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

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
                if (f) onStageFile(f);
              }}
              onClick={() => localFileInputRef.current?.click()}
              className={`cursor-pointer rounded-md border border-dashed p-3.5 transition-colors flex items-center justify-between gap-3 ${
                dragOver
                  ? 'border-cyan-500 bg-cyan-50/70 dark:bg-cyan-950/30'
                  : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 bg-slate-50/70 dark:bg-slate-800/40'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-center shrink-0">
                  {isStaging ? (
                    <Loader2 className="w-4 h-4 text-cyan-600 animate-spin" />
                  ) : (
                    <FileText className="w-4 h-4 text-slate-500" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                    {stagedPdfPayload ? stagedPdfPayload.fileName : 'Drop mechanical .PDF blueprint here'}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Click to browse or drag &amp; drop to stage preview
                  </div>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0">
                <Upload className="w-3 h-3" />
                <span>Browse</span>
              </span>
            </div>

            {/* Sample Mechanical PDFs */}
            <div className="mt-2.5">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                Or stage a sample mechanical PDF:
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {SAMPLE_DRAWINGS.map((preset) => {
                  const isActive = activeSampleId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => onStageSamplePreset(preset)}
                      className={`text-left px-2.5 py-1.5 rounded border text-[11px] transition-colors ${
                        isActive
                          ? 'border-cyan-600 bg-cyan-50/70 dark:bg-cyan-950/30 text-slate-900 dark:text-white font-medium'
                          : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="truncate">{preset.title}</div>
                      <div className="text-[10px] font-mono tabular-nums text-slate-400 truncate">
                        {preset.assetUrl ? 'SolidWorks PDF · 1:20' : preset.analysis.material}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preflight Telemetry Strip (Unboxed inline text) */}
            {stagedPdfPayload && (
              <div className="mt-2.5 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                <span>
                  Sheet {pageWidthMm}×{pageHeightMm} mm
                </span>
                <span aria-hidden="true">·</span>
                <span className={hasVectors ? 'text-slate-700 dark:text-slate-200 font-medium' : 'text-amber-600 dark:text-amber-400 font-medium'}>
                  {stagedPdfPayload.vectorEntityCount} vectors
                </span>
                {stagedPdfPayload.detectedScaleLabel && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Scale {stagedPdfPayload.detectedScaleLabel}</span>
                  </>
                )}
                {stagedPdfPayload.titleBlockMeta?.material && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Mat: {stagedPdfPayload.titleBlockMeta.material}</span>
                  </>
                )}
                {stagedPdfPayload.truncated && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>
                        Truncated ({stagedPdfPayload.droppedSegmentCount.toLocaleString()} shortest segs dropped)
                      </span>
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800" />

          {/* 2. Extraction Method: Vector Plotting vs AI Analysis */}
          <div>
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 mb-2">
              2. Extraction Method
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={vectorDisabled}
                onClick={() => onChangeConfig({ ...config, engine: 'vector' })}
                className={`text-left p-2.5 rounded-md border transition-colors ${
                  vectorDisabled
                    ? 'opacity-50 cursor-not-allowed border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900'
                    : effectiveEngine === 'vector'
                      ? 'border-cyan-600 bg-cyan-50/70 dark:bg-cyan-950/30'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white">
                  <Layers className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
                  <span>Vector Plotting</span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Exact PDF stroke paths, layers &amp; instant 1:1 / paper scaling.
                </div>
              </button>

              <button
                type="button"
                onClick={() => onChangeConfig({ ...config, engine: 'ai' })}
                className={`text-left p-2.5 rounded-md border transition-colors ${
                  effectiveEngine === 'ai'
                    ? 'border-cyan-600 bg-cyan-50/70 dark:bg-cyan-950/30'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white">
                  <Cpu className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
                  <span>AI Analysis</span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Reads scanned PDFs, GD&amp;T notes, bores &amp; shop routing.
                </div>
              </button>
            </div>

            {vectorDisabled && (
              <div className="mt-2 flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  No embedded vector strokes detected (raster scan PDF). AI Analysis is selected automatically.
                </span>
              </div>
            )}
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800" />

          {/* 3. View Detection Mode: Auto vs Manual */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                3. Drawing View Definition
              </span>
              <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {activeBoxes.length} view{activeBoxes.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1 p-1 rounded-md bg-slate-100 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => onChangeConfig({ ...config, viewMode: 'auto' })}
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  config.viewMode === 'auto'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Scan className="w-3.5 h-3.5" />
                <span>Auto-Detect</span>
              </button>
              <button
                type="button"
                onClick={() => onChangeConfig({ ...config, viewMode: 'manual' })}
                className={`inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  config.viewMode === 'manual'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <MousePointerClick className="w-3.5 h-3.5" />
                <span>Define Manually</span>
              </button>
            </div>

            {config.viewMode === 'manual' && (
              <div className="mt-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-500 dark:text-slate-400">
                    Drag on the sheet preview to draw boxes, or edit below:
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={addFullSheetBox}
                      className="inline-flex items-center gap-1 text-cyan-700 dark:text-cyan-400 hover:underline font-medium"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Box</span>
                    </button>
                    <button
                      type="button"
                      onClick={resetToAutoBoxes}
                      className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-300 hover:underline"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset Auto</span>
                    </button>
                  </div>
                </div>

                <div className="max-h-36 overflow-y-auto flex flex-col gap-1.5 pr-0.5">
                  {manualBoxes.map((box, idx) => {
                    const isSel = selectedBox?.id === box.id;
                    return (
                      <div
                        key={box.id}
                        onClick={() => setSelectedBoxId(box.id)}
                        className={`flex items-center gap-1.5 p-1.5 rounded border text-xs ${
                          isSel
                            ? 'border-cyan-600 bg-cyan-50/60 dark:bg-cyan-950/30'
                            : 'border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <span className="font-mono tabular-nums text-[10px] text-slate-400 w-4 text-center shrink-0">
                          {idx + 1}
                        </span>
                        <input
                          type="text"
                          value={box.label}
                          onChange={(e) => updateBoxField(box.id, { label: e.target.value })}
                          className="min-w-0 flex-1 px-1.5 py-0.5 text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                        />
                        <select
                          value={box.viewKind}
                          onChange={(e) =>
                            updateBoxField(box.id, { viewKind: e.target.value as ViewChunkKind })
                          }
                          className="px-1.5 py-0.5 text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                        >
                          {VIEW_KIND_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        {manualBoxes.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteManualBox(box.id);
                            }}
                            title="Delete view box"
                            className="p-1 text-slate-400 hover:text-rose-600 shrink-0"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800" />

          {/* 4. Pipeline Module Checkboxes */}
          <div>
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 mb-2">
              4. Modules to Generate
            </div>
            <div className="flex flex-col gap-1.5">
              {(
                [
                  {
                    key: 'cadPlotting',
                    title: 'CAD Plotting',
                    desc: 'Interactive 2D entities, layers, dimensions & multi-view plots.',
                  },
                  {
                    key: 'processPlan',
                    title: 'Process Plan',
                    desc: 'Shop-floor routing across Lathe, Milling, Grinding & Hobbing.',
                  },
                  {
                    key: 'toolingFeeds',
                    title: 'Tooling & Feeds',
                    desc: 'Material speed/feed optimization, RPM, MRR & stock weight.',
                  },
                ] as const
              ).map((item) => {
                const checked = config.modules[item.key];
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleModule(item.key)}
                    className={`flex items-start gap-2.5 p-2 rounded-md border text-left transition-colors ${
                      checked
                        ? 'border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40'
                        : 'border-slate-200 dark:border-slate-800 opacity-70 hover:opacity-100'
                    }`}
                  >
                    {checked ? (
                      <CheckSquare className="w-4 h-4 text-cyan-600 shrink-0 mt-0.5" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-900 dark:text-white">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {item.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {noModuleSelected && (
              <div className="mt-1.5 text-[11px] text-rose-600 dark:text-rose-400 font-medium">
                Select at least one output module to run the pipeline.
              </div>
            )}
          </div>

          {/* 5. Optional Pre-Run Scale, Material & Machine Overrides */}
          <div className="border-t border-slate-100 dark:border-slate-800 pt-2.5">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
            >
              <span className="inline-flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
                <span>Scale, Material &amp; Machine Overrides</span>
              </span>
              {showAdvanced ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              )}
            </button>

            {showAdvanced && (
              <div className="mt-3 space-y-2.5 text-xs">
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Plot Scale</span>
                    <select
                      value={config.scaleMode}
                      onChange={(e) =>
                        onChangeConfig({
                          ...config,
                          scaleMode: e.target.value as 'real' | 'paper',
                        })
                      }
                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px]"
                    >
                      <option value="real">1:1 Real</option>
                      <option value="paper">Paper mm</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Ratio (1 : X)
                    </span>
                    <input
                      type="number"
                      min={0.1}
                      step={0.5}
                      placeholder="Auto"
                      value={config.customScaleRatio ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const num = Number(raw);
                        onChangeConfig({
                          ...config,
                          customScaleRatio: raw && Number.isFinite(num) && num > 0 ? num : undefined,
                        });
                      }}
                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-mono tabular-nums"
                    />
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Units</span>
                    <select
                      value={config.unitsOverride}
                      onChange={(e) =>
                        onChangeConfig({
                          ...config,
                          unitsOverride: e.target.value as 'auto' | 'mm' | 'in',
                        })
                      }
                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px]"
                    >
                      <option value="auto">Auto</option>
                      <option value="mm">mm</option>
                      <option value="in">in</option>
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <label className="col-span-2 flex flex-col gap-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Material Alloy Override
                    </span>
                    <select
                      value={config.preferredMaterial || ''}
                      onChange={(e) =>
                        onChangeConfig({
                          ...config,
                          preferredMaterial: e.target.value || undefined,
                        })
                      }
                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px]"
                    >
                      <option value="">Auto (from Title Block)</option>
                      {MATERIAL_PRESETS.map((m) => (
                        <option key={m.id} value={m.name}>
                          {m.name} (ISO {m.isoGroup})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">Batch Qty</span>
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      value={config.batchSize}
                      onChange={(e) =>
                        onChangeConfig({
                          ...config,
                          batchSize: Math.max(1, Math.round(Number(e.target.value) || 1)),
                        })
                      }
                      className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-mono tabular-nums"
                    />
                  </label>
                </div>

                {config.modules.processPlan && (
                  <div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                      Preferred Shop Machines (optional focus)
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {SHOP_MACHINES.map((machine) => {
                        const selected = config.preferredMachines.includes(machine);
                        return (
                          <button
                            key={machine}
                            type="button"
                            onClick={() => togglePreferredMachine(machine)}
                            className={`px-2 py-1 text-[11px] rounded border transition-colors whitespace-nowrap ${
                              selected
                                ? 'border-cyan-600 bg-cyan-50 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-200 font-medium'
                                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                          >
                            {machine}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Primary Execute CTA */}
          <div className="mt-auto pt-2">
            <button
              type="button"
              disabled={!stagedPdfPayload || isStaging || isRunning || noModuleSelected}
              onClick={() => onRunPipeline(activeBoxes)}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-md bg-slate-900 dark:bg-cyan-600 text-white hover:bg-slate-800 dark:hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{loadingStatus || 'Running Pipeline...'}</span>
                </>
              ) : (
                <>
                  <span>
                    Run {effectiveEngine === 'vector' ? 'Vector Plotting' : 'AI Analysis'} → Open{' '}
                    {firstEnabledTabLabel}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Right Live Sheet Staging & Interactive View-Box Canvas */}
        <div className="xl:col-span-7 flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold text-slate-900 dark:text-white">
                Sheet Staging &amp; View Boundaries
              </span>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <span className="text-slate-500 dark:text-slate-400">
                {config.viewMode === 'manual'
                  ? 'Manual mode: click & drag on sheet to draw new boxes, or drag corners to resize'
                  : 'Auto mode: views detected from drawing geometry'}
              </span>
            </div>

            {stagedPdfPayload && (
              <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                {activeBoxes.length} region{activeBoxes.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          <div className="flex-1 p-4 bg-slate-100/70 dark:bg-slate-950 flex flex-col items-center justify-center min-h-[420px] overflow-auto">
            {stagedPdfPayload ? (
              <PdfSheetBoxEditor
                imageDataUrl={stagedPdfPayload.renderedImageDataUrl}
                alt={`Staged drawing ${stagedPdfPayload.fileName}`}
                boxes={activeBoxes}
                selectedBoxId={selectedBox?.id ?? null}
                editable={config.viewMode === 'manual'}
                allowDraw
                showIndex
                maxHeightClass="max-h-[540px]"
                onSelectBox={setSelectedBoxId}
                onChangeBoxes={setManualBoxes}
              />
            ) : (
              <div className="text-center max-w-sm">
                <FileText className="w-8 h-8 text-slate-300 dark:text-slate-700 mx-auto mb-2" />
                <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  {isStaging ? 'Rendering PDF sheet preview...' : 'No PDF staged yet'}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Drop a mechanical PDF on the left or pick one of the sample drawings to inspect views and configure extraction.
                </p>
              </div>
            )}
          </div>

          {/* Bottom View Regions Summary Bar */}
          {stagedPdfPayload && activeBoxes.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                Linked Regions:
              </span>
              {activeBoxes.map((b, i) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setSelectedBoxId(b.id)}
                  className={`font-mono tabular-nums hover:underline ${
                    selectedBox?.id === b.id
                      ? 'text-cyan-700 dark:text-cyan-400 font-semibold'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  [{i + 1}] {b.label} ({Math.round(b.normBounds.w * 100)}%×
                  {Math.round(b.normBounds.h * 100)}%)
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
