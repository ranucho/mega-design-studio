import React, { useRef, useState, useEffect, useCallback } from 'react';
import { CompositorLayer } from '@/types';
import { formatTimeShort, timeToPixel, pixelToTime } from '@/utils/timelineUtils';

interface CompositorTimelineProps {
  layers: CompositorLayer[];
  playheadTime: number;
  selectedLayerId: string | null;
  timelineZoom: number; // pixels per second
  compositionDuration: number;
  onSeek: (time: number) => void;
  onUpdateLayer: (id: string, updates: Partial<CompositorLayer>) => void;
  onSelectLayer: (id: string) => void;
  onSetZoom: (zoom: number) => void;
  getLayerTimelineDuration: (layer: CompositorLayer) => number;
}

const TRACK_HEIGHT = 40;
const LABEL_WIDTH = 120;
const RULER_HEIGHT = 28;
const MIN_PPS = 5;
const MAX_PPS = 100;

type DragType = 'trimIn' | 'trimOut' | 'move' | 'scrub';

interface DragState {
  type: DragType;
  layerId: string;
  startX: number;
  initialTimelineStart: number;
  initialTrimIn: number;
  initialTrimOut: number;
  initialLoopDuration: number;
}

export const CompositorTimeline: React.FC<CompositorTimelineProps> = ({
  layers, playheadTime, selectedLayerId, timelineZoom, compositionDuration,
  onSeek, onUpdateLayer, onSelectLayer, onSetZoom, getLayerTimelineDuration,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  // Reversed layers for NLE convention (top visual layer = top track)
  const trackLayers = [...layers].reverse();

  const totalWidth = Math.max(timeToPixel(compositionDuration + 5, timelineZoom), 800);

  // ---- Ruler tick marks ----
  const renderRuler = () => {
    const ticks: React.ReactNode[] = [];
    // Determine tick interval based on zoom
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
            <span className="absolute top-3 -translate-x-1/2 text-[8px] text-zinc-600 font-mono whitespace-nowrap select-none">
              {formatTimeShort(t)}
            </span>
          )}
        </div>
      );
    }
    return ticks;
  };

  // ---- Ruler click → scrub ----
  const handleRulerMouseDown = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft || 0);
    const time = pixelToTime(x, timelineZoom);
    onSeek(time);
    // Start scrub drag
    setDrag({
      type: 'scrub', layerId: '', startX: e.clientX,
      initialTimelineStart: 0, initialTrimIn: 0, initialTrimOut: 0, initialLoopDuration: 0,
    });
  };

  // ---- Clip interactions ----
  const handleClipMouseDown = (e: React.MouseEvent, layer: CompositorLayer, type: DragType) => {
    e.stopPropagation();
    onSelectLayer(layer.id);
    setDrag({
      type,
      layerId: layer.id,
      startX: e.clientX,
      initialTimelineStart: layer.timelineStart,
      initialTrimIn: layer.trimIn,
      initialTrimOut: layer.trimOut,
      initialLoopDuration: layer.loopDuration,
    });
  };

  // ---- Global drag handler ----
  useEffect(() => {
    if (!drag) return;

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - drag.startX;
      const dt = pixelToTime(dx, timelineZoom);

      if (drag.type === 'scrub') {
        const scrollEl = scrollRef.current;
        if (!scrollEl) return;
        const rect = scrollEl.getBoundingClientRect();
        const x = e.clientX - rect.left + scrollEl.scrollLeft;
        const time = pixelToTime(x, timelineZoom);
        onSeek(Math.max(0, time));
        return;
      }

      const layer = layers.find(l => l.id === drag.layerId);
      if (!layer) return;

      if (drag.type === 'move') {
        onUpdateLayer(drag.layerId, {
          timelineStart: Math.max(0, drag.initialTimelineStart + dt),
        });
      } else if (drag.type === 'trimIn') {
        const newTrimIn = Math.max(0, Math.min(drag.initialTrimIn + dt * layer.playbackRate, layer.trimOut - 0.1));
        // Adjust timelineStart so the right edge stays fixed
        const trimDelta = newTrimIn - drag.initialTrimIn;
        const startDelta = trimDelta / layer.playbackRate;
        onUpdateLayer(drag.layerId, {
          trimIn: newTrimIn,
          timelineStart: Math.max(0, drag.initialTimelineStart + startDelta),
        });
      } else if (drag.type === 'trimOut') {
        if (layer.loop) {
          // Extend/shorten loop duration
          const newLoopDur = Math.max(0.5, drag.initialLoopDuration + dt);
          onUpdateLayer(drag.layerId, { loopDuration: newLoopDur });
        } else {
          const newTrimOut = Math.max(layer.trimIn + 0.1, Math.min(drag.initialTrimOut + dt * layer.playbackRate, layer.mediaDuration));
          onUpdateLayer(drag.layerId, { trimOut: newTrimOut });
        }
      }
    };

    const onMouseUp = () => setDrag(null);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [drag, timelineZoom, layers, onSeek, onUpdateLayer]);

  // ---- Render clip block ----
  const renderClip = (layer: CompositorLayer) => {
    const duration = getLayerTimelineDuration(layer);
    const left = timeToPixel(layer.timelineStart, timelineZoom);
    const width = Math.max(timeToPixel(duration, timelineZoom), 4);
    const isSelected = layer.id === selectedLayerId;
    const isVideo = layer.type === 'video';
    const handleW = 6;

    // Loop cycle markers
    const loopMarkers: React.ReactNode[] = [];
    if (layer.loop) {
      const trimLen = (layer.trimOut - layer.trimIn) / layer.playbackRate;
      if (trimLen > 0 && duration > trimLen) {
        const count = Math.floor(duration / trimLen);
        for (let i = 1; i <= count; i++) {
          const mx = timeToPixel(trimLen * i, timelineZoom);
          if (mx < width - 2) {
            loopMarkers.push(
              <div key={i} className="absolute top-0 bottom-0 w-px border-l border-dashed border-white/20" style={{ left: mx }} />
            );
          }
        }
      }
    }

    return (
      <div
        key={layer.id}
        className={`absolute top-1 rounded-md overflow-hidden cursor-grab active:cursor-grabbing transition-shadow group/clip
          ${isVideo ? 'bg-violet-700/60' : 'bg-indigo-700/50'}
          ${isSelected ? 'ring-2 ring-white/80 shadow-lg' : 'hover:ring-1 hover:ring-white/30'}`}
        style={{ left, width, height: TRACK_HEIGHT - 8 }}
        onMouseDown={(e) => handleClipMouseDown(e, layer, 'move')}
      >
        {/* Clip label */}
        <div className="absolute inset-0 flex items-center px-2 overflow-hidden pointer-events-none">
          <span className="text-[9px] font-bold text-white/80 truncate select-none">
            {layer.name}
          </span>
          {layer.loop && <i className="fas fa-rotate-right text-[7px] text-white/50 ml-1" />}
        </div>

        {/* Loop cycle boundary markers */}
        {loopMarkers}

        {/* Trim-in handle (left) */}
        <div
          className="absolute left-0 top-0 bottom-0 cursor-col-resize z-10 flex items-center group/handle"
          style={{ width: handleW * 2 }}
          onMouseDown={(e) => handleClipMouseDown(e, layer, 'trimIn')}
        >
          <div className="w-1 h-4 bg-white/60 group-hover/handle:bg-white rounded-full ml-0.5" />
        </div>

        {/* Trim-out handle (right) */}
        <div
          className="absolute right-0 top-0 bottom-0 cursor-col-resize z-10 flex items-center justify-end group/handle"
          style={{ width: handleW * 2 }}
          onMouseDown={(e) => handleClipMouseDown(e, layer, 'trimOut')}
        >
          <div className="w-1 h-4 bg-white/60 group-hover/handle:bg-white rounded-full mr-0.5" />
        </div>
      </div>
    );
  };

  // ---- Playhead position ----
  const playheadX = timeToPixel(playheadTime, timelineZoom);

  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-900/80 flex flex-col" style={{ height: Math.max(RULER_HEIGHT + TRACK_HEIGHT * Math.max(layers.length, 1) + 12, 100) }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-zinc-800/50 shrink-0">
        <span className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest">Timeline</span>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-zinc-600 font-mono">{timelineZoom.toFixed(0)} px/s</span>
          <button onClick={() => onSetZoom(Math.max(MIN_PPS, timelineZoom - 5))} className="text-zinc-600 hover:text-white w-5 h-5 flex items-center justify-center">
            <i className="fas fa-minus text-[8px]" />
          </button>
          <input type="range" min={MIN_PPS} max={MAX_PPS} value={timelineZoom}
            className="w-20 accent-violet-500 h-1"
            onChange={e => onSetZoom(Number(e.target.value))} />
          <button onClick={() => onSetZoom(Math.min(MAX_PPS, timelineZoom + 5))} className="text-zinc-600 hover:text-white w-5 h-5 flex items-center justify-center">
            <i className="fas fa-plus text-[8px]" />
          </button>
        </div>
      </div>

      {/* Timeline content */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Sticky labels */}
        <div className="shrink-0 border-r border-zinc-800/50 flex flex-col" style={{ width: LABEL_WIDTH }}>
          {/* Ruler spacer */}
          <div style={{ height: RULER_HEIGHT }} className="border-b border-zinc-800/50" />
          {/* Track labels */}
          {trackLayers.map(layer => (
            <div
              key={layer.id}
              onClick={() => onSelectLayer(layer.id)}
              className={`flex items-center px-2 gap-1.5 cursor-pointer border-b border-zinc-800/30 transition-colors
                ${layer.id === selectedLayerId ? 'bg-violet-900/20' : 'hover:bg-zinc-800/30'}`}
              style={{ height: TRACK_HEIGHT }}
            >
              <i className={`fas ${layer.type === 'video' ? 'fa-film' : 'fa-image'} text-[9px] ${layer.visible ? 'text-violet-400' : 'text-zinc-700'}`} />
              <span className={`text-[10px] font-medium truncate ${layer.visible ? 'text-zinc-300' : 'text-zinc-600'}`}>
                {layer.name}
              </span>
            </div>
          ))}
        </div>

        {/* Scrollable timeline area */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden relative">
          <div className="relative" style={{ width: totalWidth, minHeight: '100%' }}>
            {/* Ruler */}
            <div
              className="relative cursor-pointer border-b border-zinc-800/50"
              style={{ height: RULER_HEIGHT }}
              onMouseDown={handleRulerMouseDown}
            >
              {renderRuler()}
            </div>

            {/* Tracks */}
            {trackLayers.map(layer => (
              <div
                key={layer.id}
                className={`relative border-b border-zinc-800/20 ${layer.id === selectedLayerId ? 'bg-violet-900/10' : ''}`}
                style={{ height: TRACK_HEIGHT }}
                onClick={() => onSelectLayer(layer.id)}
              >
                {renderClip(layer)}
              </div>
            ))}

            {/* Playhead */}
            <div
              className="absolute top-0 pointer-events-none z-20"
              style={{ left: playheadX, height: '100%' }}
            >
              {/* Playhead triangle */}
              <div className="absolute -top-0 -translate-x-1/2 w-0 h-0"
                style={{ borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '6px solid #ef4444' }} />
              {/* Playhead line */}
              <div className="w-px h-full bg-red-500/80" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompositorTimeline;
