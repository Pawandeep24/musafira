import type { ReactNode } from "react";

type Kind = "tabs" | "radio" | "toggle";

const GROUP_ROLE: Record<Kind, string> = { tabs: "tablist", radio: "radiogroup", toggle: "group" };
const ITEM_ROLE: Record<Kind, string | undefined> = { tabs: "tab", radio: "radio", toggle: undefined };

interface Props<T extends string | number> {
  options: readonly (readonly [T, ReactNode])[];
  value: NoInfer<T> | undefined;
  onChange(value: NoInfer<T>): void;
  kind?: Kind;
  label?: string;
  small?: boolean;
  className?: string;
}

export function Segmented<T extends string | number>({ options, value, onChange, kind, label, small = false, className }: Props<T>) {
  return (
    <div className={["segmented", small && "segmented--small", className].filter(Boolean).join(" ")} role={kind && GROUP_ROLE[kind]} aria-label={label}>
      {options.map(([id, text]) => (
        <button
          key={id}
          role={kind && ITEM_ROLE[kind]}
          aria-selected={kind === "tabs" ? id === value : undefined}
          aria-checked={kind === "radio" ? id === value : undefined}
          aria-pressed={kind === "toggle" ? id === value : undefined}
          className={id === value ? "is-on" : ""}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
