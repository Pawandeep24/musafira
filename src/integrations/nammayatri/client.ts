/**
 * Namma Yatri rider API, the one Namma Yatri's own CLI, MCP server and agent skill use
 * (github.com/nammayatri/ny-connectors). Production base: https://api.moving.tech/pilot/app/v2.
 *
 * Sign-in: in the app, Profile → About Us → tap the version number shows a short numeric code
 * (rider-app `generate-temp-app-code`: valid 120 s, 3 per hour). `POST /auth/get-token` redeems
 * it for the rider's session token, sent as the `token` header on every other call.
 *
 * Booking: `POST /rideSearch` (origin, `stops`, destination; the response may carry the planned
 * route) → poll `GET /rideSearch/:id/results` (HTTP 400 until estimates are ready; once some
 * arrive, one more poll catches slower providers) → `POST /estimate/:id/select2` asks drivers,
 * the only step that contacts anyone → the booking appears in `GET /rideBooking/list` once a
 * driver accepts, and its ride in `GET /ride/:id/status` with the driver's position.
 * Cancelling a booking names its stage: OnSearch before a driver is assigned, OnAssign after.
 *
 * Errors come back as { errorCode, errorMessage }. Responses are parsed leniently per item so
 * one odd estimate or booking doesn't hide the rest.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { LngLat } from "../../geo/geometry.js";
import { AppError } from "../../lib/errors.js";
import { UpstreamError } from "../../lib/http.js";
import type {
  RideBookingInfo,
  RideDriver,
  RideEstimate,
  RideHailing,
  RidePlace,
  RideProgress,
  RideSearch,
  RideTrip,
} from "../../planner/ports.js";

const SERVICE = "Namma Yatri";
const SHARE_URL = "https://www.nammayatri.in/u?vp=shareRide&rideId=";

/** An error response from Namma Yatri; shown to riders only as "Namma Yatri is unavailable". */
export class NammaYatriApiError extends UpstreamError {
  constructor(
    status: number,
    readonly code: string | undefined,
    readonly tooManyAttempts: boolean,
  ) {
    super(SERVICE, status);
    this.name = "NammaYatriApiError";
  }
}

const errorBody = z.object({ errorCode: z.string().nullish(), errorMessage: z.string().nullish() });
const latLon = z.object({ lat: z.number(), lon: z.number() });
const signInResponse = z.object({ token: z.string().min(1).nullish() });
const searchResponse = z.object({
  searchId: z.string().min(1),
  routeInfo: z
    .object({ points: z.array(latLon).nullish(), distance: z.number().nullish(), duration: z.number().nullish() })
    .nullish(),
});
const estimateSchema = z.object({
  id: z.string().min(1),
  estimatedFare: z.number(),
  estimatedTotalFare: z.number().nullish(),
  serviceTierName: z.string().nullish(),
  vehicleVariant: z.string().nullish(),
  estimatedPickupDuration: z.number().nullish(),
  totalFareRange: z.object({ minFare: z.number(), maxFare: z.number() }).nullish(),
});
const rideSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  driverName: z.string().nullish(),
  vehicleNumber: z.string().nullish(),
  vehicleModel: z.string().nullish(),
  vehicleColor: z.string().nullish(),
  rideOtp: z.string().nullish(),
});
const bookingSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  createdAt: z.string(),
  driverName: z.string().nullish(),
  vehicleNumber: z.string().nullish(),
  rideList: z.array(z.unknown()).nullish(),
});
const listOf = z.object({ list: z.array(z.unknown()) });
const resultsResponse = z.object({ estimates: z.array(z.unknown()) });
const rideStatusResponse = z.object({ ride: rideSchema, driverPosition: latLon.nullish() });
const anyBody = z.unknown();

