import { loadEnv } from "#src/config/env.js";
import { NammaYatriApiError, NammaYatriClient } from "#src/integrations/nammayatri/client.js";
import { AppError } from "#src/lib/errors.js";
import type { RideEstimate, RidePlace } from "#src/planner/ports.js";

const code = process.argv[2]?.trim() ?? "";
const mobileNumber = process.argv[3]?.replace(/[\s-]/g, "");
if (!/^\d{1,6}$/.test(code) || (mobileNumber !== undefined && !/^\+?\d{10,13}$/.test(mobileNumber))) {
  console.error("Usage: npm run smoke:nammayatri -- <code> [mobile number]");
  console.error("Get the code in Namma Yatri: Profile → About us → tap the version number. It works for 2 minutes.");
  process.exit(1);
}

const ny = new NammaYatriClient({ baseUrl: loadEnv().NAMMA_YATRI_API_URL });
const pickup: RidePlace = { point: [77.62339, 12.97562], name: "Halasuru Bazaar" };
const drop: RidePlace = { point: [77.64047, 12.97329], name: "Indiranagar" };
const checkpoint: RidePlace = { point: [77.62218, 12.9854], name: "Ulsoor Lake Park" };

const fares = (estimates: readonly RideEstimate[]) => (estimates.length ? estimates.map((e) => `${e.tier} ₹${e.fare}`).join(", ") : "none");

async function quote(token: string, label: string, stops: RidePlace[]) {
  const search = await ny.search(token, { pickup, stops, drop, cityName: "Bengaluru" });
  const route = search.route ? `${search.route.points.length} points, ${search.route.distanceMeters ?? "?"} m` : "no route";
  console.log(`${label}: search ok (${route})`);
  console.log(`${label}: fares ${fares(await ny.estimates(token, search.searchId))}`);
}

try {
  const token = await ny.signIn(code, mobileNumber);
  console.log(`Sign-in: ok${mobileNumber ? " (with mobile number)" : ""}`);
  await quote(token, "Direct", []);
  await quote(token, "Via checkpoint", [checkpoint]);
  const bookings = await ny.recentBookings(token);
  console.log(`Recent bookings: ${bookings.length} (${bookings.map((b) => b.status).join(", ") || "none"})`);
  console.log("OK. Nothing was booked.");
} catch (err) {
  if (err instanceof AppError) console.error(`FAILED: ${err.code} ${err.message}`);
  else if (err instanceof NammaYatriApiError) console.error(`FAILED: HTTP ${err.status ?? "?"} ${err.code ?? ""}`);
  else console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
}
