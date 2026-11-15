import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type {
  DrawingAnalysisResult,
  MachineCategory,
  ProcessOperation,
} from '../types/cad';
import {
  MATERIAL_PRESETS,
  SHOP_MACHINES,
  calculateCuttingParams,
  getDefaultOperationTemplate,
  matchMaterialPreset,
  normalizeMachineCategory,
} from '../utils/camEngine';

interface ProcessPlanPanelProps {
  analysis: DrawingAnalysisResult;
  batchSize: number;
  onChangeBatchSize: (size: number) => void;
  selectedOpId: string | null;
  onSelectOp: (opId: string | null, featureId?: string) => void;
  onUpdateAnalysis: (next: DrawingAnalysisResult) => void;
  onReplanWithAi: (shopFocus: string, selectedMachines?: MachineCategory[]) => Promise<void>;
  replanning: boolean;
}

export const ProcessPlanPanel: React.FC<ProcessPlanPanelProps> = ({
  analysis,
  batchSize,
  onChangeBatchSize,
  selectedOpId,
  onSelectOp,
  onUpdateAnalysis,
  onReplanWithAi,
  replanning,
}) => {
  const [shopFocus, setShopFocus] = useState<string>(
    'Turn + Mill + Gear Hob + Grinding Finishing'
  );
  const [machineFilter, setMachineFilter] = useState<'All' | MachineCategory>('All');

  const preset = matchMaterialPreset(analysis.material);

  const totalSetupMin = analysis.processPlan.reduce((sum, op) => sum + Number(op.setupTimeMin || 0), 0);
  const totalCycleMin = analysis.processPlan.reduce((sum, op) => sum + Number(op.cycleTimeMin || 0), 0);
  const totalBatchMin = totalSetupMin + totalCycleMin * batchSize;

  // Estimate raw billet mass (kg) and material cost
  const { length, width, thickness, form } = analysis.stockEnvelope;
  const volumeCm3 =
    form === 'Round Bar'
      ? (Math.PI * Math.pow(width / 2, 2) * length) / 1000
      : (length * width * thickness) / 1000;
  const partMassKg = (volumeCm3 * preset.densityGcm3) / 1000;
  const materialCostPerPc = partMassKg * preset.costPerKgUsd;

  const updateOperation = (opId: string, patch: Partial<ProcessOperation>) => {
    const nextPlan = analysis.processPlan.map((op) => (op.id === opId ? { ...op, ...patch } : op));
    onUpdateAnalysis({ ...analysis, processPlan: nextPlan });
  };

  const moveOperation = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= analysis.processPlan.length) return;
    const copy = [...analysis.processPlan];
    const [removed] = copy.splice(index, 1);
    copy.splice(target, 0, removed);
    const renumbered = copy.map((op, i) => ({ ...op, opNumber: (i + 1) * 10 }));
    onUpdateAnalysis({ ...analysis, processPlan: renumbered });
  };

  const deleteOperation = (opId: string) => {
    const filtered = analysis.processPlan
      .filter((op) => op.id !== opId)
      .map((op, i) => ({ ...op, opNumber: (i + 1) * 10 }));
    onUpdateAnalysis({ ...analysis, processPlan: filtered });
  };

  const addOperation = () => {
    const nextNum = (analysis.processPlan.length + 1) * 10;
    const targetMachine: MachineCategory = machineFilter === 'All' ? 'Milling' : machineFilter;
    const newOp = getDefaultOperationTemplate(
      targetMachine,
      analysis.material,
      nextNum,
      analysis.features[0]?.name || 'General Edges',
      analysis.features[0]?.id
    );
    onUpdateAnalysis({
      ...analysis,
      processPlan: [...analysis.processPlan, newOp],
    });
  };

  const handleMaterialChange = (materialName: string) => {
    const newPreset = matchMaterialPreset(materialName);
    const recalculated = analysis.processPlan.map((op) => {
      const cat = normalizeMachineCategory(op.machineType);
      if (cat === 'Band Saw' || cat === 'Inspection' || cat === 'Grinding Finishing') {
        return op;
      }
      const { spindleRpm, feedRateMmMin } = calculateCuttingParams(
        newPreset,
        op.toolDiameterMm || 10,
        op.flutes || 3
      );
      return {
        ...op,
        spindleRpm,
        feedRateMmMin,
      };
    });
    onUpdateAnalysis({
      ...analysis,
      material: materialName,
      processPlan: recalculated,
    });
  };

  const filteredPlan =
    machineFilter === 'All'
      ? analysis.processPlan
      : analysis.processPlan.filter(
          (op) => normalizeMachineCategory(op.machineType) === machineFilter
        );

  const countByMachine = SHOP_MACHINES.reduce<Record<MachineCategory, number>>(
    (acc, m) => {
      acc[m] = analysis.processPlan.filter(
        (op) => normalizeMachineCategory(op.machineType) === m
      ).length;
      return acc;
    },
    {
      'Lathe Machine': 0,
      Milling: 0,
      'Grinding Finishing': 0,
      'Gear Hobbing': 0,
      'Band Saw': 0,
      Inspection: 0,
    }
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Shop Routing Controls + Machine Selection Filter Header */}
      <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              Material Spec
              <select
                value={analysis.material}
                onChange={(e) => handleMaterialChange(e.target.value)}
                className="h-9 px-2.5 text-sm font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                {MATERIAL_PRESETS.map((m) => (
                  <option key={m.id} value={m.name}>
                    {m.name} (ISO {m.isoGroup})
                  </option>
                ))}
                {!MATERIAL_PRESETS.some((m) => m.name === analysis.material) && (
                  <option value={analysis.material}>{analysis.material}</option>
                )}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              Batch Qty (pcs)
              <input
                type="number"
                min={1}
                max={10000}
                value={batchSize}
                onChange={(e) => onChangeBatchSize(Math.max(1, Number(e.target.value) || 1))}
                className="h-9 w-24 px-2.5 text-sm font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </label>

            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
              Shop Equipment Strategy
              <select
                value={shopFocus}
                onChange={(e) => setShopFocus(e.target.value)}
                className="h-9 px-2.5 text-sm font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                <option value="Turn + Mill + Gear Hob + Grinding Finishing">
                  Multi-Cell: Lathe + Milling + Gear Hobbing + Grinding Finishing
                </option>
                <option value="Milling + Band Saw + Grinding Finishing">
                  Milling + Band Saw + Grinding Finishing
                </option>
                <option value="Lathe Machine + Grinding Finishing">
                  Lathe Machine + Grinding Finishing
                </option>
                <option value="Gear Hobbing + Lathe Machine + Grinding Finishing">
                  Gear Hobbing + Lathe Machine + Grinding
                </option>
                <option value="5-Axis Simultaneous Milling">
                  5-Axis Simultaneous Milling (Single Setup)
                </option>
              </select>
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={replanning}
              onClick={() =>
                onReplanWithAi(
                  shopFocus,
                  machineFilter === 'All' ? undefined : [machineFilter]
                )
              }
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${replanning ? 'animate-spin' : ''}`} />
              <span>{replanning ? 'Optimizing...' : 'Regenerate Routing'}</span>
            </button>

            <button
              type="button"
              onClick={addOperation}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-slate-900 dark:bg-cyan-600 text-white hover:bg-slate-800 dark:hover:bg-cyan-500 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>
                {machineFilter === 'All' ? 'Add Operation' : `Add ${machineFilter} Op`}
              </span>
            </button>
          </div>
        </div>

        {/* Machine Selection Filter Bar */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-1">
            Machine Filter:
          </span>
          <button
            type="button"
            onClick={() => setMachineFilter('All')}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
              machineFilter === 'All'
                ? 'border-cyan-600 bg-cyan-50/70 dark:bg-cyan-950/30 text-cyan-900 dark:text-cyan-200'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            All Machines <span className="font-mono text-[11px] opacity-75">· {analysis.processPlan.length}</span>
          </button>
          {SHOP_MACHINES.map((machine) => {
            const active = machineFilter === machine;
            return (
              <button
                key={machine}
                type="button"
                onClick={() => setMachineFilter(active ? 'All' : machine)}
                className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-cyan-600 bg-cyan-50/70 dark:bg-cyan-950/30 text-cyan-900 dark:text-cyan-200'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                {machine}{' '}
                <span className="font-mono text-[11px] opacity-75">· {countByMachine[machine]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4-Column Quantitative Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Setup Time</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
              {totalSetupMin.toFixed(0)}
            </span>
            <span className="text-xs font-mono text-slate-400">min</span>
          </div>
        </div>

        <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <div className="text-xs text-slate-500 dark:text-slate-400">Cycle Time / Part</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
              {totalCycleMin.toFixed(1)}
            </span>
            <span className="text-xs font-mono text-slate-400">min/pc</span>
          </div>
        </div>

        <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Batch Run ({batchSize} pcs)
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
              {totalBatchMin >= 60 ? `${(totalBatchMin / 60).toFixed(1)}` : totalBatchMin.toFixed(0)}
            </span>
            <span className="text-xs font-mono text-slate-400">
              {totalBatchMin >= 60 ? 'hrs total' : 'min total'}
            </span>
          </div>
        </div>

        <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <div className="text-xs text-slate-500 dark:text-slate-400">Raw Stock Billet</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-white">
              {partMassKg.toFixed(2)}
            </span>
            <span className="text-xs font-mono text-slate-400">
              kg · ${materialCostPerPc.toFixed(2)}/pc
            </span>
          </div>
        </div>
      </div>

      {/* Operation Routing Data Grid */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Shop-Floor Operation Routing
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Click any operation row to isolate its target feature and toolpath in the CAD plotter.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            {filteredPlan.length === analysis.processPlan.length
              ? `${analysis.processPlan.length} operations`
              : `${filteredPlan.length} of ${analysis.processPlan.length} ops (${machineFilter})`}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-3">Op</th>
                <th className="py-2.5 px-3">Operation &amp; Feature</th>
                <th className="py-2.5 px-3">Machine / Setup</th>
                <th className="py-2.5 px-3">Tooling</th>
                <th className="py-2.5 px-3 text-right">RPM</th>
                <th className="py-2.5 px-3 text-right">Feed (mm/m)</th>
                <th className="py-2.5 px-3 text-right">DOC (mm)</th>
                <th className="py-2.5 px-3 text-right">Setup (m)</th>
                <th className="py-2.5 px-3 text-right">Cycle (m)</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {filteredPlan.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-6 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
                    No operations assigned to {machineFilter}. Click &ldquo;Add {machineFilter} Op&rdquo; above to add one.
                  </td>
                </tr>
              ) : (
                filteredPlan.map((op) => {
                  const index = analysis.processPlan.findIndex((item) => item.id === op.id);
                  const isSelected = selectedOpId === op.id;
                  const normalizedMachine = normalizeMachineCategory(op.machineType);
                  return (
                    <tr
                      key={op.id}
                      onClick={() => onSelectOp(isSelected ? null : op.id, op.targetFeatureId)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-cyan-50/70 dark:bg-cyan-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-2.5 px-3 font-mono font-semibold tabular-nums text-slate-900 dark:text-white whitespace-nowrap">
                        OP-{op.opNumber}
                      </td>
                      <td className="py-2.5 px-3 min-w-[200px]">
                        <input
                          type="text"
                          value={op.operationName}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateOperation(op.id, { operationName: e.target.value })}
                          className="w-full font-medium text-slate-900 dark:text-white bg-transparent border-b border-transparent focus:border-cyan-500 focus:outline-none"
                        />
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[240px]">
                          {op.targetFeatureName}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 min-w-[165px]">
                        <select
                          value={normalizedMachine}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            updateOperation(op.id, {
                              machineType: e.target.value as MachineCategory,
                            })
                          }
                          className="w-full font-medium text-slate-800 dark:text-slate-200 bg-transparent border-b border-slate-200 dark:border-slate-700 focus:border-cyan-500 focus:outline-none py-0.5"
                        >
                          {SHOP_MACHINES.map((m) => (
                            <option key={m} value={m} className="bg-white dark:bg-slate-900">
                              {m}
                            </option>
                          ))}
                        </select>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[175px] mt-0.5">
                          {op.setupName}
                        </div>
                      </td>
                    <td className="py-2.5 px-3 min-w-[190px]">
                      <input
                        type="text"
                        value={op.toolSpec}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateOperation(op.id, { toolSpec: e.target.value })}
                        className="w-full text-slate-800 dark:text-slate-200 bg-transparent border-b border-transparent focus:border-cyan-500 focus:outline-none"
                      />
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        Ø{op.toolDiameterMm} mm · {op.coolant}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      <input
                        type="number"
                        value={op.spindleRpm}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateOperation(op.id, { spindleRpm: Number(e.target.value) || 0 })}
                        className="w-16 text-right bg-transparent border-b border-slate-200 dark:border-slate-700 focus:border-cyan-500 focus:outline-none text-slate-900 dark:text-white"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      <input
                        type="number"
                        value={op.feedRateMmMin}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateOperation(op.id, { feedRateMmMin: Number(e.target.value) || 0 })}
                        className="w-16 text-right bg-transparent border-b border-slate-200 dark:border-slate-700 focus:border-cyan-500 focus:outline-none text-slate-900 dark:text-white"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      <input
                        type="number"
                        step="0.1"
                        value={op.depthOfCutMm}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateOperation(op.id, { depthOfCutMm: Number(e.target.value) || 0 })}
                        className="w-14 text-right bg-transparent border-b border-slate-200 dark:border-slate-700 focus:border-cyan-500 focus:outline-none text-slate-900 dark:text-white"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      <input
                        type="number"
                        step="0.5"
                        value={op.setupTimeMin}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateOperation(op.id, { setupTimeMin: Number(e.target.value) || 0 })}
                        className="w-12 text-right bg-transparent border-b border-slate-200 dark:border-slate-700 focus:border-cyan-500 focus:outline-none text-slate-900 dark:text-white"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      <input
                        type="number"
                        step="0.1"
                        value={op.cycleTimeMin}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateOperation(op.id, { cycleTimeMin: Number(e.target.value) || 0 })}
                        className="w-12 text-right bg-transparent border-b border-slate-200 dark:border-slate-700 focus:border-cyan-500 focus:outline-none text-slate-900 dark:text-white"
                      />
                    </td>
                    <td
                      className="py-2.5 px-3 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveOperation(index, -1)}
                          disabled={index === 0}
                          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white disabled:opacity-30"
                          title="Move operation earlier"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveOperation(index, 1)}
                          disabled={index === analysis.processPlan.length - 1}
                          className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white disabled:opacity-30"
                          title="Move operation later"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteOperation(op.id)}
                          className="p-1 text-slate-400 hover:text-rose-600"
                          title="Delete operation"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* DFM & Quality Notes */}
      {analysis.dfmNotes.length > 0 && (
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
            Manufacturability &amp; Inspection Notes
          </h3>
          <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
            {analysis.dfmNotes.map((note, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="font-mono text-slate-400 tabular-nums">{String(idx + 1).padStart(2, '0')}.</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
