import { useEffect, useState } from 'react';
import { formatBytes } from '../core/budget.ts';
import type { StaticEncodeResult } from '../core/encode/staticSticker.ts';
import type { StickerSpec } from '../core/specs.ts';

export type ExportState =
  | { readonly status: 'encoding' }
  | { readonly status: 'done'; readonly result: StaticEncodeResult }
  | { readonly status: 'failed'; readonly message: string };

interface ExportCardProps {
  readonly spec: StickerSpec;
  readonly state: ExportState;
  readonly fileName: string;
  readonly onAddToPack?: () => void;
  readonly children?: React.ReactNode;
}

function useObjectUrl(blob: Blob | null): string | null {
  const [entry, setEntry] = useState<{ blob: Blob; url: string } | null>(null);

  useEffect(() => {
    if (!blob) {
      setEntry(null);
      return;
    }

    const url = URL.createObjectURL(blob);
    setEntry({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  // Creating the URL is an effect, so for one commit after a new result
  // arrives the previous URL is still in state. Returning it then would offer
  // a download link pointing at the sticker before last, so the link is
  // withheld until the URL belongs to the blob being rendered.
  return entry && entry.blob === blob ? entry.url : null;
}

export function ExportCard({ spec, state, fileName, onAddToPack, children }: ExportCardProps) {
  const result = state.status === 'done' ? state.result : null;
  const url = useObjectUrl(result?.blob ?? null);

  const issues = result?.compliance.issues ?? [];
  const ok = result?.compliance.ok ?? false;

  return (
    <article className="card" data-testid={`export-${spec.id}`}>
      <header className="card__header">
        <h3 className="card__title">{spec.label}</h3>
        <p className="card__meta">
          {spec.container.toUpperCase()} &middot; max {formatBytes(spec.maxBytes)}
        </p>
      </header>

      <div className="card__preview">{children}</div>

      <dl className="card__stats">
        <div>
          <dt>Size</dt>
          <dd data-testid={`size-${spec.id}`}>
            {result ? formatBytes(result.byteLength) : '—'}
          </dd>
        </div>
        <div>
          <dt>Dimensions</dt>
          <dd data-testid={`dimensions-${spec.id}`}>
            {result ? `${result.size.width}x${result.size.height}` : '—'}
          </dd>
        </div>
        <div>
          <dt>Quality</dt>
          <dd data-testid={`quality-${spec.id}`}>{result ? result.quality : '—'}</dd>
        </div>
      </dl>

      <p
        className={`card__status card__status--${ok ? 'ok' : state.status === 'encoding' ? 'busy' : 'error'}`}
        data-testid={`status-${spec.id}`}
        role="status"
      >
        {state.status === 'encoding' && 'Encoding…'}
        {state.status === 'failed' && state.message}
        {state.status === 'done' && (ok ? 'Meets every requirement' : issues[0]?.message)}
      </p>

      {issues.length > 1 && (
        <ul className="card__issues">
          {issues.slice(1).map((issue) => (
            <li key={issue.code}>{issue.message}</li>
          ))}
        </ul>
      )}

      <div className="card__actions">
        <button
          type="button"
          data-testid={`add-to-pack-${spec.id}`}
          disabled={!ok || !onAddToPack}
          onClick={() => onAddToPack?.()}
        >
          Add to pack
        </button>

        <a
          className="card__download"
          data-testid={`download-${spec.id}`}
          href={url ?? undefined}
          download={fileName}
          aria-disabled={url === null}
          onClick={(event) => {
            if (url === null) event.preventDefault();
          }}
        >
          Download
        </a>
      </div>
    </article>
  );
}
