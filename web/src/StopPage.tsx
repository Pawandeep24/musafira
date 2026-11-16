import { useEffect, useState } from "react";
import { api, ApiError } from "./api/client";
import type { City, PublicSafeStop } from "./api/types";
import { Icon } from "./components/Icon";
import { Logo } from "./components/TopBar";
import { ButtonLink } from "./components/ui/Button";
import { Eyebrow } from "./components/ui/Eyebrow";
import { cityTime, formatClock } from "./lib/format";
import {
  accessLabel,
  ATTENDANT_LABEL,
  CARE_FEATURES,
  CLEANED_LABEL,
  hoursLabel,
  KIND_LABEL,
  LANGUAGE_LABEL,
  PADS_LABEL,
  WASHROOM_FEATURES,
  type FeatureGroup,
} from "./lib/safeStops";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function Facts({ title, items }: { title: string; items: readonly (string | undefined | false)[] }) {
  const shown = items.filter((item): item is string => Boolean(item));
  if (shown.length === 0) return null;
  return (
    <section className="stop-card__section">
      <h2>{title}</h2>
      <ul className="stop-card__facts">
        {shown.map((item) => (
          <li key={item}>
            <Icon name="check" size={13} /> {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function StopPage({ id }: { id: string }) {
  const [stop, setStop] = useState<PublicSafeStop>();
  const [city, setCity] = useState<City>();
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    Promise.all([api.safeStop(id), api.config()])
      .then(([found, config]) => {
        setStop(found);
        setCity(config.cities.find((c) => c.id === found.cityId));
        document.title = `${found.profile.name} · Musafira Safe Stop`;
      })
      .catch((e: unknown) =>
        setFailure(e instanceof ApiError && e.status === 404 ? "This Safe Stop isn't listed." : "Couldn't load this Safe Stop. Check your connection."),
      );
  }, [id]);

  if (!stop) {
    return (
      <div className="stop-page">
        <a className="stop-page__brand" href="/">
          <Logo size={26} /> Musafira
        </a>
        <p className="stop-page__status">{failure ?? "Loading…"}</p>
      </div>
    );
  }

  const { profile } = stop;
  const offset = city?.utcOffsetMinutes ?? 330;
  const selected = (group: FeatureGroup) => group.features.filter(([feature]) => profile.features.includes(feature)).map(([, label]) => label);
  const [lon, lat] = profile.point;
  const verifiedOn = stop.verifiedAt && cityTime(stop.verifiedAt, offset).toUTCString().slice(5, 16);
  const openText = stop.open ? (stop.closesAt ? `Open now · closes ${formatClock(stop.closesAt, offset)}` : "Open 24 hours") : `Closed now · ${hoursLabel(profile.hours)}`;
  const { total, women, unisex, accessible } = profile.washrooms;

  return (
    <div className="stop-page">
      <a className="stop-page__brand" href="/">
        <Logo size={26} /> Musafira
      </a>
      <article className="stop-card glass">
        <Eyebrow icon="shield">Musafira Safe Stop</Eyebrow>
        <h1>{profile.name}</h1>
        <p className="stop-card__meta">
          {KIND_LABEL[profile.kind]}
          {city && ` · ${city.name}`}
        </p>
        <p className={`stop-card__open ${stop.open ? "is-open" : "is-closed"}`}>{openText}</p>
        {profile.offer && (
          <p className="stop-card__offer">
            <Icon name="sparkle" size={14} /> {profile.offer}
          </p>
        )}

        <Facts
          title="Washroom"
          items={[
            total > 0 && plural(total, "washroom"),
            women > 0 && `${women} for women only`,
            unisex > 0 && `${unisex} for anyone`,
            accessible > 0 && `${accessible} wheelchair friendly`,
            total > 0 && accessLabel(profile),
            total > 0 && ATTENDANT_LABEL[profile.attendant],
            total > 0 && CLEANED_LABEL[profile.cleaned],
            ...selected(WASHROOM_FEATURES),
          ]}
        />
        {CARE_FEATURES.map((group, i) => (
          <Facts key={group.title} title={group.title} items={[...(i === 0 ? [PADS_LABEL[profile.pads]] : []), ...selected(group)]} />
        ))}
        <Facts title="Staff speak" items={profile.languages.map((language) => LANGUAGE_LABEL[language])} />

        <p className="stop-card__verified">
          <Icon name="shield" size={15} />
          <span>
            Owner verified as the holder of <strong>{profile.domain}</strong>
            {stop.registrar && `, registered with ${stop.registrar}`}
            {verifiedOn && `, on ${verifiedOn}`}.
          </span>
        </p>

        <ButtonLink variant="primary" wide href={`/?${new URLSearchParams({ to: `${lon},${lat}`, name: profile.name })}`}>
          <Icon name="route" size={15} /> Plan a safe ride here
        </ButtonLink>
        <p className="stop-card__fine">
          Answers come from the shop. Musafira checks who owns the domain, not the premises.
        </p>
      </article>
    </div>
  );
}
