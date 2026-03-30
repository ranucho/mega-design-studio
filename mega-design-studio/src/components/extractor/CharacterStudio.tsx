import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useExtractor } from '@/contexts/ExtractorContext';
import { useApp } from '@/contexts/AppContext';
import { modifyImage, isolateSymbol, generateCharacterSheetFromReferences, generateGreenScreenVideo } from '@/services/gemini';
import { Crop, ReferenceAsset } from '@/types';
import { AspectRatioSelector } from '@/components/shared/AspectRatioSelector';
import { VideoFullscreen } from '@/components/shared/VideoFullscreen';
import { useToast } from '@/components/shared/Toast';
import { ScreenColorPicker, resolveScreenColor } from '@/components/shared/ScreenColorPicker';

type DragHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'create';

export const CharacterStudio: React.FC = () => {
  const { characterState, setCharacterState, setReferenceAssets, referenceAssets } = useExtractor();
  const { addAsset, assetLibrary } = useApp();
  const { toast } = useToast();
  const imageWrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [triggerName, setTriggerName] = useState('');
  const [showLabPicker, setShowLabPicker] = useState(false);
  const [fullscreenVideo, setFullscreenVideo] = useState<{ url: string; prompt?: string } | null>(null);
  const [dragState, setDragState] = useState<{
    handle: DragHandle; startX: number; startY: number; startCrop: Crop;
  } | null>(null);

  const {
    sourceImage, generatedImage, characterSheet, isolatedImage,
    prompt, videoPrompts, videoCount, crop, bgColor, aspectRatio, generatedVideos,
    isProcessingReskin, isProcessingSheet, isProcessingIsolation, isProcessingVideo,
  } = characterState;

  const RATIOS = ['9:16', '1:1', '16:9', '4:3'] as const;

  const updateState = (updates: Partial<typeof characterState>) => {
    setCharacterState(prev => ({ ...prev, ...updates }));
  };

  // Lab assets (merged & deduplicated)
  const labAssets = useMemo(() => {
    const seen = new Set(referenceAssets.map(a => a.id));
    const globalOnly = assetLibrary.filter(a => !seen.has(a.id));
    return [...referenceAssets, ...globalOnly];
  }, [referenceAssets, assetLibrary]);

  // --- File Upload ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          updateState({
            sourceImage: ev.target.result as string,
            crop: { x: 10, y: 10, w: 80, h: 80 },
            generatedImage: null, isolatedImage: null, characterSheet: null,
          });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // --- Load from Assets ---
  const handleLoadFromLab = (asset: ReferenceAsset) => {
    updateState({
      sourceImage: asset.url,
      crop: { x: 10, y: 10, w: 80, h: 80 },
      generatedImage: null, isolatedImage: null, characterSheet: null,
    });
    setShowLabPicker(false);
  };

  // --- MOUSE HANDLERS ---
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

  // --- Crop helper ---
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

  // --- AI: Extract character (generate full body from any crop, even partial) ---
  const handleExtractCharacter = async () => {
    if (!imgRef.current || !crop) return;
    updateState({ isProcessingReskin: true });
    try {
      const cropDataUrl = getCroppedImage();
      if (!cropDataUrl) throw new Error('Invalid crop');
      // AI generates a full-body character from the cropped reference (even if only torso/head)
      const fullBodyPrompt = `CHARACTER EXTRACTION & FULL BODY GENERATION:
Look at this cropped image — it contains a character (or part of a character such as a torso, head, or upper body).
Your task:
1. IDENTIFY the character in the crop
2. REMOVE all background elements — output on a SOLID WHITE background (#FFFFFF)
3. GENERATE THE COMPLETE FULL BODY of this character from head to toe, even if only a portion is visible in the crop
4. Maintain the EXACT same art style, colors, outfit, features, and design language
5. Standing pose, full body visible, centered on the canvas
6. The character should occupy about 80% of the canvas height
Output: A clean, full-body character on pure white background.`;
      const result = await modifyImage(cropDataUrl, fullBodyPrompt, aspectRatio, []);
      updateState({ generatedImage: result || cropDataUrl, isolatedImage: null, characterSheet: null });
      toast('Character extracted', { type: 'success' });
    } catch (err) { console.error(err); toast('Character extraction failed', { type: 'error' }); }
    finally { updateState({ isProcessingReskin: false }); }
  };

  // --- AI: Reskin character ---
  const handleReskinClick = async () => {
    if (!generatedImage || !prompt) return;
    updateState({ isProcessingReskin: true });
    try {
      const result = await modifyImage(generatedImage, prompt, aspectRatio, []);
      updateState({ generatedImage: result, isolatedImage: null, characterSheet: null });
      toast('Character reskinned', { type: 'success' });
    } catch (err) { console.error(err); toast('Reskin failed', { type: 'error' }); }
    finally { updateState({ isProcessingReskin: false }); }
  };

  // --- AI: Character sheet ---
  const handleGenerateSheet = async () => {
    if (!generatedImage) return;
    updateState({ isProcessingSheet: true });
    try {
      const result = await generateCharacterSheetFromReferences(generatedImage, []);
      updateState({ characterSheet: result });
      toast('Character sheet generated', { type: 'success' });
    } catch (err) { console.error(err); toast('Sheet generation failed', { type: 'error' }); }
    finally { updateState({ isProcessingSheet: false }); }
  };

  // --- AI: Chroma key isolation ---
  const handleChromaKey = async () => {
    if (!generatedImage) return;
    updateState({ isProcessingIsolation: true });
    try {
      const bgHex = resolveScreenColor(bgColor);
      const isolatePrompt = `Place this character on a solid ${bgHex} chroma key background. Keep the character exactly as-is, only change the background to a perfectly flat, uniform screen color (${bgHex}). No shadows, no gradients, no floor - just the character on pure ${bgHex}.`;
      const result = await modifyImage(generatedImage, isolatePrompt, aspectRatio, []);
      updateState({ isolatedImage: result });
      toast('Chroma key applied', { type: 'success' });
    } catch (err) { console.error(err); toast('Chroma key failed', { type: 'error' }); }
    finally { updateState({ isProcessingIsolation: false }); }
  };

  // --- Video generation (multi-prompt, multi-count) ---
  const handleGenerateVideos = async () => {
    if (!isolatedImage) return;
    const activePrompts = videoPrompts.filter(p => p.trim().length > 0);
    if (activePrompts.length === 0) return;
    updateState({ isProcessingVideo: true });
    try {
      const count = Math.min(4, Math.max(1, videoCount));
      const newVideos: { url: string; id: string; prompt?: string }[] = [];
      for (const vPrompt of activePrompts) {
        for (let i = 0; i < count; i++) {
          try {
            const videoAR = aspectRatio === '9:16' ? '9:16' : '16:9';
            const result = await generateGreenScreenVideo(isolatedImage, vPrompt, bgColor, videoAR);
            newVideos.push({ url: result.url, id: crypto.randomUUID(), prompt: vPrompt });
          } catch (err) { console.error(`Video failed: "${vPrompt}" (${i + 1})`, err); }
        }
      }
      updateState({ generatedVideos: [...generatedVideos, ...newVideos] });
      // Auto-save videos to Lab
      newVideos.forEach((v, i) => addAsset({ id: v.id, url: v.url, type: 'character_primary', name: `Char Video: ${v.prompt?.slice(0, 20) || i + 1}`, mediaType: 'video' }));
      toast(`Generated ${newVideos.length} video(s)`, { type: 'success' });
    } catch (err) { console.error(err); toast('Video generation failed', { type: 'error' }); }
    finally { updateState({ isProcessingVideo: false }); }
  };

  const handleAddToAssets = (url: string, name: string) => {
    const asset = { id: crypto.randomUUID(), url, type: 'character_primary' as const, name: name || 'Character' };
    setReferenceAssets(prev => [...prev, asset]);
    addAsset({ ...asset });
    setTriggerName('');
  };

  // Prompt helpers
  const addPromptSlot = () => { if (videoPrompts.length < 4) updateState({ videoPrompts: [...videoPrompts, ''] }); };
  const removePromptSlot = (idx: number) => { if (videoPrompts.length > 1) updateState({ videoPrompts: videoPrompts.filter((_, i) => i !== idx) }); };
  const updatePrompt = (idx: number, val: string) => { const u = [...videoPrompts]; u[idx] = val; updateState({ videoPrompts: u }); };
  const activePromptCount = videoPrompts.filter(p => p.trim().length > 0).length;
  const totalVideos = activePromptCount * videoCount;

  return (
    <div className="h-full overflow-y-auto p-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-white mb-2 flex items-center gap-3">
            <i className="fas fa-user-ninja text-pink-500" /> Character Studio
          </h1>
          <p className="text-sm text-zinc-400">
            Upload or load from Assets &rarr; Extract character &rarr; Reskin (optional) &rarr; Chroma Key &rarr; Animate.
          </p>
        </div>
        <AspectRatioSelector
          value={aspectRatio}
          onChange={(r) => updateState({ aspectRatio: r as any })}
          options={RATIOS as any}
        />
      </div>

      {/* STEP 1: SOURCE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* LEFT: Source */}
        <div className="flex flex-col gap-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">1. Source Image</h3>

          {/* Upload + Load from Assets buttons */}
          <div className="flex gap-3">
            <label className="flex-1 flex flex-col items-center justify-center h-28 border-2 border-dashed border-zinc-700 rounded-xl hover:border-pink-500 hover:bg-zinc-800/50 transition-all cursor-pointer group">
              <i className="fas fa-upload text-xl text-zinc-600 group-hover:text-pink-400 mb-1" />
              <span className="text-[10px] font-bold text-zinc-500 group-hover:text-zinc-300 uppercase">Upload Image</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
            </label>
            <button
              onClick={() => setShowLabPicker(true)}
              disabled={labAssets.length === 0}
              className="flex-1 flex flex-col items-center justify-center h-28 border-2 border-dashed border-zinc-700 rounded-xl hover:border-pink-500 hover:bg-zinc-800/50 transition-all disabled:opacity-30 group"
            >
              <i className="fas fa-flask text-xl text-zinc-600 group-hover:text-pink-400 mb-1" />
              <span className="text-[10px] font-bold text-zinc-500 group-hover:text-zinc-300 uppercase">Load from Assets</span>
              {labAssets.length > 0 && (
                <span className="bg-pink-600 text-white px-2 py-0.5 rounded-full text-[9px] mt-1">{labAssets.length}</span>
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
                {crop && crop.w > 0 && (
                  <div
                    className="absolute border-2 border-pink-500 box-content cursor-move z-20 shadow-[0_0_0_9999px_rgba(0,0,0,0.7)]"
                    style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }}
                    onMouseDown={(e) => handleMouseDown(e, 'move')}
                  >
                    <div className="absolute -top-2 -left-2 w-4 h-4 bg-pink-500 cursor-nw-resize z-30 rounded-sm" onMouseDown={(e) => handleMouseDown(e, 'nw')} />
                    <div className="absolute -top-2 -right-2 w-4 h-4 bg-pink-500 cursor-ne-resize z-30 rounded-sm" onMouseDown={(e) => handleMouseDown(e, 'ne')} />
                    <div className="absolute -bottom-2 -left-2 w-4 h-4 bg-pink-500 cursor-sw-resize z-30 rounded-sm" onMouseDown={(e) => handleMouseDown(e, 'sw')} />
                    <div className="absolute -bottom-2 -right-2 w-4 h-4 bg-pink-500 cursor-se-resize z-30 rounded-sm" onMouseDown={(e) => handleMouseDown(e, 'se')} />
                  </div>
                )}
              </div>
            ) : (
              <div className="text-zinc-600 flex flex-col items-center pointer-events-none gap-2 text-center p-8">
                <i className="fas fa-user text-4xl mb-2" />
                <span>Upload or load a source image with a character</span>
              </div>
            )}
          </div>

          {sourceImage && (
            <button onClick={handleExtractCharacter} disabled={isProcessingReskin || !crop}
              className="bg-pink-600 hover:bg-pink-500 text-white py-3 rounded-lg text-xs font-bold uppercase transition-colors disabled:opacity-50 shadow-lg flex items-center justify-center gap-2">
              {isProcessingReskin
                ? <><i className="fas fa-spinner animate-spin" /> Extracting...</>
                : <><i className="fas fa-cut" /> Extract Full-Body Character</>}
            </button>
          )}
        </div>

        {/* RIGHT: Result + Reskin + Save */}
        <div className="flex flex-col gap-6">
          {/* Extracted / Generated result */}
          <div className="flex flex-col gap-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 flex-1">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">2. Character Result</h3>
            <div className="flex-1 bg-black rounded-xl border border-zinc-800 relative overflow-hidden flex items-center justify-center min-h-[250px]">
              {generatedImage ? (
                <img src={generatedImage} className="max-w-full max-h-[50vh] object-contain" />
              ) : (
                <div className="text-zinc-700 text-sm font-mono flex flex-col items-center gap-2">
                  {isProcessingReskin && <div className="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />}
                  <span>{isProcessingReskin ? 'Extracting...' : 'No character yet'}</span>
                </div>
              )}
            </div>

            {generatedImage && (
              <>
                {/* Reskin controls */}
                <div className="flex flex-col gap-2 border-t border-zinc-800 pt-3">
                  <label className="text-[10px] uppercase font-bold text-zinc-500">Optional: Reskin</label>
                  <div className="flex gap-2">
                    <input type="text" className="flex-1 bg-black border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:border-pink-500 outline-none"
                      placeholder='E.g. "Cyberpunk samurai, high detail"'
                      value={prompt} onChange={e => updateState({ prompt: e.target.value })} />
                    <button onClick={handleReskinClick} disabled={!prompt || isProcessingReskin}
                      className="bg-pink-600 hover:bg-pink-500 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase transition-colors disabled:opacity-50">
                      {isProcessingReskin ? <i className="fas fa-spinner animate-spin" /> : 'Reskin'}
                    </button>
                  </div>
                </div>

                {/* Save + Sheet */}
                <div className="flex gap-2 items-center">
                  <input type="text" placeholder="Name..." className="flex-1 bg-zinc-800 rounded px-3 py-2 text-xs border border-zinc-700 text-white"
                    value={triggerName} onChange={e => setTriggerName(e.target.value)} />
                  <button onClick={() => handleAddToAssets(generatedImage, triggerName)}
                    className="bg-green-600 hover:bg-green-500 text-white px-5 py-2 rounded-lg text-xs font-bold uppercase transition-colors shadow-lg">
                    Save
                  </button>
                </div>
                <button onClick={handleGenerateSheet} disabled={isProcessingSheet}
                  className="w-full bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/30 text-indigo-200 hover:text-white px-4 py-2 rounded-lg text-xs font-bold uppercase transition-colors flex items-center justify-center gap-2">
                  {isProcessingSheet ? <i className="fas fa-spinner animate-spin" /> : <i className="fas fa-columns" />}
                  Character Sheet (Front/Side/Face)
                </button>
              </>
            )}

            {characterSheet && (
              <div className="p-4 bg-black/40 rounded-xl border border-zinc-800 animate-in fade-in">
                <h4 className="text-[10px] font-bold text-zinc-500 uppercase mb-2">Character Sheet</h4>
                <img src={characterSheet} className="w-full h-auto object-contain rounded-lg border border-zinc-800" />
                <button onClick={() => handleAddToAssets(characterSheet, 'Character Sheet')}
                  className="mt-2 w-full text-[10px] bg-zinc-800 hover:bg-green-600 text-white py-2 rounded transition-colors uppercase font-bold">
                  <i className="fas fa-save mr-1" /> Save Sheet
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* STEP 3: CHROMA KEY */}
      {generatedImage && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 mb-8 animate-in slide-in-from-bottom-4">
          <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-4">3. Chroma Key — Background Separation</h3>
          <div className="flex items-center gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] uppercase font-bold text-zinc-500">Screen Color</label>
              <ScreenColorPicker value={bgColor} onChange={hex => updateState({ bgColor: hex })} size="md" />
            </div>
            <button onClick={handleChromaKey} disabled={isProcessingIsolation}
              className="h-14 px-8 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white rounded-xl text-xs font-bold uppercase transition-colors disabled:opacity-50">
              {isProcessingIsolation ? <><i className="fas fa-spinner animate-spin mr-2" />Isolating...</> : <><i className="fas fa-magic mr-2" />Apply Chroma Key</>}
            </button>
          </div>

          {isolatedImage && (
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in">
              {/* Preview */}
              <div className="bg-black border border-zinc-800 rounded-xl overflow-hidden p-3 relative">
                <span className="text-[9px] text-zinc-500 font-bold uppercase block mb-1">Isolated Preview</span>
                <img src={isolatedImage} className="w-full h-auto object-contain" />
                {isProcessingVideo && (
                  <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-20 backdrop-blur-sm">
                    <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin mb-2" />
                    <span className="text-xs font-bold text-white uppercase animate-pulse">Generating...</span>
                  </div>
                )}
                <button onClick={() => handleAddToAssets(isolatedImage, 'Isolated Character')}
                  className="mt-2 w-full text-[10px] bg-zinc-800 hover:bg-green-600 text-white py-2 rounded transition-colors uppercase font-bold">
                  <i className="fas fa-save mr-1" /> Save Isolated
                </button>
              </div>

              {/* Animation controls */}
              <div className="lg:col-span-2 flex flex-col gap-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">4. Animate</h3>

                {/* Multi-prompt inputs */}
                <div className="flex flex-col gap-3">
                  {videoPrompts.map((vp, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <span className="text-[10px] text-zinc-600 font-bold mt-2.5 w-4 text-right">{idx + 1}.</span>
                      <textarea className="flex-1 bg-black border border-zinc-700 rounded-lg p-2 text-sm text-white focus:border-pink-500 outline-none resize-none h-16"
                        placeholder={idx === 0 ? 'E.g. "Running forward", "Idle breathing"' : 'Another action...'}
                        value={vp} onChange={e => updatePrompt(idx, e.target.value)} />
                      {videoPrompts.length > 1 && (
                        <button onClick={() => removePromptSlot(idx)} className="text-zinc-600 hover:text-red-400 mt-2 transition-colors">
                          <i className="fas fa-times" />
                        </button>
                      )}
                    </div>
                  ))}
                  {videoPrompts.length < 4 && (
                    <button onClick={addPromptSlot}
                      className="text-[10px] text-zinc-500 hover:text-pink-400 uppercase font-bold flex items-center gap-1 self-start ml-6 transition-colors">
                      <i className="fas fa-plus" /> Add Prompt (up to 4)
                    </button>
                  )}
                </div>

                {/* Video count */}
                <div className="flex items-center gap-4">
                  <label className="text-[10px] uppercase font-bold text-zinc-500">Per prompt:</label>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map(n => (
                      <button key={n} onClick={() => updateState({ videoCount: n })}
                        className={`w-10 h-10 rounded-lg text-sm font-black transition-all ${videoCount === n ? 'bg-pink-600 text-white shadow-lg scale-105' : 'bg-zinc-800 text-zinc-500 hover:text-white hover:bg-zinc-700 border border-zinc-700'}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                  {totalVideos > 0 && <span className="text-[10px] text-zinc-500 italic">= {totalVideos} total</span>}
                </div>

                <button onClick={handleGenerateVideos} disabled={!isolatedImage || activePromptCount === 0 || isProcessingVideo}
                  className="bg-pink-600 hover:bg-pink-500 text-white py-3 rounded-lg text-xs font-bold uppercase transition-colors disabled:opacity-50 shadow-lg flex items-center justify-center gap-2">
                  {isProcessingVideo
                    ? <><i className="fas fa-spinner animate-spin" /> Generating {totalVideos} Video{totalVideos > 1 ? 's' : ''}...</>
                    : <><i className="fas fa-film" /> Generate {totalVideos} Video{totalVideos > 1 ? 's' : ''}</>}
                </button>
              </div>
            </div>
          )}
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
                {vid.prompt && (
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-[9px] text-zinc-300 line-clamp-2">{vid.prompt}</span>
                  </div>
                )}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => setFullscreenVideo({ url: vid.url, prompt: vid.prompt })} className="bg-black/50 hover:bg-white text-white hover:text-black w-8 h-8 rounded flex items-center justify-center transition-colors">
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

      {fullscreenVideo && <VideoFullscreen url={fullscreenVideo.url} promptText={fullscreenVideo.prompt} onClose={() => setFullscreenVideo(null)} />}

      {/* LAB PICKER MODAL */}
      {showLabPicker && (
        <div className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-6 backdrop-blur-sm" onClick={() => setShowLabPicker(false)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-3xl w-full max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-6 border-b border-zinc-800">
              <h3 className="text-lg font-black uppercase tracking-widest text-white flex items-center gap-2">
                <i className="fas fa-folder-open text-pink-500" /> Load from Assets
              </h3>
              <button onClick={() => setShowLabPicker(false)} className="text-zinc-500 hover:text-white"><i className="fas fa-times" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {labAssets.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">No assets available.</div>
              ) : (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
                  {labAssets.map(asset => (
                    <button key={asset.id} onClick={() => handleLoadFromLab(asset)} className="bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden hover:border-pink-500 transition-all group">
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
