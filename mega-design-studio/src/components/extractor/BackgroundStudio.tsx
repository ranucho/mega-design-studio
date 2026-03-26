import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useExtractor } from '@/contexts/ExtractorContext';
import { useApp } from '@/contexts/AppContext';
import { generateBackgroundImage, generateFromCrop, generateAnimation } from '@/services/gemini';
import { ReferenceAsset, AspectRatio } from '@/types';
import { AspectRatioSelector } from '@/components/shared/AspectRatioSelector';
import { VideoFullscreen } from '@/components/shared/VideoFullscreen';

type DragHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'create';

export const BackgroundStudio: React.FC = () => {
  const { backgroundState, setBackgroundState, referenceAssets, setReferenceAssets } = useExtractor();
  const { addAsset, assetLibrary } = useApp();

  const {
    sourceImage, generatedImage, prompt, aspectRatio, crop, isProcessing,
    videoPrompt, videoCount, generatedVideos, isProcessingVideo,
  } = backgroundState;

  const updateState = (updates: Partial<typeof backgroundState>) => {
    setBackgroundState(prev => ({ ...prev, ...updates }));
  };

  const labAssets = useMemo(() => {
    const seen = new Set(referenceAssets.map(a => a.id));
    const globalOnly = assetLibrary.filter(a => !seen.has(a.id));
    return [...referenceAssets, ...globalOnly];
  }, [referenceAssets, assetLibrary]);

  const imageWrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [assetName, setAssetName] = useState('');
  const [showLabPicker, setShowLabPicker] = useState(false);
  const [fullscreenVideo, setFullscreenVideo] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    handle: DragHandle; startX: number; startY: number;
    startCrop: { x: number; y: number; w: number; h: number };
  } | null>(null);

  const RATIOS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:3'];

  // Current step
  const step = !sourceImage && !generatedImage ? 1
    : sourceImage && !generatedImage ? 2
    : generatedImage && generatedVideos.length === 0 ? 3
    : 4;

  // --- File Upload ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          updateState({ sourceImage: ev.target.result as string, generatedImage: null, crop: { x: 10, y: 10, w: 80, h: 60 } });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLoadFromLab = (asset: ReferenceAsset) => {
    updateState({ sourceImage: asset.url, generatedImage: null, crop: { x: 10, y: 10, w: 80, h: 60 } });
    setShowLabPicker(false);
  };

  // --- Mouse Handlers ---
  const handleMouseDown = (e: React.MouseEvent, handle: DragHandle) => {
    e.preventDefault(); e.stopPropagation();
    if (!imageWrapperRef.current) return;
    const rect = imageWrapperRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    let startCrop = crop ? { ...crop } : { x: xPct, y: yPct, w: 0, h: 0 };
    if (handle === 'create') { startCrop = { x: xPct, y: yPct, w: 0, h: 0 }; updateState({ crop: startCrop }); }
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
        newCrop = { x: Math.max(0, Math.min(100 - s.w, L + deltaX)), y: Math.max(0, Math.min(100 - s.h, T + deltaY)), w: s.w, h: s.h };
      } else if (dragState.handle === 'create') {
        const rawX = Math.max(0, Math.min(100, L + deltaX));
        const rawY = Math.max(0, Math.min(100, T + deltaY));
        newCrop = { x: Math.min(s.x, rawX), y: Math.min(s.y, rawY), w: Math.abs(rawX - s.x), h: Math.abs(rawY - s.y) };
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
    if (dragState) { window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp); }
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, [dragState]);

  const getCroppedImage = (): string | null => {
    if (!imgRef.current || !crop) return null;
    const img = imgRef.current;
    const px = Math.round((crop.x / 100) * img.naturalWidth);
    const py = Math.round((crop.y / 100) * img.naturalHeight);
    const pw = Math.round((crop.w / 100) * img.naturalWidth);
    const ph = Math.round((crop.h / 100) * img.naturalHeight);
    if (pw <= 0 || ph <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = pw; canvas.height = ph;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(img, px, py, pw, ph, 0, 0, pw, ph);
    return canvas.toDataURL('image/png');
  };

  const handleGenerateFromScratch = async () => {
    if (!prompt) return;
    updateState({ isProcessing: true });
    try {
      const result = await generateBackgroundImage(prompt, aspectRatio);
      updateState({ generatedImage: result });
    } catch (err) { console.error(err); alert('Background generation failed.'); }
    finally { updateState({ isProcessing: false }); }
  };

  const handleRegenerateFromCrop = async () => {
    if (!sourceImage) return;
    updateState({ isProcessing: true });
    try {
      const cropped = getCroppedImage();
      const userPrompt = prompt || 'Expand and enhance this background image, maintaining style and quality';
      const extractPrompt = `BACKGROUND IMAGE ONLY — no characters, no logos, no text, no game symbols, no icons, no people, no mascots. Output must be a pure scenic/decorative background. ${userPrompt}`;
      const result = cropped
        ? await generateFromCrop(cropped, extractPrompt, aspectRatio as any)
        : await generateBackgroundImage(extractPrompt, aspectRatio, sourceImage);
      updateState({ generatedImage: result });
    } catch (err) { console.error(err); alert('Regeneration failed.'); }
    finally { updateState({ isProcessing: false }); }
  };

  const handleGenerateVideos = async () => {
    if (!generatedImage || !videoPrompt) return;
    updateState({ isProcessingVideo: true });
    try {
      const count = Math.min(4, Math.max(1, videoCount));
      const newVideos: { url: string; id: string }[] = [];
      for (let i = 0; i < count; i++) {
        try {
          const { url } = await generateAnimation(generatedImage, null, videoPrompt, aspectRatio === '9:16' ? '9:16' : '16:9', 'fast');
          newVideos.push({ url, id: crypto.randomUUID() });
        } catch (err) { console.error(`Video ${i + 1} failed`, err); }
      }
      updateState({ generatedVideos: [...generatedVideos, ...newVideos] });
      newVideos.forEach((v, i) => addAsset({ id: v.id, url: v.url, type: 'background', name: `BG Video ${generatedVideos.length + i + 1}`, mediaType: 'video' }));
    } catch (err) { console.error(err); alert('Video generation failed'); }
    finally { updateState({ isProcessingVideo: false }); }
  };

  const handleSaveToAssets = () => {
    if (!generatedImage) return;
    const asset: ReferenceAsset = { id: crypto.randomUUID(), url: generatedImage, type: 'background', name: assetName || 'Background' };
    setReferenceAssets(prev => [...prev, asset]);
    addAsset({ ...asset });
    setAssetName('');
  };

  // Step indicator
  const StepBadge = ({ n, label, active }: { n: number; label: string; active: boolean }) => (
    <div className={`flex items-center gap-2 ${active ? 'text-white' : 'text-zinc-600'}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${active ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-600'}`}>{n}</div>
      <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto p-6 animate-in fade-in duration-300">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <i className="fas fa-image text-blue-500 text-lg" />
          <h1 className="text-xl font-black uppercase tracking-tight text-white">Background Studio</h1>
        </div>
        <AspectRatioSelector
          value={aspectRatio}
          onChange={(r) => updateState({ aspectRatio: r as any })}
          options={RATIOS}
        />
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-6 mb-6 pb-4 border-b border-zinc-800/50">
        <StepBadge n={1} label="Source" active={step >= 1} />
        <div className="w-8 h-px bg-zinc-800" />
        <StepBadge n={2} label="Generate" active={step >= 2} />
        <div className="w-8 h-px bg-zinc-800" />
        <StepBadge n={3} label="Animate" active={step >= 3} />
      </div>

      {/* Main content — single column flow */}
      <div className="max-w-4xl mx-auto flex flex-col gap-6">

        {/* SOURCE + GENERATE — side by side when source exists */}
        <div className={`grid gap-6 ${sourceImage ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
          {/* Source panel */}
          <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Source</span>
              {sourceImage && (
                <button onClick={() => updateState({ sourceImage: null, generatedImage: null, crop: null })}
                  className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors">
                  <i className="fas fa-times mr-1" />Clear
                </button>
              )}
            </div>

            {!sourceImage ? (
              <div className="flex gap-3">
                <label className="flex-1 flex flex-col items-center justify-center h-32 border-2 border-dashed border-zinc-700/50 rounded-xl hover:border-blue-500/50 hover:bg-blue-500/5 transition-all cursor-pointer group">
                  <i className="fas fa-upload text-xl text-zinc-600 group-hover:text-blue-400 mb-2" />
                  <span className="text-[10px] font-bold text-zinc-500 group-hover:text-zinc-300 uppercase">Upload</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                </label>
                <button onClick={() => setShowLabPicker(true)} disabled={labAssets.length === 0}
                  className="flex-1 flex flex-col items-center justify-center h-32 border-2 border-dashed border-zinc-700/50 rounded-xl hover:border-blue-500/50 hover:bg-blue-500/5 transition-all disabled:opacity-30 group">
                  <i className="fas fa-folder-open text-xl text-zinc-600 group-hover:text-blue-400 mb-2" />
                  <span className="text-[10px] font-bold text-zinc-500 group-hover:text-zinc-300 uppercase">From Assets</span>
                  {labAssets.length > 0 && <span className="bg-blue-600 text-white px-2 py-0.5 rounded-full text-[9px] mt-1">{labAssets.length}</span>}
                </button>
              </div>
            ) : (
              <div className="relative" onMouseDown={(e) => handleMouseDown(e, 'create')}>
                <div ref={imageWrapperRef} className="relative inline-block w-full">
                  <img ref={imgRef} src={sourceImage} className="w-full h-auto max-h-[40vh] object-contain rounded-lg pointer-events-none select-none" draggable={false} />
                  {crop && crop.w > 0 && crop.h > 0 && (
                    <div className="absolute border-2 border-blue-500 box-content cursor-move z-20 shadow-[0_0_0_9999px_rgba(0,0,0,0.7)]"
                      style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }}
                      onMouseDown={(e) => handleMouseDown(e, 'move')}>
                      {(['nw', 'ne', 'sw', 'se'] as const).map(h => (
                        <div key={h} className={`absolute w-3.5 h-3.5 bg-blue-500 rounded-sm z-30 cursor-${h}-resize ${h.includes('n') ? '-top-1.5' : '-bottom-1.5'} ${h.includes('w') ? '-left-1.5' : '-right-1.5'}`}
                          onMouseDown={(e) => handleMouseDown(e, h)} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Generate panel — only when source exists or prompt-only mode */}
          <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-xl p-5 flex flex-col">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">Generate</span>
            <textarea className="w-full bg-black/50 border border-zinc-700/50 rounded-lg p-3 text-sm text-white focus:border-blue-500 outline-none resize-none h-20 mb-3"
              placeholder='E.g. "Cyberpunk city, neon lights, rain"'
              value={prompt} onChange={e => updateState({ prompt: e.target.value })} />
            <div className="grid grid-cols-2 gap-2 mt-auto">
              <button onClick={handleGenerateFromScratch} disabled={isProcessing || !prompt}
                className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2.5 rounded-lg text-[10px] font-bold uppercase transition-colors disabled:opacity-40 border border-zinc-700/50 flex items-center justify-center gap-1.5">
                {isProcessing ? <i className="fas fa-spinner animate-spin" /> : <i className="fas fa-wand-magic-sparkles" />}
                From Scratch
              </button>
              <button onClick={handleRegenerateFromCrop} disabled={!sourceImage || isProcessing}
                className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-2.5 rounded-lg text-[10px] font-bold uppercase transition-colors disabled:opacity-40 shadow-lg flex items-center justify-center gap-1.5">
                {isProcessing ? <i className="fas fa-spinner animate-spin" /> : <i className="fas fa-crop-simple" />}
                From Crop
              </button>
            </div>
          </div>
        </div>

        {/* RESULT — full width */}
        {generatedImage && (
          <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-xl p-5 animate-in fade-in">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Result</span>
              <div className="flex gap-2 items-center">
                <input type="text" placeholder="Name..." className="bg-zinc-800/80 rounded-lg px-3 py-1.5 text-xs border border-zinc-700/50 text-white w-36"
                  value={assetName} onChange={e => setAssetName(e.target.value)} />
                <button onClick={handleSaveToAssets}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-colors">
                  <i className="fas fa-save mr-1" />Save
                </button>
              </div>
            </div>
            <div className="bg-black/50 rounded-lg border border-zinc-800/50 overflow-hidden flex items-center justify-center">
              <img src={generatedImage} className="max-w-full max-h-[45vh] object-contain" />
            </div>
          </div>
        )}

        {/* ANIMATE — compact inline */}
        {generatedImage && (
          <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-xl p-5 animate-in slide-in-from-bottom-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3 block">Animate</span>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <textarea className="w-full bg-black/50 border border-zinc-700/50 rounded-lg p-3 text-sm text-white focus:border-blue-500 outline-none resize-none h-16"
                  placeholder='E.g. "Camera slowly panning right, clouds moving"'
                  value={videoPrompt} onChange={e => updateState({ videoPrompt: e.target.value })} />
              </div>
              <div className="flex flex-col items-center gap-1">
                <span className="text-[8px] text-zinc-600 uppercase font-bold">Count</span>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4].map(n => (
                    <button key={n} onClick={() => updateState({ videoCount: n })}
                      className={`w-8 h-8 rounded text-xs font-black transition-all ${videoCount === n ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-white border border-zinc-700/50'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={handleGenerateVideos} disabled={!videoPrompt || isProcessingVideo}
                className="bg-blue-600 hover:bg-blue-500 text-white h-16 px-6 rounded-lg text-xs font-bold uppercase transition-colors disabled:opacity-40 shadow-lg flex items-center gap-2 whitespace-nowrap">
                {isProcessingVideo ? <i className="fas fa-spinner animate-spin" /> : <i className="fas fa-film" />}
                {isProcessingVideo ? 'Generating...' : `Generate ${videoCount}`}
              </button>
            </div>
          </div>
        )}

        {/* VIDEO GALLERY */}
        {generatedVideos.length > 0 && (
          <div className="animate-in fade-in">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3 block">Videos</span>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {generatedVideos.map(vid => (
                <div key={vid.id} className="bg-black rounded-lg overflow-hidden border border-zinc-800/50 group relative">
                  <video src={vid.url} autoPlay loop muted className="w-full h-auto" />
                  <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setFullscreenVideo(vid.url)} className="bg-black/60 hover:bg-white text-white hover:text-black w-7 h-7 rounded flex items-center justify-center transition-colors">
                      <i className="fas fa-expand text-[10px]" />
                    </button>
                    <a href={vid.url} download className="bg-black/60 hover:bg-white text-white hover:text-black w-7 h-7 rounded flex items-center justify-center transition-colors">
                      <i className="fas fa-download text-[10px]" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {fullscreenVideo && <VideoFullscreen url={fullscreenVideo} onClose={() => setFullscreenVideo(null)} />}

      {/* LAB PICKER MODAL */}
      {showLabPicker && (
        <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-6 backdrop-blur-sm" onClick={() => setShowLabPicker(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-3xl w-full max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-zinc-800">
              <h3 className="text-lg font-black uppercase tracking-widest text-white flex items-center gap-2">
                <i className="fas fa-folder-open text-blue-500" /> Load from Assets
              </h3>
              <button onClick={() => setShowLabPicker(false)} className="text-zinc-500 hover:text-white"><i className="fas fa-times" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {labAssets.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">No assets available.</div>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                  {labAssets.map(asset => (
                    <button key={asset.id} onClick={() => handleLoadFromLab(asset)} className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden hover:border-blue-500 transition-all group">
                      <div className="aspect-square bg-black p-2 flex items-center justify-center">
                        <img src={asset.url} className="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform" />
                      </div>
                      <div className="p-2 text-center">
                        <span className="text-[10px] font-bold text-zinc-400 truncate block">{asset.name || asset.type}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BackgroundStudio;
