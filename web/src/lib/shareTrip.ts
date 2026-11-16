import type { Ride } from "@/api/types";

export type ShareResult = "shared" | "copied" | "failed";

/** Shares Namma Yatri's live tracking link, or for a demo ride a map pin of the driver's position. */
export async function shareTrip(ride: Ride): Promise<ShareResult> {
  const url = ride.shareUrl ?? (ride.position ? `https://maps.google.com/?q=${ride.position[1]},${ride.position[0]}` : undefined);
  const text = `I'm on an auto ride${ride.area ? ` near ${ride.area}` : ""}${ride.driver?.vehicleNumber ? ` (${ride.driver.vehicleNumber})` : ""}, tracked by Musafira.`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "My live ride", text, ...(url ? { url } : {}) });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "shared";
    }
  }
  try {
    await navigator.clipboard.writeText(url ? `${text} ${url}` : text);
    return "copied";
  } catch {
    return "failed";
  }
}
