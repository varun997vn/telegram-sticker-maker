import { createRenderCanvas, canvasToBlob, get2dContext } from './render/canvas.ts';

/**
 * A built-in image to try the editor with.
 *
 * Drawn at runtime rather than shipped as a file: it costs nothing in the
 * bundle, and it gives someone who just wants to see what the tool does a way
 * in that does not require finding a photo first.
 */

export const SAMPLE_FILE_NAME = 'example.png';

export async function createSampleFile(): Promise<File> {
  const size = { width: 900, height: 700 };
  const canvas = createRenderCanvas(size);
  const context = get2dContext(canvas);

  const gradient = context.createLinearGradient(0, 0, size.width, size.height);
  gradient.addColorStop(0, '#4f9cf9');
  gradient.addColorStop(0.55, '#8a63f9');
  gradient.addColorStop(1, '#f9639c');

  context.clearRect(0, 0, size.width, size.height);

  // A rounded blob rather than a full-bleed rectangle, so the transparent
  // corners show what a sticker's alpha channel is for.
  const radius = Math.min(size.width, size.height) * 0.42;
  context.save();
  context.beginPath();
  context.ellipse(size.width / 2, size.height / 2, radius * 1.25, radius, 0, 0, Math.PI * 2);
  context.closePath();
  context.clip();
  context.fillStyle = gradient;
  context.fillRect(0, 0, size.width, size.height);

  context.globalAlpha = 0.18;
  context.strokeStyle = '#ffffff';
  context.lineWidth = 18;
  for (let i = -size.height; i < size.width; i += 70) {
    context.beginPath();
    context.moveTo(i, 0);
    context.lineTo(i + size.height, size.height);
    context.stroke();
  }
  context.restore();

  const blob = await canvasToBlob(canvas, 'image/png');
  return new File([blob], SAMPLE_FILE_NAME, { type: 'image/png' });
}
