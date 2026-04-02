import React, { useRef, useState, useEffect, useCallback } from 'react';
import { CompositorLayer } from '@/types';
import { formatTimeShort, timeToPixel, pixelToTime } from '@/utils/timelineUtils';

interface CompositorTimelineProps {
  layers: CompositorLayer[];
  playheadTime: number;
  selectedLayerId: string | null;
  timelineZoom: number;
  compositionDuration: number;
  onSeek: (time: number) => void;
  onUpdateLayer: (id: string, updates: Partial<CompositorLayer>) => void;
  onSelectLayer: (id: string) => void;
  onSetZoom: (zoom: number) => void;
  onReorderLayer: (id: string, direction: 'up' | 'down') => void;
  onRenameLayer: (id: string, name: string) => void;
  getLayerTimelineDuration: (layer: CompositorLayer) => number;
}

const TRACK_HEIGHT = 40;
const LABEL_WIDTH = 180;
const LAYER_COLORS = ['#7c3aed','#2563eb','#0891b2','#059669','#d97706','#dc2626','#db2777','#64748b'];
const RULER_HEIGHT = 28;
const MIN_PPS = 5;
const MAX_PPS = 100;
const SNAP_PX = 10;

type DragType = 'trimIn' | 'trimOut' | 'move' | 'scrub';

interface DragState {
  type: DragType;
  layerId: string;
  startX: number;
  startY: number;
  initialTimelineStart: number;
  initialTrimIn: number;
  initialTrimOut: number;
  initialLoopDuration: number;
  isReordering: boolean;
}

interface LabelDragState {
  layerId: string;
  startY: number;
}

