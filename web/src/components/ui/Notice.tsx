import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/Icon";

interface Props {
  tone: "error" | "info";
  icon?: IconName;
  alert?: boolean;
  children: ReactNode;
}

export function Notice({ tone, icon = "alert", alert = false, children }: Props) {
  return (
    <div className={`notice notice--${tone}`} {...(alert ? { role: "alert" } : {})}>
      <Icon name={icon} size={15} /> {children}
    </div>
  );
}
