import { useEffect, useRef, useState } from "react";
import { safetyCss } from "../lib/colors";

/** Animates a number towards `target` so score changes read as motion, not a jump. */
function useTweened(target: number, durationMs = 650): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const initial = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      const next = initial + (target - initial) * eased;
      from.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);
  return value;
}

export function ScoreRing({ score, size = 64, stroke = 6 }: { score: number; size?: number; stroke?: number }) {
  const shown = useTweened(score);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = safetyCss(shown / 100);
  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown / 100)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ filter: `drop-shadow(0 0 6px ${safetyCss(shown / 100, 0.6)})` }}
        />
      </svg>
      <span className="score-ring__value" style={{ fontSize: size * 0.34 }}>
        {Math.round(shown)}
      </span>
    </div>
  );
}