function parseEach<T>(items: readonly unknown[], schema: z.ZodType<T>): T[] {
  return items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

const toLngLat = ({ lat, lon }: { lat: number; lon: number }): LngLat => [lon, lat];

function location({ point: [lon, lat], name }: RidePlace, cityName: string) {
  return {
    gps: { lat, lon },
    address: { area: name ?? `${lat.toFixed(6)},${lon.toFixed(6)}`, city: cityName, country: "India", building: "", placeId: `${lat},${lon}`, state: "" },
  };
}

function driverOf(ride: z.infer<typeof rideSchema>): RideDriver {
  const vehicle = [ride.vehicleModel, ride.vehicleColor].filter(Boolean).join(" · ");
  return {
    ...(ride.driverName ? { name: ride.driverName } : {}),
    ...(ride.vehicleNumber ? { vehicleNumber: ride.vehicleNumber } : {}),
    ...(vehicle ? { vehicle } : {}),
    ...(ride.rideOtp ? { otp: ride.rideOtp } : {}),
  };
}

export interface NammaYatriOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly pollTimeoutMs?: number;
}

interface CallOptions {
  readonly method?: "GET" | "POST";
  readonly token?: string;
  readonly body?: unknown;
}

export class NammaYatriClient implements RideHailing {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #pollTimeoutMs: number;

