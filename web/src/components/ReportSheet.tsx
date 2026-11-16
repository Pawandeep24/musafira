import { useState } from "react";
import type { LngLat, ReportCategory, ReportWhen } from "@/api/types";
import { REPORT_META, REPORT_WHEN } from "@/lib/reports";
import { Icon } from "@/components/Icon";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { LinkButton } from "@/components/ui/LinkButton";
import { Notice } from "@/components/ui/Notice";
import { SheetHeader } from "@/components/ui/SheetHeader";
import { ToggleChip } from "@/components/ui/ToggleChip";

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
          <ToggleChip
            key={id}
            role="radio"
            aria-checked={category === id}
            on={category === id}
            className={`report__chip is-${meta.tone}`}
            onClick={() => setCategory(id)}
          >
            <Icon name={meta.icon} size={14} /> {meta.label}
          </ToggleChip>
        );
      })}
    </div>
  );

  return (
    <aside className="report-panel glass" aria-label="Report what you saw">
      <IconButton icon="close" label="Close report" className="report-panel__close" onClick={onClose} />
      <SheetHeader className="report__head" title="Report what you saw">
        <p>Riders passing this spot at a similar hour get route scores that reflect it.</p>
      </SheetHeader>

      <section className="report__step">
        <h3>Where</h3>
        <div className={`report__where ${point ? "is-set" : ""}`}>
          <Icon name="pin" size={16} />
          <span>{point ? "Spot marked. Tap the map to move it." : "Tap the map where it happened."}</span>
        </div>
        <LinkButton className="report__locate" onClick={onUseLocation} disabled={locating}>
          <Icon name="locate" size={14} /> {locating ? "Finding you…" : "Use my location"}
        </LinkButton>
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
            <ToggleChip key={id} role="radio" aria-checked={when === id} on={when === id} onClick={() => setWhen(id)}>
              {label}
            </ToggleChip>
          ))}
        </div>
      </section>

      {error && <Notice tone="error">{error}</Notice>}

      <Button variant="primary" wide disabled={!point || !category || sending} aria-busy={sending} onClick={() => category && onSubmit(category, when)}>
        <Icon name="flag" size={15} /> {sending ? "Sending…" : "Send report"}
      </Button>
      <p className="report__privacy">
        <Icon name="shield" size={13} /> Saved without your name or email.
      </p>
    </aside>
  );
}
