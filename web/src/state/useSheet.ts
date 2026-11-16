/**
 * Height of the mobile bottom sheet. Three detents as shares of the viewport
 * height, with peek never below PEEK_MIN_PX so the trip summary and the action
 * bar both fit on short phones. Dragging the grip follows the finger; on release
 * the sheet snaps to the nearest detent, or to the next one in the direction of
 * a flick faster than FLICK_PX_PER_MS, the way native sheets behave. A tap (or
 * Enter) steps up peek → half → full, and from full back to half.
 *
 * While the finger moves, the height goes straight to `--sheet-drag` on the root
 * element instead of React state, so a drag doesn't re-render the whole app each
 * frame; CSS reads `var(--sheet-drag, var(--sheet-height))`. It is cleared on
 * release; React commits the snapped detent before the next frame, so the sheet
 * animates from the finger to the detent instead of jumping back first.
 */
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";

export type Detent = "peek" | "half" | "full";

const DETENT_SHARE: Record<Detent, number> = { peek: 0.3, half: 0.56, full: 0.9 };
const DETENTS: readonly Detent[] = ["peek", "half", "full"];
const PEEK_MIN_PX = 250;
const FLICK_PX_PER_MS = 0.45;
const TAP_SLOP_PX = 6;
const STALE_FLICK_MS = 120;

interface Drag {
  readonly startY: number;
  readonly startHeight: number;
  lastY: number;
  lastAt: number;
  velocity: number;
  moved: boolean;
}

const stepped = (detent: Detent): Detent => (detent === "full" ? "half" : DETENTS[DETENTS.indexOf(detent) + 1]!);

export function useSheet() {
  const [detent, setDetent] = useState<Detent>("half");
  const [viewport, setViewport] = useState(innerHeight);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => setViewport(innerHeight);
    addEventListener("resize", onResize);
    return () => removeEventListener("resize", onResize);
  }, []);

  const heightOf = (d: Detent) => Math.round(Math.max(d === "peek" ? PEEK_MIN_PX : 0, viewport * DETENT_SHARE[d]));
  const draggedTo = (d: Drag) => Math.min(heightOf("full"), Math.max(heightOf("peek") * 0.8, d.startHeight + d.startY - d.lastY));

  const settle = (d: Drag): Detent => {
    const height = draggedTo(d);
    if (d.velocity > FLICK_PX_PER_MS) return DETENTS.find((x) => heightOf(x) > height) ?? "full";
    if (d.velocity < -FLICK_PX_PER_MS) return [...DETENTS].reverse().find((x) => heightOf(x) < height) ?? "peek";
    return DETENTS.reduce((best, x) => (Math.abs(heightOf(x) - height) < Math.abs(heightOf(best) - height) ? x : best));
  };

  const release = () => {
    drag.current = undefined;
    rootRef.current?.style.removeProperty("--sheet-drag");
    setDragging(false);
  };

  const grip = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { startY: e.clientY, startHeight: heightOf(detent), lastY: e.clientY, lastAt: e.timeStamp, velocity: 0, moved: false };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d) return;
      if (e.timeStamp > d.lastAt) d.velocity = (d.lastY - e.clientY) / (e.timeStamp - d.lastAt);
      d.lastY = e.clientY;
      d.lastAt = e.timeStamp;
      if (!d.moved && Math.abs(e.clientY - d.startY) > TAP_SLOP_PX) {
        d.moved = true;
        setDragging(true);
      }
      if (d.moved) rootRef.current?.style.setProperty("--sheet-drag", `${draggedTo(d)}px`);
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      release();
      if (!d) return;
      if (e.timeStamp - d.lastAt > STALE_FLICK_MS) d.velocity = 0;
      setDetent(d.moved ? settle(d) : stepped(detent));
    },
    onPointerCancel: release,
    onClick(e: MouseEvent<HTMLElement>) {
      if (e.detail === 0) setDetent(stepped(detent));
    },
  };

  return { detent, height: heightOf(detent), dragging, setDetent, grip, rootRef };
}
