import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Search,
  X,
} from 'lucide-react';
import type { WorkspaceTab } from '../types/cad';

interface UserManualPanelProps {
  onNavigateTab: (tab: WorkspaceTab) => void;
}

interface ManualTableRow {
  col1: string;
  col2: string;
  col3?: string;
}

interface ManualChapter {
  id: string;
  number: string;
  title: string;
  summary: string;
  targetTab?: WorkspaceTab;
  targetTabLabel?: string;
  steps: string[];
  tips: string[];
  table?: {
    headers: string[];
    rows: ManualTableRow[];
  };
  keywords: string[];
}

const MANUAL_CHAPTERS: ManualChapter[] = [
  {
    id: 'quick-start',
    number: '01',
    title: 'Getting Started & Core Workflow',
    summary:
      'DraftPlan CAD turns 2D mechanical PDFs (SolidWorks, AutoCAD, or scanned blueprints) into plotted CAD geometry, multi-machine CNC routing, speeds/feeds math, and downloadable DXF/SVG/NC/CSV files.',
    targetTab: 'upload',
    targetTabLabel: 'Open Upload Drawing',
    steps: [
      'Open the Upload Drawing tab (or click Upload PDF in the top bar) and drop a .pdf blueprint or choose one of the built-in Sample Mechanical PDFs.',
      'Review the preflight summary: sheet size (mm), embedded vector count, detected drawing scale (e.g. 1:20), and title-block material (e.g. M.S IS:2062).',
      'Select Vector Plotting (for CAD-exported PDFs with vector strokes) or AI Analysis (for scanned PDFs or full GD&T feature extraction).',
      'Keep Auto-Detect Views or switch to Define Manually to drag view boxes directly on the sheet preview.',
      'Check the modules you want to generate (CAD Plotting, Process Plan, Tooling & Feeds) and click Run Pipeline.',
    ],
    tips: [
      'Try the Bend Pulley Shell (SolidWorks PDF) preset in Upload Drawing to test 3-view detection, border stripping, M.S IS:2062 matching, and 1:1 Real vs Paper scaling.',
      'You can jump between any workspace tab at any time; unchecked modules are clearly marked Skipped and can be enabled on demand.',
    ],
    keywords: ['start', 'overview', 'workflow', 'pdf', 'sample', 'bend pulley', 'shell'],
  },
  {
    id: 'upload-drawing',
    number: '02',
    title: 'Upload Drawing Studio Options',
    summary:
      'Stage any PDF page locally before running extraction so you never waste AI calls or plot unwanted regions.',
    targetTab: 'upload',
    targetTabLabel: 'Open Upload Drawing',
    steps: [
      'Extraction Method: Choose Vector Plotting when Embedded Vectors > 0 for instant, deterministic millimeter plotting. Choose AI Analysis for scanned raster PDFs (0 vectors) or when you want Gemini to infer bores, threads, and shop routing from notes.',
      'Drawing View Definition: Use Auto-Detect to automatically separate Isometric, Orthogonal Front/Top/Side, and Cross-Section views. Switch to Define Manually to click-and-drag new view boxes directly on the PDF sheet, drag boxes to move them, resize via the bottom-right corner handle, or edit labels and view types.',
      'Modules to Generate: Check CAD Plotting, Process Plan, and/or Tooling & Feeds. Unchecked modules are skipped during extraction and marked Skipped in the top navigation bar.',
      'Scale, Material & Machine Overrides: Expand overrides to force 1:1 Real vs. Paper coordinates, enter a manual 1:X scale ratio, switch mm/in units, override the alloy, or pre-select preferred shop machines.',
    ],
    tips: [
      'If a PDF has multiple pages, use the Sheet dropdown next to the filename to preview and stage the exact page before clicking Run Pipeline.',
      'If you visit a tab that was marked Skipped, click Enable & Generate directly inside that tab to compute it without re-uploading.',
    ],
    table: {
      headers: ['Setting', 'When to Use', 'Behavior'],
      rows: [
        {
          col1: 'Vector Plotting',
          col2: 'CAD-exported PDFs (SolidWorks, Fusion, AutoCAD)',
          col3: 'Decodes DrawOPS v5 strokes, strips borders/title blocks, classifies layers',
        },
        {
          col1: 'AI Analysis',
          col2: 'Scanned PDFs, photos, or rich GD&T note synthesis',
          col3: 'Sends sheet + view chunk previews to Gemini for geometry & routing',
        },
        {
          col1: 'Auto-Detect Views',
          col2: 'Standard multi-view drawings',
          col3: 'Clusters structural geometry ignoring dimension lines so views stay separate',
        },
        {
          col1: 'Define Manually',
          col2: 'Crowded sheets or custom section crops',
          col3: 'Click & drag boxes directly on the sheet preview before extraction',
        },
      ],
    },
    keywords: ['upload', 'vector', 'ai', 'manual', 'auto', 'checkbox', 'skip', 'scale', 'override'],
  },
  {
    id: 'multi-view',
    number: '03',
    title: 'Multi-View Chunking & Sheet Linkage',
    summary:
      'Every detected or manually drawn view box stays linked to its exact normalized position on the original PDF sheet (normBounds and sheetOffset).',
    targetTab: 'cad',
    targetTabLabel: 'Open CAD Plotter',
    steps: [
      'In the CAD Plotter side-by-side PDF Reference pane, click Adjust View Boxes to move or resize boxes after plotting.',
      'Click any box on the PDF sheet to isolate that view in Single View mode or highlight its matching card in Separate Plots mode.',
      'Use Plot Chunk Vectors or Re-Analyze with Chunks after editing boxes so both vector assembly and AI vision use the updated boundaries.',
    ],
    tips: [
      'Dimension lines (#808080 gray strokes) are excluded from view clustering so extension lines never merge two neighboring views together.',
    ],
    keywords: ['chunk', 'view', 'longitudinal', 'cross-section', 'orthogonal', 'isometric', 'adjust'],
  },
  {
    id: 'cad-plotter',
    number: '04',
    title: 'CAD Plotter, Layers & Scale Toggle',
    summary:
      'Inspect plotted 2D geometry in Combined Sheet, Separate Plots (per-view multi-plot grid), or Single View modes with calibrated 1:1 Real vs. Paper dimensions.',
    targetTab: 'cad',
    targetTabLabel: 'Open CAD Plotter',
    steps: [
      'Switch plot modes in the CAD toolbar: Combined Sheet shows all views positioned by sheetOffset; Separate Plots gives each view an independent pan/zoom/fit viewport; Single View isolates one view.',
      'Toggle 1:1 Real vs. Paper in the CAD toolbar when a drawing scale (e.g., SCALE 1:20 or dimension-calibrated scale) is detected. 1:1 Real plots true manufactured millimeters; Paper plots raw PDF sheet millimeters.',
      'Toggle visibility in the Left Rail Layers panel for Part Outline, Holes & Bores, Centerlines, Hidden / Threads, Dimensions, and CAM Toolpaths.',
      'Click Measure to pick any two points on the canvas and read exact ΔX, ΔY, and Euclidean distance.',
      'Click Simulate CAM to animate rapid (G00) and cutting (G01) toolpaths directly over the plotted geometry.',
    ],
    tips: [
      'In Separate Plots mode, use the View Filter toggles above the grid to show or hide individual views such as Isometric 3D View.',
      'Click Fit in any viewport (or per-plot card) to recenter and scale the drawing automatically.',
    ],
    table: {
      headers: ['Layer / Stroke', 'PDF Source Cue', 'Default Color'],
      rows: [
        { col1: 'Part Outline', col2: 'Heavy dark strokes (outer boundaries, bores)', col3: 'Slate / Crisp White' },
        { col1: 'Centerlines', col2: 'Dashed strokes & thin crosshair axes', col3: 'Muted Slate Dashed' },
        { col1: 'Dimensions', col2: 'Mid-gray (#808080) extension & arrow lines', col3: 'Amber' },
        { col1: 'CAM Toolpaths', col2: 'Generated G00 rapid & G01 feed passes', col3: 'Cyan / Amber' },
      ],
    },
    keywords: ['cad', 'plotter', 'separate', 'combined', 'single', 'scale', '1:1', 'paper', 'measure', 'simulate'],
  },
  {
    id: 'process-plan',
    number: '05',
    title: 'Process Plan & Machine Selection',
    summary:
      'Manage shop-floor machining sequences across Lathe Machine, Milling, Grinding Finishing, Gear Hobbing, Band Saw, and Inspection.',
    targetTab: 'process',
    targetTabLabel: 'Open Process Plan',
    steps: [
      'Use the Machine Filter in the Process Plan header to filter operations by specific equipment (All Machines, Lathe Machine, Milling, Grinding Finishing, Gear Hobbing, Band Saw, Inspection).',
      'Click + Add Operation to insert a machine-specific template tuned automatically to the active part material.',
      'Edit Spindle RPM, Feed Rate, Depth of Cut, Setup Time, or Cycle Time inline; batch totals update immediately.',
      'Click any operation row to highlight its target feature and isolate its animated CAM toolpath in the CAD Plotter.',
      'Use AI Replan Routing with your selected shop equipment focus to regenerate the full sequence.',
    ],
    tips: [
      'Cylindrical parts such as shafts, bushings, and shells automatically prioritize Band Saw, Lathe Machine, Grinding Finishing, and Inspection.',
    ],
    keywords: ['process', 'plan', 'lathe', 'milling', 'grinding', 'hobbing', 'gear', 'saw', 'machine', 'batch'],
  },
  {
    id: 'tooling-feeds',
    number: '06',
    title: 'Tooling, Speeds, Feeds & Material Presets',
    summary:
      'Verify ISO material cutting parameters, spindle RPM, feed rates, Material Removal Rate (MRR), and raw stock weight/cost.',
    targetTab: 'tooling',
    targetTabLabel: 'Open Tooling & Feeds',
    steps: [
      'Select or verify the active Material Preset (6061-T6 Aluminum, M.S IS:2062 Mild Steel, 4140 Alloy Steel, 304 Stainless, C360 Brass, or Acetal/Delrin).',
      'Inspect calculated cutting speed Vc (m/min), chip load fz (mm/tooth), recommended RPM, and MRR (cm³/min) for every planned operation.',
      'Click Apply Recommended to sync calculated RPM and feed values back into the Process Plan.',
    ],
    tips: [
      'Title blocks containing M.S IS:2062 or mild steel specifications automatically resolve to M.S IS:2062 Mild Steel (ISO Group P, 145 m/min, 7.85 g/cm³).',
    ],
    table: {
      headers: ['Material Preset', 'ISO Group', 'Surface Speed (Vc)'],
      rows: [
        { col1: 'M.S IS:2062 Mild Steel', col2: 'ISO P', col3: '145 m/min · 7.85 g/cm³' },
        { col1: '6061-T6 Aluminum', col2: 'ISO N', col3: '260 m/min · 2.70 g/cm³' },
        { col1: '4140 Alloy Steel', col2: 'ISO P', col3: '120 m/min · 7.85 g/cm³' },
        { col1: '304 Stainless Steel', col2: 'ISO M', col3: '85 m/min · 8.00 g/cm³' },
      ],
    },
    keywords: ['tooling', 'feeds', 'rpm', 'mrr', 'is:2062', 'material', 'steel', 'aluminum', 'stock'],
  },
  {
    id: 'export-gcode',
    number: '07',
    title: 'CAD & Shop-Floor Exports',
    summary:
      'Preview and download industry-standard geometry and manufacturing deliverables directly from browser memory.',
    targetTab: 'export',
    targetTabLabel: 'Open Export & G-Code',
    steps: [
      'Select G-Code (.NC), AutoCAD (.DXF), Routing Sheet (.CSV), or Scaled Graphic (.SVG) in the live code previewer.',
      'Verify coordinate units ($INSUNITS in DXF; G21/G20, G90, G17, G54 headers and T01 M06 tool calls in G-Code).',
      'Click any download button to export the file or copy the generated code to your clipboard.',
    ],
    tips: [
      'If CAD Plotting was skipped during Upload Drawing, DXF/SVG exports are disabled until CAD Plotting is enabled; similarly, NC/CSV routing exports require Process Plan to be active.',
    ],
    keywords: ['export', 'dxf', 'svg', 'gcode', 'g-code', 'nc', 'csv', 'download'],
  },
  {
    id: 'flow-chart',
    number: '08',
    title: 'Architecture Flow Chart',
    summary:
      'Explore the interactive Process Flow and Code Architecture diagrams with live run telemetry and direct tab jumps.',
    targetTab: 'flow',
    targetTabLabel: 'Open Flow Chart',
    steps: [
      'Toggle between Process Flow (PDF Ingestion -> Extraction & Guard -> CAD & CAM -> Export) and Code Architecture (App -> Client Engines -> Express/Gemini -> Views).',
      'Click any node on the SVG flow diagram to inspect its inputs, outputs, and engineering notes in the side inspector.',
    ],
    tips: [
      'Use the Flow Chart whenever onboarding new engineers to explain how SolidWorks PDF streams map to CAM toolpaths.',
    ],
    keywords: ['flow', 'chart', 'diagram', 'architecture', 'pipeline'],
  },
  {
    id: 'shortcuts-troubleshooting',
    number: '09',
    title: 'Controls, Shortcuts & Troubleshooting',
    summary:
      'Quick reference for mouse navigation in CAD viewports and solutions for common PDF extraction edge cases.',
    steps: [
      'Zoom & Pan: Scroll mouse wheel over any CAD Plotter canvas to zoom toward cursor; click and drag to pan; click Fit to reset framing.',
      'Scanned PDFs (0 vectors): Vector Plotting is automatically disabled when a PDF contains only scanned pixels—run AI Analysis instead.',
      'Wrong Part Dimensions in 1:1 Real Mode: If a PDF title block states SCALE 1:20 but was printed fit-to-page, DraftPlan CAD calibrates against explicit numeric callouts automatically. You can also set a manual 1:X ratio in Upload Drawing overrides or toggle to Paper mm.',
      'Border or Title Block Lines Appearing in Plot: Use Manual View Definition in Upload Drawing (or Adjust View Boxes in CAD Plotter) to draw tight boxes strictly around the part views.',
    ],
    tips: [
      'Transient network resets during AI Blueprint Analysis automatically retry with a slim page-image payload and fall back gracefully to local PDF vectors if available.',
    ],
    table: {
      headers: ['Action / Symptom', 'Resolution / Control'],
      rows: [
        { col1: 'Zoom CAD canvas', col2: 'Mouse wheel or + / - toolbar buttons' },
        { col1: 'Pan CAD canvas', col2: 'Click & drag inside any CAD viewport' },
        { col1: 'Draw custom view box', col2: 'Upload Drawing -> Define Manually -> Click & drag on sheet' },
        { col1: 'Vector button disabled', col2: 'PDF is a raster scan (0 vectors); use AI Analysis' },
      ],
    },
    keywords: ['shortcut', 'mouse', 'wheel', 'pan', 'zoom', 'troubleshoot', 'error', 'raster', 'border', 'faq'],
  },
];

