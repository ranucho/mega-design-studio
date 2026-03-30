import React, { useState, useRef, useEffect } from 'react';

/** Standard screen/chroma colors */
const SCREEN_PRESETS = [
  { hex: '#00fa15', label: 'Green' },
  { hex: '#0072ff', label: 'Blue' },
  { hex: '#ff4dfd', label: 'Pink' },
];

interface ScreenColorPickerProps {
  value: string;           // current hex color
  onChange: (hex: string) => void;
  size?: 'sm' | 'md';     // sm = 32px buttons, md = 56px buttons
}

export const SCREEN_COLOR_PRESETS = SCREEN_PRESETS;

/** Resolve a legacy preset name ('green','blue','pink') or hex to a proper hex */
export const resolveScreenColor = (color: string): string => {
  const preset = SCREEN_PRESETS.find(p => p.label.toLowerCase() === color.toLowerCase());
  return preset ? preset.hex : color.startsWith('#') ? color : `#${color}`;
};

/** Parse hex to RGB tuple */
export const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
};

export const ScreenColorPicker: React.FC<ScreenColorPickerProps> = ({ value, onChange, size = 'md' }) => {
  const [showCustom, setShowCustom] = useState(false);
  const [hexInput, setHexInput] = useState(value);
  const pickerRef = useRef<HTMLInputElement>(null);
  const resolved = resolveScreenColor(value);

  // Sync hex input when value changes externally
  useEffect(() => { setHexInput(resolveScreenColor(value)); }, [value]);

  const isPreset = SCREEN_PRESETS.some(p => p.hex.toLowerCase() === resolved.toLowerCase());
  const btnSize = size === 'sm' ? 'w-8 h-8 rounded-lg' : 'w-14 h-14 rounded-xl';
  const checkSize = size === 'sm' ? 'text-xs' : 'text-lg';

  const handleHexSubmit = () => {
    let hex = hexInput.trim();
    if (!hex.startsWith('#')) hex = `#${hex}`;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      onChange(hex);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {/* Preset buttons */}
        {SCREEN_PRESETS.map(p => (
          <button key={p.hex} onClick={() => { onChange(p.hex); setShowCustom(false); }}
            title={p.label}
            className={`${btnSize} border-2 transition-all flex items-center justify-center shrink-0 ${
              resolved.toLowerCase() === p.hex.toLowerCase()
                ? 'border-white scale-110 shadow-lg' : 'border-transparent opacity-50 hover:opacity-80'
            }`}
            style={{ backgroundColor: p.hex }}>
            {resolved.toLowerCase() === p.hex.toLowerCase() && <i className={`fas fa-check text-black ${checkSize}`} />}
          </button>
        ))}

        {/* Custom color button */}
        <button onClick={() => setShowCustom(!showCustom)}
          title="Custom color"
          className={`${btnSize} border-2 transition-all flex items-center justify-center shrink-0 ${
            !isPreset || showCustom
              ? 'border-white scale-110 shadow-lg' : 'border-zinc-600 opacity-50 hover:opacity-80'
          }`}
          style={{ backgroundColor: !isPreset ? resolved : '#333' }}>
          <i className={`fas fa-eyedropper ${!isPreset ? 'text-black' : 'text-zinc-400'} ${checkSize}`} />
        </button>
      </div>

      {/* Custom color row: native picker + hex input */}
      {showCustom && (
        <div className="flex items-center gap-2">
          <input
            ref={pickerRef}
            type="color"
            value={resolved}
            onChange={e => { onChange(e.target.value); setHexInput(e.target.value); }}
            className="w-8 h-8 rounded-lg border border-zinc-700 cursor-pointer bg-transparent p-0 shrink-0"
            title="Pick a color"
          />
          <input
            type="text"
            value={hexInput}
            onChange={e => setHexInput(e.target.value)}
            onBlur={handleHexSubmit}
            onKeyDown={e => e.key === 'Enter' && handleHexSubmit()}
            placeholder="#00fa15"
            className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-zinc-500"
            maxLength={7}
          />
        </div>
      )}
    </div>
  );
};
