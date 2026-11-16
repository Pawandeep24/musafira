import { useEffect, useState } from "react";
import type { RideEstimate, RideMode, RideOption, RideQuote } from "../api/types";
import { formatClock, formatDistance, formatDuration } from "../lib/format";
import type { RideBooking } from "../state/useRideBooking";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon, type IconName } from "./Icon";
import { RideTracker } from "./RideTracker";
import { ScoreRing } from "./ScoreRing";
import { Button } from "./ui/Button";
import { Eyebrow } from "./ui/Eyebrow";
import { IconButton } from "./ui/IconButton";
import { LinkButton } from "./ui/LinkButton";
import { Notice } from "./ui/Notice";
import { SheetHeader } from "./ui/SheetHeader";
import { ToggleChip } from "./ui/ToggleChip";

interface Props {
  booking: RideBooking;
  cityName: string;
  liveOffered: boolean;
  liveBlocker?: string;
  utcOffsetMinutes: number;
  onShare(): void;
}

const QUOTING_STEPS: Record<RideMode, readonly { icon: IconName; text: string }[]> = {
  live: [
    { icon: "search", text: "Asking Namma Yatri for fares" },
    { icon: "flag", text: "Placing safety checkpoints" },
    { icon: "auto", text: "Pricing the ride through them" },
  ],
  demo: [
    { icon: "route", text: "Routing an auto along your trip" },
    { icon: "flag", text: "Placing safety checkpoints" },
    { icon: "auto", text: "Working out the meter fare" },
  ],
};

const rupees = (amount: number) => `₹${Math.round(amount).toLocaleString("en-IN")}`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const estimateFor = (option: RideOption, tier: string | undefined) => option.estimates.find((e) => e.tier === tier) ?? option.estimates[0];

function fareText({ fare, minFare, maxFare }: RideEstimate): string {
  return minFare !== null && maxFare !== null && minFare !== maxFare ? `${rupees(minFare)}–${rupees(maxFare)}` : rupees(fare);
}

export function RideSheet({ booking, cityName, liveOffered, liveBlocker, utcOffsetMinutes, onShare }: Props) {
  return (
    <aside className="ride-panel glass" aria-label="Book this route">
      {!booking.active && (
        <IconButton icon="close" label="Close" className="ride-panel__close" onClick={booking.close} />
      )}
      {booking.step === "choose" && (
        <ChooseMode booking={booking} cityName={cityName} liveOffered={liveOffered} {...(liveBlocker ? { liveBlocker } : {})} />
      )}
      {booking.step === "link" && <LinkAccount booking={booking} />}
      {booking.step === "quoting" && <Quoting mode={booking.mode} />}
      {booking.step === "compare" && booking.quote && <Compare booking={booking} quote={booking.quote} utcOffsetMinutes={utcOffsetMinutes} />}
      {booking.step === "ride" && booking.ride && <RideTracker booking={booking} ride={booking.ride} onShare={onShare} />}
    </aside>
  );
}

interface ChooseModeProps {
  booking: RideBooking;
  cityName: string;
  liveOffered: boolean;
  liveBlocker?: string;
}

function ChooseMode({ booking, cityName, liveOffered, liveBlocker }: ChooseModeProps) {
  return (
    <>
      <SheetHeader className="ride__head" before={<Eyebrow>Ride this route</Eyebrow>} title="Get an auto that keeps to your safe route">
        <p>Musafira pins the route with safety checkpoints, then watches the ride and alerts you if it strays.</p>
      </SheetHeader>

      <div className="ride-modes">
        {liveOffered && (
          <button className="ride-mode" disabled={Boolean(liveBlocker)} onClick={() => booking.choose("live")}>
            <span className="ride-mode__icon is-live">
              <Icon name="auto" size={20} />
            </span>
            <span className="ride-mode__body">
              <strong>
                Book on Namma Yatri
                {booking.linked && !liveBlocker && (
                  <span className="chip chip--linked">
                    <Icon name="check" size={11} /> Linked
                  </span>
                )}
              </strong>
              <small>{liveBlocker ?? "A real auto from your own Namma Yatri account, leaving now."}</small>
            </span>
            {!liveBlocker && <Icon name="chevron" size={16} />}
          </button>
        )}
        <button className="ride-mode" onClick={() => booking.choose("demo")}>
          <span className="ride-mode__icon is-demo">
            <Icon name="play" size={17} />
          </span>
          <span className="ride-mode__body">
            <strong>Try a demo ride</strong>
            <small>The full experience with a simulated driver in {cityName}. Nothing is booked.</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      </div>

      {booking.error && (
        <Notice tone="error" alert>
          {booking.error}
        </Notice>
      )}
      {liveOffered && booking.linked && (
        <LinkButton className="ride__unlink" onClick={booking.unlink}>
          <Icon name="link" size={13} /> Unlink Namma Yatri
        </LinkButton>
      )}
    </>
  );
}

