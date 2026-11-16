import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";

export function Eyebrow({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return (
    <span className="eyebrow">
      {icon && <Icon name={icon} size={13} />}
      {icon && " "}
      {children}
    </span>
  );
}
