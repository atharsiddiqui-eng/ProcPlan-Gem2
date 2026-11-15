import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Maximize2, RotateCcw, ScanSearch } from 'lucide-react';
import type {
  CadDimension,
  CadEntity,
  CadLayer,
  DrawingAnalysisResult,
  ViewChunkKind,
} from '../types/cad';
import { generateToolpathOverlay } from '../utils/camEngine';

export interface Point2D {
  x: number;
  y: number;
}

export interface ViewFrameBox {
  id: string;
  label: string;
  viewKind: ViewChunkKind;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CadPlotCanvasProps {
  analysis: DrawingAnalysisResult;
  entities: CadEntity[];
  dimensions: CadDimension[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  visibleLayers: Record<CadLayer, boolean>;
  selectedFeatureId: string | null;
  selectedOpId: string | null;
  onSelectFeature: (featureId: string | null) => void;
  showStockEnvelope: boolean;
  darkCanvas: boolean;
  unitDisplay: 'mm' | 'in';
  measureMode: boolean;
  simPlaying: boolean;
  activeViewId?: string | null;
  viewFrameBoxes?: ViewFrameBox[];
  onSelectViewFrame?: (viewId: string) => void;
  fitSignal?: number;
  zoomAction?: { seq: number; factor: number };
  statusLabel?: string;
  compactHud?: boolean;
  plotHeader?: {
    title: string;
    subtitle: string;
    isHighlighted?: boolean;
    onFocusView?: () => void;
  };
}

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const safeNum = (v: unknown, fallback = 0): number => (isNum(v) ? v : fallback);

function describeArcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number
): string {
  const rad0 = (startDeg * Math.PI) / 180;
  const rad1 = (endDeg * Math.PI) / 180;
  const x0 = cx + r * Math.cos(rad0);
  const y0 = -(cy + r * Math.sin(rad0));
  const x1 = cx + r * Math.cos(rad1);
  const y1 = -(cy + r * Math.sin(rad1));
  let sweep = endDeg - startDeg;
  while (sweep < 0) sweep += 360;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 0 ${x1} ${y1}`;
}

export function computeEntitiesBounds(
  entities: CadEntity[],
  fallback: { minX: number; minY: number; maxX: number; maxY: number }
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const ent of entities) {
    if (ent.type === 'line') {
      if (isNum(ent.x1) && isNum(ent.y1) && isNum(ent.x2) && isNum(ent.y2)) {
        minX = Math.min(minX, ent.x1, ent.x2);
        minY = Math.min(minY, ent.y1, ent.y2);
        maxX = Math.max(maxX, ent.x1, ent.x2);
        maxY = Math.max(maxY, ent.y1, ent.y2);
      }
    } else if (ent.type === 'circle' || ent.type === 'arc') {
      if (isNum(ent.cx) && isNum(ent.cy) && isNum(ent.r) && ent.r > 0) {
        minX = Math.min(minX, ent.cx - ent.r);
        minY = Math.min(minY, ent.cy - ent.r);
        maxX = Math.max(maxX, ent.cx + ent.r);
        maxY = Math.max(maxY, ent.cy + ent.r);
      }
    } else if (ent.type === 'rect') {
      if (isNum(ent.x) && isNum(ent.y) && isNum(ent.width) && isNum(ent.height)) {
        minX = Math.min(minX, ent.x);
        minY = Math.min(minY, ent.y);
        maxX = Math.max(maxX, ent.x + ent.width);
        maxY = Math.max(maxY, ent.y + ent.height);
      }
    } else if (ent.type === 'polyline' && Array.isArray(ent.points)) {
      for (const p of ent.points) {
        if (isNum(p?.x) && isNum(p?.y)) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
      }
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return fallback;
  }
  return {
    minX,
    minY,
    maxX: maxX > minX ? maxX : minX + 40,
    maxY: maxY > minY ? maxY : minY + 40,
  };
}

export const CadPlotCanvas: React.FC<CadPlotCanvasProps> = ({
  analysis,
  entities,
  dimensions,
  bounds,
  visibleLayers,
  selectedFeatureId,
  selectedOpId,
  onSelectFeature,
  showStockEnvelope,
  darkCanvas,
  unitDisplay,
  measureMode,
  simPlaying,
  activeViewId = null,
  viewFrameBoxes = [],
  onSelectViewFrame,
  fitSignal = 0,
  zoomAction,
  statusLabel,
  compactHud = false,
  plotHeader,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasFittedRealSizeRef = useRef<boolean>(false);

  const [pan, setPan] = useState<Point2D>(() => ({
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  }));
  const [pxPerMm, setPxPerMm] = useState<number>(3.4);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>(
    compactHud ? { w: 460, h: 280 } : { w: 800, h: 560 }
  );

  const [measurePoints, setMeasurePoints] = useState<Point2D[]>([]);
  const [cursorWorld, setCursorWorld] = useState<Point2D>({ x: 0, y: 0 });
  const [snapPoint, setSnapPoint] = useState<Point2D | null>(null);
  const [simProgress, setSimProgress] = useState<number>(0);

  const dragRef = useRef<{ active: boolean; startX: number; startY: number; origPan: Point2D }>({
    active: false,
    startX: 0,
    startY: 0,
    origPan: { x: 0, y: 0 },
  });

  const fitToBounds = (
    bb: { minX: number; minY: number; maxX: number; maxY: number },
    sizeOverride?: { w: number; h: number }
  ) => {
    const partW = Math.max(20, bb.maxX - bb.minX);
    const partH = Math.max(20, bb.maxY - bb.minY);
    const w = sizeOverride?.w ?? viewportSize.w;
    const h = sizeOverride?.h ?? viewportSize.h;
    const pad = compactHud ? 68 : 110;
    const availW = Math.max(140, safeNum(w, 460) - pad);
    const availH = Math.max(120, safeNum(h, 280) - pad);
    const scale = Math.min(availW / partW, availH / partH, 12);
    setPxPerMm(Math.max(0.4, safeNum(scale, 3.4)));
    setPan({
      x: (bb.minX + bb.maxX) / 2,
      y: (bb.minY + bb.maxY) / 2,
    });
  };

  useEffect(() => {
    fitToBounds(bounds);
    setMeasurePoints([]);
    setSimProgress(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, analysis]);

  useEffect(() => {
    if (fitSignal > 0) {
      fitToBounds(bounds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);

  useEffect(() => {
    if (zoomAction && zoomAction.seq > 0) {
      setPxPerMm((s) => Math.min(30, Math.max(0.25, s * zoomAction.factor)));
    }
  }, [zoomAction]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 50 && height > 50) {
          setViewportSize({ w: width, h: height });
          if (!hasFittedRealSizeRef.current) {
            hasFittedRealSizeRef.current = true;
            fitToBounds(bounds, { w: width, h: height });
          }
        }
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snapTargets = useMemo<Point2D[]>(() => {
    const pts: Point2D[] = [{ x: 0, y: 0 }];
    for (const ent of entities) {
      if (ent.type === 'line') {
        if (isNum(ent.x1) && isNum(ent.y1)) pts.push({ x: ent.x1, y: ent.y1 });
        if (isNum(ent.x2) && isNum(ent.y2)) pts.push({ x: ent.x2, y: ent.y2 });
      } else if (ent.type === 'circle' || ent.type === 'arc') {
        if (isNum(ent.cx) && isNum(ent.cy)) pts.push({ x: ent.cx, y: ent.cy });
      } else if (ent.type === 'rect') {
        if (isNum(ent.x) && isNum(ent.y) && isNum(ent.width) && isNum(ent.height)) {
          pts.push(
            { x: ent.x, y: ent.y },
            { x: ent.x + ent.width, y: ent.y },
            { x: ent.x + ent.width, y: ent.y + ent.height },
            { x: ent.x, y: ent.y + ent.height }
          );
        }
      } else if (ent.type === 'polyline' && Array.isArray(ent.points)) {
        for (const p of ent.points) {
          if (isNum(p?.x) && isNum(p?.y)) pts.push(p);
        }
      }
    }
    return pts;
  }, [entities]);

  const toolpathSegments = useMemo(
    () => generateToolpathOverlay(analysis, selectedOpId, activeViewId),
    [analysis, selectedOpId, activeViewId]
  );

  const flatCutPoints = useMemo(() => {
    const pts: Point2D[] = [];
    for (const seg of toolpathSegments) {
      if (seg.kind === 'cut') {
        for (const p of seg.points) pts.push(p);
      }
    }
    return pts;
  }, [toolpathSegments]);

  useEffect(() => {
    if (!simPlaying || flatCutPoints.length === 0) return;
    const timer = window.setInterval(() => {
      setSimProgress((prev) => {
        if (prev >= flatCutPoints.length - 1) return 0;
        return prev + 1;
      });
    }, 90);
    return () => window.clearInterval(timer);
  }, [simPlaying, flatCutPoints.length]);

  const safeScale = Math.max(0.25, safeNum(pxPerMm, 3.4));
  const safePanX = safeNum(pan.x, 0);
  const safePanY = safeNum(pan.y, 0);
  const halfW = Math.max(10, safeNum(viewportSize.w, 800) / (2 * safeScale));
  const halfH = Math.max(10, safeNum(viewportSize.h, 560) / (2 * safeScale));
  const vbMinX = safePanX - halfW;
  const vbMinY = -(safePanY + halfH);
  const vbW = halfW * 2;
  const vbH = halfH * 2;

  const screenToWorld = (clientX: number, clientY: number): Point2D => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const wx = safePanX + (sx - rect.width / 2) / safeScale;
    const wy = safePanY - (sy - rect.height / 2) / safeScale;
    return {
      x: isNum(wx) ? wx : 0,
      y: isNum(wy) ? wy : 0,
    };
  };

  const findNearestSnap = (world: Point2D): Point2D | null => {
    const thresholdMm = 9 / safeScale;
    let best: Point2D | null = null;
    let bestDist = thresholdMm;
    for (const pt of snapTargets) {
      const d = Math.hypot(pt.x - world.x, pt.y - world.y);
      if (d < bestDist) {
        bestDist = d;
        best = pt;
      }
    }
    return best;
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (dragRef.current.active) {
      const dx = (e.clientX - dragRef.current.startX) / safeScale;
      const dy = (e.clientY - dragRef.current.startY) / safeScale;
      setPan({
        x: dragRef.current.origPan.x - dx,
        y: dragRef.current.origPan.y + dy,
      });
      return;
    }
    const w = screenToWorld(e.clientX, e.clientY);
    const snapped = findNearestSnap(w);
    setSnapPoint(snapped);
    setCursorWorld(snapped || w);
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (measureMode && e.button === 0) {
      const w = screenToWorld(e.clientX, e.clientY);
      const pt = findNearestSnap(w) || w;
      setMeasurePoints((prev) => (prev.length >= 2 ? [pt] : [...prev, pt]));
      return;
    }
    if (e.button === 0 || e.button === 1) {
      dragRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        origPan: pan,
      };
    }
  };

  const handleMouseUp = () => {
    dragRef.current.active = false;
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.14 : 0.88;
    const nextScale = Math.min(30, Math.max(0.25, safeScale * factor));
    setPxPerMm(nextScale);
  };

  const rawStep = 45 / safeScale;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(0.1, rawStep))));
  const norm = rawStep / mag;
  const gridStep = norm < 1.5 ? mag : norm < 3.5 ? 2 * mag : norm < 7.5 ? 5 * mag : 10 * mag;

  const gridLinesX: number[] = [];
  const startGX = Math.floor(vbMinX / gridStep) * gridStep;
  for (let gx = startGX; gx <= vbMinX + vbW; gx += gridStep) {
    gridLinesX.push(Number(gx.toFixed(4)));
  }
  const gridLinesY: number[] = [];
  const worldMinY = safePanY - halfH;
  const worldMaxY = safePanY + halfH;
  const startGY = Math.floor(worldMinY / gridStep) * gridStep;
  for (let gy = startGY; gy <= worldMaxY; gy += gridStep) {
    gridLinesY.push(Number(gy.toFixed(4)));
  }

  const unitFactor = unitDisplay === 'in' ? 1 / 25.4 : 1;
  const fmtCoord = (valMm: number) =>
    (safeNum(valMm, 0) * unitFactor).toFixed(unitDisplay === 'in' ? 3 : 2);

  const strokeWidthBase = Math.max(0.35, 1.6 / safeScale);
  const thinStroke = Math.max(0.2, 0.9 / safeScale);
  const fontSizeWorld = Math.max(2.6, 11 / safeScale);

  const colors = darkCanvas
    ? {
        bg: '#0B101B',
        gridMinor: '#131C2E',
        gridMajor: '#1E2C45',
        axis: '#334155',
        outline: '#F1F5F9',
        hole: '#38BDF8',
        centerline: '#64748B',
        hidden: '#94A3B8',
        dimension: '#F59E0B',
        highlight: '#22D3EE',
        stock: '#475569',
        viewFrame: '#334155',
        viewLabel: '#94A3B8',
      }
    : {
        bg: '#FFFFFF',
        gridMinor: '#F1F5F9',
        gridMajor: '#E2E8F0',
        axis: '#CBD5E1',
        outline: '#0F172A',
        hole: '#0284C7',
        centerline: '#64748B',
        hidden: '#94A3B8',
        dimension: '#B45309',
        highlight: '#0891B2',
        stock: '#94A3B8',
        viewFrame: '#CBD5E1',
        viewLabel: '#64748B',
      };

  const renderEntity = (ent: CadEntity) => {
    if (!visibleLayers[ent.layer]) return null;
    const isSelected = Boolean(selectedFeatureId && ent.featureId === selectedFeatureId);

    const stroke = isSelected
      ? colors.highlight
      : ent.layer === 'hole'
        ? colors.hole
        : ent.layer === 'dimension'
          ? colors.dimension
          : ent.layer === 'centerline'
            ? colors.centerline
            : ent.layer === 'hidden'
              ? colors.hidden
              : colors.outline;

    const strokeWidth = isSelected
      ? strokeWidthBase * 1.9
      : ent.layer === 'centerline' || ent.layer === 'hidden' || ent.layer === 'dimension'
        ? thinStroke
        : strokeWidthBase;

    const dash =
      ent.layer === 'centerline'
        ? `${6 / safeScale} ${3 / safeScale} ${2 / safeScale} ${3 / safeScale}`
        : ent.layer === 'hidden'
          ? `${4 / safeScale} ${3 / safeScale}`
          : undefined;

    const handleClick = (e: React.MouseEvent) => {
      if (measureMode) return;
      e.stopPropagation();
      if (ent.featureId) {
        onSelectFeature(ent.featureId === selectedFeatureId ? null : ent.featureId);
      }
    };

    const commonProps = {
      stroke,
      strokeWidth,
      strokeDasharray: dash,
      fill: isSelected && ent.layer === 'hole' ? `${colors.highlight}22` : 'none',
      className: ent.featureId ? 'cursor-pointer transition-opacity' : undefined,
      onClick: handleClick,
    };

    if (ent.type === 'line') {
      if (!isNum(ent.x1) || !isNum(ent.y1) || !isNum(ent.x2) || !isNum(ent.y2)) return null;
      return <line key={ent.id} x1={ent.x1} y1={-ent.y1} x2={ent.x2} y2={-ent.y2} {...commonProps} />;
    }
    if (ent.type === 'circle') {
      if (!isNum(ent.cx) || !isNum(ent.cy) || !isNum(ent.r) || ent.r <= 0) return null;
      return <circle key={ent.id} cx={ent.cx} cy={-ent.cy} r={ent.r} {...commonProps} />;
    }
    if (ent.type === 'arc') {
      if (!isNum(ent.cx) || !isNum(ent.cy) || !isNum(ent.r) || ent.r <= 0) return null;
      return (
        <path
          key={ent.id}
          d={describeArcPath(
            ent.cx,
            ent.cy,
            ent.r,
            safeNum(ent.startAngle, 0),
            safeNum(ent.endAngle, 90)
          )}
          {...commonProps}
        />
      );
    }
    if (ent.type === 'rect') {
      if (
        !isNum(ent.x) ||
        !isNum(ent.y) ||
        !isNum(ent.width) ||
        !isNum(ent.height) ||
        ent.width <= 0 ||
        ent.height <= 0
      ) {
        return null;
      }
      return (
        <rect
          key={ent.id}
          x={ent.x}
          y={-(ent.y + ent.height)}
          width={ent.width}
          height={ent.height}
          rx={safeNum(ent.rx, 0)}
          {...commonProps}
        />
      );
    }
    if (ent.type === 'polyline' && Array.isArray(ent.points) && ent.points.length > 1) {
      const validPts = ent.points.filter((p) => isNum(p?.x) && isNum(p?.y));
      if (validPts.length < 2) return null;
      const pts = validPts.map((p) => `${p.x},${-p.y}`).join(' ');
      return ent.closed ? (
        <polygon key={ent.id} points={pts} {...commonProps} />
      ) : (
        <polyline key={ent.id} points={pts} {...commonProps} />
      );
    }
    return null;
  };

  const stockLen = Math.max(5, safeNum(analysis.stockEnvelope?.length, bounds.maxX - bounds.minX + 6));
  const stockWid = Math.max(5, safeNum(analysis.stockEnvelope?.width, bounds.maxY - bounds.minY + 6));
  const stockMinX = (bounds.minX + bounds.maxX) / 2 - stockLen / 2;
  const stockMaxY = (bounds.minY + bounds.maxY) / 2 + stockWid / 2;

  const rawCutter = flatCutPoints[simProgress];
  const activeCutterPt =
    rawCutter && isNum(rawCutter.x) && isNum(rawCutter.y) ? rawCutter : null;

  return (
    <div
      className={`flex flex-col w-full h-full overflow-hidden ${
        plotHeader
          ? `rounded-md border ${
              plotHeader.isHighlighted
                ? 'border-cyan-500 ring-1 ring-cyan-500/40'
                : 'border-slate-200 dark:border-slate-800'
            }`
          : ''
      }`}
    >
      {plotHeader && (
        <div className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
              {plotHeader.title}
            </div>
            <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 truncate">
              {plotHeader.subtitle}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => fitToBounds(bounds)}
              title="Fit this view plot"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50"
            >
              <Maximize2 className="w-3 h-3" />
              <span>Fit</span>
            </button>
            {plotHeader.onFocusView && (
              <button
                type="button"
                onClick={plotHeader.onFocusView}
                title="Expand to Single View"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-cyan-700 dark:text-cyan-400 hover:bg-slate-50"
              >
                <ScanSearch className="w-3 h-3" />
                <span>Focus</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 overflow-hidden select-none"
        style={{ backgroundColor: colors.bg }}
      >
        <svg
          className={`w-full h-full ${measureMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
          viewBox={`${vbMinX} ${vbMinY} ${vbW} ${vbH}`}
          preserveAspectRatio="xMidYMid meet"
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          onClick={() => {
            if (!measureMode) onSelectFeature(null);
          }}
        >
          {/* Calibrated Cartesian Grid */}
          <g>
            {gridLinesX.map((gx) => {
              const isAxis = Math.abs(gx) < 0.001;
              const isMajor = Math.abs(Math.round(gx / (gridStep * 5)) * (gridStep * 5) - gx) < 0.001;
              return (
                <line
                  key={`gx-${gx}`}
                  x1={gx}
                  y1={vbMinY}
                  x2={gx}
                  y2={vbMinY + vbH}
                  stroke={isAxis ? colors.axis : isMajor ? colors.gridMajor : colors.gridMinor}
                  strokeWidth={isAxis ? thinStroke * 1.4 : thinStroke * 0.7}
                />
              );
            })}
            {gridLinesY.map((gy) => {
              const isAxis = Math.abs(gy) < 0.001;
              const isMajor = Math.abs(Math.round(gy / (gridStep * 5)) * (gridStep * 5) - gy) < 0.001;
              return (
                <line
                  key={`gy-${gy}`}
                  x1={vbMinX}
                  y1={-gy}
                  x2={vbMinX + vbW}
                  y2={-gy}
                  stroke={isAxis ? colors.axis : isMajor ? colors.gridMajor : colors.gridMinor}
                  strokeWidth={isAxis ? thinStroke * 1.4 : thinStroke * 0.7}
                />
              );
            })}
          </g>

          {/* Linked View Chunk Region Frames in Combined Sheet Mode */}
          {viewFrameBoxes.length > 0 && (
            <g>
              {viewFrameBoxes.map((vf) => (
                <g
                  key={vf.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectViewFrame?.(vf.id);
                  }}
                  className="cursor-pointer"
                >
                  <rect
                    x={vf.minX}
                    y={-vf.maxY}
                    width={Math.max(10, vf.maxX - vf.minX)}
                    height={Math.max(10, vf.maxY - vf.minY)}
                    fill="none"
                    stroke={colors.viewFrame}
                    strokeWidth={thinStroke * 0.9}
                    strokeDasharray={`${5 / safeScale} ${4 / safeScale}`}
                  />
                  <text
                    x={vf.minX + 2 / safeScale}
                    y={-vf.maxY - 3 / safeScale}
                    fill={colors.viewLabel}
                    fontSize={fontSizeWorld * 0.85}
                    fontFamily="IBM Plex Mono, monospace"
                    fontWeight={600}
                  >
                    {vf.label.toUpperCase()}
                  </text>
                </g>
              ))}
            </g>
          )}

          {/* G54 Origin Datum Marker (0, 0) */}
          <g>
            <circle
              cx={0}
              cy={0}
              r={4.5 / safeScale}
              fill="none"
              stroke="#06B6D4"
              strokeWidth={thinStroke * 1.2}
            />
            <line
              x1={-8 / safeScale}
              y1={0}
              x2={8 / safeScale}
              y2={0}
              stroke="#06B6D4"
              strokeWidth={thinStroke * 1.2}
            />
            <line
              x1={0}
              y1={-8 / safeScale}
              x2={0}
              y2={8 / safeScale}
              stroke="#06B6D4"
              strokeWidth={thinStroke * 1.2}
            />
            <text
              x={6 / safeScale}
              y={-6 / safeScale}
              fill="#06B6D4"
              fontSize={fontSizeWorld * 0.85}
              fontFamily="IBM Plex Mono, monospace"
            >
              G54 (0,0)
            </text>
          </g>

          {/* Raw Stock Envelope */}
          {showStockEnvelope && isNum(stockMinX) && isNum(stockMaxY) && (
            <rect
              x={stockMinX}
              y={-stockMaxY}
              width={stockLen}
              height={stockWid}
              fill="none"
              stroke={colors.stock}
              strokeWidth={thinStroke}
              strokeDasharray={`${5 / safeScale} ${4 / safeScale}`}
            />
          )}

          {/* CAD Geometry Entities */}
          <g>{entities.map(renderEntity)}</g>

          {/* Dimension Callouts */}
          {visibleLayers.dimension && (
            <g>
              {dimensions.map((dim) => {
                if (!isNum(dim.x1) || !isNum(dim.y1)) return null;
                const x2 = isNum(dim.x2) ? dim.x2 : dim.x1 + 15;
                const y2 = isNum(dim.y2) ? dim.y2 : dim.y1 + 15;
                const isSelected = Boolean(selectedFeatureId && dim.featureId === selectedFeatureId);
                const dimColor = isSelected ? colors.highlight : colors.dimension;
                const off = safeNum(dim.offset, 0);
                const dx = x2 - dim.x1;
                const dy = y2 - dim.y1;
                const len = Math.hypot(dx, dy) || 1;
                const nx = (-dy / len) * off;
                const ny = (dx / len) * off;
                const p1x = dim.x1 + nx;
                const p1y = -(dim.y1 + ny);
                const p2x = x2 + nx;
                const p2y = -(y2 + ny);
                const midX = (p1x + p2x) / 2;
                const midY = (p1y + p2y) / 2;

                return (
                  <g key={dim.id} opacity={0.92}>
                    {dim.kind === 'linear' ? (
                      <>
                        <line
                          x1={dim.x1}
                          y1={-dim.y1}
                          x2={p1x}
                          y2={p1y}
                          stroke={dimColor}
                          strokeWidth={thinStroke * 0.8}
                          opacity={0.65}
                        />
                        <line
                          x1={x2}
                          y1={-y2}
                          x2={p2x}
                          y2={p2y}
                          stroke={dimColor}
                          strokeWidth={thinStroke * 0.8}
                          opacity={0.65}
                        />
                        <line
                          x1={p1x}
                          y1={p1y}
                          x2={p2x}
                          y2={p2y}
                          stroke={dimColor}
                          strokeWidth={thinStroke}
                        />
                        <circle cx={p1x} cy={p1y} r={2.2 / safeScale} fill={dimColor} />
                        <circle cx={p2x} cy={p2y} r={2.2 / safeScale} fill={dimColor} />
                      </>
                    ) : (
                      <>
                        <line
                          x1={dim.x1}
                          y1={-dim.y1}
                          x2={x2}
                          y2={-y2}
                          stroke={dimColor}
                          strokeWidth={thinStroke}
                        />
                        <circle cx={x2} cy={-y2} r={2 / safeScale} fill={dimColor} />
                      </>
                    )}
                    <text
                      x={dim.kind === 'linear' ? midX : x2 + 4 / safeScale}
                      y={dim.kind === 'linear' ? midY - 4 / safeScale : -y2 - 4 / safeScale}
                      textAnchor={dim.kind === 'linear' ? 'middle' : 'start'}
                      fill={dimColor}
                      fontSize={fontSizeWorld}
                      fontFamily="IBM Plex Mono, monospace"
                      fontWeight={500}
                    >
                      {dim.label}
                    </text>
                  </g>
                );
              })}
            </g>
          )}

          {/* CAM Toolpath Overlay */}
          {visibleLayers.toolpath && (
            <g>
              {toolpathSegments.map((seg, idx) => {
                const pts = seg.points.map((p) => `${p.x},${-p.y}`).join(' ');
                if (!pts) return null;
                return (
                  <polyline
                    key={`${seg.opId}-${idx}`}
                    points={pts}
                    fill="none"
                    stroke={seg.kind === 'rapid' ? '#F59E0B' : '#06B6D4'}
                    strokeWidth={seg.kind === 'rapid' ? thinStroke * 0.9 : strokeWidthBase * 1.1}
                    strokeDasharray={seg.kind === 'rapid' ? `${4 / safeScale} ${3 / safeScale}` : undefined}
                    opacity={seg.kind === 'rapid' ? 0.65 : 0.9}
                  />
                );
              })}
              {activeCutterPt && (
                <g>
                  <circle
                    cx={activeCutterPt.x}
                    cy={-activeCutterPt.y}
                    r={5 / safeScale}
                    fill="#06B6D433"
                    stroke="#22D3EE"
                    strokeWidth={strokeWidthBase * 1.3}
                  />
                  <circle cx={activeCutterPt.x} cy={-activeCutterPt.y} r={1.8 / safeScale} fill="#22D3EE" />
                </g>
              )}
            </g>
          )}

          {/* Interactive Snap Ring */}
          {snapPoint && isNum(snapPoint.x) && isNum(snapPoint.y) && (
            <circle
              cx={snapPoint.x}
              cy={-snapPoint.y}
              r={5 / safeScale}
              fill="none"
              stroke="#10B981"
              strokeWidth={thinStroke * 1.5}
            />
          )}

          {/* Interactive Measurement Overlay */}
          {measurePoints.length > 0 && (
            <g>
              {measurePoints.map((pt, idx) =>
                isNum(pt.x) && isNum(pt.y) ? (
                  <circle
                    key={`m-${idx}`}
                    cx={pt.x}
                    cy={-pt.y}
                    r={3.5 / safeScale}
                    fill="#10B981"
                  />
                ) : null
              )}
              {measurePoints.length === 2 && (
                <>
                  <line
                    x1={measurePoints[0].x}
                    y1={-measurePoints[0].y}
                    x2={measurePoints[1].x}
                    y2={-measurePoints[1].y}
                    stroke="#10B981"
                    strokeWidth={strokeWidthBase * 1.2}
                    strokeDasharray={`${4 / safeScale} ${2 / safeScale}`}
                  />
                  <text
                    x={(measurePoints[0].x + measurePoints[1].x) / 2}
                    y={-(measurePoints[0].y + measurePoints[1].y) / 2 - 6 / safeScale}
                    textAnchor="middle"
                    fill="#10B981"
                    fontSize={fontSizeWorld * 1.05}
                    fontFamily="IBM Plex Mono, monospace"
                    fontWeight={600}
                  >
                    {fmtCoord(
                      Math.hypot(
                        measurePoints[1].x - measurePoints[0].x,
                        measurePoints[1].y - measurePoints[0].y
                      )
                    )}{' '}
                    {unitDisplay}
                  </text>
                </>
              )}
            </g>
          )}
        </svg>

        {/* Bottom Coordinate & Grid HUD */}
        <div
          className={`absolute ${
            compactHud ? 'bottom-2 left-2 px-2 py-1 text-[10px] gap-2' : 'bottom-3 left-3 px-2.5 py-1.5 text-xs gap-3'
          } flex flex-wrap items-center rounded border font-mono tabular-nums ${
            darkCanvas
              ? 'bg-slate-900/90 border-slate-700 text-slate-200'
              : 'bg-white/95 border-slate-200 text-slate-700'
          }`}
        >
          <span className="inline-flex items-center gap-1">
            <Crosshair className={`${compactHud ? 'w-3 h-3' : 'w-3.5 h-3.5'} text-cyan-500`} />
            X: {fmtCoord(cursorWorld.x)}
          </span>
          <span>
            Y: {fmtCoord(cursorWorld.y)} {unitDisplay}
          </span>
          {!compactHud && (
            <>
              <span className="text-slate-400">|</span>
              <span>
                Grid: {fmtCoord(gridStep)} {unitDisplay}
              </span>
            </>
          )}
          <span className="text-slate-400">|</span>
          <span>{Math.round((safeScale / 3.78) * 100)}%</span>
          {statusLabel && !compactHud && (
            <>
              <span className="text-slate-400">|</span>
              <span className="text-cyan-500">{statusLabel}</span>
            </>
          )}
          {measurePoints.length === 2 && (
            <>
              <span className="text-slate-400">|</span>
              <span className="text-emerald-500 font-semibold">
                ΔX {fmtCoord(Math.abs(measurePoints[1].x - measurePoints[0].x))} · ΔY{' '}
                {fmtCoord(Math.abs(measurePoints[1].y - measurePoints[0].y))} {unitDisplay}
              </span>
              <button
                type="button"
                onClick={() => setMeasurePoints([])}
                className="ml-1 text-slate-400 hover:text-slate-200"
                title="Clear measurement"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
