/**
 * The ride booking flow as one state machine:
 *   choose a mode → (live, first time) link Namma Yatri → quote → compare → (live) confirm → ride
 * then polls the ride until it ends. Where live booking isn't offered the flow starts at the
 * demo quote, and Back closes the sheet instead of returning to a one-option choice.
 *
 * The Namma Yatri session handle and the active ride's ref live in sessionStorage so a reload
 * resumes tracking; the handle is opaque (the Namma Yatri token stays on the server). Polling
 * runs every second for a demo ride, whose simulated clock is fast, and every 3 s live.
 * The off-route alert vibrates once when it starts; "I'm OK" hides it until the ride is back
 * on route, so only a new departure from the route raises it again.
 */
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Ride, RideEstimate, RideMode, RideOption, RideOptionKind, RideQuote, RideStatus, ScoringOptions, Weights } from "../api/types";

const SESSION_KEY = "musafira.nySession";
const RIDE_KEY = "musafira.ride";
export const RIDE_POLL_MS: Record<RideMode, number> = { demo: 1000, live: 3000 };
const FINISHED: ReadonlySet<RideStatus> = new Set(["completed", "cancelled", "no_driver"]);
const AUTO_TIER = /auto/i;

export type RideStep = "choose" | "link" | "quoting" | "compare" | "ride";

export interface RideTarget {
  readonly searchId: string;
  readonly routeId: string;
  readonly weights: Weights;
  readonly options: ScoringOptions;
}

const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach Musafira. Check your connection.");

function remember(key: string, value: string | undefined) {
  if (value) sessionStorage.setItem(key, value);
  else sessionStorage.removeItem(key);
}

function defaultTier(option: RideOption | undefined): string | undefined {
  if (!option?.estimates.length) return undefined;
  const auto = option.estimates.find((e) => AUTO_TIER.test(e.tier));
  return (auto ?? [...option.estimates].sort((a, b) => a.fare - b.fare)[0])!.tier;
}

export const isFinished = (ride: Ride | undefined) => Boolean(ride && FINISHED.has(ride.status));