export const CompositorTimeline: React.FC<CompositorTimelineProps> = ({
  layers, playheadTime, selectedLayerId, timelineZoom, compositionDuration,
  onSeek, onUpdateLayer, onSelectLayer, onSetZoom, onReorderLayer, onRenameLayer, getLayerTimelineDuration,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const labelScrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [labelDrag, setLabelDrag] = useState<LabelDragState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [labelGhostPos, setLabelGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [clipGhostY, setClipGhostY] = useState<number | null>(null);
  const [colorPickerLabelId, setColorPickerLabelId] = useState<string | null>(null);
  const [colorPickerPos, setColorPickerPos] = useState<{ x: number; y: number } | null>(null);
  const labelDragMovedRef = useRef(false);

  const trackLayers = [...layers].reverse();
  const totalWidth = Math.max(timeToPixel(compositionDuration + 5, timelineZoom), 800);

  // ---- Ruler ----
  const renderRuler = () => {
    const ticks: React.ReactNode[] = [];
    let interval = 1;
    if (timelineZoom < 10) interval = 5;
    else if (timelineZoom < 25) interval = 2;
    else if (timelineZoom >= 50) interval = 0.5;
    const maxTime = compositionDuration + 5;
    for (let t = 0; t <= maxTime; t += interval) {
      const x = timeToPixel(t, timelineZoom);
      const isMajor = t % (interval >= 1 ? Math.max(interval * 2, 5) : 1) === 0 || interval < 1;
      ticks.push(
        <div key={t} className="absolute top-0" style={{ left: x, height: RULER_HEIGHT }}>
          <div className={`w-px ${isMajor ? 'h-3 bg-zinc-500' : 'h-2 bg-zinc-700'}`} />
          {(interval < 1 || t % Math.max(interval, 1) === 0) && (
            <span className="absolute top-3 -translate-x-1/2 text-[8px] text-zinc-400 font-mono whitespace-nowrap select-none">
              {formatTimeShort(t)}
            </span>
          )}
        </div>
      );
    }
    return ticks;
  };

  const handleRulerMouseDown = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft || 0);
    onSeek(pixelToTime(x, timelineZoom));
    setDrag({ type: 'scrub', layerId: '', startX: e.clientX, startY: e.clientY,
      initialTimelineStart: 0, initialTrimIn: 0, initialTrimOut: 0, initialLoopDuration: 0, isReordering: false });
  };

  const handleClipMouseDown = (e: React.MouseEvent, layer: CompositorLayer, type: DragType) => {
    e.stopPropagation();
    onSelectLayer(layer.id);
    setDrag({
      type, layerId: layer.id, startX: e.clientX, startY: e.clientY,
      initialTimelineStart: layer.timelineStart,
      initialTrimIn: layer.trimIn,
      initialTrimOut: layer.trimOut,
      initialLoopDuration: layer.loop ? layer.loopDuration : (layer.freezeDuration || 2),
      isReordering: false,
    });
  };

  // ---- Snap helpers ----
  const getSnapPoints = useCallback((excludeId: string): number[] => {
    const pts: number[] = [0];
    for (const l of layers) {
      if (l.id === excludeId) continue;
      pts.push(l.timelineStart);
      pts.push(l.timelineStart + getLayerTimelineDuration(l));
    }
    return pts;
  }, [layers, getLayerTimelineDuration]);

  const snapTo = useCallback((t: number, excludeId: string): number => {
    const threshold = pixelToTime(SNAP_PX, timelineZoom);
    const pts = getSnapPoints(excludeId);
    let best = t, bestDist = threshold;
    for (const sp of pts) {
      const d = Math.abs(t - sp);
      if (d < bestDist) { bestDist = d; best = sp; }
    }
    return best;
  }, [getSnapPoints, timelineZoom]);

  // ---- Global drag handler ----
  useEffect(() => {
    if (!drag && !labelDrag) return;

    const onMouseMove = (e: MouseEvent) => {
      // Label column drag → reorder
      if (labelDrag) {
        const dy = e.clientY - labelDrag.startY;
        if (!labelDragMovedRef.current && Math.abs(dy) <= 5) return;
        labelDragMovedRef.current = true;
        setLabelGhostPos({ x: e.clientX, y: e.clientY });
        if (dy < -TRACK_HEIGHT / 2) {
          onReorderLayer(labelDrag.layerId, 'up');
          setLabelDrag(prev => prev ? { ...prev, startY: prev.startY - TRACK_HEIGHT } : null);
        } else if (dy > TRACK_HEIGHT / 2) {
          onReorderLayer(labelDrag.layerId, 'down');
          setLabelDrag(prev => prev ? { ...prev, startY: prev.startY + TRACK_HEIGHT } : null);
        }
        return;
      }

      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const dt = pixelToTime(dx, timelineZoom);

      if (drag.type === 'scrub') {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;
        const rect = scrollEl.getBoundingClientRect();
        const x = e.clientX - rect.left + scrollEl.scrollLeft;
        onSeek(Math.max(0, pixelToTime(x, timelineZoom)));
        return;
      }

      const layer = layers.find(l => l.id === drag.layerId);
      if (!layer) { setDrag(null); return; }

      if (drag.type === 'move') {
        // Detect vertical drag → reorder
        if (!drag.isReordering && Math.abs(dy) > TRACK_HEIGHT * 0.45) {
          setDrag(prev => prev ? { ...prev, isReordering: true } : null);
          // Compute Y relative to the track container
          const el = scrollRef.current;
          if (el) {
            const rect = el.getBoundingClientRect();
            setClipGhostY(e.clientY - rect.top + el.scrollTop - (TRACK_HEIGHT - 8) / 2);
          }
          return;
        }
        if (drag.isReordering) {
          // Update floating clip ghost Y
          const el = scrollRef.current;
          if (el) {
            const rect = el.getBoundingClientRect();
            setClipGhostY(e.clientY - rect.top + el.scrollTop - (TRACK_HEIGHT - 8) / 2);
          }
          if (dy < -TRACK_HEIGHT / 2) {
            onReorderLayer(drag.layerId, 'up');
            setDrag(prev => prev ? { ...prev, startY: prev.startY - TRACK_HEIGHT } : null);
          } else if (dy > TRACK_HEIGHT / 2) {
            onReorderLayer(drag.layerId, 'down');
            setDrag(prev => prev ? { ...prev, startY: prev.startY + TRACK_HEIGHT } : null);
          }
          return;
        }
        // Horizontal move with snap
        const snapped = snapTo(Math.max(0, drag.initialTimelineStart + dt), drag.layerId);
        onUpdateLayer(drag.layerId, { timelineStart: snapped });

      } else if (drag.type === 'trimIn') {
        const rawTrimIn = Math.max(0, Math.min(drag.initialTrimIn + dt * layer.playbackRate, layer.trimOut - 0.1));
        const trimDelta = rawTrimIn - drag.initialTrimIn;
        const rawStart = Math.max(0, drag.initialTimelineStart + trimDelta / layer.playbackRate);
        // Snap the clip start edge
        const snappedStart = snapTo(rawStart, drag.layerId);
        const snappedDelta = snappedStart - drag.initialTimelineStart;
        const snappedTrimIn = Math.max(0, Math.min(drag.initialTrimIn + snappedDelta * layer.playbackRate, layer.trimOut - 0.1));
        onUpdateLayer(drag.layerId, { trimIn: snappedTrimIn, timelineStart: snappedStart });

      } else if (drag.type === 'trimOut') {
        if (layer.loop) {
          const newLoopDur = Math.max(0.5, drag.initialLoopDuration + dt);
          onUpdateLayer(drag.layerId, { loopDuration: newLoopDur });
        } else if (layer.freezeLastFrame) {
          // Extend freeze duration
          const newFreezeDur = Math.max(0.1, drag.initialLoopDuration + dt);
          onUpdateLayer(drag.layerId, { freezeDuration: newFreezeDur });
        } else {
          // Snap the clip right edge
          const clipDur = (layer.trimOut - layer.trimIn) / layer.playbackRate;
          const rawEnd = layer.timelineStart + Math.max(
            (layer.trimIn + 0.1 - layer.trimIn) / layer.playbackRate,
            (drag.initialTrimOut - drag.initialTrimIn) / layer.playbackRate + dt
          );
          const snappedEnd = snapTo(rawEnd, drag.layerId);
          const snappedDur = snappedEnd - layer.timelineStart;
          const newTrimOut = Math.max(layer.trimIn + 0.1, Math.min(
            layer.trimIn + snappedDur * layer.playbackRate, layer.mediaDuration
          ));
          onUpdateLayer(drag.layerId, { trimOut: newTrimOut });
        }
      }
    };

    const onMouseUp = () => { setDrag(null); setLabelDrag(null); setLabelGhostPos(null); setClipGhostY(null); labelDragMovedRef.current = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, [drag, labelDrag, timelineZoom, layers, onSeek, onUpdateLayer, onReorderLayer, snapTo]);

  // ---- Close timeline color picker on outside click ----
  useEffect(() => {
    if (!colorPickerLabelId) return;
    const close = () => { setColorPickerLabelId(null); setColorPickerPos(null); };
    const t = setTimeout(() => window.addEventListener('click', close), 0);
    return () => { clearTimeout(t); window.removeEventListener('click', close); };
  }, [colorPickerLabelId]);

  // ---- Sync label scroll ----
  const handleTrackScroll = (e: React.UIEvent<HTMLDivElement>) => {
    if (labelScrollRef.current) labelScrollRef.current.scrollTop = (e.currentTarget as HTMLDivElement).scrollTop;
  };

  // ---- Render clip ----
  const renderClip = (layer: CompositorLayer) => {
    const duration = getLayerTimelineDuration(layer);
    const left = timeToPixel(layer.timelineStart, timelineZoom);
    const width = Math.max(timeToPixel(duration, timelineZoom), 4);
    const isSelected = layer.id === selectedLayerId;
    const isDragging = drag?.layerId === layer.id;
    const handleW = 6;

    // Clip body and freeze zone widths
    const clipBodyDur = layer.freezeLastFrame && !layer.loop
      ? (layer.trimOut - layer.trimIn) / layer.playbackRate
      : duration;
    const clipBodyWidth = Math.max(timeToPixel(clipBodyDur, timelineZoom), 4);
    const freezeWidth = width - clipBodyWidth;

    // Color
    const baseColor = layer.color || (layer.type === 'video' ? '#7c3aed' : '#4338ca');
    const bgColor = baseColor + (isDragging ? 'aa' : '99');

    // Loop cycle markers
    const loopMarkers: React.ReactNode[] = [];
    if (layer.loop) {
      const trimLen = (layer.trimOut - layer.trimIn) / layer.playbackRate;
      if (trimLen > 0 && duration > trimLen) {
        const count = Math.floor(duration / trimLen);
        for (let i = 1; i <= count; i++) {
          const mx = timeToPixel(trimLen * i, timelineZoom);
          if (mx < width - 2) loopMarkers.push(
            <div key={i} className="absolute top-0 bottom-0 w-px border-l border-dashed border-white/20" style={{ left: mx }} />
          );
        }
      }
    }

    return (
      <div
        key={layer.id}
        className={`absolute top-1 rounded-md overflow-hidden select-none
          ${isDragging && drag?.isReordering ? 'cursor-ns-resize opacity-10 pointer-events-none' : 'cursor-grab active:cursor-grabbing'}
          ${isSelected ? 'ring-2 ring-white/80 shadow-lg' : 'hover:ring-1 hover:ring-white/30'}`}
        style={{ left, width, height: TRACK_HEIGHT - 8, backgroundColor: bgColor,
          transition: isDragging ? 'none' : 'box-shadow 0.1s' }}
        onMouseDown={(e) => handleClipMouseDown(e, layer, 'move')}
      >
        {/* Clip body */}
        <div className="absolute top-0 left-0 bottom-0" style={{ width: clipBodyWidth }} />

        {/* Freeze zone overlay */}
        {layer.freezeLastFrame && !layer.loop && freezeWidth > 0 && (
          <div
            className="absolute top-0 bottom-0 bg-cyan-500/20 border-l border-dashed border-cyan-400/50 flex items-center justify-center"
            style={{ left: clipBodyWidth, width: freezeWidth }}
          >
            <i className="fas fa-snowflake text-[7px] text-cyan-400/70" />
          </div>
        )}

        {/* Label */}
        <div className="absolute inset-0 flex items-center px-2 overflow-hidden pointer-events-none">
          <span className="text-[10px] font-bold text-white/90 truncate select-none">{layer.name}</span>
          {layer.loop && <i className="fas fa-rotate-right text-[7px] text-white/50 ml-1" />}
        </div>

        {loopMarkers}

        {/* Trim-in handle */}
        <div className="absolute left-0 top-0 bottom-0 cursor-col-resize z-10 flex items-center group/handle"
          style={{ width: handleW * 2 }} onMouseDown={(e) => handleClipMouseDown(e, layer, 'trimIn')}>
          <div className="w-1 h-4 bg-white/60 group-hover/handle:bg-white rounded-full ml-0.5" />
        </div>

        {/* Trim-out handle */}
        <div className="absolute right-0 top-0 bottom-0 cursor-col-resize z-10 flex items-center justify-end group/handle"
          style={{ width: handleW * 2 }} onMouseDown={(e) => handleClipMouseDown(e, layer, 'trimOut')}>
          <div className="w-1 h-4 bg-white/60 group-hover/handle:bg-white rounded-full mr-0.5" />
        </div>
      </div>
    );
  };

  const playheadX = timeToPixel(playheadTime, timelineZoom);
  const isDraggingReorder = drag?.isReordering || labelDrag !== null;

  return (
    <div className="flex flex-col h-full overflow-hidden border-t border-zinc-800 bg-zinc-900/80">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-zinc-800/50 shrink-0">
        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">Timeline</span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-zinc-400 font-mono">{timelineZoom.toFixed(0)} px/s</span>
          <button onClick={() => onSetZoom(Math.max(MIN_PPS, timelineZoom - 5))} className="text-zinc-400 hover:text-white w-5 h-5 flex items-center justify-center">
            <i className="fas fa-minus text-[8px]" />
          </button>
          <input type="range" min={MIN_PPS} max={MAX_PPS} value={timelineZoom}
            className="w-20 accent-violet-500 h-1" onChange={e => onSetZoom(Number(e.target.value))} />
          <button onClick={() => onSetZoom(Math.min(MAX_PPS, timelineZoom + 5))} className="text-zinc-400 hover:text-white w-5 h-5 flex items-center justify-center">
            <i className="fas fa-plus text-[8px]" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Label column */}
        <div className="shrink-0 border-r border-zinc-800/50 flex flex-col" style={{ width: LABEL_WIDTH }}>
          <div style={{ height: RULER_HEIGHT }} className="border-b border-zinc-800/50 shrink-0" />
          <div ref={labelScrollRef} className="flex-1 overflow-y-hidden flex flex-col">
            {trackLayers.map(layer => {
              const isDraggingThis = labelDrag?.layerId === layer.id || (drag?.isReordering && drag?.layerId === layer.id);
              const isRenaming = renamingId === layer.id;
              return (
                <div
                  key={layer.id}
                  onClick={() => onSelectLayer(layer.id)}
                  onMouseDown={(e) => {
                    if (isRenaming) return;
                    if ((e.target as HTMLElement).closest('button')) return;
                    e.preventDefault();
                    labelDragMovedRef.current = false;
                    setLabelDrag({ layerId: layer.id, startY: e.clientY });
                    onSelectLayer(layer.id);
                  }}
                  className={`flex items-center px-2 gap-1.5 cursor-grab active:cursor-grabbing border-b border-zinc-800/30 select-none shrink-0 transition-all duration-150
                    ${layer.id === selectedLayerId ? 'bg-violet-900/20' : 'hover:bg-zinc-800/30'}
                    ${isDraggingThis ? 'opacity-40 bg-violet-900/30 scale-y-95' : ''}`}
                  style={{ height: TRACK_HEIGHT, minHeight: TRACK_HEIGHT }}
                >
                  {/* Color dot — click to open color picker */}
                  <div className="relative shrink-0 flex-none">
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (colorPickerLabelId === layer.id) {
                          setColorPickerLabelId(null); setColorPickerPos(null);
                        } else {
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setColorPickerLabelId(layer.id);
                          setColorPickerPos({ x: r.right + 6, y: r.top - 4 });
                        }
                      }}
                      className="w-3 h-3 rounded-sm hover:scale-125 transition-transform"
                      style={{ backgroundColor: layer.color || (layer.type === 'video' ? '#7c3aed' : '#4338ca') }}
                      title="Change color"
                    />
                  </div>
                  {/* Name — double-click to rename */}
                  {isRenaming ? (
                    <input
                      autoFocus
                      className="flex-1 min-w-0 bg-zinc-700 border border-violet-500 rounded px-1 py-0 text-xs text-white outline-none"
                      value={layer.name}
                      onChange={e => onRenameLayer(layer.id, e.target.value)}
                      onBlur={() => setRenamingId(null)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setRenamingId(null); e.stopPropagation(); }}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span
                      className={`text-xs font-medium truncate flex-1 min-w-0 ${layer.visible ? 'text-zinc-200' : 'text-zinc-500 line-through'}`}
                      onDoubleClick={e => { e.stopPropagation(); setRenamingId(layer.id); }}
                      title={layer.name + ' — double-click to rename'}
                    >
                      {layer.name}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Track area */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-auto relative" onScroll={handleTrackScroll}>
          <div className="relative" style={{ width: totalWidth }}>
            {/* Ruler */}
            <div className="relative cursor-pointer border-b border-zinc-800/50 sticky top-0 z-10 bg-zinc-900/95 backdrop-blur-sm"
              style={{ height: RULER_HEIGHT }} onMouseDown={handleRulerMouseDown}>
              {renderRuler()}
            </div>

            {/* Tracks */}
            {trackLayers.map(layer => {
              const isReorderTarget = isDraggingReorder && layer.id !== (drag?.layerId || labelDrag?.layerId);
              return (
                <div key={layer.id}
                  className={`relative border-b border-zinc-800/20 transition-colors duration-100
                    ${layer.id === selectedLayerId ? 'bg-violet-900/10' : ''}
                    ${isReorderTarget ? 'bg-zinc-800/10' : ''}`}
                  style={{ height: TRACK_HEIGHT }}
                  onClick={() => onSelectLayer(layer.id)}>
                  {renderClip(layer)}
                </div>
              );
            })}

            {/* Floating clip ghost during vertical reorder drag */}
            {drag?.isReordering && clipGhostY !== null && (() => {
              const ghostLayer = layers.find(l => l.id === drag.layerId);
              if (!ghostLayer) return null;
              const duration = getLayerTimelineDuration(ghostLayer);
              const left = timeToPixel(ghostLayer.timelineStart, timelineZoom);
              const width = Math.max(timeToPixel(duration, timelineZoom), 4);
              const baseColor = ghostLayer.color || (ghostLayer.type === 'video' ? '#7c3aed' : '#4338ca');
              return (
                <div
                  className="absolute pointer-events-none rounded-md overflow-hidden z-30 ring-2 ring-white/70 shadow-2xl"
                  style={{ left, width, top: clipGhostY, height: TRACK_HEIGHT - 8, backgroundColor: baseColor + 'dd' }}
                >
                  <div className="absolute inset-0 flex items-center px-2 overflow-hidden">
                    <span className="text-[10px] font-bold text-white truncate select-none">{ghostLayer.name}</span>
                  </div>
                </div>
              );
            })()}

            {/* Playhead */}
            <div className="absolute top-0 pointer-events-none z-20" style={{ left: playheadX, height: '100%' }}>
              <div className="absolute -top-0 -translate-x-1/2 w-0 h-0"
                style={{ borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '6px solid #ef4444' }} />
              <div className="w-px h-full bg-red-500/80" />
            </div>
          </div>
        </div>
      </div>
      {/* Timeline color picker popover */}
      {colorPickerLabelId && colorPickerPos && (() => {
        const pickerLayer = layers.find(l => l.id === colorPickerLabelId);
        if (!pickerLayer) return null;
        return (
          <div
            className="fixed z-[9999] bg-zinc-900 border border-zinc-700 rounded-lg p-2 shadow-2xl flex flex-wrap gap-1"
            style={{ width: 116, left: colorPickerPos.x, top: colorPickerPos.y }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
          >
            {LAYER_COLORS.map(c => (
              <button key={c}
                onMouseDown={e => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onUpdateLayer(colorPickerLabelId, { color: c }); setColorPickerLabelId(null); setColorPickerPos(null); }}
                className={`w-5 h-5 rounded border-2 transition-transform hover:scale-110 ${pickerLayer.color === c ? 'border-white' : 'border-transparent'}`}
                style={{ backgroundColor: c }} />
            ))}
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onUpdateLayer(colorPickerLabelId, { color: undefined }); setColorPickerLabelId(null); setColorPickerPos(null); }}
              className="text-[7px] text-zinc-400 hover:text-white px-1 py-0.5 rounded bg-zinc-700/60 hover:bg-zinc-700 w-full text-center mt-0.5">reset</button>
          </div>
        );
      })()}

      {/* Label-column drag ghost (name label follows cursor) */}
      {labelDrag && labelGhostPos && (() => {
        const ghostLayer = layers.find(l => l.id === labelDrag.layerId);
        if (!ghostLayer) return null;
        return (
          <div
            className="fixed z-[9999] bg-zinc-900 border border-violet-500/80 rounded-lg px-3 py-2 shadow-2xl flex items-center gap-2 pointer-events-none"
            style={{ left: labelGhostPos.x + 12, top: labelGhostPos.y - 14 }}
          >
            <div className="w-3 h-3 rounded-sm border border-zinc-600" style={{ backgroundColor: ghostLayer.color || (ghostLayer.type === 'video' ? '#7c3aed' : '#4338ca') }} />
            <span className="text-sm font-medium text-zinc-200 max-w-[200px] truncate">{ghostLayer.name}</span>
          </div>
        );
      })()}
    </div>
  );
};

export default CompositorTimeline;
