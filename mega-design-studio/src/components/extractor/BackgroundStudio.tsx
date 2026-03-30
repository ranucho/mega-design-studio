import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useExtractor } from '@/contexts/ExtractorContext';
import { useApp } from '@/contexts/AppContext';
import { generateBackgroundImage, generateFromCrop, generateAnimation } from '@/services/gemini';
import { ReferenceAsset, AspectRatio } from '@/types';
import { AspectRatioSelector } from '@/components/shared/AspectRatioSelector';
import { VideoFullscreen } from '@/components/shared/VideoFullscreen';
import { useToast } from '@/components/shared/Toast';

type DragHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'create';

export const BackgroundStudio: React.FC = () => {
  const { backgroundState, setBackgroundState, referenceAssets, setReferenceAssets } = useExtractor();
  const { addAsset, assetLibrary } = useApp();
  const { toast } = useToast();

  const {
    sourceImage, generatedImage, prompt, aspectRatio, crop, isProcessing,
    videoPrompt, videoCount, generatedVideos, isProcessingVideo,
  } = backgroundState;

  const updateState = (updates: Partial<typeof backgroundState>) => {
    setBackgroundState(prev => ({ ...prev, ...updates }));
  };

  // Lab assets (merged & deduplicated)
  const labAssets = useMemo(() => {
    const seen = new Set(referenceAssets.map(a => a.id));
    const globalOnly = assetLibrary.filter(a => !seen.has(a.id));
    return [...referenceAssets, ...globalOnly];
  }, [referenceAssets, assetLibrary]);

  // UI state
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

  // --- Load from Assets ---
  const handleLoadFromLab = (asset: ReferenceAsset) => {
    updateState({ sourceImage: asset.url, generatedImage: null, crop: { x: 10, y: 10, w: 80, h: 60 } });
    setShowLabPicker(false);
  };

  // --- Mouse Handlers (Free-form Crop) ---
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

  // --- Crop Helper ---
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

  // --- Generation ---
  const handleGenerateFromScratch = async () => {
    if (!prompt) return;
    updateState({ isProcessing: true });
    try {
      const result = await generateBackgroundImage(prompt, aspectRatio);
      updateState({ generatedImage: result });
      toast('Background generated', { type: 'success' });
    } catch (err) { console.error(err); toast('Background generation failed', { type: 'error' }); }
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
      toast('Background regenerated', { type: 'success' });
    } catch (err) { console.error(err); toast('Regeneration failed', { type: 'error' }); }
    finally { updateState({ isProcessing: false }); }
  };

  // --- Video ---
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
      // Auto-save videos to Lab
      newVideos.forEach((v, i) => addAsset({ id: v.id, url: v.url, type: 'background', name: `BG Video ${generatedVideos.length + i + 1}`, mediaType: 'video' }));
      toast(`Generated ${newVideos.length} background video(s)`, { type: 'success' });
    } catch (err) { console.error(err); toast('Video generation failed', { type: 'error' }); }
    finally { updateState({ isProcessingVideo: false }); }
  };

  // --- Save ---
  const handleSaveToAssets = () => {
    if (!generatedImage) return;
    const asset: ReferenceAsset = { id: crypto.randomUUID(), url: generatedImage, type: 'background', name: assetName || 'Background' };
    setReferenceAssets(prev => [...prev, asset]);
    addAsset({ ...asset });
    setAssetName('');
  };

  return (
    <div className="h-full overflow-y-auto p-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-white mb-2 flex items-center gap-3">
            <i className="fas fa-image text-blue-500" /> Background Studio
          </h1>
          <p className="text-sm text-zinc-400">
            Upload or load from Assets &rarr; Generate &rarr; Animate.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AspectRatioSelector
            value={aspectRatio}
            onChange={(r) => updateState({ aspectRatio: r as any })}
            options={RATIOS}
          />
        </div>
      </div>

      {/* STEP 1: SOURCE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* LEFT: Source */}
        <div className="flex flex-col gap-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">1. Source Image</h3>

          {/* Upload + Load from Assets buttons */}
          <div className="flex gap-3">
            <label className="flex-1 flex flex-col items-center justify-center h-28 border-2 border-dashed border-zinc-700 rounded-xl hover:border-blue-500 hover:bg-zinc-800/50 transition-all cursor-pointer group">
              <i className="fas fa-upload text-xl text-zinc-600 group-hover:text-blue-400 mb-1" />
              <span className="text-[10px] font-bold text-zinc-500 group-hover:text-zinc-300 uppercase">Upload Image</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
            </label>
            <button
              onClick={() => setShowLabPicker(true)}
              disabled={labAssets.length === 0}
              className="flex-1 flex flex-col items-center justify-center h-28 border-2 border-dashed border-zinc-700 rounded-xl hover:border-blue-500 hover:bg-zinc-800/50 transition-all disabled:opacity-30 group"
            >
              <i className="fas fa-flask text-xl text-zinc-600 group-hover:text-blue-400 mb-1" />
              <span className="text-[10px] font-bold text-zinc-500 group-hover:text-zinc-300 uppercase">Load from Assets</span>
              {labAssets.length > 0 && (
                <span className="bg-blue-600 text-white px-2 py-0.5 rounded-full text-[9px] mt-1">{labAssets.length}</span>
              )}
            </button>
          </div>

          {/* Source image preview + crop */}
          <div
            className="w-full bg-black rounded-xl border border-zinc-800 relative overflow-hidden flex items-center justify-center min-h-[350px] select-none"
            onMouseDown={sourceImage ? (e) => handleMouseDown(e, 'create') : undefined}
          >
            {sourceImage ? (
              <div ref={imageWrapperRef} className="relative inline-block max-w-full max-h-[50vh]">
                <img ref={imgRef} src={sourceImage} className="block max-w-full max-h-[50vh] object-contain pointer-events-none" draggable={false} />
                {crop && crop.w > 0 && crop.h > 0 && (
                  <div
                    className="absolute border-2 border-blue-500 box-content cursor-move z-20 shadow-[0_0_0_9999px_rgba(0,0,0,0.7)]"
                    style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }}
                    onMouseDown={(e) => handleMouseDown(e, 'move')}
                  >
                    <div className="absolute -top-2 -left-2 w-4 h-4 bg-blue-500 cursor-nw-resize z-30 rounded-sm" onMouseDown={(e) => handleMouseDown(e, 'nw')} />
                    <div className="absolute -top-2 -right-2 w-4 h-4 bg-blue-500 cursor-ne-resize z-30 rounded-sm" onMouseDown={(e) => handleMouseDown(e, 'ne')} />
                    <div className="absolute -bottom-2 -left-2 w-4 h-4 bg-blue-500 cursor-sw-resize z-30 rounded-sm" onMouseDown={(e) => handleMouseDown(e, 'sw')} />
                    <div className="absolute -bottom-2 -right-2 w-4 h-4 bg-blue-500 cursor-se-resize z-30 rounded-sm" onMouseDown={(e) => handleMouseDown(e, 'se')} />
                  </div>
                )}
              </div>
            ) : (
              <div className="text-zinc-600 flex flex-col items-center pointer-events-none gap-2 text-center p-8">
                <i className="fas fa-image text-4xl mb-2" />
                <span>Upload or load a source image</span>
              </div>
            )}
          </div>

        </div>

        {/* RIGHT: Generate + Result */}
        <div className="flex flex-col gap-6">
          {/* Generation controls */}
          <div className="flex flex-col gap-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">2. Generate</h3>
            <textarea
              className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-sm text-white focus:border-blue-500 outline-none resize-none h-24"
              placeholder='E.g. "Cyberpunk city street, neon lights, rain, highly detailed"'
              value={prompt} onChange={e => updateState({ prompt: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <button onClick={handleGenerateFromScratch} disabled={isProcessing || !prompt}
                className="bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-3 rounded-lg text-xs font-bold uppercase transition-colors disabled:opacity-50 border border-zinc-700 flex items-center justify-center gap-2">
                {isProcessing ? <><i className="fas fa-spinner animate-spin" /> Processing...</> : <><i className="fas fa-wand-magic-sparkles" /> From Scratch</>}
              </button>
              <button onClick={handleRegenerateFromCrop} disabled={!sourceImage || isProcessing}
                className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-3 rounded-lg text-xs font-bold uppercase transition-colors disabled:opacity-50 shadow-lg flex items-center justify-center gap-2">
                {isProcessing ? <><i className="fas fa-spinner animate-spin" /> Processing...</> : <><i className="fas fa-crop-simple" /> Extract BG from Crop</>}
              </button>
            </div>
          </div>

          {/* Result */}
          <div className="flex flex-col gap-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 flex-1">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">3. Result</h3>
            <div className="flex-1 bg-black rounded-xl border border-zinc-800 relative overflow-hidden flex items-center justify-center min-h-[250px]">
              {generatedImage ? (
                <img src={generatedImage} className="max-w-full max-h-full object-contain" />
              ) : (
                <div className="text-zinc-700 text-sm font-mono flex flex-col items-center gap-2">
                  {isProcessing && <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />}
                  <span>{isProcessing ? 'Generating...' : 'Output Preview'}</span>
                </div>
              )}
            </div>
            {generatedImage && (
              <div className="flex gap-2 items-center">
                <input type="text" placeholder="Name..." className="flex-1 bg-zinc-800 rounded px-3 py-2 text-xs border border-zinc-700 text-white"
                  value={assetName} onChange={e => setAssetName(e.target.value)} />
                <button onClick={handleSaveToAssets} className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-lg text-xs font-bold uppercase transition-colors shadow-lg">
                  Save
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* STEP 4: ANIMATE */}
      {generatedImage && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 mb-8 animate-in slide-in-from-bottom-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-4">4. Animate</h3>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="bg-black rounded-xl border border-zinc-800 overflow-hidden relative">
              <img src={generatedImage} className="w-full h-auto object-contain" />
              {isProcessingVideo && (
                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center backdrop-blur-sm">
                  <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
                  <span className="text-xs font-bold text-white uppercase tracking-widest animate-pulse">Generating...</span>
                </div>
              )}
            </div>
            <div className="lg:col-span-2 flex flex-col gap-4">
              <textarea className="w-full bg-black border border-zinc-700 rounded-lg p-3 text-sm text-white focus:border-blue-500 outline-none resize-none h-20"
                placeholder='E.g. "Camera slowly panning right, clouds moving"'
                value={videoPrompt} onChange={e => updateState({ videoPrompt: e.target.value })} />
              <div className="flex items-center gap-4">
                <label className="text-[10px] uppercase font-bold text-zinc-500">Variations:</label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map(n => (
                    <button key={n} onClick={() => updateState({ videoCount: n })}
                      className={`w-10 h-10 rounded-lg text-sm font-black transition-all ${videoCount === n ? 'bg-blue-600 text-white shadow-lg scale-105' : 'bg-zinc-800 text-zinc-500 hover:text-white hover:bg-zinc-700 border border-zinc-700'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <button onClick={handleGenerateVideos} disabled={!videoPrompt || isProcessingVideo}
                className="bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg text-xs font-bold uppercase transition-colors disabled:opacity-50 shadow-lg flex items-center justify-center gap-2">
                {isProcessingVideo
                  ? <><i className="fas fa-spinner animate-spin" /> Generating {videoCount} Video{videoCount > 1 ? 's' : ''}...</>
                  : <><i className="fas fa-film" /> Generate {videoCount} Video{videoCount > 1 ? 's' : ''}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VIDEO GALLERY */}
      {generatedVideos.length > 0 && (
        <div className="border-t border-zinc-800 pt-6">
          <h4 className="text-xs font-bold text-zinc-500 uppercase mb-4">Generated Videos</h4>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {generatedVideos.map(vid => (
              <div key={vid.id} className="bg-black rounded-lg overflow-hidden border border-zinc-800 group relative">
                <video src={vid.url} autoPlay loop muted className="w-full h-auto" />
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setFullscreenVideo(vid.url)} className="bg-black/50 hover:bg-white text-white hover:text-black w-8 h-8 rounded flex items-center justify-center transition-colors">
                    <i className="fas fa-expand text-xs" />
                  </button>
                  <a href={vid.url} download className="bg-black/50 hover:bg-white text-white hover:text-black w-8 h-8 rounded flex items-center justify-center transition-colors">
                    <i className="fas fa-download text-xs" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
