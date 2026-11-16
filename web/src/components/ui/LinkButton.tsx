import type { ButtonHTMLAttributes } from "react";

export function LinkButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={className ? `link-button ${className}` : "link-button"} {...rest} />;
}
