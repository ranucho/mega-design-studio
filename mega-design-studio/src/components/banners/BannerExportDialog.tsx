import React, { useState, useCallback, useRef } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { BannerComposition, BannerLayer, QualityWarning } from '@/types';
import JSZip from 'jszip';

type ExportFormat = 'png' | 'jpeg' | 'webp';

/** Render a composition to an offscreen canvas and return a blob */
const renderCompositionToBlob = async (
  comp: BannerComposition,
  format: ExportFormat,
  quality: number,
): Promise<Blob> => {
  const canvas = document.createElement('canvas');
  canvas.width = comp.width;
  canvas.height = comp.height;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = comp.backgroundColor || '#000';
  ctx.fillRect(0, 0, comp.width, comp.height);

  // Load all images first
  const imageMap = new Map<string, HTMLImageElement>();
  await Promise.all(
    comp.layers
      .filter(l => l.type === 'image' && l.src)
      .map(l => new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => { imageMap.set(l.id, img); resolve(); };
        img.onerror = () => resolve();
        img.src = l.src!;
      }))
  );

  // Draw layers bottom to top
  for (const layer of comp.layers) {
    if (!layer.visible) continue;

    ctx.save();
    ctx.globalAlpha = layer.opacity;

    const cx = layer.x + (layer.nativeWidth * layer.scaleX) / 2;
    const cy = layer.y + (layer.nativeHeight * layer.scaleY) / 2;

    ctx.translate(cx, cy);
    if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
    if (layer.flipX) ctx.scale(-1, 1);
    if (layer.flipY) ctx.scale(1, -1);
    ctx.translate(-cx, -cy);

    if (layer.type === 'text') {
      const fontSize = layer.fontSize || 24;
      ctx.font = `${layer.fontWeight || 700} ${fontSize}px ${layer.fontFamily || 'sans-serif'}`;
      ctx.textAlign = (layer.textAlign || 'left') as CanvasTextAlign;
      ctx.textBaseline = 'top';

      if (layer.textShadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
      }
      if (layer.textStroke) {
        ctx.strokeStyle = layer.textStroke;
        ctx.lineWidth = Math.max(1, fontSize / 12);
        ctx.strokeText(layer.text || '', layer.x, layer.y);
      }
      ctx.fillStyle = layer.fontColor || '#ffffff';
      ctx.fillText(layer.text || '', layer.x, layer.y);
    } else if (layer.type === 'image' && layer.src) {
      const img = imageMap.get(layer.id);
      if (img) {
        const dw = layer.nativeWidth * layer.scaleX;
        const dh = layer.nativeHeight * layer.scaleY;
        ctx.drawImage(img, layer.x, layer.y, dw, dh);
      }
    }

    ctx.restore();
  }

  return new Promise((resolve, reject) => {
    const mimeType = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Failed to create blob')),
      mimeType,
      format === 'png' ? undefined : quality / 100,
    );
  });
};

/** Run quality checks on a composition */
const checkQuality = (comp: BannerComposition): QualityWarning[] => {
  const warnings: QualityWarning[] = [];

  // Safe zone check: text/CTA layers near edges
  const margin = Math.min(comp.width, comp.height) * 0.05;
  for (const layer of comp.layers) {
    if (!layer.visible) continue;
    if (layer.role === 'text' || layer.role === 'cta') {
      if (layer.x < margin || layer.y < margin ||
          layer.x + layer.nativeWidth * layer.scaleX > comp.width - margin ||
          layer.y + layer.nativeHeight * layer.scaleY > comp.height - margin) {
        warnings.push({
          type: 'safe-zone',
          severity: 'warning',
          layerId: layer.id,
          message: `"${layer.name}" is outside the safe zone`,
        });
      }
    }
  }

  // Upscale check: layer scaled beyond 150% of native
  for (const layer of comp.layers) {
    if (!layer.visible || layer.role === 'background') continue;
    if (layer.scaleX > 1.5 || layer.scaleY > 1.5) {
      warnings.push({
        type: 'upscale',
        severity: 'warning',
        layerId: layer.id,
        message: `"${layer.name}" is upscaled to ${Math.round(Math.max(layer.scaleX, layer.scaleY) * 100)}% — may appear blurry`,
      });
    }
  }

  // Missing CTA check
  const hasCta = comp.layers.some(l => l.role === 'cta' && l.visible);
  if (!hasCta) {
    warnings.push({
      type: 'missing-element',
      severity: 'info',
      message: 'No visible CTA element in this composition',
    });
  }

  return warnings;
};

