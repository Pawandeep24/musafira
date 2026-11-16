import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "../Icon";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label: string;
  iconSize?: number;
}

export function IconButton({ icon, label, iconSize = 16, className, ...rest }: Props) {
  return (
    <button className={className ? `icon-button ${className}` : "icon-button"} aria-label={label} {...rest}>
      <Icon name={icon} size={iconSize} />
    </button>
  );
}
