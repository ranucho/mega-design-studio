/**
 * Save/Load project state as a self-contained HTML file.
 *
 * Save: Collect state from all contexts → strip transient/video fields → embed as JSON in HTML viewer
 * Load: Parse HTML → extract JSON → restore state to all contexts
 */

import type React from 'react';
import {
  Character, StoryScene, AppStep,
  ReferenceAsset, SlotState, CharacterState, BackgroundState,
  SymbolGeneratorState, CompositorState, SymbolItem, MergedFrame,
  VideoSegment, ExtractedFrame,
} from '@/types';

// ─── ProjectData Shape ────────────────────────────────────────────

export interface ProjectData {
  version: 1;
  savedAt: string;
  projectName: string;

  animatix: {
    characters: Character[];
    scenes: StoryScene[];
    style: string;
    brief: string;
    storyTitle: string;
    sceneCount: number;
    step: AppStep;
    isApproved: boolean;
    aspectRatio: string;
  };

  extractor: {
    segments: VideoSegment[];
    activeSegmentId: string | null;
    modificationPrompt: string;
    referenceAssets: ReferenceAsset[];
    videoAspectRatio: number;
    slotState: Partial<SlotState>;
    characterState: Partial<CharacterState>;
    backgroundState: Partial<BackgroundState>;
    symbolGenState: Partial<SymbolGeneratorState>;
    compositorState: Partial<CompositorState>;
  };

