import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

// ── Types ──
type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  exiting: boolean;
}

interface ToastContextType {
  toast: (message: string, options?: { type?: ToastType; duration?: number }) => void;
}

// ── Context ──
const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};

// ── Icons & Colors ──
const TOAST_STYLES: Record<ToastType, { icon: string; border: string; iconColor: string }> = {
  success: { icon: 'fa-check', border: 'border-emerald-600/40', iconColor: 'text-emerald-400' },
  error: { icon: 'fa-circle-exclamation', border: 'border-red-600/40', iconColor: 'text-red-400' },
  info: { icon: 'fa-circle-info', border: 'border-cyan-600/40', iconColor: 'text-cyan-400' },
};

// ── Request browser notification permission once ──
let notifPermissionAsked = false;
const requestNotifPermission = () => {
  if (notifPermissionAsked || typeof Notification === 'undefined') return;
  notifPermissionAsked = true;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
};

// ── Provider ──
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Ask for notification permission on first toast
  useEffect(() => { requestNotifPermission(); }, []);

  const removeToast = useCallback((id: string) => {
    // Start exit animation
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 300);
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
  }, []);

  const toast = useCallback((message: string, options?: { type?: ToastType; duration?: number }) => {
    const id = crypto.randomUUID();
    const type = options?.type ?? 'info';
    const duration = options?.duration ?? 4000;

    setToasts(prev => {
      const next = [...prev, { id, message, type, duration, exiting: false }];
      // Max 5 visible — remove oldest
      return next.length > 5 ? next.slice(-5) : next;
    });

    // Auto-dismiss
    const timer = setTimeout(() => removeToast(id), duration);
    timersRef.current.set(id, timer);

    // Browser notification if tab is not focused
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      try { new Notification('Mega Design Studio', { body: message, icon: '/favicon.ico' }); } catch { /* silent */ }
    }
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container — bottom right */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 380 }}>
        {toasts.map(t => {
          const style = TOAST_STYLES[t.type];
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg border bg-zinc-900/95 backdrop-blur-sm shadow-xl transition-all duration-300 ${style.border} ${
                t.exiting ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'
              }`}
              style={{ animation: t.exiting ? undefined : 'toastSlideIn 0.3s ease-out' }}
            >
              <i className={`fa-solid ${style.icon} ${style.iconColor} text-sm shrink-0`} />
              <span className="text-xs text-zinc-200 flex-1 leading-relaxed">{t.message}</span>
              <button
                onClick={() => removeToast(t.id)}
                className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0 ml-1"
              >
                <i className="fa-solid fa-xmark text-[10px]" />
              </button>
            </div>
          );
        })}
      </div>
      {/* Keyframe for slide-in animation */}
      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateX(40px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
};