function LinkAccount({ booking }: { booking: RideBooking }) {
  const [code, setCode] = useState("");
  return (
    <>
      <SheetHeader
        className="ride__head"
        before={
          <LinkButton className="ride__back" onClick={booking.back}>
            <Icon name="back" size={14} /> Back
          </LinkButton>
        }
        title="Link your Namma Yatri account"
      >
        <p>A one-time code from the Namma Yatri app lets Musafira book and track this ride for you.</p>
      </SheetHeader>

      <ol className="ride-steps">
        <li>
          <span>1</span>
          <p>
            In Namma Yatri, open <b>Profile</b>, then <b>About us</b>.
          </p>
        </li>
        <li>
          <span>2</span>
          <p>
            Tap the <b>version number</b> at the bottom. A short code appears.
          </p>
        </li>
        <li>
          <span>3</span>
          <p>Type it here. It works for 2 minutes.</p>
        </li>
      </ol>

      <form
        className="ride-link"
        onSubmit={(e) => {
          e.preventDefault();
          if (code) void booking.link(code).then(() => setCode(""));
        }}
      >
        <input
          className="ride-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="Code"
          aria-label="Namma Yatri code"
          autoFocus
        />
        <Button variant="primary" type="submit" disabled={!code || booking.linking} aria-busy={booking.linking}>
          {booking.linking ? "Linking…" : "Link"}
        </Button>
      </form>

      {booking.error && (
        <Notice tone="error" alert>
          {booking.error}
        </Notice>
      )}
      <p className="ride__fineprint">
        <Icon name="shield" size={13} /> Your sign-in stays on Musafira's server for 12 hours, only to book and track rides. Unlink anytime.
      </p>
    </>
  );
}

function Quoting({ mode }: { mode: RideMode }) {
  const steps = QUOTING_STEPS[mode];
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => Math.min(steps.length - 1, s + 1)), mode === "live" ? 2600 : 900);
    return () => clearInterval(timer);
  }, [mode, steps.length]);

  return (
    <>
      <SheetHeader className="ride__head" before={<Eyebrow>{mode === "live" ? "Namma Yatri" : "Demo ride"}</Eyebrow>} title="Finding your safe ride" />
      <div className="scanning" aria-live="polite">
        {steps.slice(0, step + 1).map((s, i) => (
          <div key={s.text} className={`scanning__step ${i === step ? "is-active" : "is-done"}`}>
            <Icon name={i < step ? "check" : s.icon} size={15} />
            <span>{s.text}</span>
          </div>
        ))}
        <div className="scanning__card" />
        <div className="scanning__card" />
      </div>
    </>
  );
}

