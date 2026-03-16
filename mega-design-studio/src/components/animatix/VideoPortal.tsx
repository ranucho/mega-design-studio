import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface VideoPortalProps {
  children: React.ReactNode;
  onClose: () => void;
}

export const VideoPortal: React.FC<VideoPortalProps> = ({ children, onClose }) => {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const externalWindow = useRef<Window | null>(null);

  useEffect(() => {
    const win = window.open('', '_blank', 'width=1280,height=720,left=200,top=200');
    if (!win) {
      console.error("Failed to open new window. Popup blocker might be active.");
      return;
    }

    externalWindow.current = win;
    win.document.title = "Mega Design Studio - Final Movie";

    const div = win.document.createElement('div');
    div.id = 'portal-root';
    win.document.body.appendChild(div);

    const tailwind = win.document.createElement('script');
    tailwind.src = "https://cdn.tailwindcss.com";
    win.document.head.appendChild(tailwind);

    win.document.body.className = "bg-black m-0 p-0 h-screen w-screen overflow-hidden flex items-center justify-center";

    setContainer(div);

    const checkClosed = setInterval(() => {
      if (win.closed) {
        clearInterval(checkClosed);
        onClose();
      }
    }, 1000);

    return () => {
      clearInterval(checkClosed);
      if (externalWindow.current && !externalWindow.current.closed) {
        externalWindow.current.close();
      }
    };
  }, []);

  return container ? createPortal(children, container) : null;
};
