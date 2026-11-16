import { useEffect, useMemo, useState } from "react";
import { api } from "./api/client";
import type { AppConfig, City, ItineraryLeg, LngLat, Place, ReportCategory, ReportWhen, Route, TripReport, Washroom } from "./api/types";
import { useAuth } from "./auth/useAuth";
import { AuthDialog, type AuthPurpose } from "./components/AuthDialog";
import { DepartureControl } from "./components/DepartureControl";
import { EmptyState, type DemoTrip } from "./components/EmptyState";
import { Icon } from "./components/Icon";
import { ItineraryView } from "./components/ItineraryView";
import { Attribution, Legend } from "./components/Legend";
import { ReportSheet } from "./components/ReportSheet";
import { RideHud } from "./components/RideHud";
import { RideSheet } from "./components/RideSheet";
import { RideAlert } from "./components/RideTracker";
import { RouteCards } from "./components/RouteCards";
import { RouteInsights } from "./components/RouteInsights";
import { SafetyDna } from "./components/SafetyDna";
import { Scanning } from "./components/Scanning";
import { StopOnboarding } from "./components/StopOnboarding";
import { TopBar } from "./components/TopBar";
import { TripInputs } from "./components/TripInputs";
import { TripPlanner } from "./components/TripPlanner";
import { WashroomSheet } from "./components/WashroomSheet";
import { skyRgb } from "./lib/colors";
import { cityHour, formatDuration, nextCityHour } from "./lib/format";
import { SOURCE_LABEL, washroomName } from "./lib/safeStops";
import { shareTrip } from "./lib/shareTrip";
import { useMediaQuery } from "./lib/useMediaQuery";
import { routeVerdict } from "./lib/verdict";
import { gridDots, nightLightDot, signalDot, type GridDot } from "./map/gridDots";
import { MapView, type Insets } from "./map/MapView";
import type { RideScene, TripScene } from "./map/sceneLayers";
import { PREVIEW_SECONDS, retimePreview, startPreview, type RidePreview } from "./state/ridePreview";
import { useItinerary } from "./state/useItinerary";
import { usePlanner } from "./state/usePlanner";
import { useReport } from "./state/useReport";
import { RIDE_POLL_MS, useRideBooking } from "./state/useRideBooking";
import { useSafetyProfile } from "./state/useSafetyProfile";
import { useStopOnboarding } from "./state/useStopOnboarding";
import { useWashrooms } from "./state/useWashrooms";

const DEMO_HOUR = 23;
const DEFAULT_CITY_ID = "pune";
const TOAST_MS = 4500;
const LIVE_RIDE_WINDOW_MS = 15 * 60_000;
const NO_REPORTS: readonly TripReport[] = [];
const NO_ROUTES: readonly Route[] = [];
const NO_CITIES: readonly City[] = [];

type Mode = "ride" | "trip";

interface Rasters {
  lights?: readonly GridDot[];
  signal?: readonly GridDot[];
}

async function placeAt(point: LngLat): Promise<Place> {
  const found = await api.reverse(point).catch(() => null);
  return { id: `pin:${point.join(",")}`, name: found?.name ?? "Dropped pin", label: found?.label ?? "Dropped pin", point };
}

/** A destination passed in the URL (`?to=lon,lat&name=`), as a Safe Stop page links to the planner. */
function linkedDestination(cities: readonly City[]): { cityId: string; place: Place } | undefined {
  const params = new URLSearchParams(location.search);
  const [lon, lat] = (params.get("to") ?? "").split(",").map(Number);
  if (lon === undefined || lat === undefined || !Number.isFinite(lon) || !Number.isFinite(lat)) return undefined;
  const city = cities.find(({ bbox }) => lon >= bbox.west && lon <= bbox.east && lat >= bbox.south && lat <= bbox.north);
  if (!city) return undefined;
  const name = params.get("name")?.slice(0, 60) || "Safe Stop";
  return { cityId: city.id, place: { id: `link:${lon},${lat}`, name, label: name, point: [lon, lat] } };
}

