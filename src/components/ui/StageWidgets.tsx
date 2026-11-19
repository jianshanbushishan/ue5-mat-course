import React, { useState, useRef, useId } from 'react';
import { AlertTriangle, CheckCircle2, ChevronsLeftRight } from 'lucide-react';

/**
 * Parses **bold** and `inline code` into styled React elements.
 */
export const FormattedText: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, idx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          const inner = part.slice(2, -2);
          if (inner.includes('`')) {
            return (
              <strong key={idx}>
                <FormattedText text={inner} />
              </strong>
            );
          }
          return <strong key={idx}>{inner}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={idx} className="inline-code-pill">
              {part.slice(1, -1)}
            </code>
          );
        }
        return <React.Fragment key={idx}>{part}</React.Fragment>;
      })}
    </>
  );
};

export interface StageSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  formatValue?: (v: number) => string;
  onChange: (v: number) => void;
}

/**
 * 现代化滑块：已填充轨道 + 数值胶囊 + 双击恢复初始值 + 键盘微调。
 */
export const StageSlider: React.FC<StageSliderProps> = ({
  label,
  value,
  min,
  max,
  step = 0.01,
  unit = '',
  formatValue,
  onChange,
}) => {
  const id = useId();
  const initialRef = useRef(value);
  const display = formatValue
    ? formatValue(value)
    : `${Number.isInteger(step) ? value.toFixed(0) : value.toFixed(2)}${unit}`;
  const span = max - min || 1;
  const fill = Math.min(100, Math.max(0, ((value - min) / span) * 100));
  const isDefault = Math.abs(value - initialRef.current) < 1e-9;

  const reset = () => {
    if (!isDefault) onChange(initialRef.current);
  };

  return (
    <div className="slider-field">
      <div className="slider-label-row">
        <label htmlFor={id} className="slider-label" title={label}>
          {label}
        </label>
        <button
          type="button"
          className={`slider-val ${isDefault ? '' : 'changed'}`}
          onClick={reset}
          title={isDefault ? '当前为默认值' : '点击恢复默认值'}
          tabIndex={isDefault ? -1 : 0}
        >
          {display}
          {!isDefault && (
            <span className="slider-reset-icon" aria-hidden>
              ↺
            </span>
          )}
        </button>
      </div>
      <input
        id={id}
        type="range"
        className="brutal-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        onDoubleClick={reset}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
};

export interface StageSegmentedProps<T extends string> {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

export function StageSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: StageSegmentedProps<T>) {
  return (
    <div className="segmented-field">
      {label && <span className="segmented-label">{label}</span>}
      <div className="segmented-group" role="radiogroup" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={value === opt.value}
            className={`segmented-opt ${value === opt.value ? 'active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface StageToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}

/**
 * 开关样式的复选框（保留原生 checkbox 以支持键盘与读屏）。
 */
export const StageToggle: React.FC<StageToggleProps> = ({ label, checked, onChange, hint }) => (
  <label className={`stage-toggle ${checked ? 'on' : ''}`}>
    <input
      type="checkbox"
      className="stage-toggle-input"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span className="stage-toggle-track" aria-hidden>
      <span className="stage-toggle-knob" />
    </span>
    <span className="stage-toggle-text">
      {label}
      {hint && <span className="stage-toggle-hint">（{hint}）</span>}
    </span>
  </label>
);

export interface PitfallCompareBarProps {
  isPitfall: boolean;
  pitfallLabel: string;
  correctLabel: string;
  onToggle: (pitfall: boolean) => void;
}

export const PitfallCompareBar: React.FC<PitfallCompareBarProps> = ({
  isPitfall,
  pitfallLabel,
  correctLabel,
  onToggle,
}) => (
  <div className={`pitfall-bar ${isPitfall ? 'is-pitfall' : 'is-correct'}`}>
    <span className="pitfall-bar-text">
      <span className="pitfall-bar-icon" aria-hidden>
        {isPitfall ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
      </span>
      <span>
        <span className="pitfall-bar-kicker">{isPitfall ? '故障状态' : '正确配置'}</span>
        {isPitfall ? pitfallLabel : correctLabel}
      </span>
    </span>
    <div className="pitfall-bar-switch" role="radiogroup" aria-label="踩坑对照">
      <button
        type="button"
        role="radio"
        aria-checked={isPitfall}
        className={`pitfall-opt bad ${isPitfall ? 'active' : ''}`}
        onClick={() => onToggle(true)}
      >
        看踩坑现象
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={!isPitfall}
        className={`pitfall-opt good ${!isPitfall ? 'active' : ''}`}
        onClick={() => onToggle(false)}
      >
        切正确配置
      </button>
    </div>
  </div>
);

/**
 * Interactive Split Curtain comparison container
 */
export const SplitCompareContainer: React.FC<{
  leftLabel: string;
  rightLabel: string;
  leftContent: React.ReactNode;
  rightContent: React.ReactNode;
  height?: number;
  initialSplit?: number;
}> = ({ leftLabel, rightLabel, leftContent, rightContent, height = 250, initialSplit = 50 }) => {
  const [split, setSplit] = useState(initialSplit);
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const updateFromClientX = (clientX: number) => {
    if (!boxRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    const pct = Math.max(4, Math.min(96, ((clientX - rect.left) / rect.width) * 100));
    setSplit(pct);
  };

  return (
    <div
      ref={boxRef}
      className={`split-compare ${dragging ? 'dragging' : ''}`}
      style={{ height }}
      role="slider"
      tabIndex={0}
      aria-label="左右对比分割线"
      aria-valuemin={4}
      aria-valuemax={96}
      aria-valuenow={Math.round(split)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        updateFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging) updateFromClientX(e.clientX);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') setSplit((s) => Math.max(4, s - 4));
        if (e.key === 'ArrowRight') setSplit((s) => Math.min(96, s + 4));
      }}
    >
      <div style={{ position: 'absolute', inset: 0 }}>{rightContent}</div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          clipPath: `inset(0 ${100 - split}% 0 0)`,
        }}
      >
        {leftContent}
      </div>
      <div className="split-compare-divider" style={{ left: `${split}%` }}>
        <div className="split-compare-handle">
          <ChevronsLeftRight size={15} />
        </div>
      </div>
      <span className="split-compare-tag left">{leftLabel}</span>
      <span className="split-compare-tag right">{rightLabel}</span>
    </div>
  );
};
