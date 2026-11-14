import { useState } from "react";
import { api, ApiError } from "../api/client";
import type { LngLat, ReportCategory, ReportWhen } from "../api/types";
import type { AuthState } from "../auth/useAuth";

type Status = "idle" | "locating" | "sending";

const failure = (error: unknown) => {
  if (!(error instanceof ApiError)) return "Couldn't send your report. Check your connection and try again.";
  return error.status === 401 ? "Your sign-in expired. Sign in again to report." : error.message;
};

export function useReport(auth: AuthState) {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState<LngLat>();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>();

  const close = () => {
    setOpen(false);
    setPoint(undefined);
    setStatus("idle");
    setError(undefined);
  };

  return {
    open,
    point,
    error,
    locating: status === "locating",
    sending: status === "sending",
    start: () => setOpen(true),
    close,
    mark(next: LngLat) {
      setPoint(next);
      setError(undefined);
    },
    locate() {
      if (!navigator.geolocation) return setError("Location isn't available in this browser. Tap the map instead.");
      setStatus("locating");
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          setStatus("idle");
          setPoint([coords.longitude, coords.latitude]);
          setError(undefined);
        },
        () => {
          setStatus("idle");
          setError("Couldn't get your location. Tap the map instead.");
        },
        { enableHighAccuracy: true, timeout: 10_000 },
      );
    },
    async send(category: ReportCategory, when: ReportWhen): Promise<boolean> {
      if (!point) return false;
      setStatus("sending");
      setError(undefined);
      try {
        const token = await auth.idToken();
        if (!token) throw new ApiError(401, "UNAUTHORIZED", "Signed out");
        await api.report(token, { point, category, when });
        close();
        return true;
      } catch (e) {
        setStatus("idle");
        setError(failure(e));
        return false;
      }
    },
  };
}
