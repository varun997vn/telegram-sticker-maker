import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatedExportCard } from './components/AnimatedExportCard.tsx';
import type { AnimatedExportState } from './components/AnimatedExportCard.tsx';
import { DropZone } from './components/DropZone.tsx';
import { ExportCard } from './components/ExportCard.tsx';
import type { ExportState } from './components/ExportCard.tsx';
import { StickerPreview } from './components/StickerPreview.tsx';
import { TextCanvas } from './components/TextCanvas.tsx';
import { TextLayerControls } from './components/TextLayerControls.tsx';
import { TextLayerList } from './components/TextLayerList.tsx';
import { PackPanel } from './components/PackPanel.tsx';
import type { PackBuildState } from './components/PackPanel.tsx';
import { TrimControls } from './components/TrimControls.tsx';
import { usePreviewPlayback, useVideoPreview } from './components/useVideoPreview.ts';
import { APP_NAME, APP_TAGLINE } from './core/appInfo.ts';
import { ASSUME_CAPABLE, detectCapabilities, unsupportedReason } from './core/capabilities.ts';
import type { Capabilities } from './core/capabilities.ts';
import { encodeAnimatedSticker } from './core/encode/animatedSticker.ts';
import { encodeStaticSticker } from './core/encode/staticSticker.ts';
import { stickerFileName } from './core/fileNames.ts';
import type { FitMode } from './core/geometry.ts';
import { describeSource, isVideo, loadSource, releaseSource } from './core/source.ts';
import type { StickerSource } from './core/source.ts';
import { speedForSelection } from './core/framePlan.ts';
import { MAX_ANIMATION_MS, STICKER_SPECS } from './core/specs.ts';
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
import { buildPack } from './core/pack/buildPack.ts';
import {
  EMPTY_PACK,
  addSticker,
  moveSticker,
  removeSticker,
  setStickerEmojis,
  validatePack,
} from './core/pack/model.ts';
import type { StickerPack } from './core/pack/model.ts';
import { createSampleFile } from './core/sample.ts';
import { captureVideoPoster } from './core/videoPoster.ts';
import type { DrawableSource } from './core/render/composite.ts';

const STATIC_TARGETS: readonly StickerTargetId[] = ['telegram-static', 'whatsapp-static'];
const ANIMATED_TARGETS: readonly StickerTargetId[] = ['telegram-video', 'whatsapp-animated'];

type ExportStates = Partial<Record<StickerTargetId, ExportState>>;
type AnimatedStates = Partial<Record<StickerTargetId, AnimatedExportState>>;

/**
 * Still results are stored against the settings that produced them, so a card
 * falls back to "encoding" in the same commit that changes the settings rather
 * than showing a stale size while the new encode runs.
 */
interface ExportSession {
  readonly key: string;
  readonly states: ExportStates;
}

const EMPTY_SESSION: ExportSession = { key: '', states: {} };

interface Clip {
  readonly startMs: number;
  readonly endMs: number;
  readonly frameRate: number;
}

function describeLayers(layers: readonly TextLayer[]): string {
  return layers.map((layer) => JSON.stringify(layer)).join('|');
}

