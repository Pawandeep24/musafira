import { useState } from "react";

export type MapTheme = "day" | "night";

export function useMapTheme() {
  const [theme, setTheme] = useState<MapTheme>("night");
  return { theme, toggle: () => setTheme((current) => (current === "day" ? "night" : "day")) };
}