function Compare({ booking, quote, utcOffsetMinutes }: { booking: RideBooking; quote: RideQuote; utcOffsetMinutes: number }) {
  const [confirming, setConfirming] = useState(false);
  const live = quote.mode === "live";
  const option = booking.selectedOption;
  const estimate = booking.selectedEstimate;
  const safe = quote.options[0]!;
  const direct = quote.options.find((o) => o.kind === "direct");
  const count = quote.checkpoints.length;
  const pickup = quote.pickup.name ?? "your pickup";
  const drop = quote.drop.name ?? "your drop";
  const usualRoute = live ? "Namma Yatri's usual route" : "The usual car route";

  return (
    <>
      <SheetHeader
        className="ride__head"
        before={
          <>
            <LinkButton className="ride__back" onClick={booking.back}>
              <Icon name="back" size={14} /> Back
            </LinkButton>
            <span className={`chip chip--mode is-${quote.mode}`}>{live ? "Live · Namma Yatri" : "Demo · nothing is booked"}</span>
          </>
        }
        title={count > 0 ? `${plural(count, "safety checkpoint")} ${count === 1 ? "keeps" : "keep"} the ride on your route` : `${usualRoute} already follows yours`}
      >
        <p className="ride__trip">
          {pickup} <Icon name="chevron" size={12} /> {drop}
        </p>
      </SheetHeader>

      {count > 0 && (
        <div className="checkpoints">
          <ol aria-label="Safety checkpoints">
            {quote.checkpoints.map((c, i) => (
              <li key={`${c.point.join(",")}`}>
                <span className="checkpoints__dot">{i + 1}</span>
                {c.name ?? `Checkpoint ${i + 1}`}
              </li>
            ))}
          </ol>
          <p>{live ? "Namma Yatri" : "The driver"} gets them as stops, so the route and the fare both go through them.</p>
        </div>
      )}

      <div className="ride-options" role="radiogroup" aria-label="Route">
        {quote.options.map((o) => (
          <OptionCard
            key={o.kind}
            option={o}
            title={o.kind === "direct" ? usualRoute : count > 0 ? "Through the checkpoints" : "Your safe route"}
            tier={booking.tier}
            selected={o.kind === booking.optionKind}
            onSelect={() => booking.selectOption(o.kind)}
          />
        ))}
      </div>

      {direct && <Delta safe={safe} direct={direct} tier={booking.tier} />}
      {safe.estimates.length === 0 && (
        <Notice tone="info">
          Namma Yatri couldn't price a ride through the checkpoints right now. You can still book its usual route, and Musafira will watch it.
        </Notice>
      )}

      {option && option.estimates.length > 1 && (
        <div className="ride-tiers" role="radiogroup" aria-label="Vehicle">
          {option.estimates.map((e) => (
            <ToggleChip
              key={e.id}
              role="radio"
              aria-checked={e.tier === estimate?.tier}
              on={e.tier === estimate?.tier}
              onClick={() => booking.setTier(e.tier)}
            >
              {e.tier} · {rupees(e.fare)}
            </ToggleChip>
          ))}
        </div>
      )}

      {booking.error && (
        <Notice tone="error" alert>
          {booking.error}
        </Notice>
      )}

      <div className="ride__footer">
        <Button variant="primary" wide disabled={!estimate || booking.busy} aria-busy={booking.busy} onClick={() => (live ? setConfirming(true) : void booking.book())}>
          <Icon name={live ? "auto" : "play"} size={16} /> {live ? `Book ${estimate?.tier ?? "ride"}` : booking.busy ? "Starting…" : "Start demo ride"}
          {estimate && <span className="button__meta">{rupees(estimate.fare)}</span>}
        </Button>
        <p className="ride__fineprint">
          {estimate?.pickupSeconds ? `Driver about ${formatDuration(estimate.pickupSeconds)} away. ` : ""}
          {live
            ? `Fares hold till ${formatClock(quote.expiresAt, utcOffsetMinutes)}. You confirm before any driver is asked.`
            : "Auto meter fare for your departure time."}
        </p>
      </div>

      {confirming && estimate && option && (
        <ConfirmDialog
          icon="auto"
          title="Book this ride now?"
          confirmLabel="Book ride"
          busyLabel="Booking…"
          cancelLabel="Not now"
          busy={booking.busy}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            await booking.book();
            setConfirming(false);
          }}
        >
          <p>Namma Yatri will ask drivers near {pickup} straight away.</p>
          <dl className="confirm__facts">
            <div>
              <dt>Vehicle</dt>
              <dd>{estimate.tier}</dd>
            </div>
            <div>
              <dt>Fare</dt>
              <dd>{fareText(estimate)}, paid to the driver as usual</dd>
            </div>
            <div>
              <dt>Route</dt>
              <dd>{option.kind === "safe" && count > 0 ? `Through ${plural(count, "safety checkpoint")}` : usualRoute}</dd>
            </div>
            <div>
              <dt>Drop</dt>
              <dd>{drop}</dd>
            </div>
          </dl>
          <p className="confirm__warn">
            <Icon name="alert" size={14} /> Cancelling after a driver is assigned may cost a fee.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

interface OptionProps {
  option: RideOption;
  title: string;
  tier: string | undefined;
  selected: boolean;
  onSelect(): void;
}

function OptionCard({ option, title, tier, selected, onSelect }: OptionProps) {
  const estimate = estimateFor(option, tier);
  const coverage = Math.round(option.coverage * 100);
  return (
    <button role="radio" aria-checked={selected} className={`ride-option ${selected ? "is-selected" : ""}`} disabled={!estimate} onClick={onSelect}>
      <ScoreRing score={option.score} size={50} stroke={5} />
      <span className="ride-option__body">
        <span className="ride-option__top">
          <strong>{title}</strong>
          {option.kind === "safe" && <span className="chip chip--safest">Recommended</span>}
        </span>
        <span className="ride-option__meta">
          {formatDuration(option.durationSeconds)} · {formatDistance(option.distanceMeters)}
        </span>
        <span className="ride-option__coverage">
          <i style={{ width: `${coverage}%` }} />
        </span>
        <small>Follows {coverage}% of your safe route</small>
      </span>
      <span className="ride-option__fare">
        {estimate ? (
          <>
            <strong>{rupees(estimate.fare)}</strong>
            {estimate.minFare !== null && estimate.maxFare !== null && estimate.minFare !== estimate.maxFare && (
              <small>
                {rupees(estimate.minFare)}–{rupees(estimate.maxFare)}
              </small>
            )}
          </>
        ) : (
          <small>No fare</small>
        )}
      </span>
    </button>
  );
}

function Delta({ safe, direct, tier }: { safe: RideOption; direct: RideOption; tier: string | undefined }) {
  const safeFare = estimateFor(safe, tier)?.fare;
  const directFare = estimateFor(direct, tier)?.fare;
  if (safeFare === undefined || directFare === undefined) return null;
  const points = Math.round(safe.score - direct.score);
  const extra = Math.round(safeFare - directFare);
  const cost = extra > 0 ? `${rupees(extra)} more` : extra < 0 ? `${rupees(-extra)} less` : "Same fare";
  return (
    <p className="ride-delta">
      <Icon name="sparkle" size={14} />
      {points > 0 ? `${cost} for a ride ${points} points safer` : `${cost}, and the ride keeps to the route you planned`}
    </p>
  );
}
