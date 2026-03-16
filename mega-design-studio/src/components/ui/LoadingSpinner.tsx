import React from 'react';

interface LoadingSpinnerProps {
  text?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ text, size = 'md' }) => {
  const sizes = {
    sm: 'h-5 w-5 border-2',
    md: 'h-10 w-10 border-2',
    lg: 'h-16 w-16 border-4',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div className={`${sizes[size]} border-zinc-800 border-t-indigo-500 rounded-full animate-spin`} />
      {text && <p className="text-sm text-zinc-400 animate-pulse">{text}</p>}
    </div>
  );
};
