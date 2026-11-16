import type { ButtonHTMLAttributes } from "react";

export function ToggleChip({ on, className, ...rest }: { on: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={["chip chip--preset", className, on && "is-on"].filter(Boolean).join(" ")} {...rest} />;
}
