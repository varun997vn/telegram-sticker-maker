import { DEFAULT_TEXT_LAYER, TEXT_LIMITS } from './model.ts';
import type { TextLayer } from './model.ts';

/** Pure list operations for the layer stack; the UI holds the result in state. */

let counter = 0;

function nextId(): string {
  counter += 1;
  return `layer-${counter}`;
}

/** Test seam: makes generated ids predictable. */
export function resetLayerIds(): void {
  counter = 0;
}

function clamp(value: number, range: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return range.min;
  return Math.min(Math.max(value, range.min), range.max);
}

/** Bring every numeric field back inside the range the renderer can handle. */
export function clampTextLayer(layer: TextLayer): TextLayer {
  return {
    ...layer,
    text: layer.text.slice(0, TEXT_LIMITS.textLength),
    x: clamp(layer.x, TEXT_LIMITS.position),
    y: clamp(layer.y, TEXT_LIMITS.position),
    fontSize: clamp(layer.fontSize, TEXT_LIMITS.fontSize),
    strokeWidth: clamp(layer.strokeWidth, TEXT_LIMITS.strokeWidth),
    shadowBlur: clamp(layer.shadowBlur, TEXT_LIMITS.shadowBlur),
    rotation: clamp(layer.rotation, TEXT_LIMITS.rotation),
    opacity: clamp(layer.opacity, TEXT_LIMITS.opacity),
    lineHeight: clamp(layer.lineHeight, TEXT_LIMITS.lineHeight),
    maxWidth: clamp(layer.maxWidth, TEXT_LIMITS.maxWidth),
  };
}

export function createTextLayer(overrides: Partial<Omit<TextLayer, 'id'>> = {}): TextLayer {
  return clampTextLayer({ id: nextId(), ...DEFAULT_TEXT_LAYER, ...overrides });
}

export function updateLayer(
  layers: readonly TextLayer[],
  id: string,
  patch: Partial<Omit<TextLayer, 'id'>>,
): readonly TextLayer[] {
  return layers.map((layer) => (layer.id === id ? clampTextLayer({ ...layer, ...patch }) : layer));
}

export function removeLayer(layers: readonly TextLayer[], id: string): readonly TextLayer[] {
  return layers.filter((layer) => layer.id !== id);
}

/** Copies a layer directly above the original, nudged so it is visibly distinct. */
export function duplicateLayer(layers: readonly TextLayer[], id: string): readonly TextLayer[] {
  const index = layers.findIndex((layer) => layer.id === id);
  if (index === -1) return layers;

  const original = layers[index] as TextLayer;
  const copy = clampTextLayer({
    ...original,
    id: nextId(),
    x: original.x + 0.04,
    y: original.y + 0.04,
  });

  return [...layers.slice(0, index + 1), copy, ...layers.slice(index + 1)];
}

/**
 * Move a layer one place through the stack. Later entries draw on top, so
 * "forward" means towards the end of the list.
 */
export function moveLayer(
  layers: readonly TextLayer[],
  id: string,
  direction: 'forward' | 'backward',
): readonly TextLayer[] {
  const index = layers.findIndex((layer) => layer.id === id);
  if (index === -1) return layers;

  const target = direction === 'forward' ? index + 1 : index - 1;
  if (target < 0 || target >= layers.length) return layers;

  const next = [...layers];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved as TextLayer);
  return next;
}

export function findLayer(layers: readonly TextLayer[], id: string | null): TextLayer | null {
  if (id === null) return null;
  return layers.find((layer) => layer.id === id) ?? null;
}
