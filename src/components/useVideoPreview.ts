import { useEffect, useRef, useState } from 'react';
import type { VideoSource } from '../core/videoSource.ts';

/**
 * A looping, muted video element playing just the selected clip.
 *
 * The editor draws from this rather than from a still frame, so what is on
 * the layout surface is the sticker in motion — including the speed-up a long
 * selection gets, which is otherwise invisible until the export finishes.
 */

/** Browsers refuse playback rates outside roughly this range. */
const MIN_RATE = 0.0625;
const MAX_RATE = 16;

export interface PreviewWindow {
  readonly startMs: number;
  readonly endMs: number;
  readonly speed: number;
}

export interface VideoPreview {
  readonly element: HTMLVideoElement | null;
  readonly ready: boolean;
}

export function useVideoPreview(source: VideoSource | null): VideoPreview {
  const [element, setElement] = useState<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!source) {
      setElement(null);
      setReady(false);
      return;
    }

    const url = URL.createObjectURL(source.file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    const onReady = () => setReady(true);
    video.addEventListener('loadeddata', onReady);
    video.src = url;

    setElement(video);
    setReady(false);

    return () => {
      video.removeEventListener('loadeddata', onReady);
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      setElement(null);
      setReady(false);
    };
  }, [source]);

  return { element, ready };
}

/**
 * Keep a preview element looping over the chosen window at the chosen speed.
 *
 * Kept separate from creating the element so that moving a trim handle does
 * not tear down and reload the video.
 */
export function usePreviewPlayback(
  element: HTMLVideoElement | null,
  ready: boolean,
  window: PreviewWindow,
): void {
  const windowRef = useRef(window);
  windowRef.current = window;

  useEffect(() => {
    if (!element || !ready) return;

    const startSeconds = () => windowRef.current.startMs / 1000;
    const endSeconds = () => windowRef.current.endMs / 1000;

    element.playbackRate = Math.min(MAX_RATE, Math.max(MIN_RATE, window.speed));
    if (element.currentTime < startSeconds() || element.currentTime >= endSeconds()) {
      element.currentTime = startSeconds();
    }

    // `loop` would replay the whole file, so the window is enforced here.
    const onTimeUpdate = () => {
      if (element.currentTime >= endSeconds() || element.currentTime < startSeconds() - 0.05) {
        element.currentTime = startSeconds();
      }
    };

    element.addEventListener('timeupdate', onTimeUpdate);
    const started = element.play();
    // Autoplay can be refused; the still frame already on the canvas stands in.
    if (started) started.catch(() => undefined);

    return () => {
      element.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [element, ready, window.speed, window.startMs, window.endMs]);
}
