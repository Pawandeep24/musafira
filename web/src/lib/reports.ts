import type { ReportCategory, ReportWhen } from "@/api/types";
import type { IconName } from "@/components/Icon";
import { cityTime } from "@/lib/format";

export type ReportTone = "ok" | "warn" | "risk";

export const REPORT_META: Record<ReportCategory, { label: string; icon: IconName; tone: ReportTone }> = {
  poorlyLit: { label: "Poorly lit", icon: "lighting", tone: "warn" },
  deserted: { label: "Deserted", icon: "crowd", tone: "warn" },
  harassment: { label: "Harassment", icon: "alert", tone: "risk" },
  loitering: { label: "People loitering", icon: "eye", tone: "risk" },
  badRoad: { label: "Bad road", icon: "roadType", tone: "warn" },
  waterlogged: { label: "Waterlogged", icon: "droplet", tone: "warn" },
  noSignal: { label: "No signal", icon: "wifiOff", tone: "warn" },
  wellLit: { label: "Well lit", icon: "lighting", tone: "ok" },
  busy: { label: "People around", icon: "crowd", tone: "ok" },
  policeNearby: { label: "Police nearby", icon: "shield", tone: "ok" },
};

export const REPORT_WHEN: readonly { id: ReportWhen; label: string }[] = [
  { id: "now", label: "Just now" },
  { id: "morning", label: "This morning" },
  { id: "afternoon", label: "This afternoon" },
  { id: "evening", label: "This evening" },
  { id: "night", label: "At night" },
];

export const TONE_RGB: Record<ReportTone, readonly [number, number, number]> = {
  ok: [46, 242, 200],
  warn: [255, 196, 87],
  risk: [255, 61, 110],
};

export function reportAge(observedAt: string, now: Date, utcOffsetMinutes: number): string {
  const day = (d: Date | string) => Math.floor(cityTime(d, utcOffsetMinutes).getTime() / 86_400_000);
  const days = day(now) - day(observedAt);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

export const reportSummary = (count: number, category: ReportCategory) =>
  `${count > 1 ? `${count} riders` : "A rider"} reported: ${REPORT_META[category].label.toLowerCase()}`;
