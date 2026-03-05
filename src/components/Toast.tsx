"use client";

import { useEffect, useState } from "react";

interface ToastProps {
  message: string;
  /** Optional progress percentage (0-100) */
  progress?: number;
  /** Duration in ms before auto-dismiss. 0 = persist until manually dismissed. Default: 0 */
  duration?: number;
  onDismiss: () => void;
}

export default function Toast({ message, progress, duration = 0, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(false);

  // Animate in on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Auto-dismiss after duration
  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 200);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onDismiss, 200);
  };

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-zinc-700/60 bg-zinc-800/95 shadow-xl backdrop-blur-sm transition-all duration-200 ${
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-2 opacity-0"
      }`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-300">{message}</p>
          {progress !== undefined && progress < 100 && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-700">
              <div
                className="h-full bg-green-500 transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        <button
          onClick={handleClose}
          className="shrink-0 rounded p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
          aria-label="Dismiss"
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    </div>
  );
}
