import { useState } from "react";
import { isNightHour } from "@/lib/format";

export type MapTheme = "day" | "night";

/** The map follows the ride hour; a manual switch holds until the ride hour crosses dusk or dawn. */
export function useMapTheme(rideHour: number) {
  const auto: MapTheme = isNightHour(rideHour) ? "night" : "day";
  const [pinned, setPinned] = useState<{ theme: MapTheme; over: MapTheme }>();
  if (pinned && pinned.over !== auto) setPinned(undefined);
  const theme = pinned?.over === auto ? pinned.theme : auto;
  return { theme, toggle: () => setPinned({ theme: theme === "day" ? "night" : "day", over: auto }) };
}
