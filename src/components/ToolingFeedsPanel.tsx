import React, { useState } from 'react';
import { Check } from 'lucide-react';
import type { DrawingAnalysisResult } from '../types/cad';
import { MATERIAL_PRESETS, matchMaterialPreset } from '../utils/camEngine';

interface ToolingFeedsPanelProps {
  analysis: DrawingAnalysisResult;
  onUpdateAnalysis: (next: DrawingAnalysisResult) => void;
}

export const ToolingFeedsPanel: React.FC<ToolingFeedsPanelProps> = ({
  analysis,
  onUpdateAnalysis,
}) => {
  const initialPreset = matchMaterialPreset(analysis.material);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(initialPreset.id);
  const [toolDia, setToolDia] = useState<number>(10);
  const [flutes, setFlutes] = useState<number>(3);
  const [vc, setVc] = useState<number>(initialPreset.surfaceSpeedMMin);
  const [fz, setFz] = useState<number>(initialPreset.chipLoadMmTooth);
  const [ap, setAp] = useState<number>(4);
  const [ae, setAe] = useState<number>(5);
  const [appliedOpId, setAppliedOpId] = useState<string | null>(null);

  const activePreset = MATERIAL_PRESETS.find((p) => p.id === selectedPresetId) || initialPreset;

  const handleSelectMaterial = (id: string) => {
    setSelectedPresetId(id);
    const p = MATERIAL_PRESETS.find((m) => m.id === id);
    if (p) {
      setVc(p.surfaceSpeedMMin);
      setFz(p.chipLoadMmTooth);
    }
  };

  const rpm = Math.min(24000, Math.max(120, Math.round((1000 * vc) / (Math.PI * Math.max(0.5, toolDia)))));
  const feedRate = Math.round(rpm * Math.max(1, flutes) * fz);
  const mrrCm3Min = (ap * ae * feedRate) / 1000;
  const kcFactor = activePreset.isoGroup === 'M' ? 2.4 : activePreset.isoGroup === 'P' ? 2.1 : 0.85;
  const powerKw = (mrrCm3Min * kcFactor) / 60;

  const applyToOperation = (opId: string) => {
    const nextPlan = analysis.processPlan.map((op) =>
      op.id === opId
        ? {
            ...op,
            toolDiameterMm: toolDia,
            flutes,
            spindleRpm: rpm,
            feedRateMmMin: feedRate,
            depthOfCutMm: ap,
          }
        : op
    );
    onUpdateAnalysis({ ...analysis, processPlan: nextPlan });
    setAppliedOpId(opId);
    window.setTimeout(() => setAppliedOpId(null), 1600);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Feeds & Speeds Calculator */}
      <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Speeds, Feeds &amp; MRR Calculator
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {activePreset.machinabilityNote}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <label className="col-span-2 flex flex-col gap-1 font-medium text-slate-600 dark:text-slate-300">
            Workpiece Alloy Preset
            <select
              value={selectedPresetId}
              onChange={(e) => handleSelectMaterial(e.target.value)}
              className="h-9 px-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white"
            >
              {MATERIAL_PRESETS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · ISO {m.isoGroup}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 font-medium text-slate-600 dark:text-slate-300">
            Cutter Diameter (mm)
            <input
              type="number"
              min={1}
              max={100}
              step={0.5}
              value={toolDia}
              onChange={(e) => setToolDia(Math.max(1, Number(e.target.value) || 1))}
              className="h-9 px-2.5 font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white"
            />
          </label>

          <label className="flex flex-col gap-1 font-medium text-slate-600 dark:text-slate-300">
            Flutes (z)
            <input
              type="number"
              min={1}
              max={12}
              value={flutes}
              onChange={(e) => setFlutes(Math.max(1, Number(e.target.value) || 1))}
              className="h-9 px-2.5 font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white"
            />
          </label>

          <label className="flex flex-col gap-1 font-medium text-slate-600 dark:text-slate-300">
            Surface Speed Vc (m/min)
            <input
              type="number"
              min={10}
              max={800}
              value={vc}
              onChange={(e) => setVc(Math.max(10, Number(e.target.value) || 10))}
              className="h-9 px-2.5 font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white"
            />
          </label>

          <label className="flex flex-col gap-1 font-medium text-slate-600 dark:text-slate-300">
            Chip Load fz (mm/tooth)
            <input
              type="number"
              min={0.005}
              max={0.5}
              step={0.005}
              value={fz}
              onChange={(e) => setFz(Math.max(0.005, Number(e.target.value) || 0.01))}
              className="h-9 px-2.5 font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white"
            />
          </label>

          <label className="flex flex-col gap-1 font-medium text-slate-600 dark:text-slate-300">
            Axial DOC ap (mm)
            <input
              type="number"
              min={0.1}
              max={50}
              step={0.5}
              value={ap}
              onChange={(e) => setAp(Math.max(0.1, Number(e.target.value) || 0.5))}
              className="h-9 px-2.5 font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white"
            />
          </label>

          <label className="flex flex-col gap-1 font-medium text-slate-600 dark:text-slate-300">
            Radial WOC ae (mm)
            <input
              type="number"
              min={0.1}
              max={100}
              step={0.5}
              value={ae}
              onChange={(e) => setAe(Math.max(0.1, Number(e.target.value) || 0.5))}
              className="h-9 px-2.5 font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white"
            />
          </label>
        </div>

        {/* Computed Outputs */}
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Spindle Speed</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
              {rpm} <span className="text-xs font-normal text-slate-400">RPM</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Linear Feed Rate</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
              {feedRate} <span className="text-xs font-normal text-slate-400">mm/min</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Removal Rate (MRR)</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
              {mrrCm3Min.toFixed(1)} <span className="text-xs font-normal text-slate-400">cm³/min</span>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Est. Spindle Power</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
              {powerKw.toFixed(2)} <span className="text-xs font-normal text-slate-400">kW</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tooling & Feature Assignment Table */}
      <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Tool Crib &amp; Feature Mapping
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Apply calculated cutter speeds/feeds directly to any shop-floor operation.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-3">Tool #</th>
                <th className="py-2.5 px-3">Cutter Spec</th>
                <th className="py-2.5 px-3">Assigned Operation</th>
                <th className="py-2.5 px-3 text-right">Current Params</th>
                <th className="py-2.5 px-3 text-right">Sync</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {analysis.processPlan.map((op, i) => (
                <tr key={op.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-3 font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                    T{String(i + 1).padStart(2, '0')}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-medium text-slate-900 dark:text-white">{op.toolSpec}</div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      Ø{op.toolDiameterMm} mm · {op.flutes} fl · {op.coolant}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                    <span className="font-mono text-slate-400">OP-{op.opNumber}</span> · {op.operationName}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {op.spindleRpm} RPM · {op.feedRateMmMin} mm/m
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => applyToOperation(op.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
                    >
                      {appliedOpId === op.id ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span>Applied</span>
                        </>
                      ) : (
                        <span>Apply Calc</span>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
