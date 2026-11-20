'use client';

import { useEffect, useState } from 'react';

const FALLBACK = process.env.NEXT_PUBLIC_PREVIEW_ORIGIN ?? 'http://localhost:4060';
let cached: string | null = null;

/** Origin of the rf-preview service, read from the server at runtime and cached. */
export function usePreviewOrigin(): string {
  const [origin, setOrigin] = useState<string>(cached ?? FALLBACK);
  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    fetch('/api/config')
      .then((r) => r.json())
      .then((json: { previewOrigin?: string }) => {
        if (json.previewOrigin) {
          cached = json.previewOrigin;
          if (!cancelled) setOrigin(json.previewOrigin);
        }
      })
      .catch(() => {
        if (!cancelled) setOrigin(FALLBACK);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return origin;
}
