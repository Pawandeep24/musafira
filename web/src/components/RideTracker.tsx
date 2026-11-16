import { useState } from "react";
import type { Ride, RideStatus } from "../api/types";
import type { RideBooking } from "../state/useRideBooking";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";
import { Button, ButtonLink } from "./ui/Button";
import { LinkButton } from "./ui/LinkButton";
import { Notice } from "./ui/Notice";
import { SheetHeader } from "./ui/SheetHeader";

const STAGES: readonly { status: RideStatus; label: string }[] = [
  { status: "searching", label: "Finding" },
  { status: "assigned", label: "On the way" },
  { status: "riding", label: "Riding" },
  { status: "completed", label: "Arrived" },
];

type Tone = "live" | "ok" | "warn" | "risk";

const minutes = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} min`;

function headline(ride: Ride, strayed: boolean): { title: string; detail: string; tone: Tone } {
  const app = ride.mode === "live" ? "Namma Yatri" : "The demo";
  switch (ride.status) {
    case "searching":
      return ride.reassigning
        ? { title: "Finding another driver", detail: "Your driver cancelled. Namma Yatri is asking others nearby.", tone: "warn" }
        : { title: "Finding a driver", detail: `${app} is asking drivers near your pickup.`, tone: "live" };
    case "assigned":
      return {
        title: ride.pickupSeconds !== null ? `Driver arriving in ${minutes(ride.pickupSeconds)}` : "Driver on the way",
        detail: "Check the number plate, then share the OTP once you're in.",
        tone: "live",
      };
    case "riding":
      return ride.guard?.offRoute
        ? { title: "Off your safe route", detail: `${ride.guard.metersOff} m away${ride.area ? ` near ${ride.area}` : ""}.`, tone: "risk" }
        : { title: "On your safe route", detail: ride.area ? `Passing ${ride.area}.` : "Musafira is watching the route.", tone: "ok" };
    case "completed":
      return strayed
        ? { title: "You've arrived", detail: "The ride left the safe route at one point. Reporting the spot helps the next rider.", tone: "warn" }
        : { title: "You've arrived", detail: "The ride kept to your safe route all the way.", tone: "ok" };
    case "cancelled":
      return { title: "Ride cancelled", detail: ride.cancelledByRider ? "You cancelled this ride." : "The driver or Namma Yatri cancelled this ride.", tone: "warn" };
    case "no_driver":
      return { title: "No driver accepted", detail: "No one took the ride in time. Try again in a minute.", tone: "warn" };
  }
}

export function RideTracker({ booking, ride, onShare }: { booking: RideBooking; ride: Ride; onShare(): void }) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const live = ride.mode === "live";
  const { title, detail, tone } = headline(ride, booking.strayed);
  const stage = STAGES.findIndex((s) => s.status === ride.status);
  const ongoing = ride.status === "assigned" || ride.status === "riding";
  const finished = ride.status === "completed" || ride.status === "cancelled" || ride.status === "no_driver";

  return (
    <>
      <SheetHeader
        className="ride__head"
        before={<span className={`chip chip--mode is-${ride.mode}`}>{live ? "Live · Namma Yatri" : "Demo ride"}</span>}
        title={title}
        titleClassName={`ride__status tone-${tone}`}
      >
        <p>{detail}</p>
      </SheetHeader>

      {stage >= 0 && (
        <ol className="ride-stages" aria-label="Ride progress">
          {STAGES.map((s, i) => (
            <li key={s.status} className={i < stage ? "is-done" : i === stage ? "is-on" : ""}>
              <span />
              {s.label}
            </li>
          ))}
        </ol>
      )}

      {ride.status === "searching" && (
        <div className={`ride-radar is-${ride.mode}`} aria-hidden="true">
          <span />
          <span />
          <span />
          <Icon name="auto" size={26} />
        </div>
      )}

      {ongoing && ride.driver && <DriverCard ride={ride} />}

      {ride.status === "riding" && ride.guard && (
        <div className={`ride-guard ${ride.guard.offRoute ? "is-risk" : "is-ok"}`}>
          <div className="ride-guard__bar">
            <i style={{ width: `${Math.round(ride.guard.progress * 100)}%` }} />
          </div>
          <span>
            <Icon name={ride.guard.offRoute ? "alert" : "shield"} size={14} />
            {ride.guard.offRoute ? `${ride.guard.metersOff} m off route` : "On route"} · {Math.round(ride.guard.progress * 100)}% of the way
          </span>
        </div>
      )}

      {ride.stale && booking.tracking && (
        <p className="ride__stale">Reconnecting to {live ? "Namma Yatri" : "the ride"}…</p>
      )}

      {ongoing && (
        <div className="ride-actions">
          <Button variant="ghost" onClick={onShare}>
            <Icon name="share" size={15} /> Share live trip
          </Button>
          <ButtonLink variant="sos" href="tel:112">
            <Icon name="phone" size={15} /> Call 112
          </ButtonLink>
        </div>
      )}

      {ride.canDetour && (
        <Button variant="ghost" wide className="ride__detour" onClick={() => void booking.detour()}>
          <Icon name="route" size={15} /> Simulate a wrong turn
        </Button>
      )}

      {booking.error && (
        <Notice tone="error" alert>
          {booking.error}
        </Notice>
      )}

      {ride.canCancel && (
        <LinkButton className="ride__cancel" disabled={booking.busy} onClick={() => (live ? setConfirmCancel(true) : void booking.cancel())}>
          {booking.busy ? "Cancelling…" : ride.status === "searching" ? "Cancel search" : "Cancel ride"}
        </LinkButton>
      )}

      {finished && (
        <div className="ride__footer ride__footer--split">
          {ride.status !== "completed" && (
            <Button variant="primary" onClick={booking.requote}>
              <Icon name="search" size={15} /> Get fresh fares
            </Button>
          )}
          <Button variant={ride.status === "completed" ? "primary" : "ghost"} wide={ride.status === "completed"} onClick={booking.close}>
            Done
          </Button>
        </div>
      )}

      {live && !finished && (
        <p className="ride__fineprint">
          <Icon name="auto" size={13} /> The ride also shows in your Namma Yatri app.
        </p>
      )}

      {confirmCancel && (
        <ConfirmDialog
          icon="alert"
          tone="risk"
          title={ride.cancelFee ? "Cancel with a driver on the way?" : "Stop looking for a driver?"}
          confirmLabel={ride.status === "searching" ? "Cancel search" : "Cancel ride"}
          busyLabel="Cancelling…"
          cancelLabel="Keep ride"
          busy={booking.busy}
          onCancel={() => setConfirmCancel(false)}
          onConfirm={async () => {
            await booking.cancel();
            setConfirmCancel(false);
          }}
        >
          <p>
            {ride.cancelFee
              ? "Your driver is already heading to you, so Namma Yatri may charge a cancellation fee."
              : "Namma Yatri will stop asking drivers. Nothing is charged."}
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}

function DriverCard({ ride }: { ride: Ride }) {
  const driver = ride.driver!;
  return (
    <div className="driver-card">
      <span className="driver-card__avatar">{(driver.name ?? "D").slice(0, 1).toUpperCase()}</span>
      <div className="driver-card__body">
        <strong>{driver.name ?? "Your driver"}</strong>
        <span>{[driver.vehicle, `${ride.tier} · ₹${ride.fare}`].filter(Boolean).join(" · ")}</span>
      </div>
      {driver.vehicleNumber && <span className="driver-card__plate">{driver.vehicleNumber}</span>}
      {ride.status === "assigned" && driver.otp && (
        <div className="otp">
          <span>Ride OTP</span>
          <strong aria-label={`OTP ${driver.otp.split("").join(" ")}`}>
            {driver.otp.split("").map((digit, i) => (
              <i key={i}>{digit}</i>
            ))}
          </strong>
        </div>
      )}
    </div>
  );
}

export function RideAlert({ ride, onDismiss, onShare }: { ride: Ride; onDismiss(): void; onShare(): void }) {
  return (
    <div className="ride-alert glass" role="alert">
      <span className="ride-alert__icon">
        <Icon name="alert" size={22} />
      </span>
      <div className="ride-alert__text">
        <strong>Your ride left the safe route</strong>
        <span>
          {ride.guard?.metersOff ?? 0} m off route{ride.area ? ` near ${ride.area}` : ""}. Check with your driver, or get help.
        </span>
      </div>
      <div className="ride-alert__actions">
        <Button variant="ghost" onClick={onDismiss}>
          <Icon name="check" size={14} /> I'm OK
        </Button>
        <Button variant="ghost" onClick={onShare}>
          <Icon name="share" size={14} /> Share trip
        </Button>
        <ButtonLink variant="sos" href="tel:112">
          <Icon name="phone" size={14} /> Call 112
        </ButtonLink>
      </div>
    </div>
  );
}
