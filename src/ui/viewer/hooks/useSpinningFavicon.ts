import { useEffect, useRef } from 'react';

export function useSpinningFavicon(isProcessing: boolean) {
  const animationRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const rotationRef = useRef(0);
  const originalFaviconRef = useRef<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement('canvas');
      canvasRef.current.width = 32;
      canvasRef.current.height = 32;
    }

    if (!imageRef.current) {
      imageRef.current = new Image();
      // keepmind logomark as an inline SVG data URI (no raster brand asset).
      imageRef.current.src =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%232563eb'/%3E%3Cpath d='M8 9 L12 16 L16 9' fill='none' stroke='%23fff' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='8' cy='9' r='2.1' fill='%23fff'/%3E%3Ccircle cx='16' cy='9' r='2.1' fill='%23fff'/%3E%3Ccircle cx='12' cy='16' r='2.1' fill='%23fff'/%3E%3C/svg%3E";
    }

    if (!originalFaviconRef.current) {
      const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (link) {
        originalFaviconRef.current = link.href;
      }
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const image = imageRef.current;

    if (!ctx) return;

    const updateFavicon = (dataUrl: string) => {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = dataUrl;
    };

    const animate = () => {
      if (!image.complete) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      rotationRef.current += (2 * Math.PI) / 90;

      ctx.clearRect(0, 0, 32, 32);
      ctx.save();
      ctx.translate(16, 16);
      ctx.rotate(rotationRef.current);
      ctx.drawImage(image, -16, -16, 32, 32);
      ctx.restore();

      updateFavicon(canvas.toDataURL('image/png'));
      animationRef.current = requestAnimationFrame(animate);
    };

    if (isProcessing) {
      rotationRef.current = 0;
      animate();
    } else {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      if (originalFaviconRef.current) {
        updateFavicon(originalFaviconRef.current);
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isProcessing]);
}
