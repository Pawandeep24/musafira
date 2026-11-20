import { useEffect, useMemo, useState, type CSSProperties, type FocusEvent, type ReactNode } from "react";
import { api } from "@/api/client";
import type {
  AppConfig,
  AssistantPlace,
  AssistantRoute,
  City,
  ItineraryLeg,
  LngLat,
  Place,
  ReportCategory,
  ReportWhen,
  Route,
  TripReport,
  Washroom,
} from "@/api/types";
import { useAuth } from "@/auth/useAuth";
import { AssistantSheet } from "@/components/AssistantSheet";
import { AuthDialog, type AuthPurpose } from "@/components/AuthDialog";
import { ContactDialog } from "@/components/ContactDialog";
import { DepartureControl } from "@/components/DepartureControl";
import { EmptyState, type DemoTrip } from "@/components/EmptyState";
import { Icon } from "@/components/Icon";
import { ItineraryView } from "@/components/ItineraryView";
import { Attribution, Legend } from "@/components/Legend";
import { ReportSheet } from "@/components/ReportSheet";
import { RideHud } from "@/components/RideHud";
import { RideSheet } from "@/components/RideSheet";
import { RideAlert } from "@/components/RideTracker";
import { RouteCards } from "@/components/RouteCards";
import { RouteInsights } from "@/components/RouteInsights";
import { SafetyDna } from "@/components/SafetyDna";
import { Scanning } from "@/components/Scanning";
import { StopOnboarding } from "@/components/StopOnboarding";
import { TopBar } from "@/components/TopBar";
import { TripInputs } from "@/components/TripInputs";
import { TripPlanner } from "@/components/TripPlanner";
import { TripSummary } from "@/components/TripSummary";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { LinkButton } from "@/components/ui/LinkButton";
import { Notice } from "@/components/ui/Notice";
import { Segmented } from "@/components/ui/Segmented";
import { WashroomSheet } from "@/components/WashroomSheet";
import { skyRgb } from "@/lib/colors";
import { cityHour, formatDuration, nextCityHour } from "@/lib/format";
import { SOURCE_LABEL, washroomName } from "@/lib/safeStops";
import { shareTrip } from "@/lib/shareTrip";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { routeVerdict } from "@/lib/verdict";
import { MapView, type Insets } from "@/map/MapView";
import { rideSceneOf } from "@/map/rideScene";
import type { TripScene } from "@/map/sceneLayers";
import { useAssistant } from "@/state/useAssistant";
import { useCityRasters } from "@/state/useCityRasters";
import { useContact } from "@/state/useContact";
import { useItinerary } from "@/state/useItinerary";
import { useMapTheme } from "@/state/useMapTheme";
import { usePlanner } from "@/state/usePlanner";
import { usePreview } from "@/state/usePreview";
import { useReport } from "@/state/useReport";
import { useRideBooking } from "@/state/useRideBooking";
import { useSafetyProfile } from "@/state/useSafetyProfile";
import { useSheet } from "@/state/useSheet";
import { useStopOnboarding } from "@/state/useStopOnboarding";
import { useWashrooms } from "@/state/useWashrooms";

const DEMO_HOUR = 23;
const DEFAULT_CITY_ID = "pune";
const TOAST_MS = 4500;
const LIVE_RIDE_WINDOW_MS = 15 * 60_000;
const NO_REPORTS: readonly TripReport[] = [];
const NO_ROUTES: readonly Route[] = [];
const NO_CITIES: readonly City[] = [];

type Mode = "ride" | "trip";

