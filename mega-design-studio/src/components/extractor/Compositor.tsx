import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useExtractor } from '@/contexts/ExtractorContext';
import { useApp } from '@/contexts/AppContext';
import { CompositorLayer, ReferenceAsset } from '@/types';
import { SkinSelector } from '@/components/shared/SkinSelector';
import { ScreenColorPicker, resolveScreenColor, hexToRgb } from '@/components/shared/ScreenColorPicker';
import { CompositorTimeline } from './CompositorTimeline';
import { formatTimeShort } from '@/utils/timelineUtils';

// Default timeline properties for new layers
const DEFAULT_TIMELINE_PROPS = {
  timelineStart: 0,
  mediaDuration: 10,
  trimIn: 0,
  trimOut: 10,
  loop: false,
  loopDuration: 10,
  playbackRate: 1,
};

// ---- Chroma key pixel processing (with spill suppression + clip) ----
function applyChromaKey(
  imageData: ImageData,
  color: string,
  tolerance: number,
  spillSuppression: number = 50,
  clipBlack: number = 0,
  clipWhite: number = 100
) {
  const resolved = resolveScreenColor(color);
  const [cr, cg, cb] = hexToRgb(resolved);
  const d = imageData.data;
  const tol = tolerance * 2.55; // 0-100 → 0-255
  const spillAmt = spillSuppression / 100; // 0-1
  const cBlack = clipBlack * 2.55; // 0-255
  const cWhite = clipWhite * 2.55; // 0-255

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const dr = r - cr;
    const dg = g - cg;
    const db = b - cb;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);

    if (dist < tol) {
      // Core keying: compute raw alpha based on distance from key color
      const rawAlpha = dist / tol; // 0 at key center → 1 at edge
      // Apply clip black/white: remap alpha range
      let alpha: number;
      if (cWhite <= cBlack) {
        alpha = rawAlpha < 0.5 ? 0 : 1;
      } else {
        const mapped = (rawAlpha * 255 - cBlack) / (cWhite - cBlack);
        alpha = Math.max(0, Math.min(1, mapped));
      }
      d[i + 3] = Math.round(d[i + 3] * alpha);

      // Spill suppression: desaturate and shift color away from key color on semi-transparent pixels
      if (spillAmt > 0 && alpha > 0 && alpha < 1) {
        const spillStrength = spillAmt * (1 - alpha); // stronger spill removal near key
        // Determine dominant channel(s) of key color and suppress spill accordingly
        const maxC = Math.max(cr, cg, cb);
        if (cg === maxC && cg > cr && cg > cb) {
          // Green-dominant: suppress green spill
          const avg = (r + b) / 2;
          d[i + 1] = Math.round(g - (g - avg) * spillStrength);
        } else if (cb === maxC && cb > cr && cb > cg) {
          // Blue-dominant: suppress blue spill
          const avg = (r + g) / 2;
          d[i + 2] = Math.round(b - (b - avg) * spillStrength);
        } else if (cr === maxC && cr > cg && cr > cb) {
          // Red-dominant: suppress red spill
          const avg = (g + b) / 2;
          d[i] = Math.round(r - (r - avg) * spillStrength);
        } else {
          // Mixed (e.g. pink/magenta): suppress both red and blue
          const target = g;
          d[i] = Math.round(r - (r - target) * spillStrength * 0.5);
          d[i + 2] = Math.round(b - (b - target) * spillStrength * 0.5);
        }
      }
    }
  }
  return imageData;
}

// ---- Resolution presets ----
const RESOLUTION_PRESETS = [
  { label: '1080p (16:9)', w: 1920, h: 1080 },
  { label: '720p (16:9)', w: 1280, h: 720 },
  { label: '1080×1920 (9:16)', w: 1080, h: 1920 },
  { label: '1080×1080 (1:1)', w: 1080, h: 1080 },
];

export const Compositor: React.FC = () => {
  const { compositorState, setCompositorState, referenceAssets } = useExtractor();
  const { assetLibrary } = useApp();

  const { layers, selectedLayerId, canvasWidth, canvasHeight, isPlaying, isExporting,
    playheadTime, compositionDuration, timelineZoom } = compositorState;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const animFrameRef = useRef<number>(0);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [dragState, setDragState] = useState<{
    layerId: string; startX: number; startY: number; startLX: number; startLY: number;
    mode: 'move' | 'scale';
  } | null>(null);

  // Master clock refs
  const playbackStartRef = useRef<number>(0);         // performance.now() when play started
  const playbackStartTimeRef = useRef<number>(0);      // playheadTime when play started

  const updateState = useCallback((updates: Partial<typeof compositorState>) => {
    setCompositorState(prev => ({ ...prev, ...updates }));
  }, [setCompositorState]);

  const updateLayer = useCallback((id: string, updates: Partial<CompositorLayer>) => {
    setCompositorState(prev => ({
      ...prev,
      layers: prev.layers.map(l => l.id === id ? { ...l, ...updates } : l),
    }));
  }, [setCompositorState]);

  // Lab assets (merged & deduplicated)
  const labAssets = useMemo(() => {
    const seen = new Set(referenceAssets.map(a => a.id));
    const globalOnly = assetLibrary.filter(a => !seen.has(a.id));
    return [...referenceAssets, ...globalOnly];
  }, [referenceAssets, assetLibrary]);

  const selectedLayer = layers.find(l => l.id === selectedLayerId) || null;

  // ---- Timeline helpers ----
  /** Get the duration a layer occupies on the timeline */
  const getLayerTimelineDuration = useCallback((layer: CompositorLayer): number => {
    if (layer.loop) return layer.loopDuration;
    return (layer.trimOut - layer.trimIn) / layer.playbackRate;
  }, []);

  /** Given a composition time, compute the source media time for a layer and whether it's visible */
  const getLayerMediaTime = useCallback((layer: CompositorLayer, compTime: number): { visible: boolean; mediaTime: number } => {
    const layerDur = getLayerTimelineDuration(layer);
    const relTime = compTime - layer.timelineStart;
    if (relTime < 0 || relTime >= layerDur) return { visible: false, mediaTime: 0 };

    const trimLen = layer.trimOut - layer.trimIn;
    if (layer.loop && trimLen > 0) {
      // Within the loop: wrap with modulo
      const scaledTime = relTime * layer.playbackRate;
      const looped = scaledTime % trimLen;
      return { visible: true, mediaTime: layer.trimIn + looped };
    }
    // Non-looping: linear mapping
    return { visible: true, mediaTime: layer.trimIn + relTime * layer.playbackRate };
  }, [getLayerTimelineDuration]);

  /** Auto-compute composition duration from all layers */
  const computedDuration = useMemo(() => {
    if (layers.length === 0) return 10;
    let maxEnd = 0;
    for (const l of layers) {
      const end = l.timelineStart + getLayerTimelineDuration(l);
      if (end > maxEnd) maxEnd = end;
    }
    return Math.max(maxEnd, 1);
  }, [layers, getLayerTimelineDuration]);

  // Keep compositionDuration in sync
  useEffect(() => {
    if (Math.abs(computedDuration - compositionDuration) > 0.01) {
      updateState({ compositionDuration: computedDuration });
    }
  }, [computedDuration]);

  // ---- Canvas scale factor (fit canvas into the viewport) ----
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const [viewScale, setViewScale] = useState(1);
  const [expandedOpacity, setExpandedOpacity] = useState<string | null>(null);

  useEffect(() => {
    const el = canvasWrapperRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const sx = (rect.width - 16) / canvasWidth;
      const sy = (rect.height - 16) / canvasHeight;
      setViewScale(Math.min(sx, sy, 1));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasWidth, canvasHeight]);

  // ---- Load video/image elements for each layer ----
  useEffect(() => {
    const current = videoRefs.current;
    layers.forEach(layer => {
      if (layer.type === 'video' && !current.has(layer.id)) {
        const vid = document.createElement('video');
        vid.src = layer.src;
        vid.crossOrigin = 'anonymous';
        vid.loop = false; // Timeline manages looping
        vid.muted = true;
        vid.playsInline = true;
        vid.preload = 'auto';
        vid.load();
        current.set(layer.id, vid);
      }
    });
    // Clean up removed layers
    current.forEach((_, id) => {
      if (!layers.find(l => l.id === id)) {
        const v = current.get(id);
        if (v) { v.pause(); v.src = ''; }
        current.delete(id);
      }
    });
  }, [layers]);

  // ---- Master clock: play/pause management ----
  useEffect(() => {
    if (isPlaying) {
      playbackStartRef.current = performance.now();
      playbackStartTimeRef.current = playheadTime;
      // Start all video elements (they'll be seeked in render loop)
      videoRefs.current.forEach((vid) => {
        vid.play().catch(() => {});
      });
    } else {
      videoRefs.current.forEach((vid) => {
        vid.pause();
      });
    }
  }, [isPlaying]);

  // ---- Image cache for image layers ----
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  useEffect(() => {
    layers.forEach(layer => {
      if (layer.type === 'image' && !imageCache.current.has(layer.id)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = layer.src;
        imageCache.current.set(layer.id, img);
      }
    });
    // Clean removed
    imageCache.current.forEach((_, id) => {
      if (!layers.find(l => l.id === id)) imageCache.current.delete(id);
    });
  }, [layers]);

  // ---- Render loop (master clock driven) ----
  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Master clock: advance playhead if playing
    let currentTime = playheadTime;
    if (isPlaying) {
      const elapsed = (performance.now() - playbackStartRef.current) / 1000;
      currentTime = playbackStartTimeRef.current + elapsed;
      if (currentTime >= computedDuration) {
        currentTime = 0; // loop the composition
        playbackStartRef.current = performance.now();
        playbackStartTimeRef.current = 0;
      }
      // Update state (throttled — only update ref, batch to state less often)
      updateState({ playheadTime: currentTime });
    }

    // Create offscreen canvas for chroma key processing
    if (!offscreenRef.current) {
      offscreenRef.current = document.createElement('canvas');
    }
    const offscreen = offscreenRef.current;

    // Clear
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Draw layers bottom to top (index 0 = bottom)
    for (const layer of layers) {
      if (!layer.visible) continue;

      // Timeline visibility check
      const { visible: timeVisible, mediaTime } = getLayerMediaTime(layer, currentTime);
      if (!timeVisible) continue;

      let source: HTMLVideoElement | HTMLImageElement | null = null;
      let srcW = 0, srcH = 0;

      if (layer.type === 'video') {
        const vid = videoRefs.current.get(layer.id);
        if (vid && vid.readyState >= 2) {
          // Seek video to correct media time if drifted
          const drift = Math.abs(vid.currentTime - mediaTime);
          if (drift > 0.15) {
            vid.currentTime = mediaTime;
          }
          source = vid;
          srcW = vid.videoWidth;
          srcH = vid.videoHeight;
        }
      } else {
        const img = imageCache.current.get(layer.id);
        if (img && img.complete && img.naturalWidth > 0) {
          source = img;
          srcW = img.naturalWidth;
          srcH = img.naturalHeight;
        }
      }

      if (!source || srcW === 0) continue;

      const drawW = srcW * layer.scaleX;
      const drawH = srcH * layer.scaleY;

      ctx.save();
      ctx.globalAlpha = layer.opacity;

      if (layer.chromaKey.enabled) {
        // Draw to offscreen, apply chroma, then draw to main
        offscreen.width = srcW;
        offscreen.height = srcH;
        const octx = offscreen.getContext('2d');
        if (octx) {
          octx.clearRect(0, 0, srcW, srcH);
          octx.drawImage(source, 0, 0, srcW, srcH);
          const imgData = octx.getImageData(0, 0, srcW, srcH);
          applyChromaKey(imgData, layer.chromaKey.color, layer.chromaKey.tolerance, layer.chromaKey.spillSuppression, layer.chromaKey.clipBlack, layer.chromaKey.clipWhite);
          octx.putImageData(imgData, 0, 0);
          ctx.drawImage(offscreen, 0, 0, srcW, srcH, layer.x, layer.y, drawW, drawH);
        }
      } else {
        ctx.drawImage(source, layer.x, layer.y, drawW, drawH);
      }

      ctx.restore();
    }

    // Draw selection handles on top
    if (selectedLayer && selectedLayer.visible) {
      const sl = selectedLayer;
      let srcW = 0, srcH = 0;
      if (sl.type === 'video') {
        const vid = videoRefs.current.get(sl.id);
        if (vid) { srcW = vid.videoWidth; srcH = vid.videoHeight; }
      } else {
        const img = imageCache.current.get(sl.id);
        if (img) { srcW = img.naturalWidth; srcH = img.naturalHeight; }
      }
      if (srcW > 0) {
        const dw = srcW * sl.scaleX;
        const dh = srcH * sl.scaleY;
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2 / viewScale;
        ctx.setLineDash([6 / viewScale, 4 / viewScale]);
        ctx.strokeRect(sl.x, sl.y, dw, dh);
        ctx.setLineDash([]);

        // Scale handle (bottom-right)
        const hs = 10 / viewScale;
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(sl.x + dw - hs / 2, sl.y + dh - hs / 2, hs, hs);
      }
    }

    animFrameRef.current = requestAnimationFrame(renderFrame);
  }, [layers, selectedLayer, canvasWidth, canvasHeight, viewScale, isPlaying, playheadTime, computedDuration, getLayerMediaTime]);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [renderFrame]);

  // ---- Mouse interaction on canvas ----
  const canvasToWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { wx: 0, wy: 0 };
    const rect = canvas.getBoundingClientRect();
    const wx = (clientX - rect.left) / viewScale;
    const wy = (clientY - rect.top) / viewScale;
    return { wx, wy };
  };

  const hitTest = (wx: number, wy: number): CompositorLayer | null => {
    // Test from top layer to bottom (reverse)
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible || l.locked) continue;
      let srcW = 0, srcH = 0;
      if (l.type === 'video') {
        const vid = videoRefs.current.get(l.id);
        if (vid) { srcW = vid.videoWidth; srcH = vid.videoHeight; }
      } else {
        const img = imageCache.current.get(l.id);
        if (img) { srcW = img.naturalWidth; srcH = img.naturalHeight; }
      }
      const dw = srcW * l.scaleX;
      const dh = srcH * l.scaleY;
      if (wx >= l.x && wx <= l.x + dw && wy >= l.y && wy <= l.y + dh) {
        return l;
      }
    }
    return null;
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const { wx, wy } = canvasToWorld(e.clientX, e.clientY);

    // Check if clicking scale handle of selected layer
    if (selectedLayer && !selectedLayer.locked) {
      let srcW = 0, srcH = 0;
      if (selectedLayer.type === 'video') {
        const vid = videoRefs.current.get(selectedLayer.id);
        if (vid) { srcW = vid.videoWidth; srcH = vid.videoHeight; }
      } else {
        const img = imageCache.current.get(selectedLayer.id);
        if (img) { srcW = img.naturalWidth; srcH = img.naturalHeight; }
      }
      const dw = srcW * selectedLayer.scaleX;
      const dh = srcH * selectedLayer.scaleY;
      const hs = 14 / viewScale;
      const hx = selectedLayer.x + dw;
      const hy = selectedLayer.y + dh;
      if (Math.abs(wx - hx) < hs && Math.abs(wy - hy) < hs) {
        setDragState({ layerId: selectedLayer.id, startX: e.clientX, startY: e.clientY, startLX: selectedLayer.scaleX, startLY: selectedLayer.scaleY, mode: 'scale' });
        return;
      }
    }

    const hit = hitTest(wx, wy);
    if (hit) {
      updateState({ selectedLayerId: hit.id });
      setDragState({ layerId: hit.id, startX: e.clientX, startY: e.clientY, startLX: hit.x, startLY: hit.y, mode: 'move' });
    } else {
      updateState({ selectedLayerId: null });
    }
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragState) return;
      const dx = (e.clientX - dragState.startX) / viewScale;
      const dy = (e.clientY - dragState.startY) / viewScale;

      if (dragState.mode === 'move') {
        updateLayer(dragState.layerId, { x: dragState.startLX + dx, y: dragState.startLY + dy });
      } else {
        // Scale mode: use drag distance to compute scale factor
        const layer = layers.find(l => l.id === dragState.layerId);
        if (!layer) return;
        let srcW = 0, srcH = 0;
        if (layer.type === 'video') {
          const vid = videoRefs.current.get(layer.id);
          if (vid) { srcW = vid.videoWidth; srcH = vid.videoHeight; }
        } else {
          const img = imageCache.current.get(layer.id);
          if (img) { srcW = img.naturalWidth; srcH = img.naturalHeight; }
        }
        if (srcW > 0) {
          const origW = srcW * dragState.startLX;
          const newScale = Math.max(0.05, dragState.startLX + dx / srcW);
          // Uniform scale
          const ratio = newScale / dragState.startLX;
          updateLayer(dragState.layerId, { scaleX: newScale, scaleY: dragState.startLY * ratio });
        }
      }
    };
    const onMouseUp = () => setDragState(null);
    if (dragState) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragState, viewScale, layers, updateLayer]);

  // ---- Add layer from asset ----
  const addLayerFromAsset = (asset: ReferenceAsset) => {
    const isVideo = asset.mediaType === 'video' || asset.url.includes('.mp4') || asset.url.includes('.webm');
    const layerId = crypto.randomUUID();

    if (isVideo) {
      // Probe video dimensions and auto-fit to canvas width
      const vid = document.createElement('video');
      vid.preload = 'metadata';
      vid.onloadedmetadata = () => {
        const vw = vid.videoWidth || 1920;
        const vh = vid.videoHeight || 1080;
        const dur = vid.duration && isFinite(vid.duration) ? vid.duration : 10;
        const s = canvasWidth / vw;
        const newLayer: CompositorLayer = {
          id: layerId, type: 'video', name: asset.name || asset.type, src: asset.url,
          x: 0, y: (canvasHeight - vh * s) / 2,
          scaleX: s, scaleY: s, opacity: 1,
          chromaKey: { enabled: false, color: '#00fa15', tolerance: 40, spillSuppression: 50, clipBlack: 0, clipWhite: 100 },
          visible: true, locked: false,
          timelineStart: 0, mediaDuration: dur, trimIn: 0, trimOut: dur,
          loop: false, loopDuration: dur, playbackRate: 1,
        };
        updateState({ layers: [...layers, newLayer], selectedLayerId: layerId });
        setShowAssetPicker(false);
      };
      vid.onerror = () => {
        const s = canvasWidth / 1920;
        const newLayer: CompositorLayer = {
          id: layerId, type: 'video', name: asset.name || asset.type, src: asset.url,
          x: 0, y: 0, scaleX: s, scaleY: s, opacity: 1,
          chromaKey: { enabled: false, color: '#00fa15', tolerance: 40, spillSuppression: 50, clipBlack: 0, clipWhite: 100 },
          visible: true, locked: false,
          ...DEFAULT_TIMELINE_PROPS,
        };
        updateState({ layers: [...layers, newLayer], selectedLayerId: layerId });
        setShowAssetPicker(false);
      };
      vid.src = asset.url;
    } else {
      const newLayer: CompositorLayer = {
        id: layerId, type: 'image', name: asset.name || asset.type, src: asset.url,
        x: 0, y: 0,
        scaleX: canvasWidth / 1920, scaleY: canvasWidth / 1920, opacity: 1,
        chromaKey: { enabled: false, color: '#00fa15', tolerance: 40, spillSuppression: 50, clipBlack: 0, clipWhite: 100 },
        visible: true, locked: false,
        ...DEFAULT_TIMELINE_PROPS,
      };
      updateState({ layers: [...layers, newLayer], selectedLayerId: layerId });
      setShowAssetPicker(false);
    }
  };

  // ---- Add layer from file upload ----
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.startsWith('video/');
    const url = URL.createObjectURL(file);
    const layerId = crypto.randomUUID();

    if (isVideo) {
      // Probe video dimensions, then scale uniformly to fill canvas width
      const vid = document.createElement('video');
      vid.preload = 'metadata';
      vid.onloadedmetadata = () => {
        const vw = vid.videoWidth || 1920;
        const vh = vid.videoHeight || 1080;
        const dur = vid.duration && isFinite(vid.duration) ? vid.duration : 10;
        const s = canvasWidth / vw; // uniform scale to fill width
        const newLayer: CompositorLayer = {
          id: layerId, type: 'video', name: file.name, src: url,
          x: 0, y: (canvasHeight - vh * s) / 2, // center vertically
          scaleX: s, scaleY: s, opacity: 1,
          chromaKey: { enabled: false, color: '#00fa15', tolerance: 40, spillSuppression: 50, clipBlack: 0, clipWhite: 100 },
          visible: true, locked: false,
          timelineStart: 0, mediaDuration: dur, trimIn: 0, trimOut: dur,
          loop: false, loopDuration: dur, playbackRate: 1,
        };
        updateState({ layers: [...layers, newLayer], selectedLayerId: layerId });
      };
      vid.onerror = () => {
        // Fallback if metadata fails
        const newLayer: CompositorLayer = {
          id: layerId, type: 'video', name: file.name, src: url,
          x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1,
          chromaKey: { enabled: false, color: '#00fa15', tolerance: 40, spillSuppression: 50, clipBlack: 0, clipWhite: 100 },
          visible: true, locked: false,
          ...DEFAULT_TIMELINE_PROPS,
        };
        updateState({ layers: [...layers, newLayer], selectedLayerId: layerId });
      };
      vid.src = url;
    } else {
      const newLayer: CompositorLayer = {
        id: layerId, type: 'image', name: file.name, src: url,
        x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1,
        chromaKey: { enabled: false, color: '#00fa15', tolerance: 40, spillSuppression: 50, clipBlack: 0, clipWhite: 100 },
        visible: true, locked: false,
        ...DEFAULT_TIMELINE_PROPS,
      };
      updateState({ layers: [...layers, newLayer], selectedLayerId: layerId });
    }
  };

  // ---- Layer management ----
  const removeLayer = (id: string) => {
    const vid = videoRefs.current.get(id);
    if (vid) { vid.pause(); vid.src = ''; videoRefs.current.delete(id); }
    imageCache.current.delete(id);
    updateState({
      layers: layers.filter(l => l.id !== id),
      selectedLayerId: selectedLayerId === id ? null : selectedLayerId,
    });
  };

  const moveLayer = (id: string, direction: 'up' | 'down') => {
    const idx = layers.findIndex(l => l.id === id);
    if (idx < 0) return;
    const newLayers = [...layers];
    const swap = direction === 'up' ? idx + 1 : idx - 1;
    if (swap < 0 || swap >= newLayers.length) return;
    [newLayers[idx], newLayers[swap]] = [newLayers[swap], newLayers[idx]];
    updateState({ layers: newLayers });
  };

  // Fit layer to canvas
  const fitLayerToCanvas = (id: string) => {
    const layer = layers.find(l => l.id === id);
    if (!layer) return;
    let srcW = 0, srcH = 0;
    if (layer.type === 'video') {
      const vid = videoRefs.current.get(layer.id);
      if (vid) { srcW = vid.videoWidth; srcH = vid.videoHeight; }
    } else {
      const img = imageCache.current.get(layer.id);
      if (img) { srcW = img.naturalWidth; srcH = img.naturalHeight; }
    }
    if (srcW > 0 && srcH > 0) {
      const sx = canvasWidth / srcW;
      const sy = canvasHeight / srcH;
      // Cover: use max scale to fill canvas
      const s = Math.max(sx, sy);
      updateLayer(id, { x: (canvasWidth - srcW * s) / 2, y: (canvasHeight - srcH * s) / 2, scaleX: s, scaleY: s });
    }
  };

  // ---- Export ----
  const handleExport = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    updateState({ isExporting: true });

    // Determine if any video layers
    const hasVideo = layers.some(l => l.type === 'video' && l.visible);

    if (!hasVideo) {
      // Static image export
      canvas.toBlob(blob => {
        if (blob) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'composite.png';
          a.click();
          URL.revokeObjectURL(a.href);
        }
        updateState({ isExporting: false });
      }, 'image/png');
      return;
    }

    // Video export via MediaRecorder — uses composition duration from timeline
    try {
      const exportDuration = computedDuration;

      // Reset playhead to 0 and start playback (master clock drives seeking)
      playbackStartRef.current = performance.now();
      playbackStartTimeRef.current = 0;
      updateState({ playheadTime: 0, isPlaying: true });

      // Start all video elements
      videoRefs.current.forEach((vid) => {
        vid.play().catch(() => {});
      });

      const stream = canvas.captureStream(30);
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 8_000_000,
      });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'composite.webm';
        a.click();
        URL.revokeObjectURL(a.href);
        updateState({ isExporting: false, isPlaying: false });
      };

      mediaRecorder.start();

      // Stop after composition duration
      setTimeout(() => {
        mediaRecorder.stop();
        videoRefs.current.forEach((vid) => vid.pause());
      }, exportDuration * 1000);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Video export failed. Try Chrome for best WebM support.');
      updateState({ isExporting: false });
    }
  };

  // ---- Toggle play/pause ----
  const togglePlay = () => {
    if (!isPlaying) {
      playbackStartRef.current = performance.now();
      playbackStartTimeRef.current = playheadTime;
    }
    updateState({ isPlaying: !isPlaying });
  };

  // ---- Reset all video playback ----
  const resetPlayback = () => {
    videoRefs.current.forEach(vid => { vid.currentTime = 0; vid.pause(); });
    updateState({ isPlaying: false, playheadTime: 0 });
  };

  // ---- Seek to time (from timeline scrub) ----
  const handleSeek = useCallback((time: number) => {
    const clamped = Math.max(0, Math.min(time, computedDuration));
    playbackStartRef.current = performance.now();
    playbackStartTimeRef.current = clamped;
    updateState({ playheadTime: clamped });
    // Seek all videos to their correct positions
    layers.forEach(layer => {
      if (layer.type === 'video') {
        const vid = videoRefs.current.get(layer.id);
        if (vid) {
          const { visible, mediaTime } = getLayerMediaTime(layer, clamped);
          if (visible) vid.currentTime = mediaTime;
        }
      }
    });
  }, [computedDuration, layers, getLayerMediaTime]);

  // ---- Duplicate layer ----
  const duplicateLayer = useCallback((id: string) => {
    const layer = layers.find(l => l.id === id);
    if (!layer) return;
    const newId = crypto.randomUUID();
    const clone: CompositorLayer = {
      ...layer,
      id: newId,
      name: layer.name + ' (copy)',
      timelineStart: layer.timelineStart + getLayerTimelineDuration(layer),
    };
    updateState({ layers: [...layers, clone], selectedLayerId: newId });
  }, [layers, getLayerTimelineDuration]);

  return (
    <div className="h-full flex flex-col overflow-hidden animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 shrink-0 bg-zinc-900/30">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-black uppercase tracking-widest text-white flex items-center gap-2">
            <i className="fas fa-layer-group text-violet-500" /> Compositor
          </h1>
          <span className="text-[10px] text-zinc-500 font-mono">{canvasWidth}×{canvasHeight}</span>
          <span className="text-[10px] text-zinc-600 font-mono">{formatTimeShort(playheadTime)} / {formatTimeShort(computedDuration)}</span>
        </div>
        <div className="flex items-center gap-2">
          <SkinSelector type="slots" />
          {/* Resolution preset */}
          <div className="flex gap-1">
            {RESOLUTION_PRESETS.map(p => {
              const isActive = canvasWidth === p.w && canvasHeight === p.h;
              const visW = p.w > p.h ? 18 : p.w === p.h ? 14 : 10;
              const visH = p.h > p.w ? 18 : p.h === p.w ? 14 : 10;
              return (
                <button
                  key={p.label}
                  onClick={() => updateState({ canvasWidth: p.w, canvasHeight: p.h })}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-all ${
                    isActive
                      ? 'bg-cyan-600/20 border-cyan-600/50 text-cyan-400'
                      : 'border-zinc-700/60 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
                  }`}
                  title={p.label}
                >
                  <div
                    className={`rounded-[2px] border ${isActive ? 'border-cyan-500/60 bg-cyan-500/20' : 'border-zinc-600/60 bg-zinc-700/30'}`}
                    style={{ width: visW * 0.65, height: visH * 0.65 }}
                  />
                  <span className="text-[9px] font-bold">{p.label.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>
          {/* Playback controls */}
          <button onClick={resetPlayback} className="text-zinc-500 hover:text-white w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-800 transition-colors" title="Reset">
            <i className="fas fa-backward-step text-xs" />
          </button>
          <button onClick={togglePlay} className="bg-violet-600 hover:bg-violet-500 text-white w-8 h-8 flex items-center justify-center rounded-lg transition-colors shadow" title={isPlaying ? 'Pause' : 'Play'}>
            <i className={`fas ${isPlaying ? 'fa-pause' : 'fa-play'} text-xs`} />
          </button>
          {/* Export */}
          <button onClick={handleExport} disabled={isExporting || layers.length === 0}
            className="bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-colors disabled:opacity-40 flex items-center gap-1.5 shadow-lg">
            {isExporting ? <><i className="fas fa-spinner animate-spin" /> Exporting...</> : <><i className="fas fa-download" /> Export</>}
          </button>
        </div>
      </div>

      {/* Main content: Canvas + Layer panel (top), Timeline (bottom) */}
      <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top: Canvas + Sidebar */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Canvas area */}
        <div ref={canvasWrapperRef} className="flex-1 flex items-center justify-center bg-zinc-950 overflow-hidden p-2 relative">
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            className="border border-zinc-700 shadow-2xl cursor-crosshair"
            style={{ width: canvasWidth * viewScale, height: canvasHeight * viewScale }}
            onMouseDown={handleCanvasMouseDown}
          />
          {layers.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-3">
              <i className="fas fa-layer-group text-5xl text-zinc-800" />
              <span className="text-zinc-600 text-sm">Add layers from the panel on the right</span>
            </div>
          )}
        </div>

        {/* Right panel: Layers + Properties */}
        <div className="w-80 border-l border-zinc-800 flex flex-col bg-zinc-900/50 shrink-0 overflow-hidden">
          {/* Add layer buttons */}
          <div className="p-3 border-b border-zinc-800 flex gap-2">
            <button onClick={() => setShowAssetPicker(true)} disabled={labAssets.length === 0}
              className="flex-1 bg-violet-600/20 hover:bg-violet-600 border border-violet-500/30 text-violet-200 hover:text-white px-3 py-2 rounded-lg text-[10px] font-bold uppercase transition-colors flex items-center justify-center gap-1.5 disabled:opacity-30">
              <i className="fas fa-folder-open" /> From Assets
            </button>
            <label className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 px-3 py-2 rounded-lg text-[10px] font-bold uppercase transition-colors flex items-center justify-center gap-1.5 cursor-pointer">
              <i className="fas fa-upload" /> Upload
              <input type="file" accept="image/*,video/*" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>

          {/* Layer list */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-2 text-[9px] font-bold text-zinc-600 uppercase tracking-widest px-3">
              Layers ({layers.length}) — bottom to top
            </div>
            {layers.length === 0 ? (
              <div className="p-6 text-center text-zinc-600 text-xs">
                No layers yet.<br />Add videos or images.
              </div>
            ) : (
              <div className="flex flex-col-reverse gap-0 px-2 pb-2">
                {layers.map((layer, idx) => {
                  const isSelected = selectedLayerId === layer.id;
                  const showOpacity = expandedOpacity === layer.id;
                  return (
                    <div key={layer.id}>
                      <div
                        onClick={() => updateState({ selectedLayerId: isSelected ? null : layer.id })}
                        className={`flex items-center gap-2 px-2 py-1.5 cursor-pointer border-b border-zinc-800/50 transition-colors ${
                          isSelected ? 'bg-violet-600/15' : 'hover:bg-zinc-800/50'
                        }`}
                      >
                        {/* Thumbnail */}
                        <div className="w-8 h-8 rounded shrink-0 flex items-center justify-center border border-zinc-700/40 overflow-hidden bg-zinc-800">
                          {layer.type === 'video' ? (
                            <i className="fas fa-film text-[10px] text-violet-400" />
                          ) : layer.src ? (
                            <img src={layer.src} alt="" className="w-full h-full object-cover rounded" />
                          ) : (
                            <i className="fas fa-image text-[8px] text-zinc-500" />
                          )}
                        </div>

                        {/* Name */}
                        <span className={`flex-1 truncate text-[11px] font-medium ${isSelected ? 'text-violet-300' : layer.visible ? 'text-zinc-200' : 'text-zinc-600 line-through'}`}>
                          {layer.name}
                        </span>
                        {layer.chromaKey.enabled && <span className="text-[8px] px-1.5 py-0.5 rounded-full font-bold text-black" style={{ backgroundColor: layer.chromaKey.color === 'green' ? '#00fa15' : layer.chromaKey.color === 'blue' ? '#0072ff' : '#ff4dfd' }}>CK</span>}

                        {/* Controls */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'up'); }} className="text-zinc-600 hover:text-white w-5 h-5 flex items-center justify-center transition-colors" title="Move up">
                            <i className="fas fa-chevron-up text-[8px]" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); moveLayer(layer.id, 'down'); }} className="text-zinc-600 hover:text-white w-5 h-5 flex items-center justify-center transition-colors" title="Move down">
                            <i className="fas fa-chevron-down text-[8px]" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setExpandedOpacity(showOpacity ? null : layer.id); }}
                            className={`w-5 h-5 flex items-center justify-center transition-colors ${showOpacity ? 'text-violet-400' : 'text-zinc-600 hover:text-zinc-400'}`}
                            title={`Opacity ${Math.round(layer.opacity * 100)}%`}
                          >
                            <i className="fas fa-circle-half-stroke text-[8px]" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }}
                            className={`w-5 h-5 flex items-center justify-center transition-colors ${layer.visible ? 'text-zinc-400 hover:text-white' : 'text-zinc-700'}`} title="Toggle visibility">
                            <i className={`fas ${layer.visible ? 'fa-eye' : 'fa-eye-slash'} text-[8px]`} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { locked: !layer.locked }); }}
                            className={`w-5 h-5 flex items-center justify-center transition-colors ${layer.locked ? 'text-amber-400' : 'text-zinc-600 hover:text-amber-400'}`} title={layer.locked ? 'Unlock' : 'Lock'}>
                            <i className={`fas ${layer.locked ? 'fa-lock' : 'fa-lock-open'} text-[8px]`} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); duplicateLayer(layer.id); }} className="text-zinc-700 hover:text-zinc-400 w-5 h-5 flex items-center justify-center transition-colors" title="Duplicate">
                            <i className="fas fa-clone text-[8px]" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); removeLayer(layer.id); }} className="text-zinc-700 hover:text-red-400 w-5 h-5 flex items-center justify-center transition-colors" title="Remove">
                            <i className="fas fa-trash text-[8px]" />
                          </button>
                        </div>
                      </div>

                      {/* Inline opacity slider */}
                      {showOpacity && (
                        <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800/60 border-b border-zinc-800/50">
                          <span className="text-[9px] text-zinc-500 w-5 shrink-0">Op</span>
                          <input
                            type="range"
                            min={0} max={100} step={1}
                            value={Math.round(layer.opacity * 100)}
                            onChange={e => updateLayer(layer.id, { opacity: Number(e.target.value) / 100 })}
                            className="flex-1 accent-violet-500 h-1"
                          />
                          <span className="text-[9px] text-zinc-400 w-7 text-right">{Math.round(layer.opacity * 100)}%</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected layer properties */}
          {selectedLayer && (
            <div className="border-t border-zinc-800 p-3 flex flex-col gap-3 shrink-0 max-h-[45%] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Properties</h4>
                <button onClick={() => fitLayerToCanvas(selectedLayer.id)} className="text-[9px] text-zinc-500 hover:text-violet-400 uppercase font-bold transition-colors">
                  <i className="fas fa-expand mr-1" />Fit to Canvas
                </button>
              </div>

              {/* Name */}
              <input type="text" className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white focus:border-violet-500 outline-none w-full"
                value={selectedLayer.name} onChange={e => updateLayer(selectedLayer.id, { name: e.target.value })} />

              {/* Position */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] text-zinc-600 font-bold uppercase">X</label>
                  <input type="number" className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-white focus:border-violet-500 outline-none"
                    value={Math.round(selectedLayer.x)} onChange={e => updateLayer(selectedLayer.id, { x: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="text-[9px] text-zinc-600 font-bold uppercase">Y</label>
                  <input type="number" className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-white focus:border-violet-500 outline-none"
                    value={Math.round(selectedLayer.y)} onChange={e => updateLayer(selectedLayer.id, { y: Number(e.target.value) })} />
                </div>
              </div>

              {/* Scale */}
              <div>
                <label className="text-[9px] text-zinc-600 font-bold uppercase">Scale ({Math.round(selectedLayer.scaleX * 100)}%)</label>
                <input type="range" min="5" max="300" value={Math.round(selectedLayer.scaleX * 100)}
                  className="w-full accent-violet-500 h-1"
                  onChange={e => {
                    const s = Number(e.target.value) / 100;
                    updateLayer(selectedLayer.id, { scaleX: s, scaleY: s });
                  }} />
              </div>

              {/* Timeline: Loop + Speed */}
              <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[9px] text-zinc-500 font-bold uppercase">Timeline</label>
                </div>
                <div className="flex flex-col gap-2">
                  {/* Loop toggle */}
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] text-zinc-600 font-bold uppercase">Loop</label>
                    <button
                      onClick={() => updateLayer(selectedLayer.id, { loop: !selectedLayer.loop })}
                      className={`w-8 h-4 rounded-full transition-colors relative ${selectedLayer.loop ? 'bg-violet-600' : 'bg-zinc-700'}`}
                    >
                      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${selectedLayer.loop ? 'left-4' : 'left-0.5'}`} />
                    </button>
                  </div>
                  {/* Speed slider */}
                  <div>
                    <label className="text-[9px] text-zinc-600 font-bold uppercase">Speed ({selectedLayer.playbackRate.toFixed(2)}x)</label>
                    <input type="range" min="25" max="400" value={Math.round(selectedLayer.playbackRate * 100)}
                      className="w-full accent-violet-500 h-1"
                      onChange={e => updateLayer(selectedLayer.id, { playbackRate: Number(e.target.value) / 100 })} />
                  </div>
                  {/* Timeline start */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] text-zinc-600 font-bold uppercase">Start ({selectedLayer.timelineStart.toFixed(1)}s)</label>
                      <input type="range" min="0" max={Math.max(computedDuration * 100, 3000)} value={Math.round(selectedLayer.timelineStart * 100)}
                        className="w-full accent-indigo-500 h-1"
                        onChange={e => updateLayer(selectedLayer.id, { timelineStart: Number(e.target.value) / 100 })} />
                    </div>
                    <div>
                      <label className="text-[9px] text-zinc-600 font-bold uppercase">Duration ({getLayerTimelineDuration(selectedLayer).toFixed(1)}s)</label>
                      <span className="text-[10px] text-zinc-400 block mt-0.5">{formatTimeShort(selectedLayer.trimIn)} – {formatTimeShort(selectedLayer.trimOut)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Chroma Key */}
              <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[9px] text-zinc-500 font-bold uppercase">Chroma Key</label>
                  <button
                    onClick={() => updateLayer(selectedLayer.id, { chromaKey: { ...selectedLayer.chromaKey, enabled: !selectedLayer.chromaKey.enabled } })}
                    className={`w-8 h-4 rounded-full transition-colors relative ${selectedLayer.chromaKey.enabled ? 'bg-violet-600' : 'bg-zinc-700'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${selectedLayer.chromaKey.enabled ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </div>

                {selectedLayer.chromaKey.enabled && (
                  <div className="flex flex-col gap-2">
                    <div className="mb-1">
                      <ScreenColorPicker
                        value={selectedLayer.chromaKey.color}
                        onChange={hex => updateLayer(selectedLayer.id, { chromaKey: { ...selectedLayer.chromaKey, color: hex } })}
                        size="sm"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-zinc-600 font-bold uppercase">Screen Gain / Tolerance ({selectedLayer.chromaKey.tolerance})</label>
                      <input type="range" min="5" max="100" value={selectedLayer.chromaKey.tolerance}
                        className="w-full accent-violet-500 h-1"
                        onChange={e => updateLayer(selectedLayer.id, { chromaKey: { ...selectedLayer.chromaKey, tolerance: Number(e.target.value) } })} />
                    </div>
                    <div>
                      <label className="text-[9px] text-zinc-600 font-bold uppercase">Spill Suppression ({selectedLayer.chromaKey.spillSuppression})</label>
                      <input type="range" min="0" max="100" value={selectedLayer.chromaKey.spillSuppression}
                        className="w-full accent-emerald-500 h-1"
                        onChange={e => updateLayer(selectedLayer.id, { chromaKey: { ...selectedLayer.chromaKey, spillSuppression: Number(e.target.value) } })} />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] text-zinc-600 font-bold uppercase">Clip Black ({selectedLayer.chromaKey.clipBlack})</label>
                        <input type="range" min="0" max="100" value={selectedLayer.chromaKey.clipBlack}
                          className="w-full accent-zinc-400 h-1"
                          onChange={e => updateLayer(selectedLayer.id, { chromaKey: { ...selectedLayer.chromaKey, clipBlack: Number(e.target.value) } })} />
                      </div>
                      <div>
                        <label className="text-[9px] text-zinc-600 font-bold uppercase">Clip White ({selectedLayer.chromaKey.clipWhite})</label>
                        <input type="range" min="0" max="100" value={selectedLayer.chromaKey.clipWhite}
                          className="w-full accent-zinc-100 h-1"
                          onChange={e => updateLayer(selectedLayer.id, { chromaKey: { ...selectedLayer.chromaKey, clipWhite: Number(e.target.value) } })} />
                      </div>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </div>

      {/* Bottom: Timeline Panel */}
      <CompositorTimeline
        layers={layers}
        playheadTime={playheadTime}
        selectedLayerId={selectedLayerId}
        timelineZoom={timelineZoom}
        compositionDuration={computedDuration}
        onSeek={handleSeek}
        onUpdateLayer={updateLayer}
        onSelectLayer={(id) => updateState({ selectedLayerId: id })}
        onSetZoom={(z) => updateState({ timelineZoom: z })}
        getLayerTimelineDuration={getLayerTimelineDuration}
      />
      </div>

      {/* Asset Picker Modal */}
      {showAssetPicker && (
        <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-6 backdrop-blur-sm" onClick={() => setShowAssetPicker(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-3xl w-full max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-zinc-800">
              <h3 className="text-lg font-black uppercase tracking-widest text-white flex items-center gap-2">
                <i className="fas fa-folder-open text-violet-500" /> Add Layer from Assets
              </h3>
              <button onClick={() => setShowAssetPicker(false)} className="text-zinc-500 hover:text-white"><i className="fas fa-times" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {labAssets.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">No assets available. Generate some in the other studios first.</div>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                  {labAssets.map(asset => {
                    const isVid = asset.mediaType === 'video';
                    return (
                      <button key={asset.id} onClick={() => addLayerFromAsset(asset)}
                        className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden hover:border-violet-500 transition-all group">
                        <div className="aspect-square bg-black p-2 flex items-center justify-center relative">
                          {isVid ? (
                            <>
                              <video src={asset.url} className="max-w-full max-h-full object-contain" muted preload="metadata" />
                              <div className="absolute bottom-2 right-2 bg-black/70 text-violet-400 text-[8px] px-1.5 py-0.5 rounded font-bold"><i className="fas fa-film mr-1" />VID</div>
                            </>
                          ) : (
                            <img src={asset.url} className="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform" />
                          )}
                        </div>
                        <div className="p-2 text-center">
                          <span className="text-[10px] font-bold text-zinc-400 truncate block">{asset.name || asset.type}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Compositor;
