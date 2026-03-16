import React from 'react';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}

export const Select: React.FC<SelectProps> = ({ label, options, className = '', ...props }) => {
  return (
    <div>
      {label && <label className="block text-sm font-medium text-zinc-400 mb-2">{label}</label>}
      <select
        className={`w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-white outline-none appearance-none focus:border-indigo-500 transition-colors ${className}`}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
};
