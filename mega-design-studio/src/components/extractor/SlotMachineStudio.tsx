import React, { useRef, useEffect, useState } from 'react';
import { useExtractor } from '@/contexts/ExtractorContext';
import { generateSlotGridReskin } from '@/services/gemini';
import { Crop } from '@/types';

type DragHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'create';

export const SlotMachineStudio: React.FC = () => {
  const { slotState, setSlotState, setReferenceAssets } = useExtractor();
  const [symbolTriggerName, setSymbolTriggerName] = useState('');
  const [frameTriggerName, setFrameTriggerName] = useState('');

  const imageWrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [dragState, setDragState] = useState<{
    handle: DragHandle; startX: number; startY: number; startCrop: Crop;
  } | null>(null);

  const { sourceImage, resultSymbolImage, resultFrameImage, rows, cols, prompt, crop, isProcessing } = slotState;

  const updateState = (updates: Partial<typeof slotState>) => {
    setSlotState(prev => ({ ...prev, ...updates }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          updateState({
            sourceImage: ev.target.result as string,
            crop: { x: 0, y: 0, w: 100, h: 100 },
            resultSymbolImage: null,
            resultFrameImage: null,
          });
        }
      };
      reader.readAsDataURL(file);
    }
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
      updateState({ crop: startCrop });
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
      updateState({ crop: newCrop });
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

  const handleGenerateClick = async () => {
    if (!imgRef.current || !crop || !sourceImage) return;
    updateState({ isProcessing: true });
    try {
      const img = imgRef.current;
      const natW = img.naturalWidth, natH = img.naturalHeight;
      const px = Math.round((crop.x / 100) * natW);
      const py = Math.round((crop.y / 100) * natH);
      const pw = Math.round((crop.w / 100) * natW);
      const ph = Math.round((crop.h / 100) * natH);
      if (pw <= 0 || ph <= 0) throw new Error('Invalid crop');

      const canvas = document.createElement('canvas');
      canvas.width = pw; canvas.height = ph;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, px, py, pw, ph, 0, 0, pw, ph);
      const cropDataUrl = canvas.toDataURL('image/png');

      const result = await generateSlotGridReskin(cropDataUrl, prompt, rows, cols);
      // result contains { symbolSheet, frameImage } or similar
      if (typeof result === 'object' && result.symbolSheet) {
        updateState({ resultSymbolImage: result.symbolSheet, resultFrameImage: result.frameImage || null });
      } else {
        updateState({ resultSymbolImage: result as any as string });
      }
    } catch (err) {
      console.error(err);
      alert('Slot generation failed');
    } finally {
      updateState({ isProcessing: false });
    }
  };

  const handleSaveSymbolAsset = () => {
    if (resultSymbolImage) {
      setReferenceAssets(prev => [...prev, {
        id: crypto.randomUUID(), url: resultSymbolImage, type: 'style', name: symbolTriggerName || 'Slot Symbols',
      }]);
      alert('Symbols added to assets!');
      setSymbolTriggerName('');
      updateState({ resultSymbolImage: null });
    }
  };

  const handleSaveFrameAsset = () => {
    if (resultFrameImage) {
      setReferenceAssets(prev => [...prev, {
        id: crypto.randomUUID(), url: resultFrameImage, type: 'background', name: frameTriggerName || 'Slot Frame',
      }]);
      alert('Frame added to assets!');
      setFrameTriggerName('');
      updateState({ resultFrameImage: null });
    }
  };

  return (
    <div className="h-full overflow-y-auto p-8 animate-in fade-in duration-300">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-white mb-2 flex items-center gap-3">
            <i className="fas fa-border-all text-amber-500" /> Slot Machine Studio
          </h1>
          <p className="text-sm text-zinc-400">
            Generate separate Symbol Sheets and Cabinet Frames. Symbols retain background plates from source.
          </p>
        </div>
        <label className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase transition-colors flex items-center gap-2 border border-zinc-700 cursor-pointer">
          <i className="fas fa-upload" /> Upload Grid
          <input type="file" accept="image/*" onChange={handleFileUpload} className="hidden" />
        </label>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* LEFT: CROPPER */}
        <div className="flex flex-col gap-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 h-fit">
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400">1. Define Grid</h3>
            <div className="flex gap-2 items-center">
              <label className="text-[10px] uppercase font-bold text-zinc-400">Rows</label>
              <input type="number" value={rows} onChange={e => updateState({ rows: Number(e.target.value) })} className="w-12 bg-black border border-zinc-700 rounded px-2 py-1 text-xs text-white" min={1} />
              <label className="text-[10px] uppercase font-bold text-zinc-400">Cols</label>
              <input type="number" value={cols} onChange={e => updateState({ cols: Number(e.target.value) })} className="w-12 bg-black border border-zinc-700 rounded px-2 py-1 text-xs text-white" min={1} />
            </div>
          </div>

          <div
            className="w-full bg-black rounded-xl border border-zinc-800 relative overflow-hidden flex items-center justify-center min-h-[400px] select-none"
            onMouseDown={(e) => handleMouseDown(e, 'create')}
          >
            {sourceImage ? (
              <div ref={imageWrapperRef} className="relative inline-block max-w-full max-h-[50vh]">
                <img ref={imgRef} src={sourceImage} className="block max-w-full max-h-[50vh] object-contain pointer-events-none" draggable={false} />
                {crop && crop.w > 0 && (
                  <div
                    className="absolute border-2 border-amber-500 box-content cursor-move z-20"
                    style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }}
                    onMouseDown={(e) => handleMouseDown(e, 'move')}
                  >
                    {/* Grid Overlay */}
                    <div className="absolute inset-0 flex flex-col pointer-events-none opacity-50">
                      {Array.from({ length: rows - 1 }).map((_, i) => (
                        <div key={i} className="flex-1 border-b border-amber-500/50" />
                      ))}
                    </div>
                    <div className="absolute inset-0 flex pointer-events-none opacity-50">
                      {Array.from({ length: cols - 1 }).map((_, i) => (
                        <div key={i} className="flex-1 border-r border-amber-500/50" />
                      ))}
                    </div>
                    {/* Resize Handles */}
                    <div className="absolute -top-2 -left-2 w-4 h-4 bg-amber-500 cursor-nw-resize z-30" onMouseDown={(e) => handleMouseDown(e, 'nw')} />
                    <div className="absolute -bottom-2 -right-2 w-4 h-4 bg-amber-500 cursor-se-resize z-30" onMouseDown={(e) => handleMouseDown(e, 'se')} />
                  </div>
                )}
              </div>
            ) : (
              <div className="text-zinc-400 flex flex-col items-center pointer-events-none">
                <i className="fas fa-border-all text-4xl mb-2" />
                <span>Load a slot grid image</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase font-bold text-zinc-400">Reskin Style</label>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 outline-none"
                placeholder='E.g. "Space Gems, glowing, metallic interface"'
                value={prompt}
                onChange={e => updateState({ prompt: e.target.value })}
              />
              <button
                onClick={handleGenerateClick}
                disabled={!sourceImage || !crop || isProcessing}
                className="bg-amber-600 hover:bg-amber-500 text-white px-6 py-2 rounded-lg text-xs font-bold uppercase transition-colors disabled:opacity-50"
              >
                {isProcessing ? <i className="fas fa-spinner animate-spin" /> : 'Generate Assets'}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT: RESULTS */}
        <div className="flex flex-col gap-6">
          {/* Symbol Sheet */}
          <div className="flex flex-col gap-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex justify-between items-center">
              <span>2a. Symbol Sheet</span>
              {isProcessing && <span className="text-amber-500 animate-pulse">Generating...</span>}
            </h3>
            <div className="flex-1 bg-black/50 rounded-xl border border-zinc-800 flex items-center justify-center relative overflow-hidden min-h-[250px]">
              {resultSymbolImage ? (
                <img src={resultSymbolImage} className="max-w-full max-h-full object-contain" />
              ) : (
                <div className="text-zinc-700 text-sm font-mono flex flex-col items-center gap-2">
                  <span>{isProcessing ? 'Processing symbols...' : 'Pending...'}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input type="text" placeholder="Name (e.g. 'Space Symbols')" value={symbolTriggerName} onChange={(e) => setSymbolTriggerName(e.target.value)} className="flex-1 bg-black border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:border-green-500 outline-none" />
              <button onClick={handleSaveSymbolAsset} disabled={!resultSymbolImage} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase transition-colors disabled:opacity-50 whitespace-nowrap">
                <i className="fas fa-save" /> Save
              </button>
            </div>
          </div>

          {/* Frame Result */}
          <div className="flex flex-col gap-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex justify-between items-center">
              <span>2b. Reel Frame & UI</span>
              {isProcessing && <span className="text-amber-500 animate-pulse">Generating...</span>}
            </h3>
            <div className="flex-1 bg-black/50 rounded-xl border border-zinc-800 flex items-center justify-center relative overflow-hidden min-h-[250px]">
              {resultFrameImage ? (
                <img src={resultFrameImage} className="max-w-full max-h-full object-contain" />
              ) : (
                <div className="text-zinc-700 text-sm font-mono flex flex-col items-center gap-2">
                  <span>{isProcessing ? 'Processing frame...' : 'Pending...'}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input type="text" placeholder="Name (e.g. 'Space Cabinet')" value={frameTriggerName} onChange={(e) => setFrameTriggerName(e.target.value)} className="flex-1 bg-black border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white focus:border-green-500 outline-none" />
              <button onClick={handleSaveFrameAsset} disabled={!resultFrameImage} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase transition-colors disabled:opacity-50 whitespace-nowrap">
                <i className="fas fa-save" /> Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
