'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { ImageAttachment } from '@/types';

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

interface ImageLightboxProps {
  images: ImageAttachment[];
  startIndex?: number;
  onClose: () => void;
  onDelete?: (image: ImageAttachment) => void;
}

export function ImageLightbox({
  images,
  startIndex = 0,
  onClose,
  onDelete,
}: ImageLightboxProps) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(startIndex, 0), Math.max(images.length - 1, 0))
  );
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; panX: number; panY: number } | null>(
    null
  );

  const image = images[index] ?? null;
  const hasMultiple = images.length > 1;

  const resetView = useCallback(() => {
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
  }, []);

  const goPrev = useCallback(() => {
    setIndex((current) => (current <= 0 ? images.length - 1 : current - 1));
    resetView();
  }, [images.length, resetView]);

  const goNext = useCallback(() => {
    setIndex((current) => (current >= images.length - 1 ? 0 : current + 1));
    resetView();
  }, [images.length, resetView]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasMultiple) goPrev();
      if (e.key === 'ArrowRight' && hasMultiple) goNext();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [goNext, goPrev, hasMultiple, onClose]);

  useEffect(() => {
    resetView();
  }, [index, resetView]);

  if (!image) return null;

  const canPan = zoom > MIN_ZOOM;

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoom((current) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current + delta));
      if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!canPan) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag?.active) return;
    setPan({
      x: drag.panX + (e.clientX - drag.startX),
      y: drag.panY + (e.clientY - drag.startY),
    });
  };

  const handlePointerUp = () => {
    if (dragRef.current) dragRef.current.active = false;
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/92 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 z-[101] flex h-11 w-11 items-center justify-center rounded-full bg-benz-surface/80 border border-benz-surface-3 text-benz-silver hover:text-white transition-colors touch-target"
        aria-label="Close image"
      >
        <X size={22} />
      </button>

      <div className="absolute top-4 left-1/2 z-[101] flex -translate-x-1/2 items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setZoom((current) => Math.min(MAX_ZOOM, current + ZOOM_STEP));
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-benz-surface/80 border border-benz-surface-3 text-benz-silver hover:text-white"
          aria-label="Zoom in"
        >
          <ZoomIn size={18} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setZoom((current) => {
              const next = Math.max(MIN_ZOOM, current - ZOOM_STEP);
              if (next === MIN_ZOOM) setPan({ x: 0, y: 0 });
              return next;
            });
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-benz-surface/80 border border-benz-surface-3 text-benz-silver hover:text-white"
          aria-label="Zoom out"
        >
          <ZoomOut size={18} />
        </button>
        <span className="rounded-full bg-benz-surface/80 border border-benz-surface-3 px-3 py-1.5 text-xs text-benz-silver">
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(image);
          }}
          className="absolute top-4 left-4 z-[101] flex h-11 items-center gap-2 rounded-full benz-danger-btn px-4 text-sm touch-target border-none"
          aria-label="Delete image"
        >
          <Trash2 size={18} />
          Delete
        </button>
      )}

      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            className="absolute left-3 top-1/2 z-[101] flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-benz-surface/80 border border-benz-surface-3 text-benz-silver hover:text-white"
            aria-label="Previous image"
          >
            <ChevronLeft size={24} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            className="absolute right-3 top-1/2 z-[101] flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-benz-surface/80 border border-benz-surface-3 text-benz-silver hover:text-white"
            aria-label="Next image"
          >
            <ChevronRight size={24} />
          </button>
        </>
      )}

      <div
        className="relative h-[85vh] w-[min(90vw,1200px)] overflow-hidden touch-none"
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="relative h-full w-full transition-transform duration-150 ease-out"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          <Image
            src={image.url}
            alt={image.name}
            fill
            unoptimized
            className="rounded-benz-lg object-contain shadow-benz-lg select-none"
            sizes="90vw"
            draggable={false}
          />
        </div>
      </div>

      <div className="absolute bottom-5 left-1/2 max-w-[90vw] -translate-x-1/2 truncate rounded-full bg-benz-surface/80 border border-benz-surface-3 px-4 py-2 text-xs text-benz-silver">
        {hasMultiple ? `${index + 1} / ${images.length} · ` : ''}
        {image.name}
      </div>
    </div>
  );
}