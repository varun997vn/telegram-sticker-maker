import type { TextLayer } from '../core/text/model.ts';

interface TextLayerListProps {
  readonly layers: readonly TextLayer[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onMove: (id: string, direction: 'forward' | 'backward') => void;
  readonly onDuplicate: (id: string) => void;
  readonly onRemove: (id: string) => void;
}

export function TextLayerList({
  layers,
  selectedId,
  onSelect,
  onMove,
  onDuplicate,
  onRemove,
}: TextLayerListProps) {
  if (layers.length === 0) {
    return (
      <p className="layers__empty" data-testid="layers-empty">
        No text yet. Add a layer to caption the sticker.
      </p>
    );
  }

  // Later layers draw on top, so the list reads front to back.
  const ordered = [...layers].reverse();

  return (
    <ul className="layers" data-testid="layer-list">
      {ordered.map((layer) => {
        const index = layers.indexOf(layer);
        return (
          <li
            key={layer.id}
            className={`layers__item${layer.id === selectedId ? ' layers__item--selected' : ''}`}
            data-testid={`layer-item-${index}`}
          >
            <button
              type="button"
              className="layers__name"
              data-testid={`layer-select-${index}`}
              aria-pressed={layer.id === selectedId}
              onClick={() => onSelect(layer.id)}
            >
              {layer.text.trim() === '' ? '(empty)' : layer.text.split('\n')[0]}
            </button>

            <div className="layers__actions">
              <button
                type="button"
                title="Bring forward"
                aria-label={`Bring "${layer.text}" forward`}
                data-testid={`layer-forward-${index}`}
                disabled={index === layers.length - 1}
                onClick={() => onMove(layer.id, 'forward')}
              >
                ↑
              </button>
              <button
                type="button"
                title="Send backward"
                aria-label={`Send "${layer.text}" backward`}
                data-testid={`layer-backward-${index}`}
                disabled={index === 0}
                onClick={() => onMove(layer.id, 'backward')}
              >
                ↓
              </button>
              <button
                type="button"
                title="Duplicate"
                aria-label={`Duplicate "${layer.text}"`}
                data-testid={`layer-duplicate-${index}`}
                onClick={() => onDuplicate(layer.id)}
              >
                ⧉
              </button>
              <button
                type="button"
                title="Delete"
                aria-label={`Delete "${layer.text}"`}
                data-testid={`layer-remove-${index}`}
                onClick={() => onRemove(layer.id)}
              >
                ✕
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
