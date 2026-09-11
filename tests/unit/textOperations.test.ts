import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_LAYER, FONT_CHOICES, TEXT_LIMITS, fontShorthand, getFont } from '@/core/text/model.ts';
import type { TextLayer } from '@/core/text/model.ts';
import {
  clampTextLayer,
  createTextLayer,
  duplicateLayer,
  findLayer,
  moveLayer,
  removeLayer,
  resetLayerIds,
  updateLayer,
} from '@/core/text/operations.ts';

beforeEach(() => {
  resetLayerIds();
});

function stack(): readonly TextLayer[] {
  return [
    createTextLayer({ text: 'bottom' }),
    createTextLayer({ text: 'middle' }),
    createTextLayer({ text: 'top' }),
  ];
}

const texts = (layers: readonly TextLayer[]) => layers.map((layer) => layer.text);

describe('createTextLayer', () => {
  it('starts from the default caption style', () => {
    const layer = createTextLayer();
    expect(layer).toMatchObject(DEFAULT_TEXT_LAYER);
  });

  it('applies overrides over the defaults', () => {
    expect(createTextLayer({ text: 'hi', rotation: 12 })).toMatchObject({ text: 'hi', rotation: 12 });
  });

  it('gives every layer a distinct id', () => {
    const ids = [createTextLayer(), createTextLayer(), createTextLayer()].map((layer) => layer.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('clamps overrides that are out of range', () => {
    expect(createTextLayer({ opacity: 5 }).opacity).toBe(TEXT_LIMITS.opacity.max);
  });
});

describe('clampTextLayer', () => {
  it.each([
    ['fontSize', 'fontSize', 10, TEXT_LIMITS.fontSize.max],
    ['fontSize', 'fontSize', -1, TEXT_LIMITS.fontSize.min],
    ['opacity', 'opacity', 2, 1],
    ['opacity', 'opacity', -2, 0],
    ['rotation', 'rotation', 400, 180],
    ['rotation', 'rotation', -400, -180],
    ['lineHeight', 'lineHeight', 99, TEXT_LIMITS.lineHeight.max],
    ['maxWidth', 'maxWidth', 4, 1],
    ['strokeWidth', 'strokeWidth', -3, 0],
  ])('clamps %s', (_label, field, input, expected) => {
    const layer = clampTextLayer({ ...createTextLayer(), [field]: input } as TextLayer);
    expect(layer[field as keyof TextLayer]).toBe(expected);
  });

  it('replaces a non-finite value with the lower bound rather than propagating NaN', () => {
    expect(clampTextLayer({ ...createTextLayer(), opacity: Number.NaN }).opacity).toBe(0);
    expect(clampTextLayer({ ...createTextLayer(), fontSize: Number.POSITIVE_INFINITY }).fontSize).toBe(
      TEXT_LIMITS.fontSize.min,
    );
  });

  it('truncates text beyond the length limit', () => {
    const layer = clampTextLayer({ ...createTextLayer(), text: 'x'.repeat(2000) });
    expect(layer.text).toHaveLength(TEXT_LIMITS.textLength);
  });

  it('allows a position slightly outside the canvas so text can hang off the edge', () => {
    expect(clampTextLayer({ ...createTextLayer(), x: -0.2 }).x).toBe(-0.2);
    expect(clampTextLayer({ ...createTextLayer(), x: -99 }).x).toBe(TEXT_LIMITS.position.min);
  });
});

describe('updateLayer', () => {
  it('patches only the named layer', () => {
    const layers = stack();
    const updated = updateLayer(layers, layers[1]!.id, { text: 'changed' });
    expect(texts(updated)).toEqual(['bottom', 'changed', 'top']);
  });

  it('leaves the stack untouched for an unknown id', () => {
    const layers = stack();
    expect(updateLayer(layers, 'missing', { text: 'x' })).toEqual(layers);
  });

  it('clamps the patched value', () => {
    const layers = stack();
    expect(updateLayer(layers, layers[0]!.id, { opacity: 9 })[0]?.opacity).toBe(1);
  });

  it('does not mutate the original array', () => {
    const layers = stack();
    updateLayer(layers, layers[0]!.id, { text: 'changed' });
    expect(texts(layers)).toEqual(['bottom', 'middle', 'top']);
  });
});

describe('removeLayer', () => {
  it('drops the named layer', () => {
    const layers = stack();
    expect(texts(removeLayer(layers, layers[1]!.id))).toEqual(['bottom', 'top']);
  });

  it('is a no-op for an unknown id', () => {
    const layers = stack();
    expect(texts(removeLayer(layers, 'missing'))).toEqual(['bottom', 'middle', 'top']);
  });
});

describe('duplicateLayer', () => {
  it('inserts the copy directly above the original', () => {
    const layers = stack();
    expect(texts(duplicateLayer(layers, layers[0]!.id))).toEqual(['bottom', 'bottom', 'middle', 'top']);
  });

  it('gives the copy a new id', () => {
    const layers = stack();
    const result = duplicateLayer(layers, layers[0]!.id);
    expect(result[1]?.id).not.toBe(layers[0]!.id);
  });

  it('offsets the copy so it is not hidden behind the original', () => {
    const layers = stack();
    const result = duplicateLayer(layers, layers[0]!.id);
    expect(result[1]?.x).toBeGreaterThan(layers[0]!.x);
    expect(result[1]?.y).toBeGreaterThan(layers[0]!.y);
  });

  it('keeps the offset copy inside the allowed position range', () => {
    const edge = [createTextLayer({ x: TEXT_LIMITS.position.max, y: TEXT_LIMITS.position.max })];
    const result = duplicateLayer(edge, edge[0]!.id);
    expect(result[1]?.x).toBe(TEXT_LIMITS.position.max);
  });

  it('is a no-op for an unknown id', () => {
    const layers = stack();
    expect(duplicateLayer(layers, 'missing')).toEqual(layers);
  });
});

describe('moveLayer', () => {
  it('moves a layer towards the front, which draws later', () => {
    const layers = stack();
    expect(texts(moveLayer(layers, layers[0]!.id, 'forward'))).toEqual(['middle', 'bottom', 'top']);
  });

  it('moves a layer towards the back', () => {
    const layers = stack();
    expect(texts(moveLayer(layers, layers[2]!.id, 'backward'))).toEqual(['bottom', 'top', 'middle']);
  });

  it('refuses to move the front layer further forward', () => {
    const layers = stack();
    expect(texts(moveLayer(layers, layers[2]!.id, 'forward'))).toEqual(['bottom', 'middle', 'top']);
  });

  it('refuses to move the back layer further backward', () => {
    const layers = stack();
    expect(texts(moveLayer(layers, layers[0]!.id, 'backward'))).toEqual(['bottom', 'middle', 'top']);
  });

  it('is a no-op for an unknown id', () => {
    const layers = stack();
    expect(moveLayer(layers, 'missing', 'forward')).toEqual(layers);
  });

  it('does not mutate the original array', () => {
    const layers = stack();
    moveLayer(layers, layers[0]!.id, 'forward');
    expect(texts(layers)).toEqual(['bottom', 'middle', 'top']);
  });
});

describe('findLayer', () => {
  it('finds a layer by id', () => {
    const layers = stack();
    expect(findLayer(layers, layers[1]!.id)?.text).toBe('middle');
  });

  it.each([
    ['a null id', null],
    ['an unknown id', 'missing'],
  ])('returns null for %s', (_label, id) => {
    expect(findLayer(stack(), id)).toBeNull();
  });
});

describe('fonts', () => {
  it.each(FONT_CHOICES)('$id resolves to itself', (choice) => {
    expect(getFont(choice.id).id).toBe(choice.id);
  });

  it('falls back to the first choice for an unknown id', () => {
    expect(getFont('nonsense' as never).id).toBe(FONT_CHOICES[0].id);
  });

  it('builds a CSS font shorthand a canvas will accept', () => {
    const shorthand = fontShorthand('impact', 64);
    expect(shorthand).toMatch(/^\d+ 64px /);
    expect(shorthand).toContain('Impact');
  });
});