export const UserManualPanel: React.FC<UserManualPanelProps> = ({ onNavigateTab }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeChapterId, setActiveChapterId] = useState<string>(MANUAL_CHAPTERS[0].id);

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredChapters = useMemo(() => {
    if (!normalizedQuery) return MANUAL_CHAPTERS;
    return MANUAL_CHAPTERS.filter((ch) => {
      const haystack = [
        ch.number,
        ch.title,
        ch.summary,
        ...ch.steps,
        ...ch.tips,
        ...ch.keywords,
        ...(ch.table?.rows.flatMap((r) => [r.col1, r.col2, r.col3 || '']) || []),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery]);

  const activeChapter =
    filteredChapters.find((c) => c.id === activeChapterId) || filteredChapters[0] || null;

  return (
    <div className="flex flex-col gap-3 min-h-[560px]">
      {/* Manual Header & Search Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <BookOpen className="w-4 h-4 text-cyan-600 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              DraftPlan CAD User Manual
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Complete operator guide for drawing ingestion, multi-view CAD plotting, CAM routing, and exports.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search manual (e.g. manual views, 1:20, DXF)..."
              className="w-full pl-8 pr-7 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                title="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
            {filteredChapters.length} / {MANUAL_CHAPTERS.length} chapters
          </span>
        </div>
      </div>

      {/* 2-Column Chapter Index + Manual Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1 min-h-0">
        {/* Left Chapter Index */}
        <nav className="lg:col-span-4 xl:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 flex flex-col gap-1 self-start">
          <div className="px-2 py-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            Chapters
          </div>
          {filteredChapters.length === 0 ? (
            <div className="px-2 py-4 text-xs text-slate-500 dark:text-slate-400">
              No chapters match &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            filteredChapters.map((ch) => {
              const isActive = activeChapter?.id === ch.id;
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => setActiveChapterId(ch.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-md border transition-colors flex items-baseline gap-2 ${
                    isActive
                      ? 'border-cyan-600 bg-cyan-50/70 dark:bg-cyan-950/30 text-slate-900 dark:text-white'
                      : 'border-transparent text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <span className="font-mono tabular-nums text-[11px] text-cyan-700 dark:text-cyan-400 shrink-0">
                    {ch.number}.
                  </span>
                  <span className="text-xs font-medium leading-snug">{ch.title}</span>
                </button>
              );
            })
          )}
        </nav>

        {/* Right Chapter Detail & Deep Links */}
        <div className="lg:col-span-8 xl:col-span-9 flex flex-col gap-3">
          {!activeChapter ? (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center">
              <div className="text-sm font-medium text-slate-800 dark:text-slate-200">
                No matching manual sections found
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Clear the search filter to browse all nine chapters.
              </p>
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-3 px-3 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Reset Search
              </button>
            </div>
          ) : (
            (normalizedQuery ? filteredChapters : [activeChapter]).map((chapter) => (
              <article
                key={chapter.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <div className="text-xs font-mono tabular-nums text-cyan-700 dark:text-cyan-400">
                      Chapter {chapter.number}
                    </div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white mt-0.5">
                      {chapter.title}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 max-w-3xl leading-relaxed">
                      {chapter.summary}
                    </p>
                  </div>

                  {chapter.targetTab && chapter.targetTabLabel && (
                    <button
                      type="button"
                      onClick={() => onNavigateTab(chapter.targetTab!)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                    >
                      <span>{chapter.targetTabLabel}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-cyan-600" />
                    </button>
                  )}
                </div>

                {/* Step-by-Step Workflow */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-100 mb-2">
                    Step-by-Step Procedure
                  </h4>
                  <ol className="space-y-2">
                    {chapter.steps.map((step, sIdx) => (
                      <li
                        key={sIdx}
                        className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed"
                      >
                        <span className="font-mono tabular-nums text-[11px] font-semibold text-cyan-700 dark:text-cyan-400 mt-0.5 shrink-0">
                          {String(sIdx + 1).padStart(2, '0')}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                {/* Optional Reference Table */}
                {chapter.table && (
                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-md">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                          {chapter.table.headers.map((h) => (
                            <th key={h} className="px-3 py-2 font-semibold">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {chapter.table.rows.map((row, rIdx) => (
                          <tr key={rIdx} className="text-slate-700 dark:text-slate-300">
                            <td className="px-3 py-2 font-medium text-slate-900 dark:text-white whitespace-nowrap">
                              {row.col1}
                            </td>
                            <td className="px-3 py-2">{row.col2}</td>
                            {row.col3 !== undefined && (
                              <td className="px-3 py-2 font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-400">
                                {row.col3}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Engineering Tips */}
                {chapter.tips.length > 0 && (
                  <div className="p-3 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 space-y-1.5">
                    <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                      Operator Notes
                    </div>
                    {chapter.tips.map((tip, tIdx) => (
                      <p key={tIdx} className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {tip}
                      </p>
                    ))}
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
