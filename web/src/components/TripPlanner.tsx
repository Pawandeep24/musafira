import type { Place, TripAnswers, TripBackBy, TripDays, TripDiet, TripInterest } from "../api/types";
import { Icon } from "./Icon";
import { PlaceInput } from "./PlaceInput";
import { Button } from "./ui/Button";
import { Eyebrow } from "./ui/Eyebrow";
import { ToggleChip } from "./ui/ToggleChip";

const MAX_INTERESTS = 3;
const DAYS: readonly { id: TripDays; label: string }[] = [
  { id: 0.5, label: "Half day" },
  { id: 1, label: "1 day" },
  { id: 2, label: "2 days" },
  { id: 3, label: "3 days" },
];
const INTERESTS: readonly { id: TripInterest; label: string }[] = [
  { id: "food", label: "Food trails" },
  { id: "heritage", label: "History" },
  { id: "temples", label: "Temples" },
  { id: "nature", label: "Nature" },
  { id: "markets", label: "Markets" },
  { id: "cafes", label: "Cafés" },
];
const DIETS: readonly { id: TripDiet; label: string }[] = [
  { id: "veg", label: "Veg" },
  { id: "egg", label: "Egg is fine" },
  { id: "any", label: "Anything" },
];
const BACK_BY: readonly { id: TripBackBy; label: string }[] = [
  { id: "sunset", label: "Before dark" },
  { id: "20:00", label: "By 8 pm" },
  { id: "22:00", label: "By 10 pm" },
];

interface Props {
  cityId: string;
  base?: Place;
  answers: TripAnswers;
  planning: boolean;
  onBase(place: Place | undefined): void;
  onAnswer(patch: Partial<TripAnswers>): void;
  onPlan(): void;
}

function Choices<T extends string | number>({
  label,
  options,
  isOn,
  isDisabled = () => false,
  onPick,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  isOn(id: T): boolean;
  isDisabled?(id: T): boolean;
  onPick(id: T): void;
}) {
  return (
    <div className="trip-planner__chips" role="group" aria-label={label}>
      {options.map(({ id, label: text }) => (
        <ToggleChip key={id} aria-pressed={isOn(id)} on={isOn(id)} disabled={isDisabled(id)} onClick={() => onPick(id)}>
          {text}
        </ToggleChip>
      ))}
    </div>
  );
}

export function TripPlanner({ cityId, base, answers, planning, onBase, onAnswer, onPlan }: Props) {
  const toggleInterest = (id: TripInterest) =>
    onAnswer({ interests: answers.interests.includes(id) ? answers.interests.filter((i) => i !== id) : [...answers.interests, id] });

  return (
    <div className="trip-planner">
      <header className="trip-planner__head">
        <Eyebrow icon="sparkle">Day out on two wheels</Eyebrow>
        <h1>Where are you starting from?</h1>
      </header>
      <PlaceInput cityId={cityId} value={base} placeholder="Your hotel, home or a landmark" dotClass="is-origin" onChange={onBase} />

      <section className="trip-planner__question">
        <h2>How long?</h2>
        <Choices label="How long" options={DAYS} isOn={(id) => answers.days === id} onPick={(days) => onAnswer({ days })} />
      </section>
      <section className="trip-planner__question">
        <h2>
          Into <span>pick up to {MAX_INTERESTS}</span>
        </h2>
        <Choices
          label="Interests"
          options={INTERESTS}
          isOn={(id) => answers.interests.includes(id)}
          isDisabled={(id) => !answers.interests.includes(id) && answers.interests.length >= MAX_INTERESTS}
          onPick={toggleInterest}
        />
      </section>
      <section className="trip-planner__question">
        <h2>Food</h2>
        <Choices label="Food" options={DIETS} isOn={(id) => answers.diet === id} onPick={(diet) => onAnswer({ diet })} />
      </section>
      <section className="trip-planner__question">
        <h2>Back by</h2>
        <Choices label="Back by" options={BACK_BY} isOn={(id) => answers.backBy === id} onPick={(backBy) => onAnswer({ backBy })} />
      </section>

      <Button variant="primary" wide onClick={onPlan} disabled={!base || planning} aria-busy={planning}>
        <Icon name="sparkle" size={16} /> {planning ? "Planning your trip…" : "Plan my trip"}
      </Button>
      <p className="hint">
        <Icon name="shield" size={13} /> Only real places from the map. Any ride can be safety-checked.
      </p>
    </div>
  );
}
