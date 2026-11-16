import type {
  AppConfig,
  CityLayers,
  DomainIdea,
  Itinerary,
  LngLat,
  OwnedSafeStop,
  Place,
  Plan,
  Preferences,
  PublicSafeStop,
  ReportCategory,
  ReportWhen,
  Ride,
  RideMode,
  RideQuote,
  SafeStopProfile,
  ScoringOptions,
  TripAnswers,
  VerifyChecks,
  WashroomsNear,
  Weights,
} from "./types";

const SESSION_HEADER = "x-ny-session";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  token?: string;
  session?: string;
  signal?: AbortSignal;
}

async function request<T>(path: string, { method = "GET", body, token, session, signal }: RequestOptions = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(session ? { [SESSION_HEADER]: session } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
  const data = (await response.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!response.ok) {
    throw new ApiError(response.status, data?.error?.code ?? "ERROR", data?.error?.message ?? "Something went wrong");
  }
  return data as T;
}

export interface QuoteBody {
  searchId: string;
  routeId: string;
  mode: RideMode;
  weights: Weights;
  options: ScoringOptions;
}

export interface PlanBody {
  from: LngLat;
  to: LngLat;
  departAt?: string;
  weights: Weights;
  options: ScoringOptions;
}

export const api = {
  config: () => request<AppConfig>("/config"),
  layers: (cityId: string) => request<CityLayers>(`/cities/${encodeURIComponent(cityId)}/layers`),
  suggest: (q: string, city: string, near?: LngLat, signal?: AbortSignal) => {
    const params = new URLSearchParams({ q, city, ...(near ? { lon: String(near[0]), lat: String(near[1]) } : {}) });
    return request<{ places: Place[] }>(`/places/suggest?${params}`, { ...(signal ? { signal } : {}) }).then((r) => r.places);
  },
  reverse: ([lon, lat]: LngLat) =>
    request<{ place: Place | null }>(`/places/reverse?${new URLSearchParams({ lon: String(lon), lat: String(lat) })}`).then(
      (r) => r.place,
    ),
  plan: (body: PlanBody, signal?: AbortSignal) => request<Plan>("/plan", { method: "POST", body, ...(signal ? { signal } : {}) }),
  rescore: (searchId: string, body: { weights: Weights; options: ScoringOptions }, signal?: AbortSignal) =>
    request<Plan>(`/plan/${searchId}/score`, { method: "POST", body, ...(signal ? { signal } : {}) }),
  itinerary: (body: TripAnswers & { base: { name: string; point: LngLat } }, signal?: AbortSignal) =>
    request<Itinerary>("/itinerary", { method: "POST", body, ...(signal ? { signal } : {}) }),
  getPreferences: (token: string) => request<{ preferences: Preferences | null }>("/me/preferences", { token }).then((r) => r.preferences),
  savePreferences: (token: string, preferences: Preferences) =>
    request<{ preferences: Preferences }>("/me/preferences", { method: "PUT", body: preferences, token }),
  report: (token: string, body: { point: LngLat; category: ReportCategory; when: ReportWhen }) =>
    request<unknown>("/reports", { method: "POST", body, token }),
  linkRides: (code: string) => request<{ session: string }>("/rides/link", { method: "POST", body: { code } }).then((r) => r.session),
  ridesLinked: (session: string) => request<{ linked: boolean }>("/rides/link", { session }).then((r) => r.linked),
  unlinkRides: (session: string) => request<null>("/rides/link", { method: "DELETE", session }),
  quoteRide: (body: QuoteBody, session?: string, signal?: AbortSignal) =>
    request<RideQuote>("/rides/quote", { method: "POST", body, ...(session ? { session } : {}), ...(signal ? { signal } : {}) }),
  bookRide: (body: { quoteId: string; estimateId: string; confirm: boolean }, session?: string) =>
    request<Ride>("/rides", { method: "POST", body, ...(session ? { session } : {}) }),
  ride: (ref: string, session?: string) => request<Ride>(`/rides/${ref}`, session ? { session } : {}),
  cancelRide: (ref: string, session?: string) => request<Ride>(`/rides/${ref}/cancel`, { method: "POST", ...(session ? { session } : {}) }),
  detourRide: (ref: string) => request<Ride>(`/rides/${ref}/detour`, { method: "POST" }),
  washrooms: ([lon, lat]: LngLat, signal?: AbortSignal) =>
    request<WashroomsNear>(`/washrooms?${new URLSearchParams({ lon: String(lon), lat: String(lat) })}`, signal ? { signal } : {}),
  safeStop: (id: string) => request<{ stop: PublicSafeStop }>(`/stops/${encodeURIComponent(id)}`).then((r) => r.stop),
  myStops: (token: string) => request<{ stops: OwnedSafeStop[] }>("/stops/mine", { token }).then((r) => r.stops),
  createStop: (token: string, profile: SafeStopProfile) =>
    request<{ stop: OwnedSafeStop }>("/stops", { method: "POST", body: profile, token }).then((r) => r.stop),
  updateStop: (token: string, id: string, profile: SafeStopProfile) =>
    request<{ stop: OwnedSafeStop }>(`/stops/${encodeURIComponent(id)}`, { method: "PUT", body: profile, token }).then((r) => r.stop),
  verifyStop: (token: string, id: string) =>
    request<{ stop: OwnedSafeStop; checks: VerifyChecks }>(`/stops/${encodeURIComponent(id)}/verify`, { method: "POST", token }),
  domainIdeas: (token: string, name: string, cityId: string) =>
    request<{ ideas: DomainIdea[] }>("/stops/domain-ideas", { method: "POST", body: { name, cityId }, token }).then((r) => r.ideas),
};
