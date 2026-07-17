'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { ImageAttachment } from '@/types';
import { ImageLightbox } from './ImageLightbox';

interface XentryImageGalleryProps {
  images: ImageAttachment[];
  onDeleteImage?: (imageId: string) => void;
}

export function XentryImageGallery({ images, onDeleteImage }: XentryImageGalleryProps) {
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const activeImage = images.find((img) => img.id === activeImageId) || null;

  if (images.length === 0) return null;

  return (
    <>
      <div className="benz-photo-grid mb-3">
        {images.map((img) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setActiveImageId(img.id)}
            className="benz-photo-thumb relative focus:outline-none focus:ring-2 focus:ring-benz-accent/50"
            aria-label={`View ${img.name}`}
          >
            <Image src={img.url} alt={img.name} fill unoptimized className="object-cover" sizes="120px" />
          </button>
        ))}
      </div>

      {activeImage && (
        <ImageLightbox
          images={images}
          startIndex={Math.max(0, images.findIndex((img) => img.id === activeImage.id))}
          onClose={() => setActiveImageId(null)}
          onDelete={
            onDeleteImage
              ? (attachment) => {
                  onDeleteImage(attachment.id);
                  setActiveImageId(null);
                }
              : undefined
          }
        />
      )}
    </>
  );
}