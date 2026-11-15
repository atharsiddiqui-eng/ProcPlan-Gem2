import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  GitBranch,
  Layers,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react';
import type { DrawingAnalysisResult, PdfExtractionPayload } from '../types/cad';
import {
  FLOW_DIAGRAMS,
  type FlowDiagramMode,
  type FlowEdge,
  type FlowNode,
  type WorkspaceTabTarget,
} from '../utils/flowDiagrams';

interface FlowChartPanelProps {
  analysis: DrawingAnalysisResult;
  pdfPayload: PdfExtractionPayload | null;
  batchSize: number;
  onNavigateTab: (tab: WorkspaceTabTarget) => void;
}

function getAnchorPoint(
  node: FlowNode,
  side: 'left' | 'right' | 'top' | 'bottom'
): { x: number; y: number } {
  if (side === 'left') return { x: node.x, y: node.y + node.height / 2 };
  if (side === 'right') return { x: node.x + node.width, y: node.y + node.height / 2 };
  if (side === 'top') return { x: node.x + node.width / 2, y: node.y };
  return { x: node.x + node.width / 2, y: node.y + node.height };
}

function buildConnectorPath(
  fromNode: FlowNode,
  toNode: FlowNode,
  edge: FlowEdge
): { d: string; labelX: number; labelY: number } {
  const fromSide = edge.fromSide || 'right';
  const toSide = edge.toSide || 'left';
  const p1 = getAnchorPoint(fromNode, fromSide);
  const p2 = getAnchorPoint(toNode, toSide);

  if (fromSide === 'right' && toSide === 'right') {
    const loopX = Math.max(p1.x, p2.x) + 22;
    const d = `M ${p1.x} ${p1.y} L ${loopX} ${p1.y} L ${loopX} ${p2.y} L ${p2.x} ${p2.y}`;
    return { d, labelX: loopX - 4, labelY: (p1.y + p2.y) / 2 };
  }

  if (fromSide === 'right' && toSide === 'left') {
    const midX = (p1.x + p2.x) / 2;
    const d = `M ${p1.x} ${p1.y} C ${midX} ${p1.y}, ${midX} ${p2.y}, ${p2.x} ${p2.y}`;
    return { d, labelX: midX, labelY: (p1.y + p2.y) / 2 - 6 };
  }

  if (fromSide === 'left' && toSide === 'right') {
    const midX = (p1.x + p2.x) / 2;
    const d = `M ${p1.x} ${p1.y} C ${midX} ${p1.y}, ${midX} ${p2.y}, ${p2.x} ${p2.y}`;
    return { d, labelX: midX, labelY: (p1.y + p2.y) / 2 - 6 };
  }

  const midY = (p1.y + p2.y) / 2;
  const d = `M ${p1.x} ${p1.y} C ${p1.x} ${midY}, ${p2.x} ${midY}, ${p2.x} ${p2.y}`;
  return { d, labelX: (p1.x + p2.x) / 2 + 6, labelY: midY - 4 };
}

