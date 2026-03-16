import React from 'react';

interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const TextInput: React.FC<TextInputProps> = ({ label, className = '', ...props }) => {
  return (
    <div>
      {label && <label className="block text-sm font-medium text-zinc-400 mb-2">{label}</label>}
      <input
        className={`w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2.5 text-white placeholder-zinc-500 focus:border-indigo-500 outline-none transition-colors ${className}`}
        {...props}
      />
    </div>
  );
};
