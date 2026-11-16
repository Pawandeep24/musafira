import { useState } from "react";
import { api, ApiError } from "@/api/client";
import type {
  City,
  DomainIdea,
  Language,
  LngLat,
  OwnedSafeStop,
  SafeStopFeature,
  SafeStopHours,
  SafeStopKind,
  SafeStopProfile,
  VerifyChecks,
} from "@/api/types";
import type { AuthState } from "@/auth/useAuth";
import { locateRider } from "@/lib/locate";

export const STEPS = ["place", "washroom", "care", "domain", "verify"] as const;
export type Step = (typeof STEPS)[number];

export interface StopDraft {
  name: string;
  kind: SafeStopKind;
  point?: LngLat;
  hours: SafeStopHours;
  languages: Language[];
  washrooms: SafeStopProfile["washrooms"];
  access: SafeStopProfile["access"];
  feeRupees?: number;
  attendant: SafeStopProfile["attendant"];
  pads: SafeStopProfile["pads"];
  cleaned: SafeStopProfile["cleaned"];
  features: SafeStopFeature[];
  offer: string;
  promise: boolean;
  domain: string;
}

type Status = "idle" | "loading" | "locating" | "saving" | "verifying";

const EMPTY: StopDraft = {
  name: "",
  kind: "cafe",
  hours: { opens: "08:00", closes: "22:00" },
  languages: [],
  washrooms: { total: 1, women: 1, unisex: 0, accessible: 0 },
  access: "anyone",
  attendant: "daytime",
  pads: "none",
  cleaned: "few_daily",
  features: [],
  offer: "",
  promise: false,
  domain: "",
};

const fromProfile = ({ promise, offer, ...profile }: SafeStopProfile): StopDraft => ({ ...profile, offer: offer ?? "", promise });

function toProfile({ point, promise, offer, feeRupees, access, ...draft }: StopDraft): SafeStopProfile | undefined {
  if (!point || !promise) return undefined;
  return { ...draft, point, access, promise, ...(offer.trim() ? { offer: offer.trim() } : {}), ...(access === "paid" && feeRupees ? { feeRupees } : {}) };
}

const countsValid = ({ total, women, unisex, accessible }: StopDraft["washrooms"]) => women + unisex <= total && accessible <= total;

export function stepReady(step: Step, draft: StopDraft): boolean {
  if (step === "place") return draft.name.trim().length >= 2 && Boolean(draft.point);
  if (step === "washroom") return countsValid(draft.washrooms) && (draft.access !== "paid" || Boolean(draft.feeRupees));
  if (step === "domain") return draft.domain.trim().length > 3 && draft.promise;
  return true;
}

const inside = ({ bbox }: City, [lon, lat]: LngLat) => lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north;

const failure = (error: unknown) => {
  if (!(error instanceof ApiError)) return "Couldn't reach Musafira. Check your connection and try again.";
  return error.status === 401 ? "Your sign-in expired. Sign in again to keep going." : error.message;
};

export function useStopOnboarding(auth: AuthState, cities: readonly City[]) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("place");
  const [draft, setDraft] = useState<StopDraft>(EMPTY);
  const [stop, setStop] = useState<OwnedSafeStop>();
  const [ideas, setIdeas] = useState<{ name: string; list: DomainIdea[] }>();
  const [checks, setChecks] = useState<VerifyChecks>();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>();

  const withToken = async <T>(next: Status, action: (token: string) => Promise<T>): Promise<T | undefined> => {
    setStatus(next);
    setError(undefined);
    try {
      const token = await auth.idToken();
      if (!token) throw new ApiError(401, "UNAUTHORIZED", "Signed out");
      return await action(token);
    } catch (e) {
      setError(failure(e));
      return undefined;
    } finally {
      setStatus((current) => (current === next ? "idle" : current));
    }
  };

  const loadIdeas = async (name: string) => {
    const city = draft.point && cities.find((c) => inside(c, draft.point!));
    if (!city || ideas?.name === name) return;
    const list = await withToken("loading", (token) => api.domainIdeas(token, name, city.id));
    if (list) setIdeas({ name, list });
  };

  const save = async () => {
    const profile = toProfile(draft);
    if (!profile) return;
    const saved = await withToken("saving", (token) => (stop ? api.updateStop(token, stop.id, profile) : api.createStop(token, profile)));
    if (!saved) return;
    setStop(saved);
    setDraft(fromProfile(saved.profile));
    if (saved.status === "draft") setChecks(undefined);
    setStep("verify");
  };

  return {
    open,
    step,
    draft,
    stop,
    ideas: ideas?.list,
    checks,
    error,
    loading: status === "loading",
    locating: status === "locating",
    saving: status === "saving",
    verifying: status === "verifying",
    ready: stepReady(step, draft),
    async start() {
      setOpen(true);
      setError(undefined);
      const mine = await withToken("loading", (token) => api.myStops(token));
      const latest = mine?.[0];
      if (!latest) return;
      setStop(latest);
      setDraft(fromProfile(latest.profile));
      setStep("verify");
    },
    close() {
      setOpen(false);
      setStep("place");
      setDraft(EMPTY);
      setStop(undefined);
      setIdeas(undefined);
      setChecks(undefined);
      setError(undefined);
    },
    update(patch: Partial<StopDraft>) {
      setDraft((current) => ({ ...current, ...patch }));
    },
    toggleFeature(feature: SafeStopFeature) {
      setDraft((current) => ({
        ...current,
        features: current.features.includes(feature) ? current.features.filter((f) => f !== feature) : [...current.features, feature],
      }));
    },
    mark(point: LngLat) {
      setDraft((current) => ({ ...current, point }));
      setError(undefined);
    },
    locate() {
      setStatus("locating");
      locateRider(
        (point) => {
          setStatus("idle");
          setDraft((current) => ({ ...current, point }));
        },
        (message) => {
          setStatus("idle");
          setError(message);
        },
      );
    },
    goTo(next: Step) {
      setError(undefined);
      setStep(next);
      if (next === "domain") void loadIdeas(draft.name.trim());
    },
    save,
    async verify() {
      if (!stop) return;
      const result = await withToken("verifying", (token) => api.verifyStop(token, stop.id));
      if (!result) return;
      setStop(result.stop);
      setChecks(result.checks);
    },
  };
}

export type StopOnboardingState = ReturnType<typeof useStopOnboarding>;
