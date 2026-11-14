interface Props {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange(value: number): void;
}

export function Range({ label, min, max, step, value, onChange }: Props) {
  return (
    <input
      className="range"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ "--fill": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={label}
    />
  );
}
