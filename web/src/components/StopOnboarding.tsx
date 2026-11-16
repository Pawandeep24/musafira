import { useState } from "react";
import type { Language, SafeStopFeature, SafeStopKind } from "@/api/types";
import { CARE_FEATURES, KIND_LABEL, LANGUAGE_LABEL, WASHROOM_FEATURES, type FeatureGroup } from "@/lib/safeStops";
import { STEPS, type Step, type StopOnboardingState } from "@/state/useStopOnboarding";
import { Icon } from "@/components/Icon";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { IconButton } from "@/components/ui/IconButton";
import { LinkButton } from "@/components/ui/LinkButton";
import { Notice } from "@/components/ui/Notice";
import { Segmented } from "@/components/ui/Segmented";
import { SheetHeader } from "@/components/ui/SheetHeader";
import { ToggleChip } from "@/components/ui/ToggleChip";

const STEP_LABEL: Record<Step, string> = {
  place: "Place",
  washroom: "Washroom",
  care: "Care",
  domain: "Domain",
  verify: "Go live",
};

const COPIED_MS = 1500;

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange(next: T): void }) {
  return (
    <div className="onboard__field">
      <span className="onboard__label">{label}</span>
      <Segmented kind="radio" small label={label} options={options} value={value} onChange={onChange} />
    </div>
  );
}

