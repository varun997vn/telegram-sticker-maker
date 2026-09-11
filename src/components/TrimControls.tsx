import { formatBytes } from '../core/budget.ts';
import { FRAME_RATE_LADDER, speedForSelection } from '../core/framePlan.ts';
import { MAX_ANIMATION_MS } from '../core/specs.ts';
import type { VideoSource } from '../core/videoSource.ts';

interface TrimControlsProps {
  readonly source: VideoSource;
  readonly startMs: number;
  readonly endMs: number;
  readonly frameRate: number;
  readonly onChange: (patch: { startMs?: number; endMs?: number; frameRate?: number }) => void;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

export function TrimControls({ source, startMs, endMs, frameRate, onChange }: TrimControlsProps) {
  const selected = Math.max(0, endMs - startMs);
  const playback = Math.min(selected, MAX_ANIMATION_MS);
  const speed = speedForSelection(selected, MAX_ANIMATION_MS);
  const isSpedUp = speed > 1.01;

  return (
    <fieldset className="controls__group controls__group--stack" data-testid="trim-controls">
      <legend className="controls__legend">Clip</legend>

      <label className="field">
        <span className="field__label">
          Start
          <span className="field__value" data-testid="trim-start-value">
            {seconds(startMs)}
          </span>
        </span>
        <input
          type="range"
          data-testid="trim-start"
          min={0}
          max={Math.max(0, source.durationMs - 100)}
          step={10}
          value={startMs}
          onChange={(event) => onChange({ startMs: Number(event.target.value) })}
        />
      </label>

      <label className="field">
        <span className="field__label">
          End
          <span className="field__value" data-testid="trim-end-value">
            {seconds(endMs)}
          </span>
        </span>
        <input
          type="range"
          data-testid="trim-end"
          min={100}
          max={source.durationMs}
          step={10}
          value={endMs}
          onChange={(event) => onChange({ endMs: Number(event.target.value) })}
        />
      </label>

      <label className="field">
        <span className="field__label">
          Frame rate
          <span className="field__value">{frameRate} fps</span>
        </span>
        <select
          className="field__input"
          data-testid="frame-rate"
          value={frameRate}
          onChange={(event) => onChange({ frameRate: Number(event.target.value) })}
        >
          {FRAME_RATE_LADDER.map((rate) => (
            <option key={rate} value={rate}>
              {rate} fps
            </option>
          ))}
        </select>
      </label>

      <p className="controls__note" data-testid="clip-summary">
        {isSpedUp
          ? `All ${seconds(selected)} of the selection, played in ${seconds(playback)} at ${speed.toFixed(1)}× speed, up to ${frameRate} fps`
          : `${seconds(playback)} at up to ${frameRate} fps`}
      </p>
      {isSpedUp && (
        <p className="controls__note" data-testid="speed-note">
          Stickers are capped at {seconds(MAX_ANIMATION_MS)}, so a longer clip is sampled across its
          whole length rather than cut short. Select a shorter range for normal speed.
        </p>
      )}
      <p className="controls__note">
        Budgets: Telegram {formatBytes(256_000)}, WhatsApp {formatBytes(500_000)}. The encoder drops
        quality, then frame rate, until it fits.
      </p>
    </fieldset>
  );
}
