import { useEffect } from 'react';
import { X } from 'lucide-react';

interface MediaLightboxProps {
  src: string | null;
  caption?: string;
  senderName?: string;
  onClose: () => void;
}

export function MediaLightbox({ src, caption, senderName, onClose }: MediaLightboxProps) {
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Shared photo viewer"
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-4 sm:p-8"
      onClick={onClose}
    >
      <div className="w-full max-w-4xl flex items-center justify-between text-white mb-4" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          {senderName && <p className="text-sm font-medium truncate">{senderName}</p>}
          {caption && <p className="text-xs text-white/75 truncate">{caption}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo viewer"
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer shrink-0"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>

      <img
        src={src}
        alt={caption || 'Shared photo'}
        referrerPolicy="no-referrer"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[78vh] max-w-full rounded-xl object-contain shadow-2xl"
      />
    </div>
  );
}
