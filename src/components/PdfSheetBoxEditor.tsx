import React, { useEffect, useRef, useState } from 'react';
import type { NormalizedRect, PdfViewBox, ViewChunkKind } from '../types/cad';

export const VIEW_KIND_OPTIONS: Array<{ value: ViewChunkKind; label: string }> = [
  { value: 'orthogonal', label: 'Orthogonal' },
  { value: 'longitudinal-section', label: 'Longitudinal Section' },
  { value: 'cross-section', label: 'Cross-Section' },
  { value: 'detail', label: 'Detail View' },
  { value: 'isometric', label: 'Isometric' },
];

type DragState =
  | {
      mode: 'move' | 'resize';
      boxId: string;
      startClientX: number;
      startClientY: number;
      imgWidth: number;
      imgHeight: number;
      origBounds: NormalizedRect;
    }
  | {
      mode: 'draw';
      startNormX: number;
      startNormY: number;
      curNormX: number;
      curNormY: number;
      rectLeft: number;
      rectTop: number;
      imgWidth: number;
      imgHeight: number;
    };

interface PdfSheetBoxEditorProps {
  imageDataUrl: string;
  alt: string;
  boxes: PdfViewBox[];
  selectedBoxId: string | null;
  highlightedBoxId?: string | null;
  editable: boolean;
  allowDraw?: boolean;
  showIndex?: boolean;
  maxHeightClass?: string;
  onSelectBox?: (boxId: string) => void;
  onChangeBoxes?: React.Dispatch<React.SetStateAction<PdfViewBox[]>>;
}

