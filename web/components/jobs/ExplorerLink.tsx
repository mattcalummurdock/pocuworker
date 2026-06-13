import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { explorerUrl, type ExplorerLinkKind } from "@/lib/explorer";

interface ExplorerLinkProps {
  value: string;
  kind: ExplorerLinkKind;
  serial?: number | string;
  href?: string | null;
  className?: string;
  mono?: boolean;
  light?: boolean;
  children?: ReactNode;
}

export function ExplorerLink({
  value,
  kind,
  serial,
  href: hrefOverride,
  className,
  mono,
  light,
  children,
}: ExplorerLinkProps) {
  const href = hrefOverride ?? explorerUrl(value, kind, serial);
  const display = children ?? value;

  if (!href) {
    return (
      <span
        className={cn(
          light ? "text-foreground" : "",
          mono && "break-all font-mono text-xs",
          className
        )}
      >
        {display}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        light
          ? "text-foreground hover:underline"
          : "text-accent hover:underline",
        mono && "break-all font-mono text-xs",
        className
      )}
    >
      {display}
    </a>
  );
}
