import type { VideoSource } from './videoSource.ts';

/**
 * A still frame from a video, for the editor to lay text out against.
 *
 * Grabbing it with a video element rather than ffmpeg keeps the editor usable
 * immediately: nothing downloads the 32 MB engine until an export is actually
 * requested.
 */

const SEEK_TIMEOUT_MS = 10_000;

export async function captureVideoPoster(
  source: VideoSource,
  timeMs = 0,
): Promise<ImageBitmap> {
  const url = URL.createObjectURL(source.file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out reading a frame from this video')),
        SEEK_TIMEOUT_MS,
      );
      const settle = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      video.addEventListener('seeked', () => settle(), { once: true });
      video.addEventListener('error', () => settle(new Error('Could not decode this video')), {
        once: true,
      });
      video.addEventListener(
        'loadeddata',
        () => {
          // Clamp inside the media, and just off zero: seeking to exactly 0
          // does not always fire `seeked` once the first frame is shown.
          const target = Math.min(Math.max(timeMs / 1000, 0.001), Math.max(source.durationMs / 1000 - 0.05, 0));
          video.currentTime = target;
        },
        { once: true },
      );

      video.src = url;
    });

    return await createImageBitmap(video);
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
