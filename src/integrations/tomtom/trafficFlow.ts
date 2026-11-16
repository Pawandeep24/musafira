import { z } from "zod";
import type { LngLat } from "#src/geo/geometry.js";
import { fetchJson } from "#src/lib/http.js";
import type { TrafficProvider, TrafficReading } from "#src/planner/ports.js";

const BASE_URL = "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json";

const flowResponse = z.object({
  flowSegmentData: z.object({
    currentSpeed: z.number(),
    freeFlowSpeed: z.number(),
    confidence: z.number(),
    roadClosure: z.boolean(),
  }),
});

/** TomTom Traffic Flow Segment Data v4: live speed of the road nearest a point. */
export class TomTomTrafficFlow implements TrafficProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async flowAt([lon, lat]: LngLat): Promise<TrafficReading | undefined> {
    const params = new URLSearchParams({ point: `${lat},${lon}`, unit: "KMPH", key: this.apiKey });
    const { flowSegmentData: flow } = await fetchJson(this.fetchImpl, "Traffic service", `${BASE_URL}?${params}`, flowResponse, {
      timeoutMs: 4000,
    });
    return {
      currentSpeedKmh: flow.currentSpeed,
      freeFlowSpeedKmh: flow.freeFlowSpeed,
      confidence: flow.confidence,
      roadClosure: flow.roadClosure,
    };
  }
}
