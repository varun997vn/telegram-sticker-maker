import { FONT_CHOICES, TEXT_LIMITS } from '../core/text/model.ts';
import type { TextAlign, TextLayer } from '../core/text/model.ts';

interface TextLayerControlsProps {
  readonly layer: TextLayer;
  readonly onChange: (patch: Partial<Omit<TextLayer, 'id'>>) => void;
}

interface SliderProps {
  readonly label: string;
  readonly field: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly format?: (value: number) => string;
  readonly onChange: (value: number) => void;
}

function Slider({ label, field, value, min, max, step, format, onChange }: SliderProps) {
  return (
    <label className="field">
      <span className="field__label">
        {label}
        <span className="field__value">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        data-testid={`text-${field}`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function TextLayerControls({ layer, onChange }: TextLayerControlsProps) {
  return (
    <div className="text-controls" data-testid="text-controls">
      <label className="field">
        <span className="field__label">Text</span>
        <textarea
          className="field__input"
          data-testid="text-content"
          rows={2}
          value={layer.text}
          maxLength={TEXT_LIMITS.textLength}
          onChange={(event) => onChange({ text: event.target.value })}
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span className="field__label">Font</span>
          <select
            className="field__input"
            data-testid="text-font"
            value={layer.fontId}
            onChange={(event) => onChange({ fontId: event.target.value as TextLayer['fontId'] })}
          >
            {FONT_CHOICES.map((font) => (
              <option key={font.id} value={font.id}>
                {font.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Align</span>
          <select
            className="field__input"
            data-testid="text-align"
            value={layer.align}
            onChange={(event) => onChange({ align: event.target.value as TextAlign })}
          >
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
        </label>
      </div>

      <div className="field-row">
        <label className="field field--colour">
          <span className="field__label">Fill</span>
          <input
            type="color"
            data-testid="text-color"
            value={layer.color}
            onChange={(event) => onChange({ color: event.target.value })}
          />
        </label>

        <label className="field field--colour">
          <span className="field__label">Outline</span>
          <input
            type="color"
            data-testid="text-stroke-color"
            value={layer.strokeColor}
            onChange={(event) => onChange({ strokeColor: event.target.value })}
          />
        </label>

        <label className="field field--colour">
          <span className="field__label">Shadow</span>
          <input
            type="color"
            data-testid="text-shadow-color"
            value={layer.shadowColor}
            onChange={(event) => onChange({ shadowColor: event.target.value })}
          />
        </label>
      </div>

      <Slider
        label="Size"
        field="size"
        value={layer.fontSize}
        min={TEXT_LIMITS.fontSize.min}
        max={TEXT_LIMITS.fontSize.max}
        step={0.005}
        format={percent}
        onChange={(fontSize) => onChange({ fontSize })}
      />
      <Slider
        label="Outline width"
        field="stroke-width"
        value={layer.strokeWidth}
        min={TEXT_LIMITS.strokeWidth.min}
        max={TEXT_LIMITS.strokeWidth.max}
        step={0.005}
        format={percent}
        onChange={(strokeWidth) => onChange({ strokeWidth })}
      />
      <Slider
        label="Shadow"
        field="shadow-blur"
        value={layer.shadowBlur}
        min={TEXT_LIMITS.shadowBlur.min}
        max={TEXT_LIMITS.shadowBlur.max}
        step={0.01}
        format={percent}
        onChange={(shadowBlur) => onChange({ shadowBlur })}
      />
      <Slider
        label="Rotation"
        field="rotation"
        value={layer.rotation}
        min={TEXT_LIMITS.rotation.min}
        max={TEXT_LIMITS.rotation.max}
        step={1}
        format={(value) => `${value}°`}
        onChange={(rotation) => onChange({ rotation })}
      />
      <Slider
        label="Opacity"
        field="opacity"
        value={layer.opacity}
        min={TEXT_LIMITS.opacity.min}
        max={TEXT_LIMITS.opacity.max}
        step={0.01}
        format={percent}
        onChange={(opacity) => onChange({ opacity })}
      />
      <Slider
        label="Line spacing"
        field="line-height"
        value={layer.lineHeight}
        min={TEXT_LIMITS.lineHeight.min}
        max={TEXT_LIMITS.lineHeight.max}
        step={0.05}
        onChange={(lineHeight) => onChange({ lineHeight })}
      />
      <Slider
        label="Wrap width"
        field="max-width"
        value={layer.maxWidth}
        min={TEXT_LIMITS.maxWidth.min}
        max={TEXT_LIMITS.maxWidth.max}
        step={0.02}
        format={percent}
        onChange={(maxWidth) => onChange({ maxWidth })}
      />

      <label className="field field--checkbox">
        <input
          type="checkbox"
          data-testid="text-uppercase"
          checked={layer.uppercase}
          onChange={(event) => onChange({ uppercase: event.target.checked })}
        />
        <span>Uppercase</span>
      </label>
    </div>
  );
}
