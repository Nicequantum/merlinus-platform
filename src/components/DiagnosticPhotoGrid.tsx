'use client';

import Image from 'next/image';
import { useState } from 'react';
import { AlertCircle, Check, Loader2, Trash2 } from 'lucide-react';
import { ImageLightbox } from '@/components/ImageLightbox';
import type { ImageAttachment, PendingImage } from '@/types';

interface DiagnosticPhotoGridProps {
  images: PendingImage[];
  isProcessing?: boolean;
  onDeleteImage?: (imageId: string) => void;
}

function toLightboxAttachment(img: PendingImage): ImageAttachment {
  if (img.attachment) return img.attachment;
  return {
    id: img.id,
    pathname: '',
    url: img.previewUrl,
    name: img.name,
  };
}

/**
 * Prefer blob preview until the authenticated proxy URL loads successfully.
 * Cold-start / first-login proxy 403s used to blank the thumbnail even though
 * the capture succeeded.
 */
function PendingThumb({
  img,
  onOpen,
}: {
  img: PendingImage;
  onOpen: () => void;
}) {
  const proxyUrl = img.attachment?.url;
  const [useProxy, setUseProxy] = useState(Boolean(proxyUrl));
  const displayUrl = useProxy && proxyUrl ? proxyUrl : img.previewUrl;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative block h-20 w-full focus:outline-none focus:ring-2 focus:ring-benz-accent/50"
      aria-label={`Preview ${img.name}`}
    >
      <Image
        key={displayUrl}
        src={displayUrl}
        alt={img.name}
        fill
        unoptimized
        className="object-cover"
        sizes="120px"
        onError={() => {
          if (useProxy && img.previewUrl) setUseProxy(false);
        }}
      />
    </button>
  );
}

export function DiagnosticPhotoGrid({
  images,
  isProcessing = false,
  onDeleteImage,
}: DiagnosticPhotoGridProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = images.find((img) => img.id === activeId) ?? null;

  if (images.length === 0) return null;

  return (
    <>
      <div className="grid grid-cols-3 gap-2.5">
        {images.map((img) => {
          const canDelete = Boolean(onDeleteImage) && !isProcessing && img.uploadStatus !== 'uploading';

          return (
            <div
              key={img.id}
              className="relative rounded-benz overflow-hidden border border-[var(--benz-border)]"
            >
              <PendingThumb img={img} onOpen={() => setActiveId(img.id)} />

              {img.uploadStatus === 'uploading' && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 size={16} className="animate-spin text-white" />
                </div>
              )}

              {img.uploadStatus === 'saved' && !isProcessing && (
                <div className="absolute bottom-1 left-1 rounded-full bg-benz-green/90 p-0.5">
                  <Check size={12} className="text-white" />
                </div>
              )}

              {img.uploadStatus === 'error' && (
                <div className="absolute bottom-1 left-1 rounded-full bg-benz-red/90 p-0.5">
                  <AlertCircle size={12} className="text-white" />
                </div>
              )}

              {isProcessing && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 size={16} className="animate-spin text-white" />
                </div>
              )}

              {canDelete && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteImage?.(img.id);
                  }}
                  className="absolute top-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-benz-red/90 transition-colors"
                  aria-label={`Delete ${img.name}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {active && (
        <ImageLightbox
          images={images.map(toLightboxAttachment)}
          startIndex={Math.max(0, images.findIndex((img) => img.id === active.id))}
          onClose={() => setActiveId(null)}
          onDelete={
            onDeleteImage && !isProcessing && active.uploadStatus !== 'uploading'
              ? (attachment) => {
                  onDeleteImage(attachment.id);
                  setActiveId(null);
                }
              : undefined
          }
        />
      )}
    </>
  );
}