import { useRef, useState } from "react";
import { api, ApiError } from "@/api/client";
import type { Itinerary, Place, TripAnswers } from "@/api/types";

export type ItineraryStatus = "idle" | "planning" | "ready" | "error";

export const DEFAULT_ANSWERS: TripAnswers = { days: 1, interests: [], diet: "any", backBy: "sunset" };

const messageOf = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach Musafira. Check your connection.");

export function useItinerary() {
  const [base, setBase] = useState<Place>();
  const [answers, setAnswers] = useState<TripAnswers>(DEFAULT_ANSWERS);
  const [itinerary, setItinerary] = useState<Itinerary>();
  const [dayIndex, setDayIndex] = useState(0);
  const [status, setStatus] = useState<ItineraryStatus>("idle");
  const [error, setError] = useState<string>();
  const pending = useRef<AbortController | null>(null);

  const plan = async () => {
    if (!base) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setStatus("planning");
    setError(undefined);
    try {
      const result = await api.itinerary({ base: { name: base.name, point: base.point }, ...answers }, controller.signal);
      setItinerary(result);
      setDayIndex(0);
      setStatus("ready");
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(messageOf(e));
      setStatus("error");
    }
  };

  return {
    base,
    answers,
    itinerary,
    dayIndex,
    status,
    error,
    setBase,
    setDayIndex,
    answer: (patch: Partial<TripAnswers>) => setAnswers((current) => ({ ...current, ...patch })),
    plan: () => void plan(),
    edit: () => {
      setItinerary(undefined);
      setStatus("idle");
    },
    clear: () => {
      pending.current?.abort();
      setBase(undefined);
      setItinerary(undefined);
      setStatus("idle");
      setError(undefined);
    },
  };
}
