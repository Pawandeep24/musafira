import { useEffect, useState } from "react";
import { Icon, type IconName } from "./Icon";

const STEPS: readonly { icon: IconName; text: string }[] = [
  { icon: "roadType", text: "Finding two-wheeler routes" },
  { icon: "clock", text: "Timing every 100 m of the ride" },
  { icon: "lighting", text: "Reading streetlight from space" },
  { icon: "openShops", text: "Checking which shops will be open" },
  { icon: "safetyStops", text: "Locating police and 24-hour help" },
  { icon: "signal", text: "Mapping mobile signal" },
  { icon: "crowd", text: "Estimating how busy the roads are" },
];

export function Scanning() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 420);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="scanning" aria-live="polite">
      {STEPS.slice(0, step + 1).map((s, i) => (
        <div key={s.text} className={`scanning__step ${i === step ? "is-active" : "is-done"}`}>
          <Icon name={s.icon} size={15} />
          <span>{s.text}</span>
        </div>
      ))}
      <div className="scanning__card" />
      <div className="scanning__card" />
    </div>
  );
}
