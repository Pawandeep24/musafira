import { useEffect, useState } from "react";
import { previewMetersPerSecond, retimePreview, startPreview, togglePreviewPause, type PreviewCamera, type RidePreview } from "@/state/ridePreview";

export function usePreview(routeId: string | undefined) {
  const [preview, setPreview] = useState<RidePreview>();
  const [speed, setSpeed] = useState(1);
  const [camera, setCamera] = useState<PreviewCamera>("street");

  useEffect(() => {
    if (preview && preview.routeId !== routeId) setPreview(undefined);
  }, [preview, routeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPreview(undefined);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  return {
    preview,
    speed,
    camera,
    start(id: string) {
      setSpeed(1);
      setPreview(startPreview(id, previewMetersPerSecond(camera, 1), performance.now()));
    },
    stop: () => setPreview(undefined),
    togglePause: () => setPreview((p) => p && togglePreviewPause(p, performance.now())),
    changeSpeed(multiplier: number) {
      setSpeed(multiplier);
      setPreview((p) => p && retimePreview(p, previewMetersPerSecond(camera, multiplier), performance.now()));
    },
    changeCamera(next: PreviewCamera) {
      setCamera(next);
      setPreview((p) => p && retimePreview(p, previewMetersPerSecond(next, speed), performance.now()));
    },
  };
}
