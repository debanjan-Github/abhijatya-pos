import { useEffect } from 'react'

interface ImagePreviewModalProps {
  imageUrl?: string
  alt: string
  onClose: () => void
}

export function ImagePreviewModal({ imageUrl, alt, onClose }: ImagePreviewModalProps) {
  useEffect(() => {
    if (!imageUrl) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [imageUrl, onClose])

  if (!imageUrl) return null
  return <div className="image-preview-backdrop" role="presentation" onMouseDown={onClose}>
    <div className="image-preview-modal" role="dialog" aria-modal="true" aria-label={alt} onMouseDown={(event) => event.stopPropagation()}>
      <button className="image-preview-close" type="button" onClick={onClose} aria-label="Close image preview">×</button>
      <img src={imageUrl} alt={alt} />
    </div>
  </div>
}
