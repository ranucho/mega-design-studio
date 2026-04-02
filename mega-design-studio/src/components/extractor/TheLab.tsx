import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useExtractor } from '@/contexts/ExtractorContext';
import { useApp } from '@/contexts/AppContext';
import { generateFromCrop } from '@/services/gemini';
import { AssetType, ReferenceAsset } from '@/types';
// @ts-ignore
import JSZip from 'jszip';

type Crop = { x: number; y: number; w: number; h: number };
type DragHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'create';

export const TheLab: React.FC = () => {
  const { segments, referenceAssets, setReferenceAssets } = useExtractor();
  const { assetLibrary, removeAsset: removeGlobalAsset, setAssetLibrary } = useApp();

  // Merge referenceAssets (Extractor) with assetLibrary (global/Animatix), dedup by ID
  const mergedAssets = useMemo(() => {
    const seen = new Set(referenceAssets.map(a => a.id));
    const globalOnly = assetLibrary.filter(a => !seen.has(a.id));
    return [...referenceAssets, ...globalOnly];
  }, [referenceAssets, assetLibrary]);

  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [assetType, setAssetType] = useState<AssetType>('game_symbol');
  const [assetName, setAssetName] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewIsVideo, setPreviewIsVideo] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [crop, setCrop] = useState<Crop | null>(null);

  const imageWrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [dragState, setDragState] = useState<{
    handle: DragHandle; startX: number; startY: number; startCrop: Crop;
  } | null>(null);

  const allFrames = segments.flatMap(s => s.frames).filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);

  // Group assets by source (ID prefix) — much more accurate than type-only
  type CatDef = { key: string; label: string; icon: string; color: string; match: (a: ReferenceAsset) => boolean };
  const ASSET_CATEGORIES: CatDef[] = [
    { key: 'captured',    label: 'Captured Frames',    icon: 'fa-camera',              color: 'text-blue-400',    match: a => a.id.startsWith('capture-frame-') },
    { key: 'symbols',     label: 'Extracted Symbols',  icon: 'fa-diamond',             color: 'text-pink-500',    match: a => a.id.startsWith('symgen-symbol-') },
    { key: 'backgrounds', label: 'Backgrounds',        icon: 'fa-image',               color: 'text-emerald-500', match: a => a.id.startsWith('symgen-reelsframe-') || (!a.id.startsWith('symgen-') && !a.id.startsWith('capture-') && !a.id.startsWith('animatix-') && a.type === 'background') },
    { key: 'reskins',     label: 'Reskins',            icon: 'fa-wand-magic-sparkles', color: 'text-violet-500',  match: a => a.id.startsWith('symgen-reskin-') },
    { key: 'characters',  label: 'Characters',         icon: 'fa-user',                color: 'text-amber-500',   match: a => a.id.startsWith('animatix-char-') || (!a.id.startsWith('symgen-') && !a.id.startsWith('capture-') && !a.id.startsWith('animatix-') && (a.type === 'character_primary' || a.type === 'character_secondary')) },
    { key: 'scenes',      label: 'Scene Images',       icon: 'fa-film',                color: 'text-cyan-500',    match: a => a.id.startsWith('animatix-scene-') },
  ];
  const groupedAssets = useMemo(() => {
    const claimed = new Set<string>();
    const grouped = ASSET_CATEGORIES.map(cat => {
      const assets = mergedAssets.filter(a => {
        if (claimed.has(a.id)) return false;
        if (cat.match(a)) { claimed.add(a.id); return true; }
        return false;
      });
      return { ...cat, assets };
    }).filter(cat => cat.assets.length > 0);

    // Catch anything not matched by known categories
    const uncategorized = mergedAssets.filter(a => !claimed.has(a.id));
    if (uncategorized.length > 0) {
      grouped.push({ key: 'other', label: 'Other Assets', icon: 'fa-shapes', color: 'text-zinc-400', match: () => true, assets: uncategorized });
    }
    return grouped;
  }, [mergedAssets]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          setSourceImage(ev.target.result as string);
          setCrop(null);
          setGeneratedImage(null);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const getClosestRatio = (w: number, h: number): '1:1' | '3:4' | '4:3' | '9:16' | '16:9' => {
    if (!w || !h) return '1:1';
    const r = w / h;
    const ratios: Record<string, number> = { '1:1': 1, '4:3': 1.333, '3:4': 0.75, '16:9': 1.777, '9:16': 0.5625 };
    const result = Object.keys(ratios).reduce((a, b) =>
      Math.abs(ratios[a] - r) < Math.abs(ratios[b] - r) ? a : b
    );
    return result as '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
  };

  // --- MOUSE HANDLERS ---
  const handleMouseDown = (e: React.MouseEvent, handle: DragHandle) => {
    e.preventDefault();
    e.stopPropagation();
    if (!imageWrapperRef.current) return;
    const rect = imageWrapperRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    let startCrop = crop ? { ...crop } : { x: xPct, y: yPct, w: 0, h: 0 };
    if (handle === 'create') {
      startCrop = { x: xPct, y: yPct, w: 0, h: 0 };
      setCrop(startCrop);
    }
    setDragState({ handle, startX: e.clientX, startY: e.clientY, startCrop });
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragState || !imageWrapperRef.current) return;
      const rect = imageWrapperRef.current.getBoundingClientRect();
      const deltaX = ((e.clientX - dragState.startX) / rect.width) * 100;
      const deltaY = ((e.clientY - dragState.startY) / rect.height) * 100;
      const s = dragState.startCrop;
      let newCrop = { ...s };
      let L = s.x, R = s.x + s.w, T = s.y, B = s.y + s.h;

      if (dragState.handle === 'move') {
        const w = s.w, h = s.h;
        L = Math.max(0, Math.min(100 - w, L + deltaX));
        T = Math.max(0, Math.min(100 - h, T + deltaY));
        newCrop = { x: L, y: T, w, h };
      } else if (dragState.handle === 'create') {
        const currX = L + deltaX, currY = T + deltaY;
        const rawX = Math.max(0, Math.min(100, currX));
        const rawY = Math.max(0, Math.min(100, currY));
        newCrop.x = Math.min(s.x, rawX);
        newCrop.y = Math.min(s.y, rawY);
        newCrop.w = Math.abs(rawX - s.x);
        newCrop.h = Math.abs(rawY - s.y);
      } else {
        if (dragState.handle.includes('w')) L = Math.min(R - 1, Math.max(0, L + deltaX));
        if (dragState.handle.includes('e')) R = Math.max(L + 1, Math.min(100, R + deltaX));
        if (dragState.handle.includes('n')) T = Math.min(B - 1, Math.max(0, T + deltaY));
        if (dragState.handle.includes('s')) B = Math.max(T + 1, Math.min(100, B + deltaY));
        newCrop = { x: L, y: T, w: R - L, h: B - T };
      }
      setCrop(newCrop);
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
  }, [dragState]);

  // --- GENERATION ---
  const handleGenerate = async () => {
    if (!sourceImage || !crop || !prompt || !imgRef.current) return;
    setIsProcessing(true);
    try {
      const img = imgRef.current;
      const natW = img.naturalWidth, natH = img.naturalHeight;
      const px = Math.round((crop.x / 100) * natW);
      const py = Math.round((crop.y / 100) * natH);
      const pw = Math.round((crop.w / 100) * natW);
      const ph = Math.round((crop.h / 100) * natH);
      if (pw <= 0 || ph <= 0) throw new Error('Invalid crop size');

      const canvas = document.createElement('canvas');
      canvas.width = pw; canvas.height = ph;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, px, py, pw, ph, 0, 0, pw, ph);
      const cropDataUrl = canvas.toDataURL('image/png');
      const ratio = getClosestRatio(pw, ph);
      const result = await generateFromCrop(cropDataUrl, prompt, ratio);
      setGeneratedImage(result);
    } catch (err) {
      console.error(err);
      alert('Generation failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddToAssets = () => {
    if (generatedImage) {
      setReferenceAssets(prev => [...prev, {
        id: crypto.randomUUID(), url: generatedImage, type: assetType, name: assetName,
      }]);
      alert('Asset added to Global Styling!');
      setAssetName('');
      setGeneratedImage(null);
    }
  };

  const handleCopyTrigger = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleDeleteAsset = (id: string) => {
    setReferenceAssets(prev => prev.filter(a => a.id !== id));
    removeGlobalAsset(id);
  };

  const handleUpdateAsset = (id: string, updates: Partial<ReferenceAsset>) => {
    setReferenceAssets(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
    setAssetLibrary(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
  };

  const handleDownloadAllAssets = async () => {
    if (mergedAssets.length === 0) return;
    setIsZipping(true);
    try {
      const zip = new JSZip();
      for (let i = 0; i < mergedAssets.length; i++) {
        const asset = mergedAssets[i];
        const name = asset.name || `asset-${i + 1}`;
        const cleanName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        // Convert data URL to blob
        const response = await fetch(asset.url);
        const blob = await response.blob();
        const ext = asset.mediaType === 'video' ? 'mp4' : 'png';
        zip.file(`${cleanName}.${ext}`, blob);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'lab-assets.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Zip download failed', err);
    } finally {
      setIsZipping(false);
    }
  };

  const getTypeLabel = (type: AssetType) => {
    const labels: Record<string, string> = {
      game_symbol: 'Game Symbol', long_game_tile: 'Long Tile', wild_symbol: 'Wild Symbol', object: 'Object / Prop',
      character_primary: 'Primary Character', character_secondary: 'Secondary Character',
      background: 'Background', style: 'Style Reference',
    };
    return labels[type] || type;
  };

  return (
    <div className="h-full overflow-y-auto p-6 animate-in fade-in duration-300 scrollbar-thin">
      {/* Fullscreen Preview Modal */}
      {previewImage && (
        <div className="fixed inset-0 z-[200] bg-black/95 flex items-center justify-center p-4 backdrop-blur-xl" onClick={() => { setPreviewImage(null); setPreviewIsVideo(false); }}>
          {previewIsVideo ? (
            <video src={previewImage} className="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl" controls autoPlay loop muted onClick={e => e.stopPropagation()} />
          ) : (
            <img src={previewImage} className="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
          )}
          <button className="absolute top-4 right-4 text-white hover:text-red-500 text-3xl transition-colors" onClick={() => { setPreviewImage(null); setPreviewIsVideo(false); }}>
            <i className="fas fa-times" />
          </button>
        </div>
      )}

      <div className="flex flex-col min-h-min gap-8 pb-20">
        {/* Header */}
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tighter text-white mb-2 flex items-center gap-3">
              <i className="fas fa-flask text-indigo-500" /> The Lab
            </h1>
            <p className="text-sm text-zinc-400 max-w-2xl">
              Consistency Engine. Isolate specific symbols, UI elements, or characters from your video, re-style them using "Nano Banana 2", and save them as master assets.
            </p>
          </div>
          <div className="flex gap-2">
            <label className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase transition-colors flex items-center gap-2 border border-zinc-700 cursor-pointer">
              <i className="fas fa-upload" /> Upload Reference
              <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
        </div>

        {/* MAIN WORKBENCH */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* LEFT: ISOLATION TOOL */}
          <div className="flex flex-col gap-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 relative">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex justify-between">
              <span>1. Isolate & Define</span>
              {sourceImage && <span className="text-indigo-400">Drag to crop &bull; Resize corners</span>}
            </h3>

            {/* CROPPER AREA */}
            <div
              className="w-full bg-black rounded-xl border border-zinc-800 relative overflow-hidden flex items-center justify-center min-h-[400px] select-none"
              onMouseDown={(e) => handleMouseDown(e, 'create')}
            >
              {sourceImage ? (
                <div ref={imageWrapperRef} className="relative inline-block max-w-full max-h-[50vh]">
                  <img ref={imgRef} src={sourceImage} className="block max-w-full max-h-[50vh] object-contain pointer-events-none" draggable={false} />
                  {crop && crop.w > 0 && (
                    <>
                      <svg width="100%" height="100%" className="absolute inset-0 pointer-events-none z-10" style={{ fill: 'rgba(0,0,0,0.6)' }}>
                        <defs>
                          <mask id="cropMask">
                            <rect x="0" y="0" width="100%" height="100%" fill="white" />
                            <rect x={`${crop.x}%`} y={`${crop.y}%`} width={`${crop.w}%`} height={`${crop.h}%`} fill="black" />
                          </mask>
                        </defs>
                        <rect x="0" y="0" width="100%" height="100%" mask="url(#cropMask)" />
                      </svg>
                      <div
                        className="absolute border-2 border-indigo-500 box-content cursor-move z-20"
                        style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }}
                        onMouseDown={(e) => handleMouseDown(e, 'move')}
                      >
                        <div className="absolute top-1/3 left-0 right-0 h-px bg-indigo-500/30 pointer-events-none" />
                        <div className="absolute top-2/3 left-0 right-0 h-px bg-indigo-500/30 pointer-events-none" />
                        <div className="absolute left-1/3 top-0 bottom-0 w-px bg-indigo-500/30 pointer-events-none" />
                        <div className="absolute left-2/3 top-0 bottom-0 w-px bg-indigo-500/30 pointer-events-none" />
                        <div className="absolute -top-2 -left-2 w-4 h-4 bg-indigo-500 border-2 border-white cursor-nw-resize z-30" onMouseDown={(e) => handleMouseDown(e, 'nw')} />
                        <div className="absolute -top-2 -right-2 w-4 h-4 bg-indigo-500 border-2 border-white cursor-ne-resize z-30" onMouseDown={(e) => handleMouseDown(e, 'ne')} />
                        <div className="absolute -bottom-2 -left-2 w-4 h-4 bg-indigo-500 border-2 border-white cursor-sw-resize z-30" onMouseDown={(e) => handleMouseDown(e, 'sw')} />
                        <div className="absolute -bottom-2 -right-2 w-4 h-4 bg-indigo-500 border-2 border-white cursor-se-resize z-30" onMouseDown={(e) => handleMouseDown(e, 'se')} />
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-zinc-400 flex flex-col items-center pointer-events-none">
                  <i className="fas fa-crop-simple text-4xl mb-2" />
                  <span>Load an image to start</span>
                </div>
              )}
            </div>

            {/* FRAMES STRIP */}
            <div className="h-20 bg-zinc-950 border border-zinc-800 rounded-lg p-2 flex gap-2 overflow-x-auto scrollbar-hide items-center">
              {allFrames.length === 0 && <span className="text-[10px] text-zinc-400 px-2">No frames captured yet. Go to 'Capture' tab.</span>}
              {allFrames.map(f => (
                <button
                  key={f.id}
                  onClick={() => { setSourceImage(f.cleanedDataUrl || f.dataUrl); setCrop(null); setGeneratedImage(null); }}
                  className="h-full w-auto rounded overflow-hidden border border-zinc-800 hover:border-indigo-500 transition-colors shrink-0 relative min-w-[3rem]"
                >
                  <img src={f.cleanedDataUrl || f.dataUrl} className="h-full w-auto max-w-none object-contain" />
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[10px] uppercase font-bold text-zinc-400">Restyle Prompt</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:border-indigo-500 outline-none"
                  placeholder='E.g. "Redesign as a neon cyberpunk 7 symbol"'
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                />
                <button
                  onClick={handleGenerate}
                  disabled={!crop || (crop.w < 1) || !prompt || isProcessing}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg text-xs font-bold uppercase transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20"
                >
                  {isProcessing ? <i className="fas fa-spinner animate-spin" /> : 'Generate'}
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT: RESULTS */}
          <div className="flex flex-col gap-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400">2. Review & Save</h3>
            <div className="flex-1 bg-black/50 rounded-xl border border-zinc-800 flex items-center justify-center relative overflow-hidden min-h-[400px]">
              {generatedImage ? (
                <div className="relative group w-full h-full flex items-center justify-center p-8">
                  <img src={generatedImage} className="max-w-full max-h-full object-contain shadow-2xl" />
                </div>
              ) : (
                <div className="text-zinc-700 text-sm font-mono">Output pending...</div>
              )}
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Trigger Word / Name (Optional)</label>
                <input
                  type="text" value={assetName} onChange={(e) => setAssetName(e.target.value)}
                  placeholder='e.g. "Main Hero" or "Cyber-Skull"'
                  className="w-full bg-zinc-800 text-white text-xs rounded-lg px-3 py-2 border border-zinc-700 outline-none focus:border-indigo-500 placeholder-zinc-500"
                />
              </div>
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="text-[10px] uppercase font-bold text-zinc-400 mb-1 block">Asset Type</label>
                  <select
                    value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)}
                    className="w-full bg-zinc-800 text-white text-xs rounded-lg px-3 py-2 border border-zinc-700 outline-none focus:border-indigo-500"
                  >
                    <option value="game_symbol">Game Symbol (Standard)</option>
                    <option value="long_game_tile">Long Tile / Wild (Vertical)</option>
                    <option value="wild_symbol">Wild Symbol</option>
                    <option value="object">Object / Prop</option>
                    <option value="character_primary">Primary Character</option>
                    <option value="character_secondary">Secondary Character</option>
                    <option value="background">Background</option>
                    <option value="style">Style Reference</option>
                  </select>
                </div>
                <button
                  onClick={handleAddToAssets} disabled={!generatedImage}
                  className="bg-green-600 hover:bg-green-500 text-white px-6 py-2.5 rounded-lg text-xs font-bold uppercase transition-colors disabled:opacity-50 disabled:bg-zinc-800 h-[38px] shadow-lg flex items-center gap-2"
                >
                  <i className="fas fa-plus" /> Add to Assets
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* GENERATED VIDEOS */}
        {segments.some(s => s.generatedClips.length > 0) && (
          <section className="mt-4 border-t border-zinc-800 pt-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg font-black uppercase tracking-tighter text-white flex items-center gap-2">
                <i className="fas fa-video text-indigo-500" /> Generated Videos
              </h2>
              <span className="text-[10px] text-zinc-400 uppercase font-bold">
                {segments.reduce((acc, s) => acc + s.generatedClips.length, 0)} Clips
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {segments.flatMap(seg =>
                seg.generatedClips.map(clip => (
                  <div key={clip.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden group hover:border-indigo-500/50 transition-all shadow-lg">
                    <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
                      <video src={clip.url} className="w-full h-full object-contain" controls />
                    </div>
                    <div className="p-3 flex justify-between items-center border-t border-zinc-800">
                      <span className="text-xs font-bold text-zinc-300">Clip #{clip.index}</span>
                      <div className="flex gap-2">
                        <span className="text-[10px] text-zinc-400 font-mono">{(clip.originalDuration || 0).toFixed(1)}s</span>
                        <a href={clip.url} download={`clip-${clip.index}.mp4`} className="text-zinc-400 hover:text-indigo-400 transition-colors" title="Download">
                          <i className="fas fa-download text-xs" />
                        </a>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* ASSET GALLERY — organized by category */}
        <section className="mt-4 border-t border-zinc-800 pt-8">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-black uppercase tracking-tighter text-white flex items-center gap-2">
              <i className="fas fa-th-large text-zinc-400" /> Asset Gallery
            </h2>
            {mergedAssets.length > 0 && (
              <button onClick={handleDownloadAllAssets} disabled={isZipping} className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase transition-colors flex items-center gap-2 border border-zinc-700 disabled:opacity-50">
                {isZipping ? <i className="fas fa-spinner animate-spin"></i> : <i className="fas fa-download"></i>}
                Download All
              </button>
            )}
          </div>
          {mergedAssets.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-zinc-800 rounded-2xl bg-zinc-900/20">
              <p className="text-zinc-400 text-sm">No assets uploaded or generated yet.</p>
            </div>
          ) : (
            groupedAssets.map(cat => (
                <div key={cat.key} className="mb-8 last:mb-0">
                  <div className="flex items-center gap-2 mb-4">
                    <i className={`fas ${cat.icon} ${cat.color} text-sm`} />
                    <h3 className="text-sm font-black uppercase tracking-widest text-zinc-300">{cat.label}</h3>
                    <span className="text-[10px] text-zinc-400 font-mono ml-1">({cat.assets.length})</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {cat.assets.map((asset) => {
                      const isVid = asset.mediaType === 'video';
                      return (
                      <div key={asset.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden group hover:border-indigo-500/50 transition-all shadow-lg hover:shadow-indigo-500/10 flex flex-col">
                        <div className="aspect-square bg-black relative p-2 flex items-center justify-center overflow-hidden shrink-0">
                          {isVid ? (
                            <>
                              <video src={asset.url} className="w-full h-full object-contain" muted preload="metadata" />
                              <div className="absolute bottom-2 left-2 bg-black/70 text-indigo-400 text-[8px] px-1.5 py-0.5 rounded font-bold flex items-center gap-1"><i className="fas fa-film" />VIDEO</div>
                            </>
                          ) : (
                            <img src={asset.url} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300" />
                          )}
                          <div className="absolute top-1.5 right-1.5 flex gap-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => { setPreviewImage(asset.url); setPreviewIsVideo(isVid); }} className="bg-black/60 hover:bg-indigo-500 text-white w-7 h-7 rounded flex items-center justify-center transition-colors" title="View Fullscreen">
                              <i className="fas fa-eye text-[10px]" />
                            </button>
                            <button onClick={() => handleDeleteAsset(asset.id)} className="bg-black/60 hover:bg-red-500 text-white w-7 h-7 rounded flex items-center justify-center transition-colors" title="Delete Asset">
                              <i className="fas fa-times text-[10px]" />
                            </button>
                          </div>
                        </div>
                        <div className="p-3 border-t border-zinc-800 bg-zinc-900 flex flex-col gap-2 flex-1">
                          <div>
                            <div className="flex gap-1.5 relative">
                              <input
                                type="text" value={asset.name || ''} onChange={(e) => handleUpdateAsset(asset.id, { name: e.target.value })}
                                placeholder="Name..." className="w-full bg-black border border-zinc-700 rounded px-2 py-1.5 text-xs text-indigo-300 font-bold focus:border-indigo-500 outline-none"
                              />
                              {asset.name && (
                                <button onClick={() => handleCopyTrigger(asset.id, asset.name || '')} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white w-8 rounded flex items-center justify-center border border-zinc-700 transition-colors shrink-0" title="Copy Trigger Word">
                                  <i className={`fas ${copiedId === asset.id ? 'fa-check text-green-500' : 'fa-copy'} text-[10px]`} />
                                </button>
                              )}
                              {copiedId === asset.id && <div className="absolute bottom-full right-0 bg-black text-white text-[9px] px-2 py-1 rounded mb-2 border border-zinc-700 animate-in fade-in slide-in-from-bottom-2">Copied!</div>}
                            </div>
                          </div>
                          <select
                            value={asset.type} onChange={(e) => handleUpdateAsset(asset.id, { type: e.target.value as AssetType })}
                            className="w-full bg-black border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-400 focus:border-indigo-500 outline-none"
                          >
                            <option value="game_symbol">Game Symbol</option>
                            <option value="long_game_tile">Long Tile</option>
                            <option value="wild_symbol">Wild Symbol</option>
                            <option value="object">Object</option>
                            <option value="character_primary">Primary Char</option>
                            <option value="character_secondary">Secondary Char</option>
                            <option value="background">Background</option>
                            <option value="style">Style</option>
                          </select>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              ))
          )}
        </section>
      </div>
    </div>
  );
};