export const FlowChartPanel: React.FC<FlowChartPanelProps> = ({
  analysis,
  pdfPayload,
  batchSize,
  onNavigateTab,
}) => {
  const [mode, setMode] = useState<FlowDiagramMode>('process');
  const [laneFilter, setLaneFilter] = useState<string>('all');
  const [zoom, setZoom] = useState<number>(1);
  const [selectedNodeId, setSelectedNodeId] = useState<string>(
    FLOW_DIAGRAMS.process.nodes[0].id
  );

  const diagram = FLOW_DIAGRAMS[mode];

  const handleModeSwitch = (nextMode: FlowDiagramMode) => {
    setMode(nextMode);
    setLaneFilter('all');
    setSelectedNodeId(FLOW_DIAGRAMS[nextMode].nodes[0].id);
  };

  const nodeMap = useMemo(() => {
    const map = new Map<string, FlowNode>();
    for (const n of diagram.nodes) map.set(n.id, n);
    return map;
  }, [diagram.nodes]);

  const selectedNode = nodeMap.get(selectedNodeId) || diagram.nodes[0];

  const connectedSets = useMemo(() => {
    const incoming: FlowNode[] = [];
    const outgoing: FlowNode[] = [];
    const connectedEdgeIds = new Set<string>();
    const connectedNodeIds = new Set<string>([selectedNode.id]);

    for (const edge of diagram.edges) {
      if (edge.to === selectedNode.id) {
        connectedEdgeIds.add(edge.id);
        connectedNodeIds.add(edge.from);
        const src = nodeMap.get(edge.from);
        if (src) incoming.push(src);
      }
      if (edge.from === selectedNode.id) {
        connectedEdgeIds.add(edge.id);
        connectedNodeIds.add(edge.to);
        const dst = nodeMap.get(edge.to);
        if (dst) outgoing.push(dst);
      }
    }

    return { incoming, outgoing, connectedEdgeIds, connectedNodeIds };
  }, [diagram.edges, nodeMap, selectedNode.id]);

  const getLiveMetricForNode = (nodeId: string): string | null => {
    const viewCount =
      analysis.viewChunks?.length || pdfPayload?.viewChunks?.length || 1;
    const machineCount = new Set(analysis.processPlan.map((op) => op.machineType)).size;

    switch (nodeId) {
      case 'proc-upload':
      case 'code-samples':
        return `Active Sheet: ${pdfPayload?.fileName || analysis.partNumber}`;
      case 'proc-pdfjs':
      case 'code-pdfengine':
        return pdfPayload
          ? `${viewCount} view chunk(s) · ${pdfPayload.vectorEntityCount} vectors`
          : `${viewCount} view chunk(s) ready`;
      case 'proc-sanitize':
      case 'code-sanitizer':
        return `${analysis.entities.length} verified entities · ${analysis.dimensions.length} dims`;
      case 'proc-cad':
      case 'code-cadview':
        return `${viewCount} view(s) · ${analysis.stockEnvelope.length}×${analysis.stockEnvelope.width} mm`;
      case 'proc-cam':
      case 'code-camengine':
      case 'code-planning-views':
        return `${analysis.processPlan.length} ops · ${machineCount} machines · ${batchSize} pcs`;
      case 'proc-export':
      case 'code-export-view':
        return `Ready: ${analysis.partNumber}.{dxf,svg,nc,csv}`;
      case 'code-app':
        return `${analysis.features.length} features · ${analysis.material}`;
      default:
        return null;
    }
  };

  const kindAccent = (kind: FlowNode['kind']) => {
    switch (kind) {
      case 'input':
        return { bar: '#0284C7', tag: 'Input' };
      case 'decision':
        return { bar: '#D97706', tag: 'Decision' };
      case 'server':
        return { bar: '#7C3AED', tag: 'Server / AI' };
      case 'output':
        return { bar: '#059669', tag: 'Output' };
      default:
        return { bar: '#0891B2', tag: 'Engine' };
    }
  };

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Flow Chart Header & Mode Controls */}
      <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-md">
            <button
              type="button"
              onClick={() => handleModeSwitch('process')}
              className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap shrink-0 ${
                mode === 'process'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              PDF-to-CNC Process Flow
            </button>
            <button
              type="button"
              onClick={() => handleModeSwitch('code')}
              className={`px-3 py-1.5 text-xs font-semibold rounded transition-colors whitespace-nowrap shrink-0 ${
                mode === 'code'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              App Code Architecture
            </button>
          </div>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />

          {/* Swimlane Filter Controls */}
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setLaneFilter('all')}
              className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                laneFilter === 'all'
                  ? 'border-cyan-600 bg-cyan-50/70 dark:bg-cyan-950/30 text-cyan-900 dark:text-cyan-200'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              All Stages
            </button>
            {diagram.lanes.map((lane) => (
              <button
                key={lane.id}
                type="button"
                onClick={() => setLaneFilter(lane.id === laneFilter ? 'all' : lane.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
                  laneFilter === lane.id
                    ? 'border-cyan-600 bg-cyan-50/70 dark:bg-cyan-950/30 text-cyan-900 dark:text-cyan-200'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {lane.title}
              </button>
            ))}
          </div>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.1).toFixed(2))))}
            title="Zoom out diagram"
            className="p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 w-11 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(1.4, Number((z + 0.1).toFixed(2))))}
            title="Zoom in diagram"
            className="p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(1);
              setLaneFilter('all');
            }}
            title="Reset view"
            className="p-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Interactive SVG Canvas + Right Node Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1 min-h-0">
        {/* SVG Flow Diagram Stage */}
        <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                {diagram.title}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {diagram.description}
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-400 shrink-0">
              {diagram.nodes.length} nodes · {diagram.edges.length} links
            </span>
          </div>

          <div className="flex-1 overflow-auto bg-slate-50/70 dark:bg-slate-950 p-3">
            <div
              style={{
                width: `${zoom * 100}%`,
                minWidth: '820px',
              }}
              className="mx-auto transition-[width] duration-150"
            >
              <svg
                viewBox={`0 0 ${diagram.viewBoxWidth} ${diagram.viewBoxHeight}`}
                className="w-full h-auto select-none"
              >
                <defs>
                  <marker
                    id="arrow-primary"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#0891B2" />
                  </marker>
                  <marker
                    id="arrow-fallback"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#D97706" />
                  </marker>
                  <marker
                    id="arrow-feedback"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 1.5 L 8.5 5 L 0 8.5 z" fill="#059669" />
                  </marker>
                </defs>

                {/* Swimlane Columns */}
                {diagram.lanes.map((lane) => {
                  const laneMuted = laneFilter !== 'all' && laneFilter !== lane.id;
                  return (
                    <g key={lane.id} opacity={laneMuted ? 0.35 : 1}>
                      <rect
                        x={lane.x}
                        y={14}
                        width={lane.width}
                        height={diagram.viewBoxHeight - 28}
                        rx={8}
                        className="fill-white/80 dark:fill-slate-900/70 stroke-slate-200 dark:stroke-slate-800"
                        strokeWidth={1}
                      />
                      <text
                        x={lane.x + 14}
                        y={38}
                        className="fill-slate-700 dark:fill-slate-300"
                        fontSize={12}
                        fontWeight={600}
                        fontFamily="Plus Jakarta Sans, sans-serif"
                      >
                        {lane.title}
                      </text>
                      <line
                        x1={lane.x + 12}
                        y1={48}
                        x2={lane.x + lane.width - 12}
                        y2={48}
                        className="stroke-slate-200 dark:stroke-slate-800"
                        strokeWidth={1}
                      />
                    </g>
                  );
                })}

                {/* Edges */}
                {diagram.edges.map((edge) => {
                  const fromNode = nodeMap.get(edge.from);
                  const toNode = nodeMap.get(edge.to);
                  if (!fromNode || !toNode) return null;

                  const { d, labelX, labelY } = buildConnectorPath(fromNode, toNode, edge);
                  const isConnected = connectedSets.connectedEdgeIds.has(edge.id);
                  const laneActive =
                    laneFilter === 'all' ||
                    fromNode.lane === laneFilter ||
                    toNode.lane === laneFilter;

                  const stroke =
                    edge.style === 'fallback'
                      ? '#D97706'
                      : edge.style === 'feedback'
                        ? '#059669'
                        : '#0891B2';

                  const markerId =
                    edge.style === 'fallback'
                      ? 'url(#arrow-fallback)'
                      : edge.style === 'feedback'
                        ? 'url(#arrow-feedback)'
                        : 'url(#arrow-primary)';

                  return (
                    <g
                      key={edge.id}
                      opacity={!laneActive ? 0.15 : isConnected ? 1 : 0.32}
                    >
                      <path
                        d={d}
                        fill="none"
                        stroke={stroke}
                        strokeWidth={isConnected ? 2.2 : 1.5}
                        strokeDasharray={edge.style === 'fallback' ? '5 4' : undefined}
                        markerEnd={markerId}
                      />
                      {edge.label && (
                        <text
                          x={labelX}
                          y={labelY}
                          textAnchor="middle"
                          fontSize={10}
                          fontFamily="IBM Plex Mono, monospace"
                          className="fill-slate-600 dark:fill-slate-300"
                        >
                          {edge.label}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Clickable Nodes */}
                {diagram.nodes.map((node) => {
                  const isSelected = node.id === selectedNode.id;
                  const isNeighbor = connectedSets.connectedNodeIds.has(node.id);
                  const laneActive = laneFilter === 'all' || node.lane === laneFilter;
                  const accent = kindAccent(node.kind);
                  const liveText = getLiveMetricForNode(node.id);

                  return (
                    <g
                      key={node.id}
                      onClick={() => setSelectedNodeId(node.id)}
                      className="cursor-pointer"
                      opacity={!laneActive ? 0.25 : isNeighbor ? 1 : 0.72}
                    >
                      <rect
                        x={node.x}
                        y={node.y}
                        width={node.width}
                        height={node.height}
                        rx={7}
                        className={
                          isSelected
                            ? 'fill-cyan-50 dark:fill-slate-800 stroke-cyan-600 dark:stroke-cyan-400'
                            : 'fill-white dark:fill-slate-900 stroke-slate-300 dark:stroke-slate-700 hover:stroke-slate-400'
                        }
                        strokeWidth={isSelected ? 2 : 1}
                      />
                      {/* Top subtle indicator rule matching node kind */}
                      <rect
                        x={node.x + 1}
                        y={node.y + 1}
                        width={node.width - 2}
                        height={3}
                        rx={2}
                        fill={accent.bar}
                      />
                      <text
                        x={node.x + 12}
                        y={node.y + 21}
                        fontSize={10}
                        fontFamily="IBM Plex Mono, monospace"
                        fontWeight={600}
                        fill={accent.bar}
                      >
                        {node.stepCode} · {accent.tag}
                      </text>
                      <text
                        x={node.x + 12}
                        y={node.y + 40}
                        fontSize={12.5}
                        fontWeight={600}
                        fontFamily="Plus Jakarta Sans, sans-serif"
                        className="fill-slate-900 dark:fill-white"
                      >
                        {node.title}
                      </text>
                      <text
                        x={node.x + 12}
                        y={node.y + 57}
                        fontSize={10.5}
                        fontFamily="Plus Jakarta Sans, sans-serif"
                        className="fill-slate-500 dark:fill-slate-400"
                      >
                        {node.subtitle}
                      </text>
                      {liveText && (
                        <text
                          x={node.x + 12}
                          y={node.y + node.height - 10}
                          fontSize={9.5}
                          fontFamily="IBM Plex Mono, monospace"
                          className="fill-cyan-700 dark:fill-cyan-400"
                        >
                          {liveText.length > 32 ? `${liveText.slice(0, 31)}…` : liveText}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Diagram Legend Footer */}
          <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-cyan-600 inline-block" />
              Primary Data Flow
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 border-t-2 border-dashed border-amber-600 inline-block" />
              Fallback / Replan Path
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-4 h-0.5 bg-emerald-600 inline-block" />
              Live Feedback / Overlay
            </span>
          </div>
        </div>

        {/* Right Column: Clickable Node Inspector */}
        <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col gap-4 overflow-y-auto">
          <div>
            <div className="flex items-center justify-between gap-2 text-xs font-mono text-cyan-700 dark:text-cyan-400">
              <span>{selectedNode.stepCode}</span>
              <span className="text-slate-400">{kindAccent(selectedNode.kind).tag}</span>
            </div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white mt-1">
              {selectedNode.title}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1.5 leading-relaxed">
              {selectedNode.summary}
            </p>
          </div>

          {getLiveMetricForNode(selectedNode.id) && (
            <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Active Session State
              </div>
              <div className="text-xs font-mono tabular-nums font-medium text-slate-900 dark:text-white mt-0.5">
                {getLiveMetricForNode(selectedNode.id)}
              </div>
            </div>
          )}

          {/* Inputs & Outputs */}
          <div className="grid grid-cols-1 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div>
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Inputs
              </div>
              <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                {selectedNode.inputs.map((inp, idx) => (
                  <li key={idx} className="font-mono text-[11px]">
                    · {inp}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1">
                Outputs
              </div>
              <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                {selectedNode.outputs.map((out, idx) => (
                  <li key={idx} className="font-mono text-[11px]">
                    · {out}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Implementation & Process Logic Details */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
              <Layers className="w-3.5 h-3.5" />
              <span>Process &amp; Code Details</span>
            </div>
            <ul className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
              {selectedNode.details.map((detail, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="font-mono text-slate-400 tabular-nums">
                    {String(idx + 1).padStart(2, '0')}.
                  </span>
                  <span>{detail}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Upstream / Downstream Graph Navigation */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-2">
              <GitBranch className="w-3.5 h-3.5" />
              <span>Connected Nodes</span>
            </div>

            <div className="flex flex-col gap-2 text-xs">
              {connectedSets.incoming.length > 0 && (
                <div>
                  <div className="text-[11px] text-slate-400 mb-1">Upstream</div>
                  <div className="flex flex-wrap gap-1.5">
                    {connectedSets.incoming.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => setSelectedNodeId(n.id)}
                        className="px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-cyan-500"
                      >
                        ← {n.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {connectedSets.outgoing.length > 0 && (
                <div>
                  <div className="text-[11px] text-slate-400 mb-1">Downstream</div>
                  <div className="flex flex-wrap gap-1.5">
                    {connectedSets.outgoing.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => setSelectedNodeId(n.id)}
                        className="px-2 py-1 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-cyan-500"
                      >
                        {n.title} →
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Quick Jump to Workspace View */}
          {selectedNode.targetTab && (
            <div className="mt-auto pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => onNavigateTab(selectedNode.targetTab!)}
                className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-md bg-slate-900 dark:bg-cyan-600 text-white hover:bg-slate-800 dark:hover:bg-cyan-500 transition-colors"
              >
                <span>{selectedNode.targetTabLabel || 'Open in Workspace'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
