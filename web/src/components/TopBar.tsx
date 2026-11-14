import type { City } from "../api/types";
import type { AuthState } from "../auth/useAuth";
import { Icon } from "./Icon";

interface Props {
  cities: readonly City[];
  cityId?: string;
  showLights: boolean;
  showSignal: boolean;
  dnaOpen: boolean;
  reporting: boolean;
  auth: AuthState;
  onCity(id: string): void;
  onToggleLights(): void;
  onToggleSignal(): void;
  onToggleDna(): void;
  onToggleReport(): void;
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
  return (
    <header className="topbar">
      <div className="brand glass">
        <Logo />
        <div>
          <strong>Musafira</strong>
          <span>Safer routes for the hour you ride</span>
        </div>
      </div>

      <div className="segmented glass topbar__cities" role="tablist" aria-label="City">
        {props.cities.map((city) => (
          <button key={city.id} role="tab" aria-selected={city.id === props.cityId} className={city.id === props.cityId ? "is-on" : ""} onClick={() => props.onCity(city.id)}>
            {city.name}
          </button>
        ))}
      </div>

      <div className="topbar__actions">
        <button className={`pill glass ${props.showLights ? "is-on" : ""}`} onClick={props.onToggleLights} aria-pressed={props.showLights} title="NASA night-time light from space">
          <Icon name="lighting" size={15} /> <span>Night lights</span>
        </button>
        <button className={`pill glass ${props.showSignal ? "is-on" : ""}`} onClick={props.onToggleSignal} aria-pressed={props.showSignal} title="Mobile tower density">
          <Icon name="signal" size={15} /> <span>Signal</span>
        </button>
        <button className={`pill glass ${props.dnaOpen ? "is-on" : ""}`} onClick={props.onToggleDna} aria-pressed={props.dnaOpen}>
          <Icon name="sliders" size={15} /> <span>Safety DNA</span>
        </button>
        {auth.available && (
          <button
            className={`pill glass ${props.reporting ? "is-on" : ""}`}
            onClick={props.onToggleReport}
            aria-pressed={props.reporting}
            title="Tell other riders what you saw on the road"
          >
            <Icon name="flag" size={15} /> <span>Report</span>
          </button>
        )}
        {auth.available &&
          (auth.user ? (
            <button className="avatar" onClick={props.onToggleDna} title={auth.user.email ?? "Account"}>
              {auth.user.photoURL ? <img src={auth.user.photoURL} alt="" referrerPolicy="no-referrer" /> : initial}
            </button>
          ) : (
            <button className="pill glass" onClick={props.onSignIn}>
              <Icon name="user" size={15} /> <span>Sign in</span>
            </button>
          ))}
      </div>
    </header>
  );
}