  app: {
    assetLibrary: ReferenceAsset[];
    aspectRatio: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

/** True if the string is a blob: URL (invalid after page reload) */
const isBlobUrl = (s: string | null | undefined): boolean =>
  typeof s === 'string' && s.startsWith('blob:');

/** Strip blob URLs from a string field, returning null */
const cleanUrl = (url: string | null | undefined): string | null =>
  url && !isBlobUrl(url) ? url : null;

// ─── Collect ──────────────────────────────────────────────────────

interface CollectInput {
  // Animatix
  characters: Character[];
  scenes: StoryScene[];
  style: string;
  brief: string;
  storyTitle: string;
  sceneCount: number;
  step: AppStep;
  isApproved: boolean;
  animatixAspectRatio: string;

  // Extractor
  segments: VideoSegment[];
  activeSegmentId: string | null;
  modificationPrompt: string;
  referenceAssets: ReferenceAsset[];
  videoAspectRatio: number;
  slotState: SlotState;
  characterState: CharacterState;
  backgroundState: BackgroundState;
  symbolGenState: SymbolGeneratorState;
  compositorState: CompositorState;

  // App
  assetLibrary: ReferenceAsset[];
  appAspectRatio: string;
}

export function collectProjectData(input: CollectInput): ProjectData {
  const projectName = input.storyTitle || 'Untitled Project';

  // --- Clean Animatix ---
  const cleanChars: Character[] = input.characters.map(c => ({
    id: c.id,
    type: c.type,
    name: c.name,
    description: c.description,
    masterBlueprint: cleanUrl(c.masterBlueprint) ?? undefined,
    referenceImage: cleanUrl(c.referenceImage) ?? undefined,
    inputReferences: (c.inputReferences || []).map(r => cleanUrl(r) ?? '').filter(Boolean),
    preserveOriginal: c.preserveOriginal,
  }));

  const cleanScenes: StoryScene[] = input.scenes.map(s => ({
    id: s.id,
    title: s.title,
    dialogue: s.dialogue,
    visual_prompt: s.visual_prompt,
    action_prompt: s.action_prompt,
    camera_angle: s.camera_angle,
    imageUrl: cleanUrl(s.imageUrl) ?? undefined,
    // Strip video fields
    includeInVideo: s.includeInVideo,
    isHiddenFromStoryboard: s.isHiddenFromStoryboard,
    aspectRatio: s.aspectRatio,
    trimStart: s.trimStart,
    trimEnd: s.trimEnd,
    videoDuration: s.videoDuration,
  }));

  // --- Clean Extractor segments (keep frames, strip clips) ---
  const cleanSegments: VideoSegment[] = input.segments.map(seg => ({
    id: seg.id,
    start: seg.start,
    end: seg.end,
    description: seg.description,
    cameraMotion: seg.cameraMotion,
    shotType: seg.shotType,
    prompt: seg.prompt,
    frames: seg.frames.map(f => cleanFrame(f)),
    generatedClips: [], // strip video clips
  }));

  // --- Clean SlotState ---
  const cleanSlot: Partial<SlotState> = {
    sourceImage: cleanUrl(input.slotState.sourceImage),
    resultSymbolImage: cleanUrl(input.slotState.resultSymbolImage),
    resultFrameImage: cleanUrl(input.slotState.resultFrameImage),
    rows: input.slotState.rows,
    cols: input.slotState.cols,
    prompt: input.slotState.prompt,
    crop: input.slotState.crop,
  };

  // --- Clean CharacterState ---
  const cleanChar: Partial<CharacterState> = {
    sourceImage: cleanUrl(input.characterState.sourceImage),
    generatedImage: cleanUrl(input.characterState.generatedImage),
    characterSheet: cleanUrl(input.characterState.characterSheet),
    isolatedImage: cleanUrl(input.characterState.isolatedImage),
    prompt: input.characterState.prompt,
    videoPrompts: input.characterState.videoPrompts,
    videoCount: input.characterState.videoCount,
    crop: input.characterState.crop,
    bgColor: input.characterState.bgColor,
    aspectRatio: input.characterState.aspectRatio,
    // Strip generatedVideos, isProcessing*
  };

  // --- Clean BackgroundState ---
  const cleanBg: Partial<BackgroundState> = {
    sourceImage: cleanUrl(input.backgroundState.sourceImage),
    generatedImage: cleanUrl(input.backgroundState.generatedImage),
    prompt: input.backgroundState.prompt,
    aspectRatio: input.backgroundState.aspectRatio,
    crop: input.backgroundState.crop,
    videoPrompt: input.backgroundState.videoPrompt,
    videoCount: input.backgroundState.videoCount,
    // Strip generatedVideos, isProcessing*
  };

  // --- Clean SymbolGenState ---
  const sg = input.symbolGenState;
  const cleanSymGen: Partial<SymbolGeneratorState> = {
    masterImage: cleanUrl(sg.masterImage),
    reskinResult: cleanUrl(sg.reskinResult),
    masterPrompt: sg.masterPrompt,
    activeMasterView: sg.activeMasterView,
    symbols: sg.symbols.map(cleanSymbol),
    reelsFrame: cleanUrl(sg.reelsFrame),
    reelsFrameCropCoordinates: sg.reelsFrameCropCoordinates,
    gridRows: sg.gridRows,
    gridCols: sg.gridCols,
    gridState: sg.gridState,
    layoutOffsetX: sg.layoutOffsetX,
    layoutOffsetY: sg.layoutOffsetY,
    layoutWidth: sg.layoutWidth,
    layoutHeight: sg.layoutHeight,
    layoutGutterHorizontal: sg.layoutGutterHorizontal,
    layoutGutterVertical: sg.layoutGutterVertical,
    symbolScale: sg.symbolScale,
    mergedFrames: sg.mergedFrames.filter(f => !isBlobUrl(f.dataUrl)),
    savedFrames: sg.savedFrames.filter(f => !isBlobUrl(f.dataUrl)),
    animationPrompt: sg.animationPrompt,
    prompt: sg.prompt,
    activeSubTab: sg.activeSubTab,
    // Strip generatedVideos, isProcessing*, isGeneratingVideo, selectedStart/EndFrameId
  };

  // --- Clean CompositorState (image layers only) ---
  const cleanComp: Partial<CompositorState> = {
    layers: input.compositorState.layers.filter(l => l.type === 'image' && !isBlobUrl(l.src)),
    canvasWidth: input.compositorState.canvasWidth,
    canvasHeight: input.compositorState.canvasHeight,
    compositionDuration: input.compositorState.compositionDuration,
    timelineZoom: input.compositorState.timelineZoom,
  };

  // --- Clean asset library (images only) ---
  const cleanAssets = input.assetLibrary.filter(a =>
    a.mediaType !== 'video' && !isBlobUrl(a.url)
  );

  const cleanRefAssets = input.referenceAssets.filter(a =>
    a.mediaType !== 'video' && !isBlobUrl(a.url)
  );

  return {
    version: 1,
    savedAt: new Date().toISOString(),
    projectName,
    animatix: {
      characters: cleanChars,
      scenes: cleanScenes,
      style: input.style,
      brief: input.brief,
      storyTitle: input.storyTitle,
      sceneCount: input.sceneCount,
      step: input.step,
      isApproved: input.isApproved,
      aspectRatio: input.animatixAspectRatio,
    },
    extractor: {
      segments: cleanSegments,
      activeSegmentId: input.activeSegmentId,
      modificationPrompt: input.modificationPrompt,
      referenceAssets: cleanRefAssets,
      videoAspectRatio: input.videoAspectRatio,
      slotState: cleanSlot,
      characterState: cleanChar,
      backgroundState: cleanBg,
      symbolGenState: cleanSymGen,
      compositorState: cleanComp,
    },
    app: {
      assetLibrary: cleanAssets,
      aspectRatio: input.appAspectRatio,
    },
  };
}

function cleanFrame(f: ExtractedFrame): ExtractedFrame {
  return {
    id: f.id,
    timestamp: f.timestamp,
    dataUrl: isBlobUrl(f.dataUrl) ? '' : f.dataUrl,
    cleanedDataUrl: cleanUrl(f.cleanedDataUrl) ?? undefined,
    modifiedDataUrl: cleanUrl(f.modifiedDataUrl) ?? undefined,
    lastModificationPrompt: f.lastModificationPrompt,
    lastModificationMode: f.lastModificationMode,
    baseImageForLastModification: cleanUrl(f.baseImageForLastModification) ?? undefined,
    lastModificationReferenceUrl: cleanUrl(f.lastModificationReferenceUrl),
    isKeyframe: f.isKeyframe,
    transitionPrompt: f.transitionPrompt,
  };
}

function cleanSymbol(s: SymbolItem): SymbolItem {
  return {
    id: s.id,
    name: s.name,
    sourceUrl: isBlobUrl(s.sourceUrl) ? '' : s.sourceUrl,
    rawCropDataUrl: cleanUrl(s.rawCropDataUrl),
    isolatedUrl: cleanUrl(s.isolatedUrl),
    isProcessing: false,
    cropCoordinates: s.cropCoordinates,
    cropSourceView: s.cropSourceView,
    spanRows: s.spanRows,
    withFrame: s.withFrame,
    symbolRole: s.symbolRole,
    scaleX: s.scaleX,
    scaleY: s.scaleY,
    lockScale: s.lockScale,
  };
}

// ─── Generate HTML ────────────────────────────────────────────────

export function generateProjectHTML(data: ProjectData): string {
  const json = JSON.stringify(data);
  // Skip escaping for data URLs (base64 never contains &, <, >, ") — avoids 4 regex scans of 100KB+ strings
  const esc = (s: string) => s.startsWith('data:') ? s : s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const escH = (s: string) => s.startsWith('data:') ? s : s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const dateStr = new Date(data.savedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  /** Reusable image card: <div class="card"><img /><div class="card-body">label + extra</div></div> */
  const cardHTML = (src: string, label: string, extra = '') =>
    `<div class="card"><img src="${esc(src)}" class="card-img clickable" onclick="zoom(this)" /><div class="card-body"><p class="dim">${escH(label)}</p>${extra}</div></div>`;

  // --- Build sections ---
  let sectionsHTML = '';

  // Animatix Characters
  const { characters, scenes, style, brief } = data.animatix;
  if (characters.length > 0 && characters.some(c => c.name || c.masterBlueprint)) {
    let charsGrid = '';
    for (const c of characters) {
      charsGrid += `<div class="card">`;
      if (c.masterBlueprint) charsGrid += `<img src="${esc(c.masterBlueprint)}" class="card-img clickable" onclick="zoom(this)" />`;
      charsGrid += `<div class="card-body"><h4>${escH(c.name || 'Unnamed')}</h4><p class="dim">${escH(c.description || '')}</p></div>`;
      if (c.inputReferences && c.inputReferences.length > 0) {
        charsGrid += `<div class="refs">`;
        for (const r of c.inputReferences) {
          if (r) charsGrid += `<img src="${esc(r)}" class="ref-thumb clickable" onclick="zoom(this)" />`;
        }
        charsGrid += `</div>`;
      }
      charsGrid += `</div>`;
    }
    sectionsHTML += `<section><h2>Characters & Identity Blueprints</h2>`;
    if (style || brief) {
      sectionsHTML += `<div class="meta">`;
      if (style) sectionsHTML += `<span class="tag">Style: ${escH(style)}</span>`;
      if (brief) sectionsHTML += `<p class="dim">${escH(brief)}</p>`;
      sectionsHTML += `</div>`;
    }
    sectionsHTML += `<div class="grid cols-3">${charsGrid}</div></section>`;
  }

  // Animatix Scenes
  if (scenes.length > 0 && scenes.some(s => s.imageUrl || s.dialogue || s.visual_prompt)) {
    let scenesGrid = '';
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      scenesGrid += `<div class="card">`;
      if (s.imageUrl) scenesGrid += `<img src="${esc(s.imageUrl)}" class="card-img clickable" onclick="zoom(this)" />`;
      scenesGrid += `<div class="card-body">`;
      scenesGrid += `<h4><span class="num">#${i + 1}</span> ${escH(s.title || '')}</h4>`;
      if (s.dialogue) scenesGrid += `<p class="dialogue">"${escH(s.dialogue)}"</p>`;
      if (s.visual_prompt) scenesGrid += `<p class="prompt"><b>Visual:</b> ${escH(s.visual_prompt)}</p>`;
      if (s.action_prompt) scenesGrid += `<p class="prompt"><b>Motion:</b> ${escH(s.action_prompt)}</p>`;
      scenesGrid += `</div></div>`;
    }
    sectionsHTML += `<section><h2>Storyboard (${scenes.length} Scenes)</h2><div class="grid cols-3">${scenesGrid}</div></section>`;
  }

  // Symbol Generator
  const sg = data.extractor.symbolGenState;
  if (sg && (sg.masterImage || sg.reskinResult || (sg.symbols && sg.symbols.length > 0) || sg.reelsFrame)) {
    let symHTML = '';
    // Master images
    if (sg.masterImage || sg.reskinResult) {
      symHTML += `<div class="side-by-side">`;
      if (sg.masterImage) symHTML += `<div class="half"><h4>Source Master</h4><img src="${esc(sg.masterImage)}" class="full-img clickable" onclick="zoom(this)" /></div>`;
      if (sg.reskinResult) symHTML += `<div class="half"><h4>Reskinned Master</h4><img src="${esc(sg.reskinResult)}" class="full-img clickable" onclick="zoom(this)" /></div>`;
      symHTML += `</div>`;
      if (sg.masterPrompt) symHTML += `<p class="prompt"><b>Reskin Prompt:</b> ${escH(sg.masterPrompt)}</p>`;
    }
    // Symbols
    if (sg.symbols && sg.symbols.length > 0) {
      symHTML += `<h3>Extracted Symbols (${sg.symbols.length})</h3><div class="grid cols-5">`;
      for (const sym of sg.symbols) {
        const imgUrl = sym.isolatedUrl || sym.rawCropDataUrl || sym.sourceUrl;
        symHTML += `<div class="card sym-card">`;
        if (imgUrl) symHTML += `<img src="${esc(imgUrl)}" class="sym-img clickable" onclick="zoom(this)" />`;
        symHTML += `<div class="card-body"><h4>${escH(sym.name)}</h4>`;
        if (sym.symbolRole) symHTML += `<span class="tag role-${sym.symbolRole}">${sym.symbolRole}</span>`;
        if (sym.withFrame) symHTML += ` <span class="tag">framed</span>`;
        symHTML += `</div></div>`;
      }
      symHTML += `</div>`;
    }
    // Reels frame
    if (sg.reelsFrame) {
      symHTML += `<h3>Reels Frame / Background</h3><img src="${esc(sg.reelsFrame)}" class="full-img clickable" onclick="zoom(this)" />`;
    }
    // Merged/Saved frames
    const allMerged = [...(sg.mergedFrames || []), ...(sg.savedFrames || [])];
    if (allMerged.length > 0) {
      symHTML += `<h3>Merged Frames (${allMerged.length})</h3><div class="grid cols-4">`;
      for (const mf of allMerged) {
        symHTML += cardHTML(mf.dataUrl, mf.label);
      }
      symHTML += `</div>`;
    }
    // Layout settings
    if (sg.gridRows || sg.gridCols) {
      symHTML += `<p class="dim mt">Grid: ${sg.gridRows}r x ${sg.gridCols}c | Scale: ${sg.symbolScale}% | Offset: (${sg.layoutOffsetX}, ${sg.layoutOffsetY}) | Size: ${sg.layoutWidth}% x ${sg.layoutHeight}% | Gutter: ${sg.layoutGutterHorizontal} / ${sg.layoutGutterVertical}</p>`;
    }
    sectionsHTML += `<section><h2>Symbol Generator</h2>${symHTML}</section>`;
  }

  // Capture & Reskin (Segments with frames)
  const segs = data.extractor.segments;
  if (segs.length > 0 && segs.some(s => s.frames.length > 0)) {
    let capHTML = '';
    for (const seg of segs) {
      if (seg.frames.length === 0) continue;
      capHTML += `<div class="segment"><h3>${escH(seg.description || 'Segment')}</h3>`;
      if (seg.prompt) capHTML += `<p class="prompt"><b>Prompt:</b> ${escH(seg.prompt)}</p>`;
      capHTML += `<div class="grid cols-4">`;
      for (const f of seg.frames) {
        const bestImg = f.modifiedDataUrl || f.cleanedDataUrl || f.dataUrl;
        if (!bestImg) continue;
        capHTML += `<div class="card">`;
        capHTML += `<img src="${esc(bestImg)}" class="card-img clickable" onclick="zoom(this)" />`;
        capHTML += `<div class="card-body"><p class="dim">${f.timestamp.toFixed(2)}s${f.isKeyframe ? ' <span class="tag">keyframe</span>' : ''}</p>`;
        if (f.lastModificationPrompt) capHTML += `<p class="prompt">${escH(f.lastModificationPrompt)}</p>`;
        // Show variant count
        const variants = [f.dataUrl, f.cleanedDataUrl, f.modifiedDataUrl].filter(Boolean);
        if (variants.length > 1) capHTML += `<p class="dim">${variants.length} variants</p>`;
        capHTML += `</div></div>`;
      }
      capHTML += `</div></div>`;
    }
    sectionsHTML += `<section><h2>Capture & Reskin</h2>${capHTML}</section>`;
  }

  // Character Studio
  const cs = data.extractor.characterState;
  if (cs && (cs.sourceImage || cs.generatedImage || cs.characterSheet || cs.isolatedImage)) {
    let csHTML = `<div class="grid cols-4">`;
    if (cs.sourceImage) csHTML += cardHTML(cs.sourceImage, 'Source');
    if (cs.generatedImage) csHTML += cardHTML(cs.generatedImage, 'Generated');
    if (cs.characterSheet) csHTML += cardHTML(cs.characterSheet, 'Character Sheet');
    if (cs.isolatedImage) csHTML += cardHTML(cs.isolatedImage, 'Isolated');
    csHTML += `</div>`;
    if (cs.prompt) csHTML += `<p class="prompt"><b>Prompt:</b> ${escH(cs.prompt)}</p>`;
    sectionsHTML += `<section><h2>Character Studio</h2>${csHTML}</section>`;
  }

  // Background Studio
  const bg = data.extractor.backgroundState;
  if (bg && (bg.sourceImage || bg.generatedImage)) {
    let bgHTML = `<div class="grid cols-2">`;
    if (bg.sourceImage) bgHTML += cardHTML(bg.sourceImage, 'Source');
    if (bg.generatedImage) bgHTML += cardHTML(bg.generatedImage, 'Generated');
    bgHTML += `</div>`;
    if (bg.prompt) bgHTML += `<p class="prompt"><b>Prompt:</b> ${escH(bg.prompt)}</p>`;
    sectionsHTML += `<section><h2>Background Studio</h2>${bgHTML}</section>`;
  }

  // Slot State
  const sl = data.extractor.slotState;
  if (sl && (sl.sourceImage || sl.resultSymbolImage || sl.resultFrameImage)) {
    let slHTML = `<div class="grid cols-3">`;
    if (sl.sourceImage) slHTML += cardHTML(sl.sourceImage, 'Source');
    if (sl.resultSymbolImage) slHTML += cardHTML(sl.resultSymbolImage, 'Symbol Result');
    if (sl.resultFrameImage) slHTML += cardHTML(sl.resultFrameImage, 'Frame Result');
    slHTML += `</div>`;
    if (sl.prompt) slHTML += `<p class="prompt"><b>Prompt:</b> ${escH(sl.prompt)}</p>`;
    sectionsHTML += `<section><h2>Slot Machine Studio</h2>${slHTML}</section>`;
  }

  // Asset Library
  const imgAssets = data.app.assetLibrary; // already filtered to images-only by collectProjectData
  if (imgAssets.length > 0) {
    let assHTML = `<div class="grid cols-5">`;
    for (const a of imgAssets) {
      assHTML += cardHTML(a.url, a.name || a.id, `<span class="tag">${a.type}</span>`);
    }
    assHTML += `</div>`;
    sectionsHTML += `<section><h2>Asset Library (${imgAssets.length})</h2>${assHTML}</section>`;
  }

  // --- Build full HTML ---
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mega Design Studio \u2014 ${escH(data.projectName)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;color:#e4e4e7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.5;padding:0 0 80px}
header.main{background:#09090b;border-bottom:1px solid #27272a;padding:20px 32px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:50;backdrop-filter:blur(8px)}
header.main .logo{width:32px;height:32px;background:linear-gradient(135deg,#6366f1,#a855f7);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff}
header.main h1{font-size:18px;font-weight:700;background:linear-gradient(90deg,#818cf8,#c084fc);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
header.main .date{margin-left:auto;font-size:12px;color:#71717a}
header.main .badge{background:#3730a3;color:#c7d2fe;font-size:10px;padding:2px 8px;border-radius:99px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}
section{margin:32px;padding:24px;background:#18181b;border:1px solid #27272a;border-radius:16px}
section h2{font-size:16px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#a5b4fc;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid #27272a}
section h3{font-size:14px;font-weight:700;color:#c4b5fd;margin:20px 0 12px;text-transform:uppercase;letter-spacing:1px}
.grid{display:grid;gap:16px}
.cols-2{grid-template-columns:repeat(2,1fr)}
.cols-3{grid-template-columns:repeat(3,1fr)}
.cols-4{grid-template-columns:repeat(4,1fr)}
.cols-5{grid-template-columns:repeat(5,1fr)}
@media(max-width:900px){.cols-3,.cols-4,.cols-5{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.cols-2,.cols-3,.cols-4,.cols-5{grid-template-columns:1fr}}
.card{background:#09090b;border:1px solid #27272a;border-radius:12px;overflow:hidden;transition:border-color .2s}
.card:hover{border-color:#4f46e5}
.card-img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#000}
.sym-card .sym-img{width:100%;aspect-ratio:1/1;object-fit:contain;display:block;background:#fff;padding:4px}
.card-body{padding:10px 12px}
.card-body h4{font-size:13px;font-weight:700;color:#e4e4e7;margin-bottom:4px}
.dim{font-size:11px;color:#71717a;margin:2px 0}
.prompt{font-size:11px;color:#a1a1aa;margin:4px 0;line-height:1.4}
.prompt b{color:#818cf8}
.dialogue{font-size:12px;color:#a5b4fc;font-style:italic;margin:4px 0}
.tag{display:inline-block;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:2px 6px;border-radius:4px;background:#27272a;color:#a1a1aa;margin-right:4px}
.role-low{background:#292524;color:#a8a29e}
.role-high{background:#1e1b4b;color:#a5b4fc}
.role-wild{background:#3b0764;color:#d8b4fe}
.role-scatter{background:#7f1d1d;color:#fca5a5}
.num{font-size:10px;background:#27272a;color:#71717a;padding:1px 6px;border-radius:4px;margin-right:4px}
.meta{margin-bottom:16px;padding:12px;background:#09090b;border-radius:8px;border:1px solid #27272a}
.side-by-side{display:flex;gap:16px;margin-bottom:16px}
.half{flex:1}
.half h4{font-size:12px;color:#a1a1aa;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px}
.full-img{width:100%;border-radius:8px;border:1px solid #27272a}
.refs{display:flex;gap:8px;padding:8px 12px;border-top:1px solid #27272a}
.ref-thumb{width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #3f3f46}
.segment{margin-bottom:24px}
.mt{margin-top:12px}
.clickable{cursor:pointer}
/* Zoom overlay */
#zoom-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:1000;justify-content:center;align-items:center;cursor:zoom-out}
#zoom-overlay.active{display:flex}
#zoom-overlay img{max-width:95vw;max-height:95vh;object-fit:contain;border-radius:8px;box-shadow:0 0 60px rgba(99,102,241,.3)}
.load-banner{margin:32px;padding:16px 24px;background:#1e1b4b;border:1px solid #4f46e5;border-radius:12px;font-size:12px;color:#c7d2fe;display:flex;align-items:center;gap:12px}
.load-banner b{color:#a5b4fc}
</style>
</head>
<body>

<header class="main">
  <div class="logo">\u2728</div>
  <h1>Mega Design Studio</h1>
  <span class="badge">Project Save</span>
  <span class="date">${escH(data.projectName)} \u2014 ${escH(dateStr)}</span>
</header>

<div class="load-banner">
  <b>\u2139\ufe0f</b> This file contains your full project data. To restore, open Mega Design Studio and click <b>Load Project</b>, then select this HTML file.
</div>

${sectionsHTML}

<script id="mega-studio-data" type="application/json">${json}<\/script>

<div id="zoom-overlay" onclick="this.classList.remove('active')"><img id="zoom-img" /></div>
<script>
function zoom(el){var o=document.getElementById('zoom-overlay');document.getElementById('zoom-img').src=el.src;o.classList.add('active')}
document.addEventListener('keydown',function(e){if(e.key==='Escape')document.getElementById('zoom-overlay').classList.remove('active')});
</script>

</body>
</html>`;
}

// ─── Parse HTML ───────────────────────────────────────────────────

export function parseProjectHTML(htmlString: string): ProjectData | null {
  try {
    // Extract JSON from the embedded script tag
    const marker = 'id="mega-studio-data" type="application/json">';
    const startIdx = htmlString.indexOf(marker);
    if (startIdx === -1) return null;

    const jsonStart = startIdx + marker.length;
    const jsonEnd = htmlString.indexOf('</script>', jsonStart);
    if (jsonEnd === -1) return null;

    const jsonStr = htmlString.substring(jsonStart, jsonEnd);
    const data = JSON.parse(jsonStr) as ProjectData;

    if (data.version !== 1) {
      console.warn('Unknown project version:', data.version);
    }

    return data;
  } catch (err) {
    console.error('Failed to parse project HTML:', err);
    return null;
  }
}

// ─── Restore ──────────────────────────────────────────────────────

interface RestoreSetters {
  // Animatix
  setCharacters: React.Dispatch<React.SetStateAction<Character[]>>;
  setScenes: React.Dispatch<React.SetStateAction<StoryScene[]>>;
  setStyle: (s: string) => void;
  setBrief: (s: string) => void;
  setStoryTitle: (s: string) => void;
  setSceneCount: (n: number) => void;
  setStep: (step: AppStep) => void;
  setIsApproved: (b: boolean) => void;
  setAnimatixAspectRatio: (ar: string) => void;

  // Extractor
  setSegments: React.Dispatch<React.SetStateAction<VideoSegment[]>>;
  setActiveSegmentId: (id: string | null) => void;
  setModificationPrompt: (p: string) => void;
  setReferenceAssets: React.Dispatch<React.SetStateAction<ReferenceAsset[]>>;
  setVideoAspectRatio: (ratio: number) => void;
  setSlotState: React.Dispatch<React.SetStateAction<SlotState>>;
  setCharacterState: React.Dispatch<React.SetStateAction<CharacterState>>;
  setBackgroundState: React.Dispatch<React.SetStateAction<BackgroundState>>;
  setSymbolGenState: React.Dispatch<React.SetStateAction<SymbolGeneratorState>>;
  setCompositorState: React.Dispatch<React.SetStateAction<CompositorState>>;

  // App
  setAssetLibrary: (assets: ReferenceAsset[]) => void;
  setAppAspectRatio: (ar: string) => void;
}

export function restoreProjectData(data: ProjectData, setters: RestoreSetters) {
  const { animatix: a, extractor: e, app } = data;

  // --- Animatix ---
  setters.setCharacters(a.characters);
  setters.setScenes(a.scenes);
  setters.setStyle(a.style);
  setters.setBrief(a.brief);
  setters.setStoryTitle(a.storyTitle);
  setters.setSceneCount(a.sceneCount);
  setters.setStep(a.step);
  setters.setIsApproved(a.isApproved);
  setters.setAnimatixAspectRatio(a.aspectRatio);

  // --- Extractor ---
  setters.setSegments(e.segments);
  setters.setActiveSegmentId(e.activeSegmentId);
  setters.setModificationPrompt(e.modificationPrompt);
  setters.setReferenceAssets(e.referenceAssets);
  if (e.videoAspectRatio) setters.setVideoAspectRatio(e.videoAspectRatio);

  // Merge partial states with defaults
  setters.setSlotState(prev => ({ ...prev, ...e.slotState, isProcessing: false }));
  setters.setCharacterState(prev => ({
    ...prev,
    ...e.characterState,
    generatedVideos: [],
    isProcessingReskin: false,
    isProcessingSheet: false,
    isProcessingIsolation: false,
    isProcessingVideo: false,
  }));
  setters.setBackgroundState(prev => ({
    ...prev,
    ...e.backgroundState,
    generatedVideos: [],
    isProcessing: false,
    isProcessingVideo: false,
  }));
  setters.setSymbolGenState(prev => ({
    ...prev,
    ...e.symbolGenState,
    generatedVideos: [],
    isProcessingMaster: false,
    isProcessing: false,
    isGeneratingVideo: false,
    selectedStartFrameId: null,
    selectedEndFrameId: null,
  }));
  setters.setCompositorState(prev => ({
    ...prev,
    ...e.compositorState,
    selectedLayerId: null,
    isPlaying: false,
    isExporting: false,
    playheadTime: 0,
  }));

  // --- App ---
  setters.setAssetLibrary(app.assetLibrary);
  setters.setAppAspectRatio(app.aspectRatio);
}
