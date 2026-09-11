import { useEffect, useState } from 'react';
import { formatBytes } from '../core/budget.ts';
import type { AnimatedEncodeResult, AnimatedProgress } from '../core/encode/animatedSticker.ts';
import type { StickerSpec } from '../core/specs.ts';

export type AnimatedExportState =
  | { readonly status: 'idle' }
  | { readonly status: 'running'; readonly progress: AnimatedProgress | null }
  | { readonly status: 'done'; readonly result: AnimatedEncodeResult }
  | { readonly status: 'failed'; readonly message: string };

interface AnimatedExportCardProps {
  readonly spec: StickerSpec;
  readonly state: AnimatedExportState;
  readonly fileName: string;
  readonly onGenerate: () => void;
  readonly onCancel: () => void;
  readonly onAddToPack?: () => void;
  /** Why this browser cannot produce this target, if it cannot. */
  readonly unsupportedReason?: string | null;
}

const PHASE_LABELS: Record<AnimatedProgress['phase'], string> = {
  extracting: 'Reading the video',
  compositing: 'Drawing captions onto each frame',
  encoding: 'Encoding',
};

function describeProgress(progress: AnimatedProgress | null): string {
  if (!progress) return 'Starting…';

  const label = PHASE_LABELS[progress.phase];
  if (progress.phase === 'encoding') {
    const rate = progress.frameRate ? ` at ${Math.round(progress.frameRate)} fps` : '';
    const attempt = progress.attempt ? ` (attempt ${progress.attempt})` : '';
    return `${label}${rate}${attempt}…`;
  }

  const percent = progress.ratio === null ? '' : ` ${Math.round(progress.ratio * 100)}%`;
  return `${label}${percent}…`;
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

export function AnimatedExportCard({
  spec,
  state,
  fileName,
  onGenerate,
  onCancel,
  onAddToPack,
  unsupportedReason = null,
}: AnimatedExportCardProps) {
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

      <div className="card__preview">
        {url && spec.container === 'webm' && (
          <video
            className="preview__canvas"
            data-testid={`result-${spec.id}`}
            src={url}
            autoPlay
            loop
            muted
            playsInline
          />
        )}
        {url && spec.container === 'webp' && (
          <img className="preview__canvas" data-testid={`result-${spec.id}`} src={url} alt={`${spec.label} preview`} />
        )}
        {!url && (
          <p className="card__placeholder">
            {state.status === 'running' ? describeProgress(state.progress) : 'Not generated yet'}
          </p>
        )}
      </div>

      <dl className="card__stats">
        <div>
          <dt>Size</dt>
          <dd data-testid={`size-${spec.id}`}>{result ? formatBytes(result.byteLength) : '—'}</dd>
        </div>
        <div>
          <dt>Dimensions</dt>
          <dd data-testid={`dimensions-${spec.id}`}>
            {result ? `${result.size.width}x${result.size.height}` : '—'}
          </dd>
        </div>
        <div>
          <dt>Frames</dt>
          <dd data-testid={`frames-${spec.id}`}>
            {result ? `${result.frameCount} @ ${Math.round(result.frameRate)}fps` : '—'}
          </dd>
        </div>
      </dl>

      <p
        className={`card__status card__status--${
          state.status === 'running'
            ? 'busy'
            : ok
              ? 'ok'
              : state.status === 'idle' && unsupportedReason === null
                ? 'busy'
                : 'error'
        }`}
        data-testid={`status-${spec.id}`}
        role="status"
      >
        {state.status === 'idle' && (unsupportedReason ?? 'Ready to generate')}
        {state.status === 'running' && describeProgress(state.progress)}
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
        {state.status === 'running' ? (
          <button type="button" data-testid={`cancel-${spec.id}`} onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            data-testid={`generate-${spec.id}`}
            disabled={unsupportedReason !== null}
            onClick={onGenerate}
          >
            {result ? 'Regenerate' : 'Generate'}
          </button>
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
          Download
        </a>
      </div>

      <button
        type="button"
        className="card__secondary"
        data-testid={`add-to-pack-${spec.id}`}
        disabled={!ok || !onAddToPack}
        onClick={() => onAddToPack?.()}
      >
        Add to pack
      </button>
    </article>
  );
}