export const BannerExportDialog: React.FC = () => {
  const { project, setStage, setProject, updateComposition } = useBanner();
  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(90);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [warnings, setWarnings] = useState<Map<string, QualityWarning[]>>(new Map());
  const [hasChecked, setHasChecked] = useState(false);

  const compositions = project?.compositions.filter(c => c.status !== 'pending' && c.layers.length > 0) ?? [];

  const projectName = (() => {
    const raw = (project?.name || 'banner').toString();
    return raw
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'banner';
  })();

  // Run quality checks on all compositions
  const runQualityCheck = useCallback(() => {
    const warnMap = new Map<string, QualityWarning[]>();
    for (const comp of compositions) {
      const w = checkQuality(comp);
      if (w.length > 0) warnMap.set(comp.id, w);
      updateComposition(comp.id, { warnings: w });
    }
    setWarnings(warnMap);
    setHasChecked(true);
  }, [compositions, updateComposition]);

  const totalWarnings = Array.from(warnings.values()).flat();
  const errorCount = totalWarnings.filter(w => w.severity === 'error').length;
  const warningCount = totalWarnings.filter(w => w.severity === 'warning').length;

  /** Convert a data URL to a Blob */
  const dataUrlToBlob = useCallback(async (dataUrl: string, targetFormat: ExportFormat, targetQuality: number): Promise<Blob> => {
    // Load into canvas to convert format
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load sparkled image'));
      img.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const mimeType = targetFormat === 'jpeg' ? 'image/jpeg' : targetFormat === 'webp' ? 'image/webp' : 'image/png';
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Failed to create blob')),
        mimeType,
        targetFormat === 'png' ? undefined : targetQuality / 100,
      );
    });
  }, []);

  const handleExportAll = useCallback(async () => {
    if (compositions.length === 0) return;
    setIsExporting(true);
    setExportProgress(0);

    try {
      const zip = new JSZip();
      const folder = zip.folder('banners')!;

      for (let i = 0; i < compositions.length; i++) {
        const comp = compositions[i];
        // Use sparkle version if available
        const blob = comp.sparkleDataUrl
          ? await dataUrlToBlob(comp.sparkleDataUrl, format, quality)
          : await renderCompositionToBlob(comp, format, quality);
        const ext = format === 'jpeg' ? 'jpg' : format;
        const filename = `${projectName}_${comp.width}x${comp.height}.${ext}`;
        folder.file(filename, blob);
        setExportProgress(((i + 1) / compositions.length) * 100);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName}_banners.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Export failed:', err);
    } finally {
      setIsExporting(false);
    }
  }, [compositions, format, quality, projectName, dataUrlToBlob]);

  // Export single composition
  const handleExportSingle = useCallback(async (comp: BannerComposition) => {
    try {
      const blob = comp.sparkleDataUrl
        ? await dataUrlToBlob(comp.sparkleDataUrl, format, quality)
        : await renderCompositionToBlob(comp, format, quality);
      const ext = format === 'jpeg' ? 'jpg' : format;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName}_${comp.width}x${comp.height}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Export failed:', err);
    }
  }, [format, quality, projectName, dataUrlToBlob]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">

          <div className="text-center">
            <h2 className="text-xl font-bold text-white mb-1">Export Banners</h2>
            <p className="text-zinc-400 text-sm">
              {compositions.length} composition{compositions.length !== 1 ? 's' : ''} ready for export
            </p>
          </div>

          {/* Project Name — used as export filename prefix */}
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
            <label className="text-xs text-zinc-400 block mb-1.5">
              <i className="fa-solid fa-tag mr-1.5" />
              Project Name <span className="text-zinc-600">(used for filenames)</span>
            </label>
            <input
              type="text"
              value={project?.name ?? ''}
              onChange={e => setProject(prev => prev ? { ...prev, name: e.target.value } : null)}
              placeholder="banner-project"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-cyan-500 focus:outline-none transition-colors"
            />
            <div className="text-[10px] text-zinc-500 mt-1.5 font-mono">
              Files: <span className="text-cyan-400/80">{projectName}_WxH.{format === 'jpeg' ? 'jpg' : format}</span> &nbsp;·&nbsp; Zip: <span className="text-cyan-400/80">{projectName}_banners.zip</span>
            </div>
          </div>

          {/* Format & Quality */}
          <div className="flex gap-4 items-end bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
            <div className="flex-1">
              <label className="text-xs text-zinc-400 block mb-1.5">Format</label>
              <div className="flex gap-1.5">
                {(['png', 'jpeg', 'webp'] as ExportFormat[]).map(f => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-all ${
                      format === f
                        ? 'bg-cyan-600/20 text-cyan-400 border-cyan-600/40'
                        : 'text-zinc-400 border-zinc-700 hover:border-zinc-500'
                    }`}
                  >
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            {format !== 'png' && (
              <div className="flex-1">
                <label className="text-xs text-zinc-400 block mb-1.5">Quality: {quality}%</label>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={quality}
                  onChange={e => setQuality(Number(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>
            )}
          </div>

          {/* Quality Check */}
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-zinc-300">
                <i className="fa-solid fa-shield-check mr-2 text-zinc-400" />
                Quality Check
              </h3>
              <button
                onClick={runQualityCheck}
                className="px-3 py-1.5 text-xs text-cyan-400 border border-cyan-600/30 rounded-lg hover:bg-cyan-600/10 transition-colors"
              >
                <i className="fa-solid fa-magnifying-glass mr-1" />
                {hasChecked ? 'Re-check' : 'Run Check'}
              </button>
            </div>

            {hasChecked && totalWarnings.length === 0 && (
              <div className="flex items-center gap-2 text-green-400 text-sm">
                <i className="fa-solid fa-circle-check" />
                All compositions pass quality checks
              </div>
            )}

            {hasChecked && totalWarnings.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="flex gap-3 text-xs">
                  {errorCount > 0 && (
                    <span className="text-red-400">
                      <i className="fa-solid fa-circle-xmark mr-1" />{errorCount} error{errorCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {warningCount > 0 && (
                    <span className="text-yellow-400">
                      <i className="fa-solid fa-triangle-exclamation mr-1" />{warningCount} warning{warningCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="max-h-48 overflow-auto flex flex-col gap-1">
                  {totalWarnings.map((w, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
                        w.severity === 'error' ? 'bg-red-900/20 text-red-400' :
                        w.severity === 'warning' ? 'bg-yellow-900/20 text-yellow-400' :
                        'bg-zinc-800/50 text-zinc-400'
                      }`}
                    >
                      <i className={`fa-solid ${
                        w.severity === 'error' ? 'fa-circle-xmark' :
                        w.severity === 'warning' ? 'fa-triangle-exclamation' :
                        'fa-circle-info'
                      } mt-0.5`} />
                      {w.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Composition list */}
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
            <h3 className="text-sm font-semibold text-zinc-300 mb-3">
              Compositions ({compositions.length})
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {compositions.map(comp => {
                const compWarnings = warnings.get(comp.id) ?? [];
                return (
                  <div
                    key={comp.id}
                    className="relative group bg-zinc-800 rounded-lg border border-zinc-700/50 overflow-hidden"
                  >
                    <div
                      className="flex items-center justify-center bg-zinc-900"
                      style={{ aspectRatio: `${comp.width}/${comp.height}`, maxHeight: 120 }}
                    >
                      <span className="text-[9px] text-zinc-400">{comp.width}x{comp.height}</span>
                    </div>
                    <div className="px-2 py-1.5 border-t border-zinc-700/50 flex items-center justify-between">
                      <span className="text-[10px] text-zinc-400 truncate flex-1">{comp.name}</span>
                      <button
                        onClick={() => handleExportSingle(comp)}
                        className="text-[9px] text-cyan-400 hover:text-cyan-300 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Download this size"
                      >
                        <i className="fa-solid fa-download" />
                      </button>
                    </div>
                    {compWarnings.length > 0 && (
                      <div className="absolute top-1 right-1">
                        <div className="w-4 h-4 rounded-full bg-yellow-600/80 flex items-center justify-center">
                          <span className="text-[8px] text-white font-bold">{compWarnings.length}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Export progress */}
          {isExporting && (
            <div className="flex items-center gap-3 px-4 py-3 bg-zinc-800/60 rounded-lg border border-zinc-700/50">
              <i className="fa-solid fa-spinner fa-spin text-cyan-400" />
              <div className="flex-1">
                <div className="flex justify-between text-xs text-zinc-400 mb-1">
                  <span>Rendering compositions...</span>
                  <span>{Math.round(exportProgress)}%</span>
                </div>
                <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 rounded-full transition-all duration-300"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 bg-zinc-900/80 border-t border-zinc-800">
        <button
          onClick={() => setStage('sparkle')}
          className="px-4 py-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 rounded-lg transition-colors"
        >
          <i className="fa-solid fa-arrow-left mr-2" />
          Back to Fine Tune
        </button>
        <button
          disabled={isExporting || compositions.length === 0}
          onClick={handleExportAll}
          className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all shadow-lg ${
            !isExporting && compositions.length > 0
              ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-cyan-600/20'
              : 'bg-zinc-700 text-zinc-400 cursor-not-allowed shadow-none'
          }`}
        >
          {isExporting ? (
            <>
              <i className="fa-solid fa-spinner fa-spin mr-2" />
              Exporting...
            </>
          ) : (
            <>
              <i className="fa-solid fa-download mr-2" />
              Download All ({compositions.length} sizes)
            </>
          )}
        </button>
      </div>
    </div>
  );
};