const MODES: readonly (readonly [Mode, ReactNode])[] = [
  [
    "ride",
    <>
      <Icon name="route" size={14} /> Ride
    </>,
  ],
  [
    "trip",
    <>
      <Icon name="sparkle" size={14} /> Day trip
    </>,
  ],
];

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
  const [showLights, setShowLights] = useState(true);
  const [showSignal, setShowSignal] = useState(false);
  const [dnaOpen, setDnaOpen] = useState(false);
  const [authPurpose, setAuthPurpose] = useState<AuthPurpose>();
  const [toast, setToast] = useState<string>();
  const [mode, setMode] = useState<Mode>("ride");
  const [editingTrip, setEditingTrip] = useState(false);
  const mobile = useMediaQuery("(max-width: 760px)");
  const roomyTopBar = useMediaQuery("(min-width: 1401px)");
  const sheet = useSheet();

  const auth = useAuth();
  const safety = useSafetyProfile(config?.defaults, auth);
  const planner = usePlanner(safety.profile && { weights: safety.profile.weights, options: safety.profile.options });
  const report = useReport(auth);
  const trip = useItinerary();
  const rides = useRideBooking();
  const washrooms = useWashrooms();
  const listing = useStopOnboarding(auth, config?.cities ?? NO_CITIES);
  const contact = useContact();
  const assistant = useAssistant(cityId);
  const contactLink = config?.contactEmail ? { onContact: contact.start } : {};

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

  const rasters = useCityRasters(cityId);

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
  const previewer = usePreview(selected?.id);
  const { preview, speed, camera } = previewer;

  useEffect(() => {
    if (!rides.active) rides.close();
  }, [planner.plan?.searchId, planner.selectedId]);

  const rideScene = useMemo(() => rideSceneOf(rides), [rides.open, rides.step, rides.ride, rides.quote, rides.selectedOption]);

  const closePanels = (keep?: "report" | "washrooms" | "listing" | "assistant") => {
    setDnaOpen(false);
    previewer.stop();
    if (keep !== "report") report.close();
    if (keep !== "washrooms") washrooms.close();
    if (keep !== "listing") listing.close();
    if (keep !== "assistant") assistant.close();
  };

  const beginPreview = () => {
    if (!selected) return;
    closePanels();
    if (!rides.active) rides.close();
    previewer.start(selected.id);
  };

  const openRide = () => {
    if (!selected || !planner.plan || !safety.profile) return;
    closePanels();
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
    closePanels("report");
    report.start();
  };
  const toggleReport = () => {
    if (report.open) report.close();
    else if (auth.user) openReport();
    else setAuthPurpose("report");
  };
  const toggleDna = () => {
    report.close();
    washrooms.close();
    listing.close();
    assistant.close();
    setDnaOpen((v) => !v);
  };
  const toggleWashrooms = () => {
    if (washrooms.open) return washrooms.close();
    closePanels("washrooms");
    washrooms.start();
  };
  const openListing = () => {
    closePanels("listing");
    void listing.start();
  };
  const startListing = () => (auth.user ? openListing() : setAuthPurpose("listing"));
  const toggleListing = () => (listing.open ? listing.close() : startListing());
  const toggleAssistant = () => {
    if (assistant.open) return assistant.close();
    closePanels("assistant");
    assistant.start();
  };

  const showAssistantRoute = (route: AssistantRoute) => {
    const place = ({ name, point }: AssistantPlace): Place => ({ id: `ask:${point.join(",")}`, name, label: name, point });
    assistant.close();
    previewer.stop();
    setMode("ride");
    planner.search({ from: place(route.from), to: place(route.to), departure: { mode: "at", at: new Date(route.departAt) } });
  };

  const rideToWashroom = (washroom: Washroom) => {
    const from = washrooms.point;
    if (!from) return;
    const washroomCity = washrooms.result?.cityId;
    washrooms.close();
    previewer.stop();
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

  const switchCity = (id: string) => {
    if (id === cityId) return;
    previewer.stop();
    planner.clear();
    trip.clear();
    setCityId(id);
  };

  const switchMode = (next: Mode) => {
    previewer.stop();
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

  const sheetOpen = (washrooms.open || listing.open || assistant.open) && !preview;
  const rideSheetOpen = rides.open && !dnaOpen && !report.open && !sheetOpen && !preview;
  const tapPoint = report.open ? report.mark : washrooms.open ? washrooms.mark : listing.open && listing.step === "place" ? listing.mark : undefined;
  const markedPoint = report.open
    ? report.point
    : washrooms.open
      ? washrooms.point
      : listing.open
        ? listing.draft.point
        : assistant.open
          ? assistant.focused?.point
          : undefined;
  const rideable = Boolean(city && (city.rides.live || city.rides.demo));
  const planDepartsNow = planner.plan ? Math.abs(new Date(planner.plan.departAt).getTime() - Date.now()) <= LIVE_RIDE_WINDOW_MS : false;
  const liveOffered = Boolean(city?.rides.live);
  const liveBlocker = liveOffered && !planDepartsNow ? "Live rides leave now. Set departure to Now and update routes to book one." : undefined;

  const activeSheet =
    !mobile || preview
      ? undefined
      : dnaOpen
        ? "dna"
        : report.open
          ? "report"
          : washrooms.open
            ? "washrooms"
            : listing.open
              ? "listing"
              : assistant.open
                ? "assistant"
                : rideSheetOpen
                  ? "ride"
                  : config && city
                    ? "planner"
                    : undefined;
  const sheetKey = `${activeSheet}:${planner.plan?.searchId}`;
  const [shownSheetKey, setShownSheetKey] = useState(sheetKey);
  if (sheetKey !== shownSheetKey) {
    setShownSheetKey(sheetKey);
    setEditingTrip(false);
    sheet.setDetent(activeSheet === "dna" ? "full" : "half");
  }
  const foldedTrip =
    mobile && planner.plan && !planner.stale && !editingTrip && planner.from && planner.to ? { from: planner.from, to: planner.to } : undefined;
  const expandForTyping = (e: FocusEvent) => {
    const typing = e.target instanceof Element && e.target.matches("input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea");
    if (activeSheet && typing && e.target.closest(".panel, .dna-panel, .report-panel, .side-sheet, .ride-panel")) sheet.setDetent("full");
  };

  const insets: Insets = mobile
    ? { top: 80, right: 64, bottom: sheet.height + 12, left: 20 }
    : { top: 120, right: dnaOpen || report.open || rideSheetOpen || sheetOpen ? 460 : 120, bottom: 120, left: 500 };

  const skyHour = planner.departure.mode === "at" ? cityHour(planner.departure.at, offset) : cityHour(new Date(), offset);
  const [r, g, b] = skyRgb(skyHour);
  const mapTheme = useMapTheme();
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
      ref={sheet.rootRef}
      className={`app ${mapTheme.theme === "day" ? "is-day" : ""} ${preview ? "is-previewing" : ""} ${dnaOpen ? "has-dna" : ""} ${report.open ? "is-reporting" : ""} ${rideSheetOpen ? "is-booking" : ""} ${sheetOpen ? "has-sheet" : ""} ${tapPoint ? "is-picking" : ""} ${sheet.dragging ? "is-dragging-sheet" : ""} ${activeSheet && sheet.detent === "full" ? "is-sheet-full" : ""}`}
      {...(mobile ? { style: { "--sheet-height": `${sheet.height}px` } as CSSProperties } : {})}
      onFocus={expandForTyping}
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
        {...(assistant.open && assistant.focused ? { focusPoint: assistant.focused.point } : {})}
        {...(washrooms.open ? { washrooms: washrooms.shown } : {})}
        {...(showLights && rasters.lights ? { lights: rasters.lights } : {})}
        {...(showSignal && rasters.signal ? { signal: rasters.signal } : {})}
        {...(preview ? { preview } : {})}
        previewCamera={camera}
        theme={mapTheme.theme}
        insets={insets}
        onSelectRoute={(id) => !tapPoint && planner.setSelectedId(id)}
        onPickPoint={pickPoint}
        {...(tapPoint ? { onTapPoint: tapPoint } : {})}
        onPreviewEnd={previewer.stop}
      />
      <div className="sky-tint" style={{ background: `radial-gradient(120% 60% at 50% 0%, rgba(${r},${g},${b},0.22), transparent 70%)` }} />

      {config && (
        <TopBar
          cities={config.cities}
          {...(cityId ? { cityId } : {})}
          compact={mobile}
          roomy={roomyTopBar}
          theme={mapTheme.theme}
          showLights={showLights}
          showSignal={showSignal}
          dnaOpen={dnaOpen}
          reporting={report.open}
          washrooms={washrooms.open}
          listing={listing.open}
          assistant={config.assistant}
          asking={assistant.open}
          auth={auth}
          onCity={switchCity}
          onToggleTheme={mapTheme.toggle}
          onToggleLights={() => setShowLights((v) => !v)}
          onToggleSignal={() => setShowSignal((v) => !v)}
          onToggleDna={toggleDna}
          onToggleReport={toggleReport}
          onToggleWashrooms={toggleWashrooms}
          onToggleListing={toggleListing}
          onToggleAssistant={toggleAssistant}
          onSignIn={() => setAuthPurpose("sync")}
        />
      )}

      {config && city && (
        <aside className={`panel glass ${busy ? "is-busy" : ""}`}>
          <div className="panel__progress" />
          <Segmented kind="tabs" label="Mode" className="mode-switch" options={MODES} value={tripMode ? "trip" : "ride"} onChange={switchMode} />

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
              {trip.error && <Notice tone="error">{trip.error}</Notice>}
            </>
          )}

          {!tripMode && (
            <>
              {foldedTrip ? (
                <TripSummary from={foldedTrip.from} to={foldedTrip.to} departure={planner.departure} utcOffsetMinutes={offset} onEdit={() => setEditingTrip(true)} />
              ) : (
                <>
                  {mobile && editingTrip && planner.plan && !planner.stale && (
                    <div className="trip-edit">
                      <span>Edit your trip</span>
                      <LinkButton onClick={() => setEditingTrip(false)}>Done</LinkButton>
                    </div>
                  )}
                  <TripInputs cityId={city.id} from={planner.from} to={planner.to} onFrom={planner.setFrom} onTo={planner.setTo} onSwap={planner.swap} />
                  <DepartureControl departure={planner.departure} utcOffsetMinutes={offset} onChange={planner.setDeparture} />
                </>
              )}

              {(!planner.plan || outdated) && (
                <Button variant="primary" wide onClick={() => planner.search()} disabled={!planner.from || !planner.to || planning} aria-busy={planning}>
                  <Icon name="search" size={16} /> {planning ? "Finding routes…" : planner.plan ? "Update routes" : "Find safe routes"}
                </Button>
              )}

              {planner.error && <Notice tone="error">{planner.error}</Notice>}

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
                    key={planner.plan.searchId}
                    routes={routes}
                    {...(planner.selectedId ? { selectedId: planner.selectedId } : {})}
                    utcOffsetMinutes={offset}
                    compact={mobile}
                    onSelect={planner.setSelectedId}
                  />
                  {selected && safety.profile && (
                    <RouteInsights route={selected} parameters={config.parameters} weights={safety.profile.weights} city={city} />
                  )}
                </div>
              )}

              {selected && !outdated && (
                <div className={`panel__footer ${rideable ? "panel__footer--split" : ""}`}>
                  <Button variant={rideable ? "secondary" : "primary"} wide={!rideable} onClick={beginPreview}>
                    <Icon name="play" size={15} /> {rideable ? "Preview" : "Preview the ride"}
                    <span className="button__meta">{formatDuration(selected.durationSeconds)}</span>
                  </Button>
                  {rideable && (
                    <Button variant="primary" onClick={openRide} aria-expanded={rides.open}>
                      <Icon name="auto" size={16} /> Book this route
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </aside>
      )}

      {config && safety.profile && dnaOpen && (
        <aside className="dna-panel glass">
          <IconButton icon="close" label="Close safety DNA" className="dna-panel__close" onClick={() => setDnaOpen(false)} />
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
                  <LinkButton onClick={() => void auth.signOut()}>Sign out</LinkButton>
                </>
              ) : (
                <LinkButton onClick={() => setAuthPurpose("sync")}>Sign in to keep these on every device</LinkButton>
              )}
              {config.contactEmail && <LinkButton onClick={contact.start}>Contact us</LinkButton>}
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

      {assistant.open && !preview && city && (
        <AssistantSheet assistant={assistant} cityId={city.id} cityName={city.name} utcOffsetMinutes={offset} onShowRoute={showAssistantRoute} />
      )}

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
        <RideHud
          route={selected}
          preview={preview}
          utcOffsetMinutes={offset}
          speed={speed}
          camera={camera}
          compact={mobile}
          onSpeed={previewer.changeSpeed}
          onCamera={previewer.changeCamera}
          onTogglePause={previewer.togglePause}
          onExit={previewer.stop}
        />
      )}

      {activeSheet && (
        <button key={activeSheet} className="sheet-grip" aria-label={sheet.detent === "full" ? "Shrink panel" : "Expand panel"} {...sheet.grip} />
      )}

      <div className="bottom-bar">
        <Legend showRoute={Boolean(selected)} showLights={showLights && Boolean(rasters.lights)} showSignal={showSignal && Boolean(rasters.signal)} />
        <Attribution {...(city ? { city } : {})} compact={mobile} {...contactLink} />
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

      {contact.open && config?.contactEmail && (
        <ContactDialog
          to={config.contactEmail}
          name={auth.user?.displayName ?? ""}
          email={auth.user?.email ?? ""}
          sending={contact.sending}
          {...(contact.sentTo ? { sentTo: contact.sentTo } : {})}
          {...(contact.error ? { error: contact.error } : {})}
          onSend={contact.send}
          onClose={contact.close}
        />
      )}
    </div>
  );
}