export function App() {
  const [source, setSource] = useState<StickerSource | null>(null);
  const [sourceGeneration, setSourceGeneration] = useState(0);
  const [poster, setPoster] = useState<ImageBitmap | null>(null);
  const [fit, setFit] = useState<FitMode>('contain');
  const [layers, setLayers] = useState<readonly TextLayer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [clip, setClip] = useState<Clip>({ startMs: 0, endMs: MAX_ANIMATION_MS, frameRate: 30 });
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ExportSession>(EMPTY_SESSION);
  const [animated, setAnimated] = useState<AnimatedStates>({});
  const [pack, setPack] = useState<StickerPack>(EMPTY_PACK);
  const [packBuild, setPackBuild] = useState<PackBuildState>({ status: 'idle' });
  const [capabilities, setCapabilities] = useState<Capabilities>(ASSUME_CAPABLE);

  const video = source && isVideo(source) ? source : null;
  const speed = video ? speedForSelection(clip.endMs - clip.startMs, MAX_ANIMATION_MS) : 1;

  // The editor plays the clip rather than showing a frozen frame, so the
  // framing, the captions and the speed-up are all visible before exporting.
  const preview = useVideoPreview(video);
  usePreviewPlayback(preview.element, preview.ready, {
    startMs: clip.startMs,
    endMs: clip.endMs,
    speed,
  });

  // A still frame stands in until the video is ready, or if it refuses to play.
  const drawable: DrawableSource | null =
    source === null
      ? null
      : source.kind === 'image'
        ? source
        : preview.ready && preview.element
          ? { width: source.width, height: source.height, bitmap: preview.element }
          : poster
            ? { width: poster.width, height: poster.height, bitmap: poster }
            : null;

  const exportKey = drawable ? `${sourceGeneration}|${fit}|${describeLayers(layers)}` : '';
  const exports = session.key === exportKey ? session.states : {};
  const selected = findLayer(layers, selectedId);

  // Checked once, so an unsupported export explains itself before the user
  // spends a minute waiting for it to fail.
  useEffect(() => {
    let current = true;
    void detectCapabilities().then((detected) => {
      if (current) setCapabilities(detected);
    });
    return () => {
      current = false;
    };
  }, []);

  const currentSource = useRef<StickerSource | null>(null);
  const running = useRef<Partial<Record<StickerTargetId, AbortController>>>({});

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const loaded = await loadSource(file);
      const previous = currentSource.current;
      currentSource.current = loaded;

      setSource(loaded);
      setSourceGeneration((generation) => generation + 1);
      setAnimated({});
      setPoster(null);

      if (isVideo(loaded)) {
        // The whole clip, not just the first three seconds: a longer
        // selection is kept and played faster rather than being cut short.
        setClip({ startMs: 0, endMs: loaded.durationMs, frameRate: 30 });
        try {
          setPoster(await captureVideoPoster(loaded, 0));
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Could not read a frame from this video');
        }
      }

      if (previous) releaseSource(previous);
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

  // Still exports are cheap, so they re-run on every edit.
  useEffect(() => {
    if (!drawable || video) {
      setSession(EMPTY_SESSION);
      return;
    }

    let current = true;
    const key = exportKey;

    void (async () => {
      for (const id of STATIC_TARGETS) {
        if (!current) return;

        let state: ExportState;
        try {
          const result = await encodeStaticSticker({
            source: drawable,
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
  }, [drawable, video, fit, layers, exportKey]);

  /**
   * Animated exports take seconds and load a 32 MB engine, so they run only
   * when asked for rather than on every keystroke.
   */
  const generate = useCallback(
    async (id: StickerTargetId) => {
      if (!video) return;

      running.current[id]?.abort();
      const controller = new AbortController();
      running.current[id] = controller;

      setAnimated((previous) => ({ ...previous, [id]: { status: 'running', progress: null } }));

      try {
        const result = await encodeAnimatedSticker({
          source: video,
          spec: STICKER_SPECS[id],
          fit,
          layers,
          trimStartMs: clip.startMs,
          trimEndMs: clip.endMs,
          frameRate: clip.frameRate,
          signal: controller.signal,
          onProgress: (progress) => {
            if (controller.signal.aborted) return;
            setAnimated((previous) => ({ ...previous, [id]: { status: 'running', progress } }));
          },
        });

        if (controller.signal.aborted) return;
        setAnimated((previous) => ({ ...previous, [id]: { status: 'done', result } }));
      } catch (cause) {
        if (controller.signal.aborted) {
          setAnimated((previous) => ({ ...previous, [id]: { status: 'idle' } }));
          return;
        }
        setAnimated((previous) => ({
          ...previous,
          [id]: {
            status: 'failed',
            message: cause instanceof Error ? cause.message : 'Encoding failed',
          },
        }));
      } finally {
        if (running.current[id] === controller) delete running.current[id];
      }
    },
    [video, fit, layers, clip],
  );

  /** Copy a finished export into the pack; the bytes are already in hand. */
  const addToPack = useCallback(
    (
      targetId: StickerTargetId,
      bytes: Uint8Array,
      size: { width: number; height: number },
    ) => {
      setPack((previous) =>
        addSticker(previous, {
          targetId,
          bytes,
          width: size.width,
          height: size.height,
          sourceName: currentSource.current?.fileName ?? 'sticker',
        }),
      );
      // Any archive built before this no longer matches the pack.
      setPackBuild({ status: 'idle' });
    },
    [],
  );

  const changePack = useCallback((next: (previous: StickerPack) => StickerPack) => {
    setPack(next);
    setPackBuild({ status: 'idle' });
  }, []);

  const build = useCallback(async () => {
    setPackBuild({ status: 'building' });
    try {
      setPackBuild({ status: 'done', built: await buildPack({ pack }) });
    } catch (cause) {
      setPackBuild({
        status: 'failed',
        message: cause instanceof Error ? cause.message : 'Could not build the archive',
      });
    }
  }, [pack]);

  const updateClip = useCallback((patch: Partial<Clip>) => {
    setClip((previous) => {
      const next = { ...previous, ...patch };
      // Keep the window ordered and at least a tenth of a second long.
      if (next.endMs <= next.startMs) {
        return patch.startMs !== undefined
          ? { ...next, endMs: next.startMs + 100 }
          : { ...next, startMs: Math.max(0, next.endMs - 100) };
      }
      return next;
    });
  }, []);

  // A newly loaded video should start with the whole of it selected: the
  // sticker keeps all of it either way, sped up if it is long.
  useEffect(() => {
    if (!video) return;
    setClip((previous) => ({ ...previous, endMs: Math.min(previous.endMs, video.durationMs) }));
  }, [video]);

  return (
    <main className="app">
      <header className="app__header">
        <h1 className="app__title">{APP_NAME}</h1>
        <p className="app__tagline">{APP_TAGLINE}</p>
      </header>

      {!capabilities.webpEncode && (
        <p className="app__error" role="alert" data-testid="capability-warning">
          {unsupportedReason(capabilities, 'webp')}
        </p>
      )}

      <section className="app__stage" data-testid="stage">
        <DropZone onFile={handleFile} onSample={() => void createSampleFile().then(handleFile)} />
        {error && (
          <p className="app__error" role="alert" data-testid="error">
            {error}
          </p>
        )}
        {source && (
          <p className="app__source" data-testid="source-info">
            {describeSource(source)}
          </p>
        )}
      </section>

      {drawable && (
        <>
          <section className="editor" aria-label="Editor">
            <div className="editor__design">
              <TextCanvas
                source={drawable}
                fit={fit}
                layers={layers}
                selectedId={selectedId}
                animate={video !== null && preview.ready}
                onSelect={setSelectedId}
                onMove={(id, x, y) => patchLayer(id, { x, y })}
              />
              <p className="editor__hint" data-testid="editor-hint">
                {video
                  ? `Live preview, 512×512${speed > 1.01 ? ` at ${speed.toFixed(1)}× speed` : ''}. Drag text to reposition it.`
                  : 'Layout surface, 512×512. Drag text to reposition it; each target below shows how it lands.'}
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

              {video && (
                <TrimControls
                  source={video}
                  startMs={clip.startMs}
                  endMs={clip.endMs}
                  frameRate={clip.frameRate}
                  onChange={updateClip}
                />
              )}

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
            {video
              ? ANIMATED_TARGETS.map((id) => (
                  <AnimatedExportCard
                    key={id}
                    spec={STICKER_SPECS[id]}
                    state={animated[id] ?? { status: 'idle' }}
                    fileName={stickerFileName(source?.fileName ?? 'sticker', STICKER_SPECS[id])}
                    unsupportedReason={unsupportedReason(
                      capabilities,
                      STICKER_SPECS[id].container,
                    )}
                    onGenerate={() => void generate(id)}
                    onCancel={() => running.current[id]?.abort()}
                    {...(animated[id]?.status === 'done'
                      ? {
                          onAddToPack: () => {
                            const state = animated[id];
                            if (state?.status !== 'done') return;
                            addToPack(id, state.result.bytes, state.result.size);
                          },
                        }
                      : {})}
                  />
                ))
              : STATIC_TARGETS.map((id) => (
                  <ExportCard
                    key={id}
                    spec={STICKER_SPECS[id]}
                    state={exports[id] ?? { status: 'encoding' }}
                    fileName={stickerFileName(source?.fileName ?? 'sticker', STICKER_SPECS[id])}
                    {...(exports[id]?.status === 'done'
                      ? {
                          onAddToPack: () => {
                            const state = exports[id];
                            if (state?.status !== 'done') return;
                            addToPack(id, state.result.bytes, state.result.size);
                          },
                        }
                      : {})}
                  >
                    <StickerPreview
                      source={drawable}
                      spec={STICKER_SPECS[id]}
                      fit={fit}
                      layers={layers}
                    />
                  </ExportCard>
                ))}
          </section>
        </>
      )}

      <section className="pack-section" aria-label="Pack">
        <PackPanel
          pack={pack}
          state={packBuild}
          issues={validatePack(pack)}
          onRename={(patch) => changePack((previous) => ({ ...previous, ...patch }))}
          onEmojis={(id, value) => changePack((previous) => setStickerEmojis(previous, id, value))}
          onMove={(id, direction) => changePack((previous) => moveSticker(previous, id, direction))}
          onRemove={(id) => changePack((previous) => removeSticker(previous, id))}
          onBuild={() => void build()}
        />
      </section>
    </main>
  );
}
