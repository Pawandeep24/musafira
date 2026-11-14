import { useState } from "react";
import type { LngLat, ReportCategory, ReportWhen } from "../api/types";
import { REPORT_META, REPORT_WHEN } from "../lib/reports";
import { Icon } from "./Icon";

const PROBLEMS: readonly ReportCategory[] = ["poorlyLit", "deserted", "harassment", "loitering", "badRoad", "waterlogged", "noSignal"];
const GOOD_SIGNS: readonly ReportCategory[] = ["wellLit", "busy", "policeNearby"];

interface Props {
  point?: LngLat;
  locating: boolean;
  sending: boolean;
  error?: string;
  onUseLocation(): void;
  onSubmit(category: ReportCategory, when: ReportWhen): void;
  onClose(): void;
}

export function ReportSheet({ point, locating, sending, error, onUseLocation, onSubmit, onClose }: Props) {
  const [category, setCategory] = useState<ReportCategory>();
  const [when, setWhen] = useState<ReportWhen>("now");

  const categoryChips = (ids: readonly ReportCategory[], label: string) => (
    <div className="report__chips" role="radiogroup" aria-label={label}>
      {ids.map((id) => {
        const meta = REPORT_META[id];
        return (
          <button
            key={id}
            role="radio"
            aria-checked={category === id}
            className={`chip chip--preset report__chip is-${meta.tone} ${category === id ? "is-on" : ""}`}
            onClick={() => setCategory(id)}
          >
            <Icon name={meta.icon} size={14} /> {meta.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <aside className="report-panel glass" aria-label="Report what you saw">
      <button className="icon-button report-panel__close" onClick={onClose} aria-label="Close report">
        <Icon name="close" size={16} />
      </button>
      <header className="report__head">
        <h2>Report what you saw</h2>
        <p>Riders passing this spot at a similar hour get route scores that reflect it.</p>
      </header>

      <section className="report__step">
        <h3>Where</h3>
        <div className={`report__where ${point ? "is-set" : ""}`}>
          <Icon name="pin" size={16} />
          <span>{point ? "Spot marked. Tap the map to move it." : "Tap the map where it happened."}</span>
        </div>
        <button className="link-button report__locate" onClick={onUseLocation} disabled={locating}>
          <Icon name="locate" size={14} /> {locating ? "Finding you…" : "Use my location"}
        </button>
      </section>

      <section className="report__step">
        <h3>What</h3>
        {categoryChips(PROBLEMS, "Problems")}
        <h4>Good to know</h4>
        {categoryChips(GOOD_SIGNS, "Good to know")}
      </section>

      <section className="report__step">
        <h3>When</h3>
        <div className="report__chips" role="radiogroup" aria-label="When">
          {REPORT_WHEN.map(({ id, label }) => (
            <button key={id} role="radio" aria-checked={when === id} className={`chip chip--preset ${when === id ? "is-on" : ""}`} onClick={() => setWhen(id)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="notice notice--error">
          <Icon name="alert" size={15} /> {error}
        </div>
      )}

      <button
        className="button button--primary button--wide"
        disabled={!point || !category || sending}
        aria-busy={sending}
        onClick={() => category && onSubmit(category, when)}
      >
        <Icon name="flag" size={15} /> {sending ? "Sending…" : "Send report"}
      </button>
      <p className="report__privacy">
        <Icon name="shield" size={13} /> Saved without your name or email.
      </p>
    </aside>
  );
}
