import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { Place, Plan, ScoringOptions, Weights } from "../api/types";

export type Departure = { mode: "now" } | { mode: "at"; at: Date };
export type PlannerStatus = "idle" | "planning" | "rescoring" | "ready" | "error";

interface Trip {
  readonly from: Place;
  readonly to: Place;
  readonly departure: Departure;
}

const RESCORE_DELAY_MS = 140;

const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach Musafira. Check your connection.");

/**
 * Trip inputs → plan, only when the rider searches. Editing places or the
 * departure time afterwards marks the plan stale (inputs no longer match the
 * searched trip) until the next search; changing weights only rescores the
 * stored search, which is instant and needs no routing call.
 */
export function usePlanner(scoring: { weights: Weights; options: ScoringOptions } | undefined) {
  const [from, setFrom] = useState<Place>();
  const [to, setTo] = useState<Place>();
  const [departure, setDeparture] = useState<Departure>({ mode: "now" });
  const [searched, setSearched] = useState<Trip>();
  const [plan, setPlan] = useState<Plan>();
  const [selectedId, setSelectedId] = useState<string>();
  const [status, setStatus] = useState<PlannerStatus>("idle");
  const [error, setError] = useState<string>();
  const [replanNonce, setReplanNonce] = useState(0);

  const latestScoring = useRef(scoring);
  latestScoring.current = scoring;
  const searchId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const current = latestScoring.current;
    if (!searched || !current) {
      setPlan(undefined);
      setError(undefined);
      searchId.current = undefined;
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    setStatus("planning");
    setError(undefined);
    api
      .plan(
        {
          from: searched.from.point,
          to: searched.to.point,
          ...(searched.departure.mode === "at" ? { departAt: searched.departure.at.toISOString() } : {}),
          ...current,
        },
        controller.signal,
      )
      .then((result) => {
        searchId.current = result.searchId;
        setPlan(result);
        setSelectedId(result.routes[0]?.id);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        searchId.current = undefined;
        setPlan(undefined);
        setError(messageOf(e));
        setStatus("error");
      });
    return () => controller.abort();
  }, [searched, replanNonce, Boolean(scoring)]);

  useEffect(() => {
    const id = searchId.current;
    if (!id || !scoring) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("rescoring");
      try {
        const result = await api.rescore(id, scoring, controller.signal);
        setPlan(result);
        setStatus("ready");
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof ApiError && e.status === 404) setReplanNonce((n) => n + 1);
        else {
          setError(messageOf(e));
          setStatus("error");
        }
      }
    }, RESCORE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [scoring?.weights, scoring?.options]);

  const stale = Boolean(searched) && (searched?.from !== from || searched?.to !== to || searched?.departure !== departure);

  return {
    from,
    to,
    departure,
    plan,
    selectedId,
    status,
    error,
    stale,
    setFrom,
    setTo,
    setDeparture,
    setSelectedId,
    search: (trip: Partial<Trip> = {}) => {
      const next = { from, to, departure, ...trip };
      if (!next.from || !next.to) return;
      setFrom(next.from);
      setTo(next.to);
      setDeparture(next.departure);
      setSearched({ from: next.from, to: next.to, departure: next.departure });
    },
    swap: () => {
      setFrom(to);
      setTo(from);
    },
    clear: () => {
      setFrom(undefined);
      setTo(undefined);
      setSearched(undefined);
    },
  };
}