function Counter({ label, value, onChange }: { label: string; value: number; onChange(next: number): void }) {
  return (
    <div className="counter">
      <span>{label}</span>
      <div className="counter__controls">
        <button className="icon-button" aria-label={`Fewer: ${label}`} disabled={value <= 0} onClick={() => onChange(value - 1)}>
          −
        </button>
        <output aria-live="polite">{value}</output>
        <button className="icon-button" aria-label={`More: ${label}`} disabled={value >= 50} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

function Features({ group, selected, onToggle }: { group: FeatureGroup; selected: readonly SafeStopFeature[]; onToggle(feature: SafeStopFeature): void }) {
  return (
    <section className="report__step">
      <h3>{group.title}</h3>
      <div className="report__chips">
        {group.features.map(([id, label]) => (
          <ToggleChip key={id} aria-pressed={selected.includes(id)} on={selected.includes(id)} onClick={() => onToggle(id)}>
            {selected.includes(id) && <Icon name="check" size={13} />} {label}
          </ToggleChip>
        ))}
      </div>
    </section>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    });
  return (
    <div className="dns-row">
      <span>{label}</span>
      <code>{value}</code>
      <IconButton icon={copied ? "check" : "copy"} iconSize={14} label={`Copy ${label}`} onClick={copy} />
    </div>
  );
}

function Check({ ok, title, detail }: { ok: boolean; title: string; detail?: string }) {
  return (
    <li className={`check ${ok ? "is-ok" : "is-missing"}`}>
      <Icon name={ok ? "check" : "close"} size={15} />
      <div>
        <strong>{title}</strong>
        {detail && <span>{detail}</span>}
      </div>
    </li>
  );
}

function PlaceStep({ onboarding }: { onboarding: StopOnboardingState }) {
  const { draft, update, locating } = onboarding;
  const allDay = "allDay" in draft.hours;
  const languages = draft.languages;
  const toggleLanguage = (id: Language) => update({ languages: languages.includes(id) ? languages.filter((l) => l !== id) : [...languages, id] });
  return (
    <>
      <label className="onboard__field">
        <span className="onboard__label">Shop name</span>
        <input className="onboard__input" value={draft.name} maxLength={60} placeholder="Sharma Chai Point" onChange={(e) => update({ name: e.target.value })} />
      </label>

      <section className="report__step">
        <h3>What kind of place</h3>
        <div className="report__chips">
          {(Object.keys(KIND_LABEL) as SafeStopKind[]).map((kind) => (
            <ToggleChip key={kind} aria-pressed={draft.kind === kind} on={draft.kind === kind} onClick={() => update({ kind })}>
              {KIND_LABEL[kind]}
            </ToggleChip>
          ))}
        </div>
      </section>

      <section className="report__step">
        <h3>Where</h3>
        <div className={`report__where ${draft.point ? "is-set" : ""}`}>
          <Icon name="pin" size={16} />
          <span>{draft.point ? "Shop marked. Tap the map to move it." : "Tap the map at your shop's entrance."}</span>
        </div>
        <LinkButton className="report__locate" onClick={onboarding.locate} disabled={locating}>
          <Icon name="locate" size={14} /> {locating ? "Finding you…" : "I'm at the shop now"}
        </LinkButton>
      </section>

      <section className="report__step">
        <h3>Open</h3>
        <div className="onboard__hours">
          <ToggleChip aria-pressed={allDay} on={allDay} onClick={() => update({ hours: allDay ? { opens: "08:00", closes: "22:00" } : { allDay: true } })}>
            {allDay && <Icon name="check" size={13} />} 24 hours
          </ToggleChip>
          {!allDay && "opens" in draft.hours && (
            <>
              <input type="time" className="onboard__input" aria-label="Opens" value={draft.hours.opens} onChange={(e) => update({ hours: { ...draft.hours, opens: e.target.value } })} />
              <span className="hint">to</span>
              <input type="time" className="onboard__input" aria-label="Closes" value={draft.hours.closes} onChange={(e) => update({ hours: { ...draft.hours, closes: e.target.value } })} />
            </>
          )}
        </div>
        <p className="hint">Riders only see your shop while it's open, so keep this honest.</p>
      </section>

      <section className="report__step">
        <h3>Staff speak</h3>
        <div className="report__chips">
          {(Object.keys(LANGUAGE_LABEL) as Language[]).map((id) => (
            <ToggleChip key={id} aria-pressed={languages.includes(id)} on={languages.includes(id)} onClick={() => toggleLanguage(id)}>
              {LANGUAGE_LABEL[id]}
            </ToggleChip>
          ))}
        </div>
      </section>
    </>
  );
}

function WashroomStep({ onboarding }: { onboarding: StopOnboardingState }) {
  const { draft, update } = onboarding;
  const counts = draft.washrooms;
  const setCount = (key: keyof typeof counts) => (value: number) => update({ washrooms: { ...counts, [key]: value } });
  const tooMany = counts.women + counts.unisex > counts.total || counts.accessible > counts.total;
  return (
    <>
      <section className="report__step">
        <h3>Washrooms</h3>
        <div className="counters">
          <Counter label="In total" value={counts.total} onChange={setCount("total")} />
          <Counter label="Women only" value={counts.women} onChange={setCount("women")} />
          <Counter label="For anyone" value={counts.unisex} onChange={setCount("unisex")} />
          <Counter label="Wheelchair friendly" value={counts.accessible} onChange={setCount("accessible")} />
        </div>
        {tooMany && (
          <Notice tone="error">Women-only and for-anyone washrooms can't add up to more than the total.</Notice>
        )}
      </section>

      <Choice
        label="Who can use it"
        value={draft.access}
        options={[
          ["anyone", "Anyone"],
          ["customers", "Customers"],
          ["paid", "Small fee"],
        ]}
        onChange={(access) => update({ access })}
      />
      {draft.access === "paid" && (
        <label className="onboard__field">
          <span className="onboard__label">Fee in rupees</span>
          <input
            type="number"
            min={1}
            max={100}
            className="onboard__input onboard__input--short"
            value={draft.feeRupees ?? ""}
            onChange={(e) => update({ feeRupees: e.target.value ? Math.min(100, Math.max(1, Math.round(Number(e.target.value)))) : undefined })}
          />
        </label>
      )}
      <Choice
        label="Someone looks after it"
        value={draft.attendant}
        options={[
          ["always", "Always"],
          ["daytime", "Daytime"],
          ["none", "No"],
        ]}
        onChange={(attendant) => update({ attendant })}
      />
      <Choice
        label="Cleaned"
        value={draft.cleaned}
        options={[
          ["hourly", "Every hour"],
          ["few_daily", "Few times a day"],
          ["daily", "Daily"],
        ]}
        onChange={(cleaned) => update({ cleaned })}
      />
      <Features group={WASHROOM_FEATURES} selected={draft.features} onToggle={onboarding.toggleFeature} />
    </>
  );
}

function CareStep({ onboarding }: { onboarding: StopOnboardingState }) {
  const { draft, update } = onboarding;
  return (
    <>
      <Choice
        label="Sanitary pads"
        value={draft.pads}
        options={[
          ["free", "Free"],
          ["sold", "For sale"],
          ["none", "Not yet"],
        ]}
        onChange={(pads) => update({ pads })}
      />
      {CARE_FEATURES.map((group) => (
        <Features key={group.title} group={group} selected={draft.features} onToggle={onboarding.toggleFeature} />
      ))}
      <label className="onboard__field">
        <span className="onboard__label">Something for riders (optional)</span>
        <input className="onboard__input" value={draft.offer} maxLength={60} placeholder="Free water refill, 10% off chai" onChange={(e) => update({ offer: e.target.value })} />
      </label>
    </>
  );
}

function DomainStep({ onboarding }: { onboarding: StopOnboardingState }) {
  const { draft, update, ideas, loading } = onboarding;
  const picked = ideas?.find((idea) => idea.domain === draft.domain && idea.available !== false);
  return (
    <>
      <p className="onboard__intro">
        Your GoDaddy domain is how Musafira knows the shop is really yours, and it gives the shop its own address on the web.
      </p>

      <section className="report__step">
        <h3>Ideas for {draft.name.trim() || "your shop"}</h3>
        {loading && <p className="hint">Checking which names are free…</p>}
        {ideas && ideas.length === 0 && <p className="hint">Type your shop name in English letters for ideas, or enter a domain below.</p>}
        {ideas && ideas.length > 0 && (
          <ul className="domain-ideas">
            {ideas.map((idea) => (
              <li key={idea.domain}>
                <button
                  className={`domain-ideas__pick ${draft.domain === idea.domain ? "is-on" : ""}`}
                  aria-pressed={draft.domain === idea.domain}
                  onClick={() => update({ domain: idea.domain })}
                >
                  <code title={idea.domain}>{idea.domain}</code>
                  <span className={`domain-ideas__state is-${idea.available === null ? "unknown" : idea.available ? "free" : "taken"}`}>
                    {idea.available === null ? "Unknown" : idea.available ? "Available" : "Taken"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {picked && (
          <ButtonLink variant="secondary" className="domain-ideas__buy" href={picked.buyUrl} target="_blank" rel="noreferrer">
            Get {picked.domain} on GoDaddy <Icon name="chevron" size={14} />
          </ButtonLink>
        )}
      </section>

      <label className="onboard__field">
        <span className="onboard__label">Your GoDaddy domain</span>
        <input
          className="onboard__input"
          value={draft.domain}
          placeholder="sharmachai.in"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => update({ domain: e.target.value })}
        />
      </label>

      <label className="promise">
        <input type="checkbox" checked={draft.promise} onChange={(e) => update({ promise: e.target.checked })} />
        <span>
          <strong>The Safe Stop Promise</strong>
          A rider who feels unsafe can wait here and ask my staff for help. Everything above is true, and I'll update it if anything changes.
        </span>
      </label>
      <p className="hint">
        <Icon name="shield" size={13} /> Listing is free. You buy and own your domain on GoDaddy; Musafira never buys it for you.
      </p>
    </>
  );
}

function VerifyStep({ onboarding }: { onboarding: StopOnboardingState }) {
  const { stop, checks, verifying } = onboarding;
  if (!stop) return null;
  const { domain } = stop.profile;
  if (stop.status === "listed") {
    return (
      <div className="live-card">
        <Icon name="shield" size={26} />
        <h3>{stop.profile.name} is a Safe Stop</h3>
        <p>
          Riders now see it in washrooms near me and as a safe place to stop on their routes. Verified as the owner of <strong>{domain}</strong>
          {stop.registrar && ` (${stop.registrar})`}.
        </p>
        <ButtonLink variant="primary" href={`/s/${stop.id}`} target="_blank" rel="noreferrer">
          <Icon name="link" size={15} /> Open your stop page
        </ButtonLink>
      </div>
    );
  }
  const registrarDetail = checks?.godaddy
    ? checks.registrar ?? undefined
    : checks?.registrar
      ? `${domain} is registered with ${checks.registrar}. Safe Stops need a GoDaddy domain.`
      : `No registry knows ${domain} yet. If you just bought it, give it a few minutes.`;
  return (
    <>
      <p className="onboard__intro">
        Last step: prove <strong>{domain}</strong> is yours. Sign in at GoDaddy, open <em>My Products</em>, choose the domain and open <em>DNS</em>. Add a new record:
      </p>
      <div className="dns-card">
        <CopyRow label="Type" value="TXT" />
        <CopyRow label="Name" value="_musafira" />
        <CopyRow label="Value" value={stop.verify.value} />
      </div>
      <p className="hint">Leave the TTL as it is. New records usually show within a few minutes.</p>

      {checks && (
        <ul className="checks">
          <Check ok={checks.codeFound} title={`Code found at ${stop.verify.name}`} {...(checks.codeFound ? {} : { detail: "Not visible yet. Check the name and value, then try again in a minute." })} />
          <Check ok={checks.godaddy} title="Registered with GoDaddy" {...(registrarDetail ? { detail: registrarDetail } : {})} />
        </ul>
      )}

      <Button variant="primary" wide onClick={() => void onboarding.verify()} disabled={verifying} aria-busy={verifying}>
        <Icon name="shield" size={15} /> {verifying ? "Checking DNS…" : checks ? "Check again" : "Check now"}
      </Button>
    </>
  );
}

export function StopOnboarding({ onboarding }: { onboarding: StopOnboardingState }) {
  const { step, ready, saving, error, stop } = onboarding;
  const index = STEPS.indexOf(step);
  const next = STEPS[index + 1];
  const previous = STEPS[index - 1];
  return (
    <aside className="side-sheet glass" aria-label="List your shop as a Safe Stop">
      <IconButton icon="close" label="Close" className="side-sheet__close" onClick={onboarding.close} />
      <SheetHeader className="side-sheet__head" before={<Eyebrow icon="shield">Musafira Safe Stops</Eyebrow>} title={stop ? stop.profile.name : "List your shop"}>
        {step === "place" && <p>Riders, especially women riding late, look for a clean washroom and a safe place to pause. Tell them what you offer.</p>}
      </SheetHeader>

      <ol className="stepper">
        {STEPS.map((s, i) => (
          <li key={s} className={`${s === step ? "is-current" : ""} ${i < index ? "is-done" : ""}`}>
            <button disabled={s === step || (!stop && i > index)} onClick={() => onboarding.goTo(s)}>
              <span>{i < index ? <Icon name="check" size={11} /> : i + 1}</span>
              {STEP_LABEL[s]}
            </button>
          </li>
        ))}
      </ol>

      {step === "place" && <PlaceStep onboarding={onboarding} />}
      {step === "washroom" && <WashroomStep onboarding={onboarding} />}
      {step === "care" && <CareStep onboarding={onboarding} />}
      {step === "domain" && <DomainStep onboarding={onboarding} />}
      {step === "verify" && <VerifyStep onboarding={onboarding} />}

      {error && <Notice tone="error">{error}</Notice>}

      {step === "verify" ? (
        <LinkButton className="side-sheet__edit" onClick={() => onboarding.goTo("place")}>
          Edit answers
        </LinkButton>
      ) : (
        <div className="side-sheet__nav">
          {previous && (
            <Button variant="secondary" onClick={() => onboarding.goTo(previous)}>
              <Icon name="back" size={15} /> Back
            </Button>
          )}
          {step === "domain" ? (
            <Button variant="primary" disabled={!ready || saving} aria-busy={saving} onClick={() => void onboarding.save()}>
              {saving ? "Saving…" : stop ? "Save changes" : "Save and get my code"}
            </Button>
          ) : (
            next && (
              <Button variant="primary" disabled={!ready} onClick={() => onboarding.goTo(next)}>
                Next <Icon name="chevron" size={15} />
              </Button>
            )
          )}
        </div>
      )}
    </aside>
  );
}
