import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';

interface ApiKeyDialogProps {
  isOpen: boolean;
  onSubmit: (key: string) => void;
  onClose: () => void;
}

export const ApiKeyDialog: React.FC<ApiKeyDialogProps> = ({ isOpen, onSubmit, onClose }) => {
  const [key, setKey] = useState('');

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (key.trim()) {
      onSubmit(key.trim());
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl max-w-md w-full shadow-2xl">
        <h2 className="text-2xl font-bold mb-4">API Key Required</h2>
        <p className="text-zinc-400 mb-6 leading-relaxed">
          This application uses Google's <strong>Gemini</strong> and <strong>Veo 3.1</strong> models.
          Enter your Gemini API key to get started.
        </p>
        <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg mb-6 text-sm text-blue-300">
          <i className="fas fa-info-circle mr-2"></i>
          Get a key from{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-200">
            Google AI Studio
          </a>
        </div>
        <TextInput
          placeholder="Enter your Gemini API key..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          type="password"
        />
        <div className="flex gap-3 mt-6">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!key.trim()} className="flex-1">
            Connect
          </Button>
        </div>
      </div>
    </div>
  );
};
