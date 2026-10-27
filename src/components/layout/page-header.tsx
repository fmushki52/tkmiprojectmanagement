import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Full-width gold title band (as in Daerat Toloba). It bleeds to the edges of the content column using
 * negative margins that mirror the page padding set in AppShell.
 */
export function PageBand({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("-mx-4 mb-6 bg-gold-band px-4 py-5 text-foreground md:-mx-6 md:px-6 print:bg-transparent", className)}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <PageBand className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-normal tracking-tight">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-foreground/75">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </PageBand>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-foreground/25 bg-card/60 px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-muted-foreground [&_svg]:size-8">{icon}</div> : null}
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
