import type {
  AppConfig,
  CityLayers,
  Itinerary,
  LngLat,
  Place,
  Plan,
  Preferences,
  ReportCategory,
  ReportWhen,
  ScoringOptions,
  TripAnswers,
  Weights,
} from "./types";

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
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
}

async function request<T>(path: string, { method = "GET", body, token, signal }: RequestOptions = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
};
