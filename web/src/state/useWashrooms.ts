import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/api/client";
import type { LngLat, WashroomsNear } from "@/api/types";
import { locateRider } from "@/lib/locate";
import type { WashroomFilter } from "@/lib/safeStops";

type Status = "idle" | "locating" | "loading";

export function useWashrooms() {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState<LngLat>();
  const [result, setResult] = useState<WashroomsNear>();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>();
  const [filters, setFilters] = useState<ReadonlySet<WashroomFilter>>(new Set());

  useEffect(() => {
    if (!point) return;
    const controller = new AbortController();
    setStatus("loading");
    setError(undefined);
    api
      .washrooms(point, controller.signal)
      .then((found) => {
        setResult(found);
        setStatus("idle");
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setResult(undefined);
        setStatus("idle");
        setError(e instanceof ApiError ? e.message : "Couldn't load washrooms. Check your connection.");
      });
    return () => controller.abort();
  }, [point]);

  const shown = useMemo(() => result?.washrooms.filter((w) => [...filters].every((f) => w.facts[f] === true)) ?? [], [result, filters]);

  const locate = () => {
    setStatus("locating");
    locateRider(setPoint, (message) => {
      setStatus("idle");
      setError(message);
    });
  };

  return {
    open,
    point,
    result,
    shown,
    filters,
    error,
    locating: status === "locating",
    loading: status === "loading",
    start() {
      setOpen(true);
      if (!point) locate();
    },
    close() {
      setOpen(false);
      setPoint(undefined);
      setResult(undefined);
      setError(undefined);
      setStatus("idle");
    },
    mark: setPoint,
    locate,
    toggleFilter(filter: WashroomFilter) {
      setFilters((current) => {
        const next = new Set(current);
        if (!next.delete(filter)) next.add(filter);
        return next;
      });
    },
  };
}

export type WashroomsState = ReturnType<typeof useWashrooms>;
