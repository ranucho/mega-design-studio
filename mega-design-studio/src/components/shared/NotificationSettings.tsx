import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';

interface NotificationSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  topic: string;
  onTopicChange: (newTopic: string) => void;
}

export const NotificationSettings: React.FC<NotificationSettingsProps> = ({
  isOpen,
  onClose,
  topic,
  onTopicChange
}) => {
  const [localTopic, setLocalTopic] = useState(topic);
  const [isTestLoading, setIsTestLoading] = useState(false);

  useEffect(() => {
    setLocalTopic(topic);
  }, [topic]);

  if (!isOpen) return null;

  const generateRandomTopic = () => {
    const random = Math.random().toString(36).substring(2, 10);
    setLocalTopic(`megastudio-${random}`);
  };

  const handleSave = () => {
    onTopicChange(localTopic);
    onClose();
  };

  const sendTestNotification = async () => {
    if (!localTopic) return;
    setIsTestLoading(true);
    try {
      await fetch(`https://ntfy.sh/${localTopic}`, {
        method: 'POST',
        body: 'This is a test notification from Mega Design Studio!',
        headers: { 'Title': 'Studio Connected', 'Tags': 'tada' }
      });
      alert("Notification sent! Check your phone.");
    } catch (e) {
      alert("Failed to send test notification.");
      console.error(e);
    } finally {
      setIsTestLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <i className="fa-solid fa-bell text-indigo-400" />
            Phone Notifications
          </h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-indigo-900/20 border border-indigo-500/30 p-4 rounded-lg text-sm text-indigo-200">
            <p className="mb-2 font-semibold">How to get notifications on your phone:</p>
            <ol className="list-decimal list-inside space-y-1 text-zinc-300">
              <li>Install the free <strong>Ntfy</strong> app (iOS/Android).</li>
              <li>Subscribe to the <strong>Topic Name</strong> below.</li>
              <li>Leave this tab open on your computer to render.</li>
              <li>We'll buzz your phone when it's done!</li>
            </ol>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-2">Topic Name</label>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white focus:border-indigo-500 outline-none"
                placeholder="e.g. megastudio-my-name"
                value={localTopic}
                onChange={(e) => setLocalTopic(e.target.value)}
              />
              <button
                onClick={generateRandomTopic}
                className="px-3 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-700"
                title="Generate Random"
              >
                <i className="fa-solid fa-dice" />
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Use a unique name to avoid receiving other people's notifications.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={sendTestNotification} disabled={!localTopic || isTestLoading} className="flex-1">
              {isTestLoading ? 'Sending...' : 'Test on Phone'}
            </Button>
            <Button variant="primary" onClick={handleSave} className="flex-1">
              Save Settings
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
