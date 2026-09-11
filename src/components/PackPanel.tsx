import { useEffect, useState } from 'react';
import { formatBytes } from '../core/budget.ts';
import type { BuiltPack } from '../core/pack/buildPack.ts';
import { PACK_LIMITS } from '../core/pack/model.ts';
import type { PackSticker, StickerPack } from '../core/pack/model.ts';
import { getSpec } from '../core/specs.ts';

export type PackBuildState =
  | { readonly status: 'idle' }
  | { readonly status: 'building' }
  | { readonly status: 'done'; readonly built: BuiltPack }
  | { readonly status: 'failed'; readonly message: string };

interface PackPanelProps {
  readonly pack: StickerPack;
  readonly state: PackBuildState;
  readonly issues: readonly { code: string; message: string; severity: 'error' | 'warning' }[];
  readonly onRename: (patch: { name?: string; publisher?: string }) => void;
  readonly onEmojis: (id: string, value: string) => void;
  readonly onMove: (id: string, direction: 'up' | 'down') => void;
  readonly onRemove: (id: string) => void;
  readonly onBuild: () => void;
}

function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  return url;
}

function StickerThumb({ sticker }: { readonly sticker: PackSticker }) {
  const spec = getSpec(sticker.targetId);
  const url = useObjectUrl(new Blob([sticker.bytes as BlobPart], { type: spec.mimeType }));

  if (!url) return <div className="pack__thumb" />;

  return spec.container === 'webm' ? (
    <video className="pack__thumb" src={url} autoPlay loop muted playsInline />
  ) : (
    <img className="pack__thumb" src={url} alt={`${spec.label} from ${sticker.sourceName}`} />
  );
}

export function PackPanel({
  pack,
  state,
  issues,
  onRename,
  onEmojis,
  onMove,
  onRemove,
  onBuild,
}: PackPanelProps) {
  const built = state.status === 'done' ? state.built : null;
  const url = useObjectUrl(built?.blob ?? null);
  const blocking = issues.some((issue) => issue.severity === 'error');

  return (
    <section className="panel pack" aria-label="Sticker pack" data-testid="pack-panel">
      <div className="panel__header">
        <h2 className="panel__title">
          Pack <span className="pack__count" data-testid="pack-count">{pack.stickers.length}</span>
        </h2>
        <button
          type="button"
          data-testid="build-pack"
          disabled={pack.stickers.length === 0 || blocking || state.status === 'building'}
          onClick={onBuild}
        >
          {state.status === 'building' ? 'Packing…' : 'Build archive'}
        </button>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Pack name</span>
          <input
            className="field__input"
            data-testid="pack-name"
            type="text"
            value={pack.name}
            maxLength={PACK_LIMITS.nameLength}
            onChange={(event) => onRename({ name: event.target.value })}
          />
        </label>
        <label className="field">
          <span className="field__label">Publisher</span>
          <input
            className="field__input"
            data-testid="pack-publisher"
            type="text"
            value={pack.publisher}
            maxLength={PACK_LIMITS.publisherLength}
            onChange={(event) => onRename({ publisher: event.target.value })}
          />
        </label>
      </div>

      {pack.stickers.length === 0 ? (
        <p className="layers__empty" data-testid="pack-empty">
          Nothing in the pack yet. Generate a sticker, then add it here.
        </p>
      ) : (
        <ul className="pack__list" data-testid="pack-list">
          {pack.stickers.map((sticker, index) => (
            <li className="pack__item" key={sticker.id} data-testid={`pack-item-${index}`}>
              <StickerThumb sticker={sticker} />

              <div className="pack__details">
                <p className="pack__name">{getSpec(sticker.targetId).label}</p>
                <p className="pack__meta">
                  {sticker.sourceName} · {formatBytes(sticker.bytes.byteLength)}
                </p>
                <input
                  className="field__input pack__emojis"
                  data-testid={`pack-emojis-${index}`}
                  type="text"
                  aria-label={`Emoji for sticker ${index + 1}`}
                  value={sticker.emojis.join('')}
                  onChange={(event) => onEmojis(sticker.id, event.target.value)}
                />
              </div>

              <div className="layers__actions">
                <button
                  type="button"
                  aria-label={`Move sticker ${index + 1} earlier`}
                  data-testid={`pack-up-${index}`}
                  disabled={index === 0}
                  onClick={() => onMove(sticker.id, 'up')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move sticker ${index + 1} later`}
                  data-testid={`pack-down-${index}`}
                  disabled={index === pack.stickers.length - 1}
                  onClick={() => onMove(sticker.id, 'down')}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Remove sticker ${index + 1}`}
                  data-testid={`pack-remove-${index}`}
                  onClick={() => onRemove(sticker.id)}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {issues.length > 0 && (
        <ul className="card__issues" data-testid="pack-issues">
          {issues.map((issue) => (
            <li key={issue.code} className={`pack__issue pack__issue--${issue.severity}`}>
              {issue.message}
            </li>
          ))}
        </ul>
      )}

      {state.status === 'failed' && (
        <p className="card__status card__status--error" role="alert" data-testid="pack-error">
          {state.message}
        </p>
      )}

      {built && (
        <a
          className="card__download"
          data-testid="download-pack"
          href={url ?? undefined}
          download={built.fileName}
        >
          Download {built.fileName} ({formatBytes(built.bytes.byteLength)})
        </a>
      )}
    </section>
  );
}
