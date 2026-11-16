import type { ReactNode } from "react";

interface Props {
  className: string;
  before?: ReactNode;
  title: ReactNode;
  titleClassName?: string;
  children?: ReactNode;
}

/** A panel's heading: an eyebrow, back link or chip before the title, then any description. */
export function SheetHeader({ className, before, title, titleClassName, children }: Props) {
  return (
    <header className={className}>
      {before}
      <h2 className={titleClassName}>{title}</h2>
      {children}
    </header>
  );
}