export function useRideBooking() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<RideStep>("choose");
  const [target, setTarget] = useState<RideTarget>();
  const [mode, setMode] = useState<RideMode>("demo");
  const [demoOnly, setDemoOnly] = useState(false);
  const [session, setSession] = useState<string | undefined>(() => sessionStorage.getItem(SESSION_KEY) ?? undefined);
  const [linking, setLinking] = useState(false);
  const [quote, setQuote] = useState<RideQuote>();
  const [optionKind, setOptionKind] = useState<RideOptionKind>("safe");
  const [tier, setTier] = useState<string>();
  const [ride, setRide] = useState<Ride>();
  const [tracking, setTracking] = useState(true);
  const [strayed, setStrayed] = useState(false);
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const quoteRun = useRef<AbortController | undefined>(undefined);

  const forgetSession = () => {
    remember(SESSION_KEY, undefined);
    setSession(undefined);
  };

  useEffect(() => {
    if (session) api.ridesLinked(session).then((linked) => !linked && forgetSession(), () => undefined);
    const ref = sessionStorage.getItem(RIDE_KEY);
    if (!ref) return;
    api.ride(ref, session).then(
      (found) => {
        setRide(found);
        setStep("ride");
        setOpen(true);
      },
      () => remember(RIDE_KEY, undefined),
    );
  }, []);

  useEffect(() => {
    if (!ride) return;
    remember(RIDE_KEY, isFinished(ride) ? undefined : ride.ref);
    if (ride.guard?.offRoute) setStrayed(true);
    if (isFinished(ride) || !tracking) return;
    const timer = setTimeout(async () => {
      try {
        setRide(await api.ride(ride.ref, session));
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.code === "NY_SIGNED_OUT")) {
          if (e.code === "NY_SIGNED_OUT") forgetSession();
          setTracking(false);
          setError(e.status === 404 ? "This ride is no longer tracked here." : "Your Namma Yatri sign-in ended. Follow this ride in the Namma Yatri app.");
        } else {
          setRide((current) => current && { ...current, stale: true });
        }
      }
    }, RIDE_POLL_MS[ride.mode]);
    return () => clearTimeout(timer);
  }, [ride, tracking]);

  const offRoute = Boolean(ride?.status === "riding" && ride.guard?.offRoute);
  useEffect(() => {
    if (!offRoute) setAlertDismissed(false);
    else navigator.vibrate?.([220, 120, 220]);
  }, [offRoute]);

  const runQuote = async (nextMode: RideMode, nextTarget: RideTarget | undefined, nextSession: string | undefined) => {
    if (!nextTarget) return;
    quoteRun.current?.abort();
    const controller = new AbortController();
    quoteRun.current = controller;
    setStep("quoting");
    setError(undefined);
    setQuote(undefined);
    try {
      const result = await api.quoteRide({ ...nextTarget, mode: nextMode }, nextMode === "live" ? nextSession : undefined, controller.signal);
      const kind: RideOptionKind = result.options[0]?.estimates.length ? "safe" : "direct";
      setQuote(result);
      setOptionKind(kind);
      setTier(defaultTier(result.options.find((o) => o.kind === kind)));
      setStep("compare");
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof ApiError && e.code === "NY_SIGNED_OUT") {
        forgetSession();
        setStep("link");
        setError("Link Namma Yatri again to see live fares.");
        return;
      }
      setError(messageOf(e));
      setStep("choose");
    }
  };

  const selectedOption = quote?.options.find((o) => o.kind === optionKind);
  const selectedEstimate: RideEstimate | undefined = selectedOption?.estimates.find((e) => e.tier === tier) ?? selectedOption?.estimates[0];
  const active = Boolean(ride && !isFinished(ride));

  const reset = () => {
    quoteRun.current?.abort();
    setRide(undefined);
    setQuote(undefined);
    setStrayed(false);
    setTracking(true);
    setError(undefined);
    setStep("choose");
  };

  return {
    open,
    step,
    mode,
    linked: Boolean(session),
    linking,
    quote,
    optionKind,
    tier,
    selectedOption,
    selectedEstimate,
    ride,
    active,
    tracking,
    strayed,
    alertVisible: offRoute && !alertDismissed,
    busy,
    error,

    start(next: RideTarget, liveOffered: boolean) {
      setOpen(true);
      if (active) return;
      reset();
      setTarget(next);
      setDemoOnly(!liveOffered);
      if (!liveOffered) {
        setMode("demo");
        void runQuote("demo", next, undefined);
      }
    },
    close() {
      setOpen(false);
      if (!active) reset();
    },
    back() {
      quoteRun.current?.abort();
      setError(undefined);
      if (!demoOnly) return setStep("choose");
      setOpen(false);
      reset();
    },
    choose(next: RideMode) {
      setMode(next);
      setError(undefined);
      if (next === "live" && !session) setStep("link");
      else void runQuote(next, target, session);
    },
    async link(code: string) {
      setLinking(true);
      setError(undefined);
      try {
        const handle = await api.linkRides(code);
        remember(SESSION_KEY, handle);
        setSession(handle);
        void runQuote("live", target, handle);
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setLinking(false);
      }
    },
    unlink() {
      if (session) void api.unlinkRides(session).catch(() => undefined);
      forgetSession();
      if (mode === "live" && step !== "ride") {
        setQuote(undefined);
        setStep("choose");
      }
    },
    requote() {
      setRide(undefined);
      setStrayed(false);
      setTracking(true);
      void runQuote(mode, target, session);
    },
    selectOption(kind: RideOptionKind) {
      const option = quote?.options.find((o) => o.kind === kind);
      if (!option?.estimates.length) return;
      setOptionKind(kind);
      if (!option.estimates.some((e) => e.tier === tier)) setTier(defaultTier(option));
    },
    setTier,
    async book() {
      if (!quote || !selectedEstimate) return;
      setBusy(true);
      setError(undefined);
      try {
        const booked = await api.bookRide({ quoteId: quote.quoteId, estimateId: selectedEstimate.id, confirm: quote.mode === "live" }, session);
        setRide(booked);
        setTracking(true);
        setStrayed(false);
        setStep("ride");
      } catch (e) {
        if (e instanceof ApiError && e.code === "QUOTE_EXPIRED") void runQuote(mode, target, session);
        else setError(messageOf(e));
      } finally {
        setBusy(false);
      }
    },
    async cancel() {
      if (!ride) return;
      setBusy(true);
      setError(undefined);
      try {
        setRide(await api.cancelRide(ride.ref, session));
      } catch (e) {
        setError(messageOf(e));
      } finally {
        setBusy(false);
      }
    },
    async detour() {
      if (!ride) return;
      try {
        setRide(await api.detourRide(ride.ref));
      } catch (e) {
        setError(messageOf(e));
      }
    },
    dismissAlert: () => setAlertDismissed(true),
  };
}

export type RideBooking = ReturnType<typeof useRideBooking>;
