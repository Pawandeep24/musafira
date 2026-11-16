import { useEffect, useRef, useState } from "react";
import type { City } from "../api/types";
import type { AuthState } from "../auth/useAuth";
import type { MapTheme } from "../state/useMapTheme";
import { Icon } from "./Icon";
import { Segmented } from "./ui/Segmented";

interface Props {
  cities: readonly City[];
  cityId?: string;
  compact: boolean;
  theme: MapTheme;
  showLights: boolean;
  showSignal: boolean;
  dnaOpen: boolean;
  reporting: boolean;
  washrooms: boolean;
  auth: AuthState;
  onCity(id: string): void;
  onToggleTheme(): void;
  onToggleLights(): void;
  onToggleSignal(): void;
  onToggleDna(): void;
  onToggleReport(): void;
  onToggleWashrooms(): void;
  onSignIn(): void;
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="logo-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e9fffa" />
          <stop offset="0.55" stopColor="#8fdccc" />
          <stop offset="1" stopColor="#4fb3a2" />
        </linearGradient>
      </defs>
      <path
        d="M32 10c7 5 14 7 20 7v13c0 12-8 20-20 25C20 50 12 42 12 30V17c6 0 13-2 20-7z"
        fill="none"
        stroke="url(#logo-gradient)"
        strokeWidth="4.5"
        strokeLinejoin="round"
      />
      <path d="M22 35c5-9 15-9 20 0" fill="none" stroke="url(#logo-gradient)" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="32" cy="27" r="3.8" fill="#e9fffa" />
    </svg>
  );
}

export function TopBar(props: Props) {
  const { auth } = props;
  const initial = (auth.user?.displayName ?? auth.user?.email ?? "?").slice(0, 1).toUpperCase();
  const [layersOpen, setLayersOpen] = useState(false);
  const layersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!layersOpen) return;
    const closeOutside = (e: PointerEvent) => {
      if (!layersRef.current?.contains(e.target as Node)) setLayersOpen(false);
    };
    addEventListener("pointerdown", closeOutside);
    return () => removeEventListener("pointerdown", closeOutside);
  }, [layersOpen]);

  const layers = (
    <>
      <button
        className="pill pill--icon glass"
        onClick={props.onToggleTheme}
        aria-label={props.theme === "day" ? "Switch to night map" : "Switch to day map"}
        title={`${props.theme === "day" ? "Day" : "Night"} map, following your ride time. Tap to switch.`}
      >
        <Icon name={props.theme === "day" ? "sun" : "moon"} size={16} /> <span>{props.theme === "day" ? "Day map" : "Night map"}</span>
      </button>
      <button className={`pill glass ${props.showLights ? "is-on" : ""}`} onClick={props.onToggleLights} aria-pressed={props.showLights} title="NASA night-time light from space">
        <Icon name="lighting" size={15} /> <span>Night lights</span>
      </button>
      <button className={`pill glass ${props.showSignal ? "is-on" : ""}`} onClick={props.onToggleSignal} aria-pressed={props.showSignal} title="Mobile tower density">
        <Icon name="signal" size={15} /> <span>Signal</span>
      </button>
    </>
  );
  const tools = (
    <>
      <button className={`pill glass ${props.dnaOpen ? "is-on" : ""}`} onClick={props.onToggleDna} aria-pressed={props.dnaOpen} aria-label="Safety DNA">
        <Icon name="sliders" size={15} /> <span>Safety DNA</span>
      </button>
      <button
        className={`pill glass ${props.washrooms ? "is-on" : ""}`}
        onClick={props.onToggleWashrooms}
        aria-pressed={props.washrooms}
        aria-label="Washrooms"
        title="Open washrooms near you, women-friendly first"
      >
        <Icon name="droplet" size={15} /> <span>Washrooms</span>
      </button>
      {auth.available && (
        <button
          className={`pill glass ${props.reporting ? "is-on" : ""}`}
          onClick={props.onToggleReport}
          aria-pressed={props.reporting}
          aria-label="Report"
          title="Tell other riders what you saw on the road"
        >
          <Icon name="flag" size={15} /> <span>Report</span>
        </button>
      )}
    </>
  );
  const account =
    auth.available &&
    (auth.user ? (
      <button className="avatar" onClick={props.onToggleDna} title={auth.user.email ?? "Account"}>
        {auth.user.photoURL ? <img src={auth.user.photoURL} alt="" referrerPolicy="no-referrer" /> : initial}
      </button>
    ) : (
      <button className="pill glass" onClick={props.onSignIn} aria-label="Sign in">
        <Icon name="user" size={15} /> <span>Sign in</span>
      </button>
    ));

  return (
    <>
      <header className="topbar">
        <div className="brand glass">
          <Logo />
          <div>
            <strong>Musafira</strong>
            <span>Safer routes for the hour you ride</span>
          </div>
        </div>

        <Segmented
          kind="tabs"
          label="City"
          className="glass topbar__cities"
          options={props.cities.map((city) => [city.id, city.name] as const)}
          value={props.cityId}
          onChange={props.onCity}
        />

        <div className="topbar__actions">
          {!props.compact && layers}
          {!props.compact && tools}
          {account}
        </div>
      </header>

      {props.compact && (
        <nav className="map-rail" aria-label="Map tools">
          <div className="map-rail__layers" ref={layersRef}>
            <button className={`pill glass ${layersOpen ? "is-on" : ""}`} onClick={() => setLayersOpen((v) => !v)} aria-expanded={layersOpen} aria-label="Map layers">
              <Icon name="layers" size={17} />
            </button>
            {layersOpen && (
              <div className="layers-menu glass" role="group" aria-label="Map layers">
                {layers}
              </div>
            )}
          </div>
          {tools}
        </nav>
      )}
    </>
  );
}
