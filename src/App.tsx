import { useCallback, useEffect, useRef, useState } from 'react';
import { DropZone } from './components/DropZone.tsx';
import { ExportCard } from './components/ExportCard.tsx';
import type { ExportState } from './components/ExportCard.tsx';
import { StickerPreview } from './components/StickerPreview.tsx';
import { TextCanvas } from './components/TextCanvas.tsx';
import { TextLayerControls } from './components/TextLayerControls.tsx';
import { TextLayerList } from './components/TextLayerList.tsx';
import { APP_NAME, APP_TAGLINE } from './core/appInfo.ts';
import { encodeStaticSticker } from './core/encode/staticSticker.ts';
import { stickerFileName } from './core/fileNames.ts';
import type { FitMode } from './core/geometry.ts';
import { loadImageSource, releaseImageSource } from './core/imageSource.ts';
import type { ImageSource } from './core/imageSource.ts';
import { STICKER_SPECS } from './core/specs.ts';
import type { StickerTargetId } from './core/specs.ts';
import type { TextLayer } from './core/text/model.ts';
import {
  createTextLayer,
  duplicateLayer,
  findLayer,
  moveLayer,
  removeLayer,
  updateLayer,
} from './core/text/operations.ts';

/** Stage 3 ships the still targets; the animated ones arrive with the encoder. */
const STATIC_TARGETS: readonly StickerTargetId[] = ['telegram-static', 'whatsapp-static'];

type ExportStates = Partial<Record<StickerTargetId, ExportState>>;

/**
 * Results are stored against the settings that produced them. Anything from a
 * previous image, framing or caption is therefore never rendered: the cards
 * fall back to "encoding" in the very same commit that changes the settings,
 * rather than showing a stale size for a frame or two while the new encode
 * runs.
 */
interface ExportSession {
  readonly key: string;
  readonly states: ExportStates;
}

const EMPTY_SESSION: ExportSession = { key: '', states: {} };

/** Identifies everything an encode depends on, so results can be keyed to it. */
function describeLayers(layers: readonly TextLayer[]): string {
  return layers.map((layer) => JSON.stringify(layer)).join('|');
}

export function App() {
  const [source, setSource] = useState<ImageSource | null>(null);
  const [sourceGeneration, setSourceGeneration] = useState(0);
  const [fit, setFit] = useState<FitMode>('contain');
  const [layers, setLayers] = useState<readonly TextLayer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ExportSession>(EMPTY_SESSION);

  const exportKey = source ? `${sourceGeneration}|${fit}|${describeLayers(layers)}` : '';
  const exports = session.key === exportKey ? session.states : {};
  const selected = findLayer(layers, selectedId);

  // Freeing the previous bitmap is a side effect, so it is kept out of the
  // state updater, which React is free to call more than once.
  const currentSource = useRef<ImageSource | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const loaded = await loadImageSource(file);
      const previous = currentSource.current;
      currentSource.current = loaded;

      setSource(loaded);
      setSourceGeneration((generation) => generation + 1);

      if (previous) releaseImageSource(previous);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that file');
    }
  }, []);

  const addLayer = useCallback(() => {
    const layer = createTextLayer();
    setLayers((previous) => [...previous, layer]);
    setSelectedId(layer.id);
  }, []);

  const patchLayer = useCallback((id: string, patch: Partial<Omit<TextLayer, 'id'>>) => {
    setLayers((previous) => updateLayer(previous, id, patch));
  }, []);

  const handleRemove = useCallback((id: string) => {
    setLayers((previous) => removeLayer(previous, id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  useEffect(() => {
    if (!source) {
      setSession(EMPTY_SESSION);
      return;
    }

    // A later edit must never be overwritten by an encode started for an
    // earlier one that happened to finish afterwards.
    let current = true;
    const key = exportKey;

    void (async () => {
      for (const id of STATIC_TARGETS) {
        if (!current) return;

        let state: ExportState;
        try {
          const result = await encodeStaticSticker({
            source,
            spec: STICKER_SPECS[id],
            fit,
            layers,
          });
          state = { status: 'done', result };
        } catch (cause) {
          state = {
            status: 'failed',
            message: cause instanceof Error ? cause.message : 'Encoding failed',
          };
        }

        if (!current) return;
        setSession((previous) => ({
          key,
          states: { ...(previous.key === key ? previous.states : {}), [id]: state },
        }));
      }
    })();

    return () => {
      current = false;
    };
  }, [source, fit, layers, exportKey]);

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">{APP_NAME}</h1>
        <p className="app__tagline">{APP_TAGLINE}</p>
      </header>

      <section className="app__stage" data-testid="stage">
        <DropZone onFile={handleFile} />
        {error && (
          <p className="app__error" role="alert" data-testid="error">
            {error}
          </p>
        )}
        {source && (
          <p className="app__source" data-testid="source-info">
            {source.fileName} — {source.width}x{source.height}
          </p>
        )}
      </section>

      {source && (
        <>
          <section className="editor" aria-label="Editor">
            <div className="editor__design">
              <TextCanvas
                source={source}
                fit={fit}
                layers={layers}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onMove={(id, x, y) => patchLayer(id, { x, y })}
              />
              <p className="editor__hint">
                Layout surface, 512×512. Drag text to reposition it; each target below shows how it
                lands.
              </p>
            </div>

            <div className="editor__panel">
              <fieldset className="controls__group">
                <legend className="controls__legend">Framing</legend>
                {(['contain', 'cover'] as const).map((mode) => (
                  <label key={mode} className="controls__option">
                    <input
                      type="radio"
                      name="fit"
                      value={mode}
                      checked={fit === mode}
                      data-testid={`fit-${mode}`}
                      onChange={() => setFit(mode)}
                    />
                    <span>{mode === 'contain' ? 'Fit whole image' : 'Fill and crop'}</span>
                  </label>
                ))}
              </fieldset>

              <div className="panel">
                <div className="panel__header">
                  <h2 className="panel__title">Text</h2>
                  <button type="button" data-testid="add-text" onClick={addLayer}>
                    Add text
                  </button>
                </div>

                <TextLayerList
                  layers={layers}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onMove={(id, direction) =>
                    setLayers((previous) => moveLayer(previous, id, direction))
                  }
                  onDuplicate={(id) => setLayers((previous) => duplicateLayer(previous, id))}
                  onRemove={handleRemove}
                />

                {selected && (
                  <TextLayerControls
                    layer={selected}
                    onChange={(patch) => patchLayer(selected.id, patch)}
                  />
                )}
              </div>
            </div>
          </section>

          <section
            className="exports"
            aria-label="Exports"
            data-testid="exports"
            data-export-key={exportKey}
          >
            {STATIC_TARGETS.map((id) => (
              <ExportCard
                key={id}
                spec={STICKER_SPECS[id]}
                state={exports[id] ?? { status: 'encoding' }}
                fileName={stickerFileName(source.fileName, STICKER_SPECS[id])}
              >
                <StickerPreview
                  source={source}
                  spec={STICKER_SPECS[id]}
                  fit={fit}
                  layers={layers}
                />
              </ExportCard>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