  constructor({ baseUrl, fetchImpl = fetch, timeoutMs = 15_000, pollIntervalMs = 1500, pollTimeoutMs = 12_000 }: NammaYatriOptions) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
    this.#pollIntervalMs = pollIntervalMs;
    this.#pollTimeoutMs = pollTimeoutMs;
  }

  async signIn(code: string, mobileNumber?: string): Promise<string> {
    const body = { appSecretCode: code, ...(mobileNumber ? { userMobileNo: mobileNumber } : {}) };
    const response = await this.#call("/auth/get-token", signInResponse, { method: "POST", body }).catch(
      (error: unknown) => {
        if (error instanceof NammaYatriApiError && error.tooManyAttempts) {
          throw new AppError(429, "NY_CODE_LIMIT", "Namma Yatri allows 3 codes an hour. Try again later, or try the demo ride.");
        }
        if ((error instanceof NammaYatriApiError && error.code === "GET_USER_ID_ERROR") || (error instanceof AppError && error.statusCode === 401)) {
          throw invalidCode();
        }
        throw error;
      },
    );
    if (!response.token) throw invalidCode();
    return response.token;
  }

  async search(token: string, trip: RideTrip): Promise<RideSearch> {
    const response = await this.#call("/rideSearch", searchResponse, {
      method: "POST",
      token,
      body: {
        contents: {
          origin: location(trip.pickup, trip.cityName),
          destination: location(trip.drop, trip.cityName),
          ...(trip.stops.length > 0 ? { stops: trip.stops.map((stop) => location(stop, trip.cityName)) } : {}),
          placeNameSource: "API_MCP",
          platformType: "APPLICATION",
        },
        fareProductType: "ONE_WAY",
      },
    });
    const route = response.routeInfo;
    const points = route?.points?.map(toLngLat) ?? [];
    return {
      searchId: response.searchId,
      ...(points.length >= 2
        ? {
            route: {
              points,
              ...(route?.distance ? { distanceMeters: route.distance } : {}),
              ...(route?.duration ? { durationSeconds: route.duration } : {}),
            },
          }
        : {}),
    };
  }

  async estimates(token: string, searchId: string): Promise<RideEstimate[]> {
    const deadline = Date.now() + this.#pollTimeoutMs;
    let found: RideEstimate[] = [];
    for (;;) {
      const latest = await this.#results(token, searchId).catch((error: unknown) => {
        if (error instanceof NammaYatriApiError && error.status === 400) return [];
        throw error;
      });
      if (latest.length > found.length) found = latest;
      else if (found.length > 0) return found;
      if (Date.now() >= deadline) return found;
      await sleep(this.#pollIntervalMs);
    }
  }

  async select(token: string, estimateId: string): Promise<void> {
    await this.#call(`/estimate/${encodeURIComponent(estimateId)}/select2`, anyBody, {
      method: "POST",
      token,
      body: {
        autoAssignEnabled: true,
        autoAssignEnabledV2: true,
        paymentMethodId: "",
        otherSelectedEstimates: [],
        disabilityDisable: true,
        isPetRide: false,
      },
    });
  }

  async recentBookings(token: string): Promise<RideBookingInfo[]> {
    const { list } = await this.#call("/rideBooking/list?limit=5&onlyActive=false", listOf, { token });
    return parseEach(list, bookingSchema).flatMap((booking) => {
      const createdAt = new Date(booking.createdAt);
      if (Number.isNaN(createdAt.getTime())) return [];
      const [ride] = parseEach(booking.rideList ?? [], rideSchema);
      const driver = ride
        ? driverOf(ride)
        : {
            ...(booking.driverName ? { name: booking.driverName } : {}),
            ...(booking.vehicleNumber ? { vehicleNumber: booking.vehicleNumber } : {}),
          };
      return [
        {
          id: booking.id,
          status: booking.status,
          createdAt,
          ...(ride ? { rideId: ride.id, rideStatus: ride.status } : {}),
          ...(Object.keys(driver).length > 0 ? { driver } : {}),
        },
      ];
    });
  }

  async rideProgress(token: string, rideId: string): Promise<RideProgress> {
    const response = await this.#call(`/ride/${encodeURIComponent(rideId)}/status`, rideStatusResponse, { token });
    return {
      status: response.ride.status,
      driver: driverOf(response.ride),
      ...(response.driverPosition ? { position: toLngLat(response.driverPosition) } : {}),
    };
  }

  async cancelSearch(token: string, estimateId: string): Promise<void> {
    await this.#call(`/estimate/${encodeURIComponent(estimateId)}/cancelSearch`, anyBody, { method: "POST", token, body: {} });
  }

  async cancelBooking(token: string, bookingId: string, driverAssigned: boolean): Promise<void> {
    await this.#call(`/rideBooking/${encodeURIComponent(bookingId)}/cancel`, anyBody, {
      method: "POST",
      token,
      body: { reasonCode: "CHANGE_OF_MIND", reasonStage: driverAssigned ? "OnAssign" : "OnSearch", additionalInfo: "" },
    });
  }

  shareUrl(rideId: string): string {
    return `${SHARE_URL}${encodeURIComponent(rideId)}`;
  }

  async #results(token: string, searchId: string): Promise<RideEstimate[]> {
    const { estimates } = await this.#call(`/rideSearch/${encodeURIComponent(searchId)}/results`, resultsResponse, { token });
    return parseEach(estimates, estimateSchema).map((e) => ({
      id: e.id,
      tier: e.serviceTierName ?? e.vehicleVariant ?? "Ride",
      fare: e.estimatedTotalFare ?? e.estimatedFare,
      ...(e.totalFareRange ? { minFare: e.totalFareRange.minFare, maxFare: e.totalFareRange.maxFare } : {}),
      ...(e.estimatedPickupDuration != null ? { pickupSeconds: e.estimatedPickupDuration } : {}),
    }));
  }

  async #call<T>(path: string, schema: z.ZodType<T>, { method = "GET", token, body }: CallOptions): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token ? { token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch {
      throw new UpstreamError(SERVICE);
    }
    const json: unknown = await response.json().catch(() => undefined);
    if (response.status === 401) throw signedOut();
    if (!response.ok) {
      const error = errorBody.safeParse(json);
      const message = error.success ? (error.data.errorMessage ?? "") : "";
      throw new NammaYatriApiError(response.status, error.success ? (error.data.errorCode ?? undefined) : undefined, /too many attempts/i.test(message));
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new UpstreamError(SERVICE, response.status);
    return parsed.data;
  }
}

const invalidCode = () =>
  new AppError(
    401,
    "NY_CODE_INVALID",
    "Namma Yatri doesn't recognise that code. Codes expire after 2 minutes, so get a new one and enter it straight away.",
  );

const signedOut = () =>
  new AppError(401, "NY_SIGNED_OUT", "Your Namma Yatri sign-in has ended. Link your account again with a fresh code.");
