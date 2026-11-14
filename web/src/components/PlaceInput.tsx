import { useEffect, useId, useState } from "react";
import { api } from "../api/client";
import type { LngLat, Place, PlaceKind } from "../api/types";
import { matchedRuns } from "../lib/matchedRuns";
import { recentPlaces, rememberPlace } from "../state/recentPlaces";
import { Icon, type IconName } from "./Icon";

interface Props {
  cityId: string;
  value?: Place;
  near?: LngLat;
  placeholder: string;
  dotClass: string;
  onChange(place: Place | undefined): void;
  trailing?: React.ReactNode;
}

const SEARCH_DELAY_MS = 90;
const MAX_CACHED_QUERIES = 200;
const KIND_ICON: Record<PlaceKind, IconName> = { area: "pin", residence: "home", landmark: "flag", street: "roadType" };
const answered = new Map<string, Place[]>();

function remember(key: string, places: Place[]) {
  if (answered.size >= MAX_CACHED_QUERIES) answered.delete(answered.keys().next().value!);
  answered.set(key, places);
}

const detailOf = (place: Place) => (place.label.startsWith(`${place.name}, `) ? place.label.slice(place.name.length + 2) : place.label);

export function PlaceInput({ cityId, value, near, placeholder, dotClass, onChange, trailing }: Props) {
  const [text, setText] = useState(value?.name ?? "");
  const [suggestions, setSuggestions] = useState<Place[]>([]);
  const [answeredQuery, setAnsweredQuery] = useState<string>();
  const [recents, setRecents] = useState<Place[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const query = text.trim();
  const nearKey = near?.map((n) => n.toFixed(3)).join(",") ?? "";

  useEffect(() => setText(value?.name ?? ""), [value?.id]);

  useEffect(() => {
    if (!open || query.length < 2 || query === value?.name) {
      setSuggestions([]);
      setAnsweredQuery(undefined);
      return;
    }
    const key = `${cityId}|${nearKey}|${query.toLowerCase()}`;
    const show = (places: Place[]) => {
      setSuggestions(places);
      setAnsweredQuery(query);
      setActive(0);
    };
    const cached = answered.get(key);
    if (cached) return show(cached);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .suggest(query, cityId, near, controller.signal)
        .then((places) => {
          remember(key, places);
          show(places);
        })
        .catch(() => {
          if (!controller.signal.aborted) show([]);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, cityId, nearKey, open]);

  const showingRecents = open && query === "";
  const items = showingRecents ? recents : suggestions;
  const noMatch = open && !showingRecents && answeredQuery === query && suggestions.length === 0;

  const choose = (place: Place) => {
    rememberPlace(cityId, place);
    onChange(place);
    setText(place.name);
    setOpen(false);
    setSuggestions([]);
  };

  return (
    <div className="place-input">
      <span className={`place-input__dot ${dotClass}`} />
      <input
        value={text}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={() => {
          setRecents(recentPlaces(cityId));
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (!e.target.value) onChange(undefined);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((i) => Math.min(items.length - 1, i + 1));
          else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
          else if (e.key === "Enter" && items[active]) choose(items[active]);
          else if (e.key === "Escape") setOpen(false);
          else return;
          e.preventDefault();
        }}
      />
      {trailing}
      {open && (items.length > 0 || noMatch) && (
        <ul className="place-input__list glass" id={listId} role="listbox">
          {showingRecents && (
            <li className="place-input__heading" role="presentation">
              Recent
            </li>
          )}
          {items.map((place, i) => (
            <li
              key={place.id}
              role="option"
              aria-selected={i === active}
              className={`place-input__option ${i === active ? "is-active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(place);
              }}
            >
              <span className="place-input__icon">
                <Icon name={showingRecents ? "clock" : KIND_ICON[place.kind ?? "landmark"]} size={15} />
              </span>
              <span className="place-input__text">
                <span className="place-input__name">
                  {matchedRuns(place.name, query).map((run, j) => (run.match ? <mark key={j}>{run.text}</mark> : run.text))}
                </span>
                <span className="place-input__detail">{detailOf(place)}</span>
              </span>
            </li>
          ))}
          {noMatch && (
            <li className="place-input__empty" role="presentation">
              No match for “{query}”. Try a nearby landmark, or right-click the map to drop a pin.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
