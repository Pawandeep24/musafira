import type { ParameterInfo, Preferences, Preset, ScoringOptions } from "../api/types";
import { formatDistance } from "../lib/format";
import type { SyncState } from "../state/useSafetyProfile";
import { Icon } from "./Icon";
import { Range } from "./Range";
import { ToggleChip } from "./ui/ToggleChip";

interface Props {
  parameters: readonly ParameterInfo[];
  presets: readonly Preset[];
  maxWeight: number;
  profile: Preferences;
  sync: SyncState;
  signedIn: boolean;
  onWeight(id: ParameterInfo["id"], value: number): void;
  onOption(key: keyof ScoringOptions, value: number): void;
  onPreset(preset: Preset): void;
}

const SYNC_TEXT: Record<SyncState, string> = {
  device: "Saved on this device",
  syncing: "Syncing…",
  synced: "Synced to your account",
  error: "Couldn't sync, saved on this device",
};

function Radar({ parameters, weights, max }: { parameters: readonly ParameterInfo[]; weights: Preferences["weights"]; max: number }) {
  const size = 168;
  const c = size / 2;
  const r = c - 22;
  const angle = (i: number) => (Math.PI * 2 * i) / parameters.length - Math.PI / 2;
  const point = (i: number, scale: number) => `${c + Math.cos(angle(i)) * r * scale},${c + Math.sin(angle(i)) * r * scale}`;
  const shape = parameters.map((p, i) => point(i, Math.max(0.04, weights[p.id] / max))).join(" ");
  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="radar-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c9f5ec" stopOpacity="0.5" />
          <stop offset="1" stopColor="#4fb3a2" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {[0.33, 0.66, 1].map((ring) => (
        <polygon key={ring} points={parameters.map((_, i) => point(i, ring)).join(" ")} className="radar__ring" />
      ))}
      {parameters.map((_, i) => (
        <line key={i} x1={c} y1={c} x2={c + Math.cos(angle(i)) * r} y2={c + Math.sin(angle(i)) * r} className="radar__spoke" />
      ))}
      <polygon points={shape} fill="url(#radar-fill)" className="radar__shape" />
      {parameters.map((p, i) => {
        const [x, y] = point(i, 1.18).split(",").map(Number);
        return (
          <foreignObject key={p.id} x={x! - 9} y={y! - 9} width={18} height={18}>
            <div className="radar__icon" title={p.label}>
              <Icon name={p.id} size={13} />
            </div>
          </foreignObject>
        );
      })}
    </svg>
  );
}

/** The rider's "safety DNA": what matters to her, as weights the score is built from. */
export function SafetyDna({ parameters, presets, maxWeight, profile, sync, signedIn, onWeight, onOption, onPreset }: Props) {
  return (
    <div className="dna">
      <div className="dna__head">
        <Radar parameters={parameters} weights={profile.weights} max={maxWeight} />
        <div>
          <h2>Your safety DNA</h2>
          <p>Tell Musafira what matters on your ride. Scores update instantly.</p>
          <span className={`sync sync--${sync}`}>{signedIn ? SYNC_TEXT[sync] : SYNC_TEXT.device}</span>
        </div>
      </div>

      <div className="presets">
        {presets.map((preset) => (
          <ToggleChip key={preset.id} on={profile.presetId === preset.id} onClick={() => onPreset(preset)}>
            {preset.label}
          </ToggleChip>
        ))}
      </div>

      <ul className="weights">
        {parameters.map((p) => {
          const value = profile.weights[p.id];
          return (
            <li key={p.id} title={p.description}>
              <label>
                <span className="weights__name">
                  <Icon name={p.id} size={15} /> {p.label}
                </span>
                <span className="weights__value">{value}</span>
              </label>
              <Range label={p.label} min={0} max={maxWeight} step={1} value={value} onChange={(v) => onWeight(p.id, v)} />
            </li>
          );
        })}
      </ul>

      <div className="dna__options">
        <h3>
          <Icon name="sliders" size={14} /> Alerts
        </h3>
        <label>
          <span>Flag dark stretches longer than</span>
          <strong>{formatDistance(profile.options.darkStretchMeters)}</strong>
        </label>
        <Range
          label="Dark stretch threshold"
          min={200}
          max={2000}
          step={100}
          value={profile.options.darkStretchMeters}
          onChange={(v) => onOption("darkStretchMeters", v)}
        />
        <label>
          <span>Penalise gaps between safety stops over</span>
          <strong>{formatDistance(profile.options.maxStopGapMeters)}</strong>
        </label>
        <Range
          label="Safety stop gap threshold"
          min={500}
          max={5000}
          step={250}
          value={profile.options.maxStopGapMeters}
          onChange={(v) => onOption("maxStopGapMeters", v)}
        />
      </div>
    </div>
  );
}
