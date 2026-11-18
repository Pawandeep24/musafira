import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { gridDots, nightLightDot, signalDot, type GridDot } from "@/map/gridDots";

export interface Rasters {
  lights?: readonly GridDot[];
  signal?: readonly GridDot[];
}

export function useCityRasters(cityId: string | undefined): Rasters {
  const [rasters, setRasters] = useState<Rasters>({});

  useEffect(() => {
    if (!cityId) return;
    let cancelled = false;
    setRasters({});
    api
      .layers(cityId)
      .then((layers) => {
        if (cancelled) return;
        setRasters({
          ...(layers.lights ? { lights: gridDots(layers.lights, nightLightDot) } : {}),
          ...(layers.cellDensity ? { signal: gridDots(layers.cellDensity, signalDot) } : {}),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [cityId]);

  return rasters;
}