export const PdfSheetBoxEditor: React.FC<PdfSheetBoxEditorProps> = ({
  imageDataUrl,
  alt,
  boxes,
  selectedBoxId,
  highlightedBoxId,
  editable,
  allowDraw = false,
  showIndex = false,
  maxHeightClass = 'max-h-[540px]',
  onSelectBox,
  onChangeBoxes,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [drawPreviewRect, setDrawPreviewRect] = useState<NormalizedRect | null>(null);

  useEffect(() => {
    const onPointerMove = (e: MouseEvent) => {
      const st = dragRef.current;
      if (!st || st.imgWidth <= 0 || st.imgHeight <= 0) return;

      if (st.mode === 'draw') {
        const curX = Math.max(0, Math.min(1, (e.clientX - st.rectLeft) / st.imgWidth));
        const curY = Math.max(0, Math.min(1, (e.clientY - st.rectTop) / st.imgHeight));
        st.curNormX = curX;
        st.curNormY = curY;
        setDrawPreviewRect({
          x: Math.min(st.startNormX, curX),
          y: Math.min(st.startNormY, curY),
          w: Math.abs(curX - st.startNormX),
          h: Math.abs(curY - st.startNormY),
        });
        return;
      }

      if (!onChangeBoxes) return;
      const dxNorm = (e.clientX - st.startClientX) / st.imgWidth;
      const dyNorm = (e.clientY - st.startClientY) / st.imgHeight;

      onChangeBoxes((prev) =>
        prev.map((box) => {
          if (box.id !== st.boxId) return box;
          if (st.mode === 'move') {
            const nx = Math.max(0, Math.min(1 - st.origBounds.w, st.origBounds.x + dxNorm));
            const ny = Math.max(0, Math.min(1 - st.origBounds.h, st.origBounds.y + dyNorm));
            return {
              ...box,
              normBounds: {
                ...box.normBounds,
                x: Number(nx.toFixed(4)),
                y: Number(ny.toFixed(4)),
              },
            };
          }
          const nw = Math.max(0.05, Math.min(1 - st.origBounds.x, st.origBounds.w + dxNorm));
          const nh = Math.max(0.05, Math.min(1 - st.origBounds.y, st.origBounds.h + dyNorm));
          return {
            ...box,
            normBounds: {
              ...box.normBounds,
              w: Number(nw.toFixed(4)),
              h: Number(nh.toFixed(4)),
            },
          };
        })
      );
    };

    const onPointerUp = () => {
      const st = dragRef.current;
      dragRef.current = null;
      setDrawPreviewRect(null);
      if (!st || st.mode !== 'draw' || !onChangeBoxes) return;

      const x = Math.min(st.startNormX, st.curNormX);
      const y = Math.min(st.startNormY, st.curNormY);
      const w = Math.abs(st.curNormX - st.startNormX);
      const h = Math.abs(st.curNormY - st.startNormY);
      if (w < 0.04 || h < 0.04) return;

      const createdId = `manual-view-${Date.now().toString(36).slice(-4)}-${Math.random().toString(36).slice(2, 4)}`;
      onChangeBoxes((prev) => [
        ...prev,
        {
          id: createdId,
          label: `View ${prev.length + 1}`,
          viewKind: 'orthogonal',
          normBounds: {
            x: Number(x.toFixed(4)),
            y: Number(y.toFixed(4)),
            w: Number(w.toFixed(4)),
            h: Number(h.toFixed(4)),
          },
        },
      ]);
      onSelectBox?.(createdId);
    };

    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);
    return () => {
      window.removeEventListener('mousemove', onPointerMove);
      window.removeEventListener('mouseup', onPointerUp);
    };
  }, [onChangeBoxes, onSelectBox]);

  const startBoxTransform = (
    e: React.MouseEvent,
    box: PdfViewBox,
    mode: 'move' | 'resize'
  ) => {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectBox?.(box.id);
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    dragRef.current = {
      mode,
      boxId: box.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      imgWidth: rect.width,
      imgHeight: rect.height,
      origBounds: { ...box.normBounds },
    };
  };

  const startCanvasDraw = (e: React.MouseEvent) => {
    if (!editable || !allowDraw) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    e.preventDefault();
    const sx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const sy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    dragRef.current = {
      mode: 'draw',
      startNormX: sx,
      startNormY: sy,
      curNormX: sx,
      curNormY: sy,
      rectLeft: rect.left,
      rectTop: rect.top,
      imgWidth: rect.width,
      imgHeight: rect.height,
    };
    setDrawPreviewRect({ x: sx, y: sy, w: 0, h: 0 });
  };

  return (
    <div
      ref={stageRef}
      onMouseDown={editable && allowDraw ? startCanvasDraw : undefined}
      className={`relative inline-block max-w-full max-h-full select-none border border-slate-300 dark:border-slate-700 bg-white shadow-xs ${
        editable && allowDraw ? 'cursor-crosshair' : ''
      }`}
    >
      <img
        src={imageDataUrl}
        alt={alt}
        draggable={false}
        className={`block max-w-full ${maxHeightClass} object-contain`}
      />

      {boxes.map((box, idx) => {
        const isSel = box.id === selectedBoxId;
        const isHighlighted = box.id === highlightedBoxId;
        const b = box.normBounds;
        return (
          <div
            key={box.id}
            onMouseDown={(e) => {
              if (editable) {
                startBoxTransform(e, box, 'move');
              } else {
                e.stopPropagation();
                onSelectBox?.(box.id);
              }
            }}
            style={{
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              width: `${b.w * 100}%`,
              height: `${b.h * 100}%`,
            }}
            className={`absolute transition-colors ${editable ? 'cursor-move' : 'cursor-pointer'} ${
              (isSel && editable) || isHighlighted || (isSel && showIndex)
                ? 'border-2 border-cyan-500 bg-cyan-500/10'
                : 'border border-dashed border-amber-500/80 hover:border-cyan-500 bg-amber-500/5'
            }`}
          >
            <div
              className={`px-1.5 py-0.5 text-[10px] font-mono tabular-nums font-semibold inline-block max-w-full truncate ${
                isSel && editable ? 'bg-cyan-600 text-white' : 'bg-slate-900/85 text-white'
              }`}
            >
              {showIndex ? `${idx + 1}. ${box.label}` : box.label}
            </div>

            {editable && (
              <div
                onMouseDown={(e) => startBoxTransform(e, box, 'resize')}
                title="Drag to resize view box"
                className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-cyan-600 border-2 border-white rounded-xs cursor-nwse-resize"
              />
            )}
          </div>
        );
      })}

      {drawPreviewRect && drawPreviewRect.w > 0.01 && drawPreviewRect.h > 0.01 && (
        <div
          style={{
            left: `${drawPreviewRect.x * 100}%`,
            top: `${drawPreviewRect.y * 100}%`,
            width: `${drawPreviewRect.w * 100}%`,
            height: `${drawPreviewRect.h * 100}%`,
          }}
          className="absolute border-2 border-dashed border-cyan-600 bg-cyan-500/15 pointer-events-none"
        />
      )}
    </div>
  );
};
