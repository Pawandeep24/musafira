import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "light" | "danger" | "sos";

interface Look {
  variant?: ButtonVariant;
  wide?: boolean;
}

const buttonClass = (variant: ButtonVariant | undefined, wide: boolean | undefined, className: string | undefined) =>
  ["button", variant && `button--${variant}`, wide && "button--wide", className].filter(Boolean).join(" ");

export function Button({ variant, wide, className, ...rest }: Look & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={buttonClass(variant, wide, className)} {...rest} />;
}

export function ButtonLink({ variant, wide, className, ...rest }: Look & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={buttonClass(variant, wide, className)} {...rest} />;
}
