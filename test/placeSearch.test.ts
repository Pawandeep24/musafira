import { describe, expect, it } from "vitest";
import type { NamedPlace } from "../src/city/cityData.js";
import type { LngLat } from "../src/geo/geometry.js";
import { toNamedPlaces } from "../scripts/ingest/osmPlaces.js";
import type { OverpassElement } from "../scripts/ingest/osmPois.js";
import { testCity } from "./fixtures.js";

const place = (id: string, name: string, [lon, lat]: LngLat, kind: NamedPlace["kind"] = "residence", aka?: string[]): NamedPlace => ({
  id,
  name,
  lon,
  lat,
  kind,
  ...(aka ? { aka } : {}),
});

const city = testCity({
  places: [
    place("a1", "Kondhwa", [73.88, 18.47], "area"),
    place("a2", "Viman Nagar", [73.91, 18.567], "area"),
    place("r1", "Kumar Prithvi", [73.881, 18.471]),
    place("r2", "Kumar Shantiniketan Co-operative Housing Society Limited", [73.9, 18.5]),
    place("r3", "Lower Parijat Rohan Mithila 4", [73.913, 18.569]),
    place("r4", "Rohan Mithila", [73.912, 18.568]),
    place("r5", "Blue Ridge", [73.73, 18.58]),
    place("r6", "Nyati Elan", [73.95, 18.52]),
    place("r7", "Nyati Elan", [73.951, 18.5205]),
    place("r8", "Gera Greensville", [73.75, 18.6]),
    place("r9", "Gera Greensville", [73.95, 18.45]),
    place("l1", "Pune Railway Station", [73.874, 18.528], "landmark", ["पुणे रेल्वे स्टेशन"]),
    place("s1", "Gopal Hari Deshmukh Marg", [73.79, 18.555], "street", ["Baner Road"]),
  ],
  pois: [{ id: "p1", lon: 73.877, lat: 18.531, cat: "hospital", name: "Ruby Hall Clinic" }],
});
const names = (text: string, near?: LngLat) => city.places.search(text, near).map((p) => p.name);

describe("place search", () => {
  it("finds a housing society from a partial name, labelled with its area", () => {
    const [first] = city.places.search("kumar pri");
    expect(first).toMatchObject({ name: "Kumar Prithvi", label: "Kumar Prithvi, Kondhwa, Testville", kind: "residence" });
  });

  it("tolerates transliteration variants, typos and missing spaces", () => {
    expect(names("kumar pru")[0]).toBe("Kumar Prithvi");
    expect(names("kumar pruthvi")[0]).toBe("Kumar Prithvi");
    expect(names("kondva")[0]).toBe("Kondhwa");
    expect(names("rohn mithila")[0]).toBe("Rohan Mithila");
    expect(names("bluerid")[0]).toBe("Blue Ridge");
  });

  it("ranks the closest full-name match first", () => {
    expect(names("rohan mithila")).toEqual(["Rohan Mithila", "Lower Parijat Rohan Mithila 4"]);
  });

  it("merges one place mapped twice and prefers the copy near the rider", () => {
    expect(names("nyati elan")).toEqual(["Nyati Elan"]);
    expect(city.places.search("gera green", [73.95, 18.45])[0]?.point).toEqual([73.95, 18.45]);
    expect(city.places.search("gera green", [73.75, 18.6])[0]?.point).toEqual([73.75, 18.6]);
  });

  it("shows a place found by an alias under that alias, with its official name in the label", () => {
    expect(city.places.search("baner ro")[0]).toMatchObject({ name: "Baner Road", label: "Baner Road, Gopal Hari Deshmukh Marg, Testville" });
    expect(city.places.search("पुणे")[0]?.label).toContain("Pune Railway Station");
  });

  it("finds named POIs too", () => {
    expect(names("ruby hall")[0]).toBe("Ruby Hall Clinic");
  });

  it("returns nothing for unrelated text", () => {
    expect(names("zzqx")).toEqual([]);
  });
});

describe("OSM place ingest", () => {
  const element = (id: number, tags: Record<string, string>, lon: number, lat = 18.47): OverpassElement => ({
    type: "way",
    id,
    center: { lon, lat },
    tags,
  });

  it("keeps one entry per society and street, preferring English names", () => {
    const places = toNamedPlaces([
      element(1, { building: "apartments", name: "Kumar Prithvi" }, 73.8811),
      element(2, { landuse: "residential", name: "Kumar Prithvi" }, 73.881),
      element(3, { place: "suburb", name: "कोंढवा", "name:en": "Kondhwa" }, 73.88),
      element(4, { highway: "residential", name: "NIBM Road" }, 73.89),
      element(5, { highway: "residential", name: "NIBM Road" }, 73.9),
      element(6, { amenity: "school", name: "Delhi Public School", alt_name: "DPS;D.P.S." }, 73.87),
      element(7, { place: "neighbourhood", name: "Suyojan Society" }, 73.86),
      element(8, { place: "locality", name: "Nal Stop" }, 73.85),
    ]);
    expect(places.map((p) => [p.name, p.kind])).toEqual([
      ["Kondhwa", "area"],
      ["Kumar Prithvi", "residence"],
      ["Suyojan Society", "residence"],
      ["Delhi Public School", "landmark"],
      ["Nal Stop", "landmark"],
      ["NIBM Road", "street"],
    ]);
    expect(places[0]?.aka).toEqual(["कोंढवा"]);
    expect(places[3]?.aka).toEqual(["DPS", "D.P.S."]);
  });
});
