import React, { useState, useCallback, useRef } from 'react';
import { useBanner } from '@/contexts/BannerContext';
import { reskinBanner } from '@/services/gemini';

interface ReskinConfig {
  theme: string;
  characterRef: string | null;
  palette: string;
  textChanges: Record<string, string>;
  negativePrompts?: string;
}

export const BannerReskinPanel: React.FC = () => {
  const { project, initProject, setStage } = useBanner();
  const [config, setConfig] = useState<ReskinConfig>({
    theme: '',
    characterRef: null,
    palette: '',
    textChanges: {},
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNegative, setShowNegative] = useState(false);
  const charInputRef = useRef<HTMLInputElement>(null);

  // Collect detected text from extracted elements
  const detectedTexts = (project?.extractedElements ?? [])
    .filter(el => el.detectedText)
    .map(el => ({ id: el.id, label: el.label, text: el.detectedText! }));

  const handleCharacterUpload = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => setConfig(prev => ({ ...prev, characterRef: reader.result as string }));
    reader.readAsDataURL(file);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!project?.sourceImage || !config.theme.trim()) return;

    setIsGenerating(true);
    setError(null);

    try {
      const themeWithNegatives = config.negativePrompts?.trim()
        ? `${config.theme}\n\nNEGATIVE PROMPTS (avoid these): ${config.negativePrompts.trim()}`
        : config.theme;

      const reskinned = await reskinBanner(project.sourceImage, {
        theme: themeWithNegatives,
        characterRef: config.characterRef || undefined,
        palette: config.palette || undefined,
        textChanges: Object.keys(config.textChanges).length > 0 ? config.textChanges : undefined,
      });

      // Initialize a new project with the reskinned image
      const img = new Image();
      img.onload = () => {
        initProject(reskinned, img.naturalWidth, img.naturalHeight, 'resize');
        setStage('extract');
      };
      img.src = reskinned;
    } catch (err: any) {
      setError(err.message || 'Reskin generation failed');
    } finally {
      setIsGenerating(false);
    }
  }, [project?.sourceImage, config, initProject, setStage]);

  if (!project) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-6">

          <div className="text-center">
            <h2 className="text-xl font-bold text-white mb-1">
              <i className="fa-solid fa-palette mr-2 text-purple-400" />
              Reskin Banner
            </h2>
            <p className="text-zinc-400 text-sm">
              Transform your banner with a new theme while maintaining the original layout
            </p>
          </div>

          {/* Source preview */}
          <div className="flex gap-4">
            <div className="flex-1 rounded-xl overflow-hidden border border-zinc-700 bg-zinc-900">
              <img
                src={project.sourceImage}
                alt="Source banner"
                className="w-full h-auto"
              />
              <div className="px-3 py-2 border-t border-zinc-700/50 text-xs text-zinc-400">
                Original — {project.sourceWidth}x{project.sourceHeight}
              </div>
            </div>
          </div>

          {/* Theme */}
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
            <label className="text-sm font-semibold text-zinc-300 block mb-2">
              <i className="fa-solid fa-wand-magic-sparkles mr-2 text-purple-400" />
              New Theme / Setting
            </label>
            <input
              type="text"
              value={config.theme}
              onChange={e => setConfig(prev => ({ ...prev, theme: e.target.value }))}
              placeholder="e.g. Norse mythology, Underwater kingdom, Cyberpunk city, Ancient Egypt..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-purple-500 focus:outline-none transition-colors"
            />
          </div>

          {/* Negative Prompts */}
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
            <button
              onClick={() => setShowNegative(v => !v)}
              className="w-full flex items-center justify-between text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
            >
              <span>
                <i className="fa-solid fa-ban mr-2 text-red-400" />
                Negative Prompts (optional)
              </span>
              <i className={`fa-solid ${showNegative ? 'fa-chevron-up' : 'fa-chevron-down'} text-xs text-zinc-500`} />
            </button>
            {showNegative && (
              <div className="mt-3">
                <p className="text-xs text-zinc-400 mb-2">
                  Things the AI should avoid in the reskin
                </p>
                <textarea
                  value={config.negativePrompts ?? ''}
                  onChange={e => setConfig(prev => ({ ...prev, negativePrompts: e.target.value }))}
                  placeholder="e.g. dollar signs, actual banknotes, violence, text artifacts..."
                  rows={3}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-red-500 focus:outline-none transition-colors resize-none"
                />
              </div>
            )}
          </div>

          {/* Character Reference */}
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
            <label className="text-sm font-semibold text-zinc-300 block mb-2">
              <i className="fa-solid fa-user mr-2 text-blue-400" />
              Character Reference (optional)
            </label>
            <p className="text-xs text-zinc-400 mb-3">
              Upload a reference image for the new character, or leave empty to auto-generate
            </p>
            <div className="flex gap-3 items-start">
              {config.characterRef ? (
                <div className="relative w-24 h-24 rounded-lg overflow-hidden border border-zinc-700">
                  <img src={config.characterRef} alt="Character ref" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, characterRef: null }))}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-600 text-white text-[9px] flex items-center justify-center"
                  >
                    <i className="fa-solid fa-xmark" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => charInputRef.current?.click()}
                  className="w-24 h-24 rounded-lg border-2 border-dashed border-zinc-700 hover:border-zinc-500 flex flex-col items-center justify-center gap-1 text-zinc-400 hover:text-zinc-300 transition-colors"
                >
                  <i className="fa-solid fa-plus" />
                  <span className="text-[9px]">Upload</span>
                </button>
              )}
              <input
                ref={charInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleCharacterUpload(f); }}
              />
            </div>
          </div>

          {/* Color Palette */}
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
            <label className="text-sm font-semibold text-zinc-300 block mb-2">
              <i className="fa-solid fa-swatchbook mr-2 text-amber-400" />
              Color Palette (optional)
            </label>
            <input
              type="text"
              value={config.palette}
              onChange={e => setConfig(prev => ({ ...prev, palette: e.target.value }))}
              placeholder="e.g. Deep blue and gold, Dark red with silver accents..."
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none transition-colors"
            />
          </div>

          {/* Text Changes */}
          {detectedTexts.length > 0 && (
            <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-4">
              <label className="text-sm font-semibold text-zinc-300 block mb-3">
                <i className="fa-solid fa-font mr-2 text-green-400" />
                Text Changes
              </label>
              <div className="flex flex-col gap-2">
                {detectedTexts.map(dt => (
                  <div key={dt.id} className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400 w-28 truncate shrink-0" title={dt.label}>
                      {dt.label}:
                    </span>
                    <span className="text-xs text-zinc-400 w-32 truncate shrink-0">"{dt.text}"</span>
                    <i className="fa-solid fa-arrow-right text-[8px] text-zinc-700" />
                    <input
                      type="text"
                      value={config.textChanges[dt.text] ?? ''}
                      onChange={e => setConfig(prev => ({
                        ...prev,
                        textChanges: {
                          ...prev.textChanges,
                          [dt.text]: e.target.value,
                        },
                      }))}
                      placeholder={dt.text}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-green-500 focus:outline-none transition-colors"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-3 bg-red-900/20 border border-red-800/40 rounded-lg text-sm text-red-400">
              <i className="fa-solid fa-circle-exclamation" />
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 flex items-center justify-between px-6 py-3 bg-zinc-900/80 border-t border-zinc-800">
        <button
          onClick={() => setStage('upload')}
          className="px-4 py-2 text-sm text-zinc-400 hover:text-white border border-zinc-700 rounded-lg transition-colors"
        >
          <i className="fa-solid fa-arrow-left mr-2" />
          Back
        </button>
        <button
          disabled={!config.theme.trim() || isGenerating}
          onClick={handleGenerate}
          className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all shadow-lg ${
            config.theme.trim() && !isGenerating
              ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/20'
              : 'bg-zinc-700 text-zinc-400 cursor-not-allowed shadow-none'
          }`}
        >
          {isGenerating ? (
            <>
              <i className="fa-solid fa-spinner fa-spin mr-2" />
              Generating Reskin...
            </>
          ) : (
            <>
              <i className="fa-solid fa-wand-magic-sparkles mr-2" />
              Generate Reskin
            </>
          )}
        </button>
      </div>
    </div>
  );
};
