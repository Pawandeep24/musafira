import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon";

interface Props {
  icon: IconName;
  tone?: "accent" | "risk";
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel: string;
  busy: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog({ icon, tone = "accent", title, children, confirmLabel, busyLabel, cancelLabel, busy, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  // Portalled because a backdrop-filter on any ancestor panel would trap position: fixed inside it.
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={() => !busy && onCancel()}>
      <div className="dialog glass confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(e) => e.stopPropagation()}>
        <span className={`confirm__icon is-${tone}`}>
          <Icon name={icon} size={22} />
        </span>
        <h2 id="confirm-title">{title}</h2>
        {children}
        <div className="confirm__actions">
          <button className="button button--ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button className={`button ${tone === "risk" ? "button--danger" : "button--primary"}`} onClick={onConfirm} disabled={busy} aria-busy={busy} autoFocus>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
