import { useEffect, useMemo, useState } from "react";
import { api } from "./api/client";
import type { AppConfig, LngLat, Place, ReportCategory, ReportWhen, TripReport } from "./api/types";
import { useAuth } from "./auth/useAuth";
import { AuthDialog, type AuthPurpose } from "./components/AuthDialog";
import { DepartureControl } from "./components/DepartureControl";
import { EmptyState, type DemoTrip } from "./components/EmptyState";
import { Icon } from "./components/Icon";
import { Attribution, Legend } from "./components/Legend";
import { ReportSheet } from "./components/ReportSheet";
import { RideHud } from "./components/RideHud";
import { RouteCards } from "./components/RouteCards";
import { RouteInsights } from "./components/RouteInsights";
import { SafetyDna } from "./components/SafetyDna";
import { Scanning } from "./components/Scanning";
import { TopBar } from "./components/TopBar";
import { TripInputs } from "./components/TripInputs";
import { skyRgb } from "./lib/colors";
import { cityHour, formatDuration, nextCityHour } from "./lib/format";
import { useMediaQuery } from "./lib/useMediaQuery";
import { routeVerdict } from "./lib/verdict";
import { gridDots, nightLightDot, signalDot, type GridDot } from "./map/gridDots";
import { MapView, type Insets } from "./map/MapView";
import { PREVIEW_SECONDS, retimePreview, startPreview, type RidePreview } from "./state/ridePreview";
import { usePlanner } from "./state/usePlanner";
import { useReport } from "./state/useReport";
import { useSafetyProfile } from "./state/useSafetyProfile";

const DEMO_HOUR = 23;
const DEFAULT_CITY_ID = "pune";
const TOAST_MS = 4500;
const NO_REPORTS: readonly TripReport[] = [];

interface Rasters {
  lights?: readonly GridDot[];
  signal?: readonly GridDot[];
}

async function placeAt(point: LngLat): Promise<Place> {
  const found = await api.reverse(point).catch(() => null);
  return { id: `pin:${point.join(",")}`, name: found?.name ?? "Dropped pin", label: found?.label ?? "Dropped pin", point };
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
  const mobile = useMediaQuery("(max-width: 760px)");

  const auth = useAuth();
  const safety = useSafetyProfile(config?.defaults, auth);
  const planner = usePlanner(safety.profile && { weights: safety.profile.weights, options: safety.profile.options });
  const report = useReport(auth);

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
        setCityId((id) => id ?? (c.cities.find((city) => city.id === DEFAULT_CITY_ID) ?? c.cities[0])?.id);
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
  const routes = planner.plan?.routes ?? [];
  const selected = routes.find((r) => r.id === planner.selectedId);
  const verdict = useMemo(() => (config ? routeVerdict(routes, config.parameters) : null), [routes, config]);

  useEffect(() => {
    if (preview && preview.routeId !== selected?.id) setPreview(undefined);
  }, [preview, selected?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPreview(undefined);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const routeMeters = selected?.segments.at(-1)?.endMeters ?? 0;
  const beginPreview = () => {
    if (!selected) return;
    setSpeed(1);
    setDnaOpen(false);
    report.close();
    setPreview(startPreview(selected.id, routeMeters, performance.now()));
  };

  const openReport = () => {
    setDnaOpen(false);
    setPreview(undefined);
    report.start();
  };
  const toggleReport = () => {
    if (report.open) report.close();
    else if (auth.user) openReport();
    else setAuthPurpose("report");
  };
  const toggleDna = () => {
    report.close();
    setDnaOpen((v) => !v);
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
    setCityId(id);
  };

  const runDemo = (trip: DemoTrip) => {
    planner.search({ from: trip.from, to: trip.to, departure: { mode: "at", at: nextCityHour(DEMO_HOUR, new Date(), offset) } });
  };

  const pickPoint = async (point: LngLat) => {
    if (preview) return;
    const place = await placeAt(point);
    if (!planner.from) planner.setFrom(place);
    else planner.setTo(place);
  };

  const insets: Insets = mobile
    ? { top: 110, right: 30, bottom: Math.round(innerHeight * 0.54), left: 30 }
    : { top: 120, right: dnaOpen || report.open ? 460 : 120, bottom: 120, left: 500 };

  const skyHour = planner.departure.mode === "at" ? cityHour(planner.departure.at, offset) : cityHour(new Date(), offset);
  const [r, g, b] = skyRgb(skyHour);
  const planning = planner.status === "planning";
  const busy = planning || planner.status === "rescoring";
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
    <div className={`app ${preview ? "is-previewing" : ""} ${dnaOpen ? "has-dna" : ""} ${report.open ? "is-reporting" : ""}`}>
      <MapView
        {...(city ? { city } : {})}
        routes={routes}
        reports={planner.plan?.reports ?? NO_REPORTS}
        {...(planner.plan ? { searchId: planner.plan.searchId } : {})}
        {...(planner.selectedId ? { selectedId: planner.selectedId } : {})}
        {...(planner.from ? { from: planner.from.point } : {})}
        {...(planner.to ? { to: planner.to.point } : {})}
        {...(report.point ? { reportPoint: report.point } : {})}
        {...(showLights && rasters.lights ? { lights: rasters.lights } : {})}
        {...(showSignal && rasters.signal ? { signal: rasters.signal } : {})}
        {...(preview ? { preview } : {})}
        insets={insets}
        onSelectRoute={(id) => !report.open && planner.setSelectedId(id)}
        onPickPoint={pickPoint}
        {...(report.open ? { onTapPoint: report.mark } : {})}
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
          auth={auth}
          onCity={switchCity}
          onToggleLights={() => setShowLights((v) => !v)}
          onToggleSignal={() => setShowSignal((v) => !v)}
          onToggleDna={toggleDna}
          onToggleReport={toggleReport}
          onSignIn={() => setAuthPurpose("sync")}
        />
      )}

      {config && city && (
        <aside className={`panel glass ${busy ? "is-busy" : ""}`}>
          <div className="panel__progress" />
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
            <div className="panel__footer">
              <button className="button button--primary button--wide" onClick={beginPreview}>
                <Icon name="play" size={15} /> Preview the ride
                <span className="button__meta">{formatDuration(selected.durationSeconds)}</span>
              </button>
            </div>
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
          {...(authPurpose === "report" ? { onSignedIn: openReport } : {})}
          onClose={() => setAuthPurpose(undefined)}
        />
      )}
    </div>
  );
}
