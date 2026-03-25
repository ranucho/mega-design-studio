import React from 'react';

export type AspectRatioOption = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';

interface AspectRatioSelectorProps {
  value: string;
  onChange: (ratio: string) => void;
  options?: AspectRatioOption[];
  /** Compact mode for tight spaces (smaller buttons) */
  compact?: boolean;
}

// Visual ratio box dimensions (width x height in px) for each ratio
const RATIO_VISUALS: Record<string, { w: number; h: number; icon?: string; label?: string }> = {
  '16:9': { w: 22, h: 12, icon: 'fa-tv', label: 'Landscape' },
  '9:16': { w: 12, h: 22, icon: 'fa-mobile-alt', label: 'Portrait' },
  '1:1':  { w: 16, h: 16, label: 'Square' },
  '4:3':  { w: 20, h: 15, label: 'Standard' },
  '3:4':  { w: 15, h: 20, label: 'Tall' },
};

const DEFAULT_OPTIONS: AspectRatioOption[] = ['16:9', '9:16', '1:1', '4:3'];

export const AspectRatioSelector: React.FC<AspectRatioSelectorProps> = ({
  value,
  onChange,
  options = DEFAULT_OPTIONS,
  compact = false,
}) => {
  return (
    <div className="flex gap-1.5">
      {options.map(ratio => {
        const isActive = value === ratio;
        const vis = RATIO_VISUALS[ratio] || { w: 16, h: 16 };

        return (
          <button
            key={ratio}
            onClick={() => onChange(ratio)}
            className={`flex items-center gap-1.5 rounded-lg border transition-all ${
              compact ? 'px-2 py-1.5' : 'px-3 py-2'
            } ${
              isActive
                ? 'bg-cyan-600/20 border-cyan-600/50 text-cyan-400 shadow-sm shadow-cyan-600/10'
                : 'border-zinc-700/60 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
            }`}
            title={vis.label ? `${vis.label} (${ratio})` : ratio}
          >
            {/* Visual ratio indicator */}
            <div
              className={`rounded-[2px] border ${
                isActive ? 'border-cyan-500/60 bg-cyan-500/20' : 'border-zinc-600/60 bg-zinc-700/30'
              }`}
              style={{ width: vis.w * (compact ? 0.7 : 1), height: vis.h * (compact ? 0.7 : 1) }}
            />
            <span className={`font-bold ${compact ? 'text-[9px]' : 'text-[10px]'}`}>
              {ratio}
            </span>
          </button>
        );
      })}
    </div>
  );
};
