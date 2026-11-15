import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import type { DrawingAnalysisResult, PipelineModulesConfig } from '../types/cad';
import {
  exportToDxf,
  exportToGcode,
  exportToProcessCsv,
  exportToSvg,
} from '../utils/camEngine';

interface ExportPanelProps {
  analysis: DrawingAnalysisResult;
  batchSize: number;
  currentPdfBytes: ArrayBuffer | null;
  currentPdfName: string;
  enabledModules?: PipelineModulesConfig;
}

type PreviewTab = 'gcode' | 'dxf' | 'csv' | 'svg';

function triggerDownload(content: string | ArrayBuffer, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const ExportPanel: React.FC<ExportPanelProps> = ({
  analysis,
  batchSize,
  currentPdfBytes,
  currentPdfName,
  enabledModules,
}) => {
  const cadAvailable = enabledModules?.cadPlotting !== false && analysis.entities.length > 0;
  const processAvailable = enabledModules?.processPlan !== false && analysis.processPlan.length > 0;
  const [previewTab, setPreviewTab] = useState<PreviewTab>(processAvailable ? 'gcode' : 'dxf');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!processAvailable && (previewTab === 'gcode' || previewTab === 'csv') && cadAvailable) {
      setPreviewTab('dxf');
    } else if (!cadAvailable && (previewTab === 'dxf' || previewTab === 'svg') && processAvailable) {
      setPreviewTab('gcode');
    }
  }, [processAvailable, cadAvailable, previewTab]);

  const baseName = analysis.partNumber.replace(/[^a-zA-Z0-9_-]/g, '_') || 'part_drawing';

  const dxfText = useMemo(() => exportToDxf(analysis), [analysis]);
  const svgText = useMemo(() => exportToSvg(analysis), [analysis]);
  const gcodeText = useMemo(() => exportToGcode(analysis), [analysis]);
  const csvText = useMemo(() => exportToProcessCsv(analysis, batchSize), [analysis, batchSize]);

  const activeCode =
    previewTab === 'gcode'
      ? gcodeText
      : previewTab === 'dxf'
        ? dxfText
        : previewTab === 'csv'
          ? csvText
          : svgText;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div className="lg:col-span-4 flex flex-col gap-3">
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            CAD &amp; Manufacturing Exports
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Download plotted 2D vector geometry, starter ISO G-code, or shop-floor routing sheets.
          </p>

          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              disabled={!cadAvailable}
              onClick={() => triggerDownload(dxfText, `${baseName}.dxf`, 'application/dxf')}
              className="flex items-center justify-between px-3 py-2.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>AutoCAD 2D Vector (.DXF){!cadAvailable ? ' · CAD skipped' : ''}</span>
              <Download className="w-3.5 h-3.5 text-cyan-600" />
            </button>

            <button
              type="button"
              disabled={!cadAvailable}
              onClick={() => triggerDownload(svgText, `${baseName}.svg`, 'image/svg+xml')}
              className="flex items-center justify-between px-3 py-2.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>Scaled Vector Graphic (.SVG){!cadAvailable ? ' · CAD skipped' : ''}</span>
              <Download className="w-3.5 h-3.5 text-cyan-600" />
            </button>

            <button
              type="button"
              disabled={!processAvailable}
              onClick={() => triggerDownload(gcodeText, `${baseName}.nc`, 'text/plain')}
              className="flex items-center justify-between px-3 py-2.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>Starter Fanuc/GRBL G-Code (.NC){!processAvailable ? ' · Process skipped' : ''}</span>
              <Download className="w-3.5 h-3.5 text-cyan-600" />
            </button>

            <button
              type="button"
              disabled={!processAvailable}
              onClick={() => triggerDownload(csvText, `${baseName}_routing.csv`, 'text/csv')}
              className="flex items-center justify-between px-3 py-2.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>Process Routing Sheet (.CSV){!processAvailable ? ' · Process skipped' : ''}</span>
              <Download className="w-3.5 h-3.5 text-cyan-600" />
            </button>

            {currentPdfBytes && (
              <button
                type="button"
                onClick={() =>
                  triggerDownload(currentPdfBytes, currentPdfName || `${baseName}.pdf`, 'application/pdf')
                }
                className="flex items-center justify-between px-3 py-2.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-white"
              >
                <span>Source Drawing PDF (.PDF)</span>
                <Download className="w-3.5 h-3.5 text-slate-500" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Live Code / File Preview */}
      <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 dark:bg-slate-800 rounded-md">
            {(
              [
                ['gcode', 'G-Code (.nc)'],
                ['dxf', 'DXF Entities'],
                ['csv', 'Routing CSV'],
                ['svg', 'SVG Markup'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPreviewTab(key)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  previewTab === key
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 whitespace-nowrap"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>

        <pre className="p-4 text-xs font-mono leading-relaxed text-slate-800 dark:text-slate-200 overflow-auto max-h-[460px] bg-slate-50/50 dark:bg-slate-950/60">
          {activeCode}
        </pre>
      </div>
    </div>
  );
};
