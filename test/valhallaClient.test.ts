import { describe, expect, it, vi } from "vitest";
import { ValhallaClient } from "../src/integrations/valhalla/client.js";
import { AppError } from "../src/lib/errors.js";
import { encodePolyline } from "./fixtures.js";

const shape = [
  [73.8, 18.52],
  [73.805, 18.52],
  [73.81, 18.52],
  [73.815, 18.52],
] as const;

const trip = {
  summary: { length: 1.58, time: 200 },
  legs: [
    {
      shape: encodePolyline(shape),
      maneuvers: [
        { time: 100, begin_shape_index: 0, end_shape_index: 2 },
        { time: 100, begin_shape_index: 2, end_shape_index: 3 },
        { time: 0, begin_shape_index: 3, end_shape_index: 3 },
      ],
    },
  ],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fakeValhalla() {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    if (String(url).endsWith("/route")) return json({ trip, alternates: [{ trip }] });
    return json({
      edges: [
        { length: 0.5, road_class: "primary", use: "road", tunnel: false },
        { length: 1.08, road_class: "residential", use: "alley", tunnel: true },
      ],
    });
  });
}

describe("Valhalla client", () => {
  it("turns route and trace responses into timed, classified candidates", async () => {
    const fetchImpl = fakeValhalla();
    const routes = await new ValhallaClient({ baseUrl: "https://valhalla.test/", fetchImpl }).routes([73.8, 18.52], [73.815, 18.52]);

    expect(routes).toHaveLength(2);
    const [route] = routes;
    expect(route!.distanceMeters).toBe(1580);
    [0, 50, 100, 200].forEach((seconds, i) => expect(route!.secondsAt[i]).toBeCloseTo(seconds, 6));
    expect(route!.roads.map((r) => [r.roadClass, r.tunnel])).toEqual([
      ["primary", false],
      ["alley", true],
    ]);
    expect(route!.roads.at(-1)!.endMeters).toBeCloseTo(1580);
    const body = JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string);
    expect(body).toMatchObject({ costing: "motor_scooter", alternates: 2 });
  });

  it("maps 'no route' to a 422 the rider can act on", async () => {
    const fetchImpl = vi.fn(async () => json({ error_code: 442, error: "No path could be found" }, 400));
    const client = new ValhallaClient({ baseUrl: "https://valhalla.test", fetchImpl });
    await expect(client.routes([73.8, 18.52], [73.9, 18.6])).rejects.toMatchObject({ statusCode: 422, code: "NO_ROUTE" });
    await expect(client.routes([73.8, 18.52], [73.9, 18.6])).rejects.toBeInstanceOf(AppError);
  });

  it("still returns routes when road attributes are unavailable", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/route") ? json({ trip }) : json({ error: "down" }, 503),
    );
    const [route] = await new ValhallaClient({ baseUrl: "https://valhalla.test", fetchImpl }).routes([73.8, 18.52], [73.815, 18.52]);
    expect(route!.roads).toEqual([]);
  });
});