export function App() {
  const [config, setConfig] = useState<AppConfig>();
  const [loadError, setLoadError] = useState(false);
  const [cityId, setCityId] = useState<string>();
  const [rasters, setRasters] = useState<Rasters>({});
  const [showLights, setShowLights] = useState(true);
  const [showSignal, setShowSignal] = useState(false);
  const [dnaOpen, setDnaOpen] = useState(false);
  const [authPurpose, setAuthPurpose] = useState<AuthPurpose>();
  const [preview, setPreview] = useState<RidePreview>();
  const [speed, setSpeed] = useState(1);
  const [toast, setToast] = useState<string>();
  const [mode, setMode] = useState<Mode>("ride");
  const mobile = useMediaQuery("(max-width: 760px)");

  const auth = useAuth();
  const safety = useSafetyProfile(config?.defaults, auth);
  const planner = usePlanner(safety.profile && { weights: safety.profile.weights, options: safety.profile.options });
  const report = useReport(auth);
  const trip = useItinerary();
  const rides = useRideBooking();
  const washrooms = useWashrooms();
  const listing = useStopOnboarding(auth, config?.cities ?? NO_CITIES);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    api
      .config()
      .then((c) => {
        setConfig(c);
        const linked = linkedDestination(c.cities);
        if (linked) {
          planner.setTo(linked.place);
          history.replaceState(null, "", location.pathname);
        }
        setCityId((id) => id ?? linked?.cityId ?? (c.cities.find((city) => city.id === DEFAULT_CITY_ID) ?? c.cities[0])?.id);
      })
      .catch(() => setLoadError(true));
  }, []);

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

  const city = config?.cities.find((c) => c.id === cityId);
  const offset = city?.utcOffsetMinutes ?? 330;
  const tripMode = mode === "trip";
  const routes = (!tripMode && planner.plan?.routes) || NO_ROUTES;
  const tripDay = trip.itinerary?.days[trip.dayIndex];
  const tripScene = useMemo<TripScene | undefined>(
    () => (tripMode && trip.itinerary && tripDay ? { base: trip.itinerary.base.point, stops: tripDay.stops, legs: tripDay.legs } : undefined),
    [tripMode, trip.itinerary, tripDay],
  );
  const selected = routes.find((r) => r.id === planner.selectedId);
  const verdict = useMemo(() => (config ? routeVerdict(routes, config.parameters) : null), [routes, config]);

  useEffect(() => {
    if (preview && preview.routeId !== selected?.id) setPreview(undefined);
  }, [preview, selected?.id]);

  useEffect(() => {
    if (!rides.active) rides.close();
  }, [planner.plan?.searchId, planner.selectedId]);

  const rideScene = useMemo<RideScene | undefined>(() => {
    const { ride, quote, selectedOption } = rides;
    if (rides.step === "ride" && ride) {
      return {
        key: `ride:${ride.ref}`,
        path: ride.route,
        checkpoints: ride.checkpoints.map((c) => c.point),
        ...(ride.position ? { driver: ride.position } : {}),
        offRoute: Boolean(ride.guard?.offRoute),
        tweenMs: RIDE_POLL_MS[ride.mode],
      };
    }
    if (!rides.open || rides.step !== "compare" || !quote || !selectedOption) return undefined;
    const other = quote.options.find((o) => o.kind !== selectedOption.kind);
    return {
      key: `quote:${quote.quoteId}:${selectedOption.kind}`,
      path: selectedOption.path,
      ...(other ? { alternative: other.path } : {}),
      checkpoints: selectedOption.kind === "safe" ? quote.checkpoints.map((c) => c.point) : [],
      offRoute: false,
      tweenMs: RIDE_POLL_MS.demo,
    };
  }, [rides.open, rides.step, rides.ride, rides.quote, rides.selectedOption]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPreview(undefined);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const closeSheets = () => {
    washrooms.close();
    listing.close();
  };

  const routeMeters = selected?.segments.at(-1)?.endMeters ?? 0;
  const beginPreview = () => {
    if (!selected) return;
    setSpeed(1);
    setDnaOpen(false);
    report.close();
    closeSheets();
    if (!rides.active) rides.close();
    setPreview(startPreview(selected.id, routeMeters, performance.now()));
  };

  const openRide = () => {
    if (!selected || !planner.plan || !safety.profile) return;
    setDnaOpen(false);
    report.close();
    closeSheets();
    setPreview(undefined);
    rides.start(
      { searchId: planner.plan.searchId, routeId: selected.id, weights: safety.profile.weights, options: safety.profile.options },
      Boolean(city?.rides.live),
    );
  };

  const shareRide = async () => {
    if (!rides.ride) return;
    const result = await shareTrip(rides.ride);
    if (result === "copied") setToast("Trip link copied. Send it to someone you trust.");
    if (result === "failed") setToast("Couldn't share from this browser. Call 112 if you need help.");
  };

  const openReport = () => {
    setDnaOpen(false);
    setPreview(undefined);
    closeSheets();
    report.start();
  };
  const toggleReport = () => {
    if (report.open) report.close();
    else if (auth.user) openReport();
    else setAuthPurpose("report");
  };
  const toggleDna = () => {
    report.close();
    closeSheets();
    setDnaOpen((v) => !v);
  };
  const toggleWashrooms = () => {
    if (washrooms.open) return washrooms.close();
    setDnaOpen(false);
    setPreview(undefined);
    report.close();
    listing.close();
    washrooms.start();
  };
  const openListing = () => {
    setDnaOpen(false);
    setPreview(undefined);
    report.close();
    washrooms.close();
    void listing.start();
  };
  const startListing = () => (auth.user ? openListing() : setAuthPurpose("listing"));

  const rideToWashroom = (washroom: Washroom) => {
    const from = washrooms.point;
    if (!from) return;
    const washroomCity = washrooms.result?.cityId;
    washrooms.close();
    setPreview(undefined);
    setMode("ride");
    if (washroomCity && washroomCity !== cityId) setCityId(washroomCity);
    planner.search({
      from: { id: `pin:${from.join(",")}`, name: "Where you searched", label: "Where you searched", point: from },
      to: { id: `washroom:${washroom.id}`, name: washroomName(washroom), label: SOURCE_LABEL[washroom.source], point: washroom.point },
      departure: { mode: "now" },
    });
  };
  const sendReport = async (category: ReportCategory, when: ReportWhen) => {
    if (!(await report.send(category, when))) return;
    setToast("Thanks. Routes through that spot now reflect your report.");
    if (planner.plan && !planner.stale) planner.search();
  };
  const changeSpeed = (multiplier: number) => {
    setSpeed(multiplier);
    setPreview((p) => p && retimePreview(p, (routeMeters / PREVIEW_SECONDS) * multiplier, performance.now()));
  };

  const switchCity = (id: string) => {
    if (id === cityId) return;
    setPreview(undefined);
    planner.clear();
    trip.clear();
    setCityId(id);
  };

  const switchMode = (next: Mode) => {
    setPreview(undefined);
    report.close();
    setMode(next);
  };

  const checkLeg = (leg: ItineraryLeg, fromName: string, toName: string) => {
    const place = (name: string, point: LngLat): Place => ({ id: `trip:${point.join(",")}`, name, label: name, point });
    switchMode("ride");
    planner.search({ from: place(fromName, leg.from), to: place(toName, leg.to), departure: { mode: "at", at: new Date(leg.departAt) } });
  };

  const runDemo = (trip: DemoTrip) => {
    planner.search({ from: trip.from, to: trip.to, departure: { mode: "at", at: nextCityHour(DEMO_HOUR, new Date(), offset) } });
  };

  const pickPoint = async (point: LngLat) => {
    if (preview) return;
    const place = await placeAt(point);
    if (tripMode) trip.setBase(place);
    else if (!planner.from) planner.setFrom(place);
    else planner.setTo(place);
  };

  const sheetOpen = (washrooms.open || listing.open) && !preview;
  const rideSheetOpen = rides.open && !dnaOpen && !report.open && !sheetOpen && !preview;
  const tapPoint = report.open ? report.mark : washrooms.open ? washrooms.mark : listing.open && listing.step === "place" ? listing.mark : undefined;
  const markedPoint = report.open ? report.point : washrooms.open ? washrooms.point : listing.open ? listing.draft.point : undefined;
  const rideable = Boolean(city && (city.rides.live || city.rides.demo));
  const planDepartsNow = planner.plan ? Math.abs(new Date(planner.plan.departAt).getTime() - Date.now()) <= LIVE_RIDE_WINDOW_MS : false;
  const liveOffered = Boolean(city?.rides.live);
  const liveBlocker = liveOffered && !planDepartsNow ? "Live rides leave now. Set departure to Now and update routes to book one." : undefined;

  const insets: Insets = mobile
    ? { top: 110, right: 30, bottom: Math.round(innerHeight * (rideSheetOpen || sheetOpen ? 0.64 : 0.54)), left: 30 }
    : { top: 120, right: dnaOpen || report.open || rideSheetOpen || sheetOpen ? 460 : 120, bottom: 120, left: 500 };

  const skyHour = planner.departure.mode === "at" ? cityHour(planner.departure.at, offset) : cityHour(new Date(), offset);
  const [r, g, b] = skyRgb(skyHour);
  const planning = planner.status === "planning";
  const busy = tripMode ? trip.status === "planning" : planning || planner.status === "rescoring";
  const outdated = planner.stale || planning;

  if (loadError) {
    return (
      <div className="fatal">
        <Icon name="alert" size={28} />
        <h1>Musafira can't reach its server</h1>
        <p>Start the API with `npm run dev` and reload this page.</p>
      </div>
    );
  }

  return (
    <div
      className={`app ${preview ? "is-previewing" : ""} ${dnaOpen ? "has-dna" : ""} ${report.open ? "is-reporting" : ""} ${rideSheetOpen ? "is-booking" : ""} ${sheetOpen ? "has-sheet" : ""} ${tapPoint ? "is-picking" : ""}`}
    >
      <MapView
        {...(city ? { city } : {})}
        routes={routes}
        reports={(!tripMode && planner.plan?.reports) || NO_REPORTS}
        {...(tripScene ? { trip: tripScene } : {})}
        {...(rideScene ? { ride: rideScene } : {})}
        {...(!tripMode && planner.plan ? { searchId: planner.plan.searchId } : {})}
        {...(!tripMode && planner.selectedId ? { selectedId: planner.selectedId } : {})}
        {...(tripMode ? (!tripScene && trip.base ? { from: trip.base.point } : {}) : planner.from ? { from: planner.from.point } : {})}
        {...(!tripMode && planner.to ? { to: planner.to.point } : {})}
        {...(markedPoint ? { markedPoint } : {})}
        {...(washrooms.open ? { washrooms: washrooms.shown } : {})}
        {...(showLights && rasters.lights ? { lights: rasters.lights } : {})}
        {...(showSignal && rasters.signal ? { signal: rasters.signal } : {})}
        {...(preview ? { preview } : {})}
        insets={insets}
        onSelectRoute={(id) => !tapPoint && planner.setSelectedId(id)}
        onPickPoint={pickPoint}
        {...(tapPoint ? { onTapPoint: tapPoint } : {})}
        onPreviewEnd={() => setPreview(undefined)}
      />
      <div className="sky-tint" style={{ background: `radial-gradient(120% 60% at 50% 0%, rgba(${r},${g},${b},0.22), transparent 70%)` }} />

      {config && (
        <TopBar
          cities={config.cities}
          {...(cityId ? { cityId } : {})}
          showLights={showLights}
          showSignal={showSignal}
          dnaOpen={dnaOpen}
          reporting={report.open}
          washrooms={washrooms.open}
          auth={auth}
          onCity={switchCity}
          onToggleLights={() => setShowLights((v) => !v)}
          onToggleSignal={() => setShowSignal((v) => !v)}
          onToggleDna={toggleDna}
          onToggleReport={toggleReport}
          onToggleWashrooms={toggleWashrooms}
          onSignIn={() => setAuthPurpose("sync")}
        />
      )}

      {config && city && (
        <aside className={`panel glass ${busy ? "is-busy" : ""}`}>
          <div className="panel__progress" />
          <div className="segmented mode-switch" role="tablist" aria-label="Mode">
            <button role="tab" aria-selected={!tripMode} className={tripMode ? "" : "is-on"} onClick={() => switchMode("ride")}>
              <Icon name="route" size={14} /> Ride
            </button>
            <button role="tab" aria-selected={tripMode} className={tripMode ? "is-on" : ""} onClick={() => switchMode("trip")}>
              <Icon name="sparkle" size={14} /> Day trip
            </button>
          </div>

          {tripMode && (
            <>
              {trip.itinerary ? (
                <ItineraryView itinerary={trip.itinerary} dayIndex={trip.dayIndex} onDay={trip.setDayIndex} onEdit={trip.edit} onCheckRoute={checkLeg} />
              ) : (
                <TripPlanner
                  cityId={city.id}
                  {...(trip.base ? { base: trip.base } : {})}
                  answers={trip.answers}
                  planning={trip.status === "planning"}
                  onBase={trip.setBase}
                  onAnswer={trip.answer}
                  onPlan={trip.plan}
                />
              )}
              {trip.error && (
                <div className="notice notice--error">
                  <Icon name="alert" size={15} /> {trip.error}
                </div>
              )}
            </>
          )}

          {!tripMode && (
            <>
              <TripInputs cityId={city.id} from={planner.from} to={planner.to} onFrom={planner.setFrom} onTo={planner.setTo} onSwap={planner.swap} />
              <DepartureControl departure={planner.departure} utcOffsetMinutes={offset} onChange={planner.setDeparture} />

              {(!planner.plan || outdated) && (
                <button
                  className="button button--primary button--wide"
                  onClick={() => planner.search()}
                  disabled={!planner.from || !planner.to || planning}
                  aria-busy={planning}
                >
                  <Icon name="search" size={16} /> {planning ? "Finding routes…" : planner.plan ? "Update routes" : "Find safe routes"}
                </button>
              )}

              {planner.error && (
                <div className="notice notice--error">
                  <Icon name="alert" size={15} /> {planner.error}
                </div>
              )}

              {!planner.plan && planner.status === "planning" && <Scanning />}
              {!planner.plan && planner.status !== "planning" && <EmptyState cityId={city.id} onDemo={runDemo} />}

              {planner.plan && (
                <div className={`results ${outdated ? "is-stale" : ""}`}>
                  {verdict && (
                    <p className="verdict">
                      <Icon name="sparkle" size={15} /> {verdict}
                    </p>
                  )}
                  <RouteCards
                    routes={routes}
                    {...(planner.selectedId ? { selectedId: planner.selectedId } : {})}
                    utcOffsetMinutes={offset}
                    onSelect={planner.setSelectedId}
                  />
                  {selected && safety.profile && (
                    <RouteInsights route={selected} parameters={config.parameters} weights={safety.profile.weights} city={city} />
                  )}
                </div>
              )}

              {selected && !outdated && (
                <div className={`panel__footer ${rideable ? "panel__footer--split" : ""}`}>
                  <button className={`button ${rideable ? "button--secondary" : "button--primary button--wide"}`} onClick={beginPreview}>
                    <Icon name="play" size={15} /> {rideable ? "Preview" : "Preview the ride"}
                    <span className="button__meta">{formatDuration(selected.durationSeconds)}</span>
                  </button>
                  {rideable && (
                    <button className="button button--primary" onClick={openRide} aria-expanded={rides.open}>
                      <Icon name="auto" size={16} /> Book this route
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </aside>
      )}

      {config && safety.profile && dnaOpen && (
        <aside className="dna-panel glass">
          <button className="icon-button dna-panel__close" onClick={() => setDnaOpen(false)} aria-label="Close safety DNA">
            <Icon name="close" size={16} />
          </button>
          <SafetyDna
            parameters={config.parameters}
            presets={config.presets}
            maxWeight={config.maxWeight}
            profile={safety.profile}
            sync={safety.sync}
            signedIn={Boolean(auth.user)}
            onWeight={safety.setWeight}
            onOption={safety.setOption}
            onPreset={safety.applyPreset}
          />
          {auth.available && (
            <div className="dna-panel__account">
              {auth.user ? (
                <>
                  <span>Signed in as {auth.user.email ?? auth.user.displayName}</span>
                  <button className="link-button" onClick={() => void auth.signOut()}>
                    Sign out
                  </button>
                </>
              ) : (
                <button className="link-button" onClick={() => setAuthPurpose("sync")}>
                  Sign in to keep these on every device
                </button>
              )}
            </div>
          )}
        </aside>
      )}

      {report.open && !preview && (
        <ReportSheet
          {...(report.point ? { point: report.point } : {})}
          locating={report.locating}
          sending={report.sending}
          {...(report.error ? { error: report.error } : {})}
          onUseLocation={report.locate}
          onSubmit={(category, when) => void sendReport(category, when)}
          onClose={report.close}
        />
      )}

      {washrooms.open && !preview && (
        <WashroomSheet washrooms={washrooms} utcOffsetMinutes={offset} onGo={rideToWashroom} {...(auth.available ? { onListShop: startListing } : {})} />
      )}

      {listing.open && !preview && <StopOnboarding onboarding={listing} />}

      {rideSheetOpen && city && (
        <RideSheet
          booking={rides}
          cityName={city.name}
          liveOffered={liveOffered}
          {...(liveBlocker ? { liveBlocker } : {})}
          utcOffsetMinutes={offset}
          onShare={() => void shareRide()}
        />
      )}

      {rides.alertVisible && rides.ride && <RideAlert ride={rides.ride} onDismiss={rides.dismissAlert} onShare={() => void shareRide()} />}

      {preview && selected && (
        <RideHud route={selected} preview={preview} utcOffsetMinutes={offset} speed={speed} onSpeed={changeSpeed} onExit={() => setPreview(undefined)} />
      )}

      <div className="bottom-bar">
        <Legend showRoute={Boolean(selected)} showLights={showLights && Boolean(rasters.lights)} showSignal={showSignal && Boolean(rasters.signal)} />
        <Attribution {...(city ? { city } : {})} />
      </div>

      {toast && (
        <div className="toast glass" role="status">
          <Icon name="flag" size={15} /> {toast}
        </div>
      )}

      {authPurpose && (
        <AuthDialog
          auth={auth}
          purpose={authPurpose}
          {...(authPurpose === "report" ? { onSignedIn: openReport } : authPurpose === "listing" ? { onSignedIn: openListing } : {})}
          onClose={() => setAuthPurpose(undefined)}
        />
      )}
    </div>
  );
}
