import React, { useRef, useEffect, useState, useMemo } from 'react';
import { useExtractor } from '@/contexts/ExtractorContext';
import { useApp } from '@/contexts/AppContext';
import { modifyImage, isolateSymbol, generateCharacterSheetFromReferences, generateGreenScreenVideo } from '@/services/gemini';
import { Crop, ReferenceAsset } from '@/types';
import { AspectRatioSelector } from '@/components/shared/AspectRatioSelector';
import { VideoFullscreen } from '@/components/shared/VideoFullscreen';

type DragHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | 'create';

// Screen color presets
const SCREEN_COLORS = [
  { key: 'green', hex: '#00fa15', label: 'Green' },
  { key: 'blue', hex: '#0072ff', label: 'Blue' },
  { key: 'pink', hex: '#ff4dfd', label: 'Pink' },
] as const;

export const CharacterStudio: React.FC = () => {
  const { characterState, setCharacterState, setReferenceAssets, referenceAssets } = useExtractor();
  const { addAsset, assetLibrary } = useApp();
  const imageWrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [triggerName, setTriggerName] = useState('');
  const [showLabPicker, setShowLabPicker] = useState(false);
  const [fullscreenVideo, setFullscreenVideo] = useState<{ url: string; prompt?: string } | null>(null);
  const [customColor, setCustomColor] = useState('');
  const [showColorPicker, setShowColorPicker] = useState(false);
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

  const labAssets = useMemo(() => {
    const seen = new Set(referenceAssets.map(a => a.id));
    const globalOnly = assetLibrary.filter(a => !seen.has(a.id));
    return [...referenceAssets, ...globalOnly];
  }, [referenceAssets, assetLibrary]);

  // Resolve current screen color hex
  const currentScreenHex = SCREEN_COLORS.find(c => c.key === bgColor)?.hex || bgColor;

  // --- File Upload ---
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          updateState({ sourceImage: ev.target.result as string, crop: { x: 10, y: 10, w: 80, h: 80 }, generatedImage: null, isolatedImage: null, characterSheet: null });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLoadFromLab = (asset: ReferenceAsset) => {
    updateState({ sourceImage: asset.url, crop: { x: 10, y: 10, w: 80, h: 80 }, generatedImage: null, isolatedImage: null, characterSheet: null });
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

  const handleExtractCharacter = async () => {
    if (!imgRef.current || !crop) return;
    updateState({ isProcessingReskin: true });
    try {
      const cropDataUrl = getCroppedImage();
      if (!cropDataUrl) throw new Error('Invalid crop');
      const fullBodyPrompt = `CHARACTER EXTRACTION & FULL BODY GENERATION:
Look at this cropped image — it contains a character (or part of a character such as a torso, head, or upper body).
Your task:
1. LOOK at the character VISUALLY in this crop. Do NOT rely on any text label — extract EXACTLY what you SEE.
2. REMOVE all background elements — output on a SOLID WHITE background (#FFFFFF)
3. GENERATE THE COMPLETE FULL BODY of this character from head to toe, even if only a portion is visible
4. Maintain the EXACT same art style, colors, outfit, features, pose, and design language
5. The character must look IDENTICAL to what is in the crop
6. Full body visible, centered on the canvas, occupying about 80% of canvas height
7. Do NOT add any outline, stroke, or border around the character
Output: A clean, full-body character on pure white background.`;
      const result = await modifyImage(cropDataUrl, fullBodyPrompt, aspectRatio, []);
      updateState({ generatedImage: result || cropDataUrl, isolatedImage: null, characterSheet: null });
    } catch (err) { console.error(err); alert('Character extraction failed'); }
    finally { updateState({ isProcessingReskin: false }); }
  };

  const handleReskinClick = async () => {
    if (!generatedImage || !prompt) return;
    updateState({ isProcessingReskin: true });
    try {
      const result = await modifyImage(generatedImage, prompt, aspectRatio, []);
      updateState({ generatedImage: result, isolatedImage: null, characterSheet: null });
    } catch (err) { console.error(err); alert('Reskin failed'); }
    finally { updateState({ isProcessingReskin: false }); }
  };

  const handleGenerateSheet = async () => {
    if (!generatedImage) return;
    updateState({ isProcessingSheet: true });
    try {
      const result = await generateCharacterSheetFromReferences(generatedImage, []);
      updateState({ characterSheet: result });
    } catch (err) { console.error(err); alert('Sheet generation failed'); }
    finally { updateState({ isProcessingSheet: false }); }
  };

  const handleChromaKey = async () => {
    if (!generatedImage) return;
    updateState({ isProcessingIsolation: true });
    try {
      const bgHex = currentScreenHex;
      const colorName = SCREEN_COLORS.find(c => c.key === bgColor)?.label || bgColor;
      const isolatePrompt = `Place this character on a solid ${bgHex} chroma key background. Keep the character exactly as-is, only change the background to a perfectly flat, uniform ${colorName} screen color (${bgHex}). No shadows, no gradients, no floor - just the character on pure ${colorName}.`;
      const result = await modifyImage(generatedImage, isolatePrompt, aspectRatio, []);
      updateState({ isolatedImage: result });
    } catch (err) { console.error(err); alert('Chroma key failed'); }
    finally { updateState({ isProcessingIsolation: false }); }
  };

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
      newVideos.forEach((v, i) => addAsset({ id: v.id, url: v.url, type: 'character_primary', name: `Char Video: ${v.prompt?.slice(0, 20) || i + 1}`, mediaType: 'video' }));
    } catch (err) { console.error(err); alert('Video generation failed'); }
    finally { updateState({ isProcessingVideo: false }); }
  };

  const handleAddToAssets = (url: string, name: string) => {
    const asset = { id: crypto.randomUUID(), url, type: 'character_primary' as const, name: name || 'Character' };
    setReferenceAssets(prev => [...prev, asset]);
    addAsset({ ...asset });
    setTriggerName('');
  };

  const addPromptSlot = () => { if (videoPrompts.length < 4) updateState({ videoPrompts: [...videoPrompts, ''] }); };
  const removePromptSlot = (idx: number) => { if (videoPrompts.length > 1) updateState({ videoPrompts: videoPrompts.filter((_, i) => i !== idx) }); };
  const updatePrompt = (idx: number, val: string) => { const u = [...videoPrompts]; u[idx] = val; updateState({ videoPrompts: u }); };
  const activePromptCount = videoPrompts.filter(p => p.trim().length > 0).length;
  const totalVideos = activePromptCount * videoCount;

  const StepBadge = ({ n, label, active }: { n: number; label: string; active: boolean }) => (
    <div className={`flex items-center gap-2 ${active ? 'text-white' : 'text-zinc-600'}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black ${active ? 'bg-pink-600 text-white' : 'bg-zinc-800 text-zinc-600'}`}>{n}</div>
      <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
    </div>
  );

  // Apply custom color
  const applyCustomColor = () => {
    let hex = customColor.trim();
    if (hex && !hex.startsWith('#')) hex = '#' + hex;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      updateState({ bgColor: hex });
      setShowColorPicker(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <i className="fas fa-user-ninja text-pink-500 text-lg" />
          <h1 className="text-xl font-black uppercase tracking-tight text-white">Character Studio</h1>
        </div>
        <AspectRatioSelector value={aspectRatio} onChange={(r) => updateState({ aspectRatio: r as any })} options={RATIOS as any} />
      </div>

      {/* Steps */}
      <div className="flex items-center gap-6 mb-6 pb-4 border-b border-zinc-800/50">
        <StepBadge n={1} label="Source" active={true} />
        <div className="w-8 h-px bg-zinc-800" />
        <StepBadge n={2} label="Extract" active={!!generatedImage} />
        <div className="w-8 h-px bg-zinc-800" />
        <StepBadge n={3} label="Chroma Key" active={!!isolatedImage} />
        <div className="w-8 h-px bg-zinc-800" />
        <StepBadge n={4} label="Animate" active={generatedVideos.length > 0} />
      </div>

      <div className="max-w-4xl mx-auto flex flex-col gap-6">

        {/* SOURCE + RESULT side by side */}
        <div className={`grid gap-6 ${generatedImage ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 max-w-lg'}`}>
          {/* Source */}
          <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Source</span>
              {sourceImage && (
                <button onClick={() => updateState({ sourceImage: null, generatedImage: null, isolatedImage: null, characterSheet: null, crop: null })}
                  className="text-[10px] text-zinc-600 hover:text-red-400 transition-colors"><i className="fas fa-times mr-1" />Clear</button>
              )}
            </div>

            {!sourceImage ? (
              <div className="flex gap-3">
                <label className="flex-1 flex flex-col items-center justify-center h-32 border-2 border-dashed border-zinc-700/50 rounded-xl hover:border-pink-500/50 hover:bg-pink-500/5 transition-all cursor-pointer group">
                  <i className="fas fa-upload text-xl text-zinc-600 group-hover:text-pink-400 mb-2" />
                  <span className="text-[10px] font-bold text-zinc-500 group-hover:text-zinc-300 uppercase">Upload</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                </label>
                <button onClick={() => setShowLabPicker(true)} disabled={labAssets.length === 0}
                  className="flex-1 flex flex-col items-center justify-center h-32 border-2 border-dashed border-zinc-700/50 rounded-xl hover:border-pink-500/50 hover:bg-pink-500/5 transition-all disabled:opacity-30 group">
                  <i className="fas fa-folder-open text-xl text-zinc-600 group-hover:text-pink-400 mb-2" />
                  <span className="text-[10px] font-bold text-zinc-500 group-hover:text-zinc-300 uppercase">From Assets</span>
                  {labAssets.length > 0 && <span className="bg-pink-600 text-white px-2 py-0.5 rounded-full text-[9px] mt-1">{labAssets.length}</span>}
                </button>
              </div>
            ) : (
              <>
                <div className="relative" onMouseDown={(e) => handleMouseDown(e, 'create')}>
                  <div ref={imageWrapperRef} className="relative inline-block w-full">
                    <img ref={imgRef} src={sourceImage} className="w-full h-auto max-h-[40vh] object-contain rounded-lg pointer-events-none select-none" draggable={false} />
                    {crop && crop.w > 0 && (
                      <div className="absolute border-2 border-pink-500 box-content cursor-move z-20 shadow-[0_0_0_9999px_rgba(0,0,0,0.7)]"
                        style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }}
                        onMouseDown={(e) => handleMouseDown(e, 'move')}>
                        {(['nw', 'ne', 'sw', 'se'] as const).map(h => (
                          <div key={h} className={`absolute w-3.5 h-3.5 bg-pink-500 rounded-sm z-30 cursor-${h}-resize ${h.includes('n') ? '-top-1.5' : '-bottom-1.5'} ${h.includes('w') ? '-left-1.5' : '-right-1.5'}`}
                            onMouseDown={(e) => handleMouseDown(e, h)} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={handleExtractCharacter} disabled={isProcessingReskin || !crop}
                  className="mt-3 w-full bg-pink-600 hover:bg-pink-500 text-white py-2.5 rounded-lg text-[10px] font-bold uppercase transition-colors disabled:opacity-40 shadow-lg flex items-center justify-center gap-2">
                  {isProcessingReskin ? <><i className="fas fa-spinner animate-spin" /> Extracting...</> : <><i className="fas fa-cut" /> Extract Full-Body</>}
                </button>
              </>
            )}
          </div>

          {/* Result + Reskin + Save */}
          {generatedImage && (
            <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-xl p-5 animate-in fade-in flex flex-col">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">Character</span>
              <div className="bg-black/50 rounded-lg border border-zinc-800/50 overflow-hidden flex items-center justify-center mb-3 flex-1 min-h-[200px]">
                <img src={generatedImage} className="max-w-full max-h-[40vh] object-contain" />
              </div>

              {/* Reskin inline */}
              <div className="flex gap-2 mb-3">
                <input type="text" className="flex-1 bg-black/50 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-white focus:border-pink-500 outline-none"
                  placeholder='Reskin: "Cyberpunk samurai"'
                  value={prompt} onChange={e => updateState({ prompt: e.target.value })} />
                <button onClick={handleReskinClick} disabled={!prompt || isProcessingReskin}
                  className="bg-pink-600 hover:bg-pink-500 text-white px-4 py-2 rounded-lg text-[10px] font-bold uppercase transition-colors disabled:opacity-40">
                  {isProcessingReskin ? <i className="fas fa-spinner animate-spin" /> : 'Reskin'}
                </button>
              </div>

              {/* Save + Sheet row */}
              <div className="flex gap-2 items-center mb-2">
                <input type="text" placeholder="Name..." className="flex-1 bg-zinc-800/80 rounded-lg px-3 py-1.5 text-xs border border-zinc-700/50 text-white"
                  value={triggerName} onChange={e => setTriggerName(e.target.value)} />
                <button onClick={() => handleAddToAssets(generatedImage, triggerName)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-colors">
                  <i className="fas fa-save mr-1" />Save
                </button>
              </div>
              <button onClick={handleGenerateSheet} disabled={isProcessingSheet}
                className="w-full bg-indigo-600/15 hover:bg-indigo-600 border border-indigo-500/20 text-indigo-300 hover:text-white px-3 py-2 rounded-lg text-[10px] font-bold uppercase transition-colors flex items-center justify-center gap-2">
                {isProcessingSheet ? <i className="fas fa-spinner animate-spin" /> : <i className="fas fa-columns" />}
                Character Sheet
              </button>

              {characterSheet && (
                <div className="mt-3 p-3 bg-black/30 rounded-lg border border-zinc-800/50 animate-in fade-in">
                  <img src={characterSheet} className="w-full h-auto object-contain rounded" />
                  <button onClick={() => handleAddToAssets(characterSheet, 'Character Sheet')}
                    className="mt-2 w-full text-[10px] bg-zinc-800 hover:bg-emerald-600 text-white py-1.5 rounded transition-colors uppercase font-bold">
                    <i className="fas fa-save mr-1" /> Save Sheet
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* CHROMA KEY */}
        {generatedImage && (
          <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-xl p-5 animate-in slide-in-from-bottom-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3 block">Chroma Key</span>
            <div className="flex items-center gap-4 flex-wrap">
              {/* Preset colors */}
              {SCREEN_COLORS.map(c => (
                <button key={c.key} onClick={() => updateState({ bgColor: c.key })}
                  className={`w-11 h-11 rounded-lg border-2 transition-all flex items-center justify-center ${bgColor === c.key ? 'border-white scale-110 shadow-lg' : 'border-zinc-700/50 opacity-60 hover:opacity-90'}`}
                  style={{ backgroundColor: c.hex }}
                  title={`${c.label} (${c.hex})`}>
                  {bgColor === c.key && <i className="fas fa-check text-black text-sm" />}
                </button>
              ))}

              {/* Custom color */}
              <div className="relative">
                <button onClick={() => setShowColorPicker(!showColorPicker)}
                  className={`w-11 h-11 rounded-lg border-2 transition-all flex items-center justify-center ${!SCREEN_COLORS.some(c => c.key === bgColor) ? 'border-white scale-110' : 'border-zinc-700/50 opacity-60 hover:opacity-90'}`}
                  style={{ backgroundColor: !SCREEN_COLORS.some(c => c.key === bgColor) ? bgColor : '#333' }}
                  title="Custom color">
                  <i className="fas fa-eyedropper text-white text-xs" />
                </button>
                {showColorPicker && (
                  <div className="absolute top-full left-0 mt-2 z-50 bg-zinc-900 border border-zinc-700 rounded-lg p-3 shadow-xl flex flex-col gap-2 min-w-[180px]">
                    <div className="flex gap-2">
                      <input type="color" value={customColor.startsWith('#') ? customColor : '#00fa15'}
                        onChange={e => setCustomColor(e.target.value)}
                        className="w-10 h-10 rounded cursor-pointer bg-transparent border-0" />
                      <input type="text" value={customColor} onChange={e => setCustomColor(e.target.value)}
                        placeholder="#hex"
                        className="flex-1 bg-black border border-zinc-700 rounded px-2 py-1 text-xs text-white font-mono outline-none focus:border-pink-500" />
                    </div>
                    <button onClick={applyCustomColor}
                      className="bg-pink-600 hover:bg-pink-500 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase">Apply</button>
                  </div>
                )}
              </div>

              <div className="w-px h-8 bg-zinc-800" />

              <button onClick={handleChromaKey} disabled={isProcessingIsolation}
                className="h-11 px-6 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 text-white rounded-lg text-[10px] font-bold uppercase transition-colors disabled:opacity-40">
                {isProcessingIsolation ? <><i className="fas fa-spinner animate-spin mr-2" />Isolating...</> : <><i className="fas fa-magic mr-2" />Apply</>}
              </button>
            </div>

            {/* Isolated result inline */}
            {isolatedImage && (
              <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 animate-in fade-in">
                <div className="bg-black/50 border border-zinc-800/50 rounded-lg overflow-hidden p-3 relative">
                  <img src={isolatedImage} className="w-full h-auto object-contain rounded" />
                  {isProcessingVideo && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-20 backdrop-blur-sm">
                      <div className="w-8 h-8 border-4 border-pink-500 border-t-transparent rounded-full animate-spin mb-2" />
                      <span className="text-xs font-bold text-white uppercase animate-pulse">Generating...</span>
                    </div>
                  )}
                  <button onClick={() => handleAddToAssets(isolatedImage, 'Isolated Character')}
                    className="mt-2 w-full text-[10px] bg-zinc-800 hover:bg-emerald-600 text-white py-1.5 rounded transition-colors uppercase font-bold">
                    <i className="fas fa-save mr-1" /> Save Isolated
                  </button>
                </div>

                {/* Animate controls */}
                <div className="lg:col-span-2 flex flex-col gap-3">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Animate</span>
                  {videoPrompts.map((vp, idx) => (
                    <div key={idx} className="flex gap-2 items-start">
                      <span className="text-[10px] text-zinc-600 font-bold mt-2 w-3 text-right">{idx + 1}.</span>
                      <textarea className="flex-1 bg-black/50 border border-zinc-700/50 rounded-lg p-2 text-sm text-white focus:border-pink-500 outline-none resize-none h-14"
                        placeholder={idx === 0 ? '"Running forward", "Idle breathing"' : 'Another action...'}
                        value={vp} onChange={e => updatePrompt(idx, e.target.value)} />
                      {videoPrompts.length > 1 && (
                        <button onClick={() => removePromptSlot(idx)} className="text-zinc-600 hover:text-red-400 mt-2 transition-colors"><i className="fas fa-times" /></button>
                      )}
                    </div>
                  ))}
                  {videoPrompts.length < 4 && (
                    <button onClick={addPromptSlot}
                      className="text-[10px] text-zinc-500 hover:text-pink-400 uppercase font-bold flex items-center gap-1 self-start ml-5 transition-colors">
                      <i className="fas fa-plus" /> Add Prompt
                    </button>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="text-[8px] text-zinc-600 uppercase font-bold">Per prompt:</span>
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4].map(n => (
                        <button key={n} onClick={() => updateState({ videoCount: n })}
                          className={`w-8 h-8 rounded text-xs font-black transition-all ${videoCount === n ? 'bg-pink-600 text-white' : 'bg-zinc-800 text-zinc-500 hover:text-white border border-zinc-700/50'}`}>
                          {n}
                        </button>
                      ))}
                    </div>
                    {totalVideos > 0 && <span className="text-[10px] text-zinc-500">= {totalVideos} total</span>}
                  </div>
                  <button onClick={handleGenerateVideos} disabled={!isolatedImage || activePromptCount === 0 || isProcessingVideo}
                    className="bg-pink-600 hover:bg-pink-500 text-white py-2.5 rounded-lg text-xs font-bold uppercase transition-colors disabled:opacity-40 shadow-lg flex items-center justify-center gap-2">
                    {isProcessingVideo ? <><i className="fas fa-spinner animate-spin" /> Generating...</> : <><i className="fas fa-film" /> Generate {totalVideos} Video{totalVideos !== 1 ? 's' : ''}</>}
                  </button>
                </div>
              </div>
            )}
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
                  {vid.prompt && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <span className="text-[9px] text-zinc-300 line-clamp-2">{vid.prompt}</span>
                    </div>
                  )}
                  <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setFullscreenVideo({ url: vid.url, prompt: vid.prompt })} className="bg-black/60 hover:bg-white text-white hover:text-black w-7 h-7 rounded flex items-center justify-center transition-colors">
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
