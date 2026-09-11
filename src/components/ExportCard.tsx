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
  readonly children?: React.ReactNode;
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

export function ExportCard({ spec, state, fileName, children }: ExportCardProps) {
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
        Download {fileName}
      </a>
    </article>
  );
}
