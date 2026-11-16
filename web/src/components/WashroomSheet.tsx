import type { Washroom } from "../api/types";
import { formatClock, formatDistance } from "../lib/format";
import { FACT_LABEL, FILTERS, SOURCE_LABEL, washroomName } from "../lib/safeStops";
import type { WashroomsState } from "../state/useWashrooms";
import { Icon } from "./Icon";

interface Props {
  washrooms: WashroomsState;
  utcOffsetMinutes: number;
  onGo(washroom: Washroom): void;
  onListShop?(): void;
}

function openLabel(washroom: Washroom, utcOffsetMinutes: number) {
  const hours = washroom.closesAt ? `Open till ${formatClock(washroom.closesAt, utcOffsetMinutes)}` : "Open 24 hours";
  return washroom.estimated ? `${hours} · typical hours` : hours;
}

function WashroomCard({ washroom, utcOffsetMinutes, onGo }: { washroom: Washroom; utcOffsetMinutes: number; onGo(): void }) {
  const known = FACT_LABEL.filter(([fact]) => washroom.facts[fact] === true);
  return (
    <li className={`washroom is-${washroom.source}`}>
      <div className="washroom__head">
        <span className="washroom__dot" />
        <div className="washroom__title">
          <strong>{washroomName(washroom)}</strong>
          <span>
            {SOURCE_LABEL[washroom.source]} · {formatDistance(washroom.distanceMeters)} · {openLabel(washroom, utcOffsetMinutes)}
          </span>
        </div>
        <span className="washroom__minutes">{washroom.rideMinutes} min</span>
      </div>
      {washroom.source === "safeStop" && (
        <p className="washroom__verified">
          <Icon name="shield" size={13} /> Owner verified with a GoDaddy domain
        </p>
      )}
      {known.length > 0 && (
        <ul className="washroom__facts">
          {known.map(([fact, label]) => (
            <li key={fact}>{label}</li>
          ))}
        </ul>
      )}
      {washroom.source === "fuel" && <p className="washroom__note">Fuel stations must keep a clean washroom for customers.</p>}
      {washroom.source === "public" && washroom.facts.women === undefined && <p className="washroom__note">Women's access isn't recorded.</p>}
      <div className="washroom__actions">
        <button className="button button--primary" onClick={onGo}>
          <Icon name="route" size={14} /> Safe route here
        </button>
        {washroom.safeStopId && (
          <a className="button button--secondary" href={`/s/${washroom.safeStopId}`} target="_blank" rel="noreferrer">
            See stop
          </a>
        )}
      </div>
    </li>
  );
}

export function WashroomSheet({ washrooms, utcOffsetMinutes, onGo, onListShop }: Props) {
  const { point, result, shown, filters, error, locating, loading } = washrooms;
  const hidden = (result?.washrooms.length ?? 0) - shown.length;
  return (
    <aside className="side-sheet glass" aria-label="Washrooms near you">
      <button className="icon-button side-sheet__close" onClick={washrooms.close} aria-label="Close washrooms">
        <Icon name="close" size={16} />
      </button>
      <header className="side-sheet__head">
        <h2>Washrooms near you</h2>
        <p>Open now, within a short ride. Verified Safe Stops come first, then public toilets and fuel stations.</p>
      </header>

      <div className={`report__where ${point ? "is-set" : ""}`}>
        <Icon name="pin" size={16} />
        <span>{locating ? "Finding you…" : point ? "Searching from the marked spot. Tap the map to move it." : "Tap the map to search from there."}</span>
      </div>
      {!locating && (
        <button className="link-button report__locate" onClick={washrooms.locate}>
          <Icon name="locate" size={14} /> Use my location
        </button>
      )}

      <div className="report__chips" role="group" aria-label="Must have">
        {FILTERS.map(([filter, label]) => (
          <button
            key={filter}
            aria-pressed={filters.has(filter)}
            className={`chip chip--preset ${filters.has(filter) ? "is-on" : ""}`}
            onClick={() => washrooms.toggleFilter(filter)}
          >
            {filters.has(filter) && <Icon name="check" size={13} />} {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="notice notice--error">
          <Icon name="alert" size={15} /> {error}
        </div>
      )}

      {loading && <p className="hint">Looking for open washrooms…</p>}
      {!loading && result && shown.length === 0 && (
        <div className="notice notice--info">
          <Icon name="droplet" size={15} />
          {hidden > 0 ? `${hidden} open nearby, but none with everything you picked.` : "Nothing open within 4 km right now."}
        </div>
      )}

      {shown.length > 0 && (
        <ul className="washroom-list">
          {shown.map((washroom) => (
            <WashroomCard key={washroom.id} washroom={washroom} utcOffsetMinutes={utcOffsetMinutes} onGo={() => onGo(washroom)} />
          ))}
        </ul>
      )}

      {onListShop && (
        <button className="side-sheet__cta" onClick={onListShop}>
          <Icon name="shield" size={18} />
          <span>
            <strong>Run a shop? List it as a Safe Stop</strong>
            <small>Give riders a washroom they can trust, verified with your GoDaddy domain.</small>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      )}
    </aside>
  );
}
