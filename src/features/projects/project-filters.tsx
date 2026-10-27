"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PRIORITIES, PROJECT_STATUSES } from "@/lib/validation";
import { label } from "@/lib/format";

/** Filters live in the URL so lists are shareable, bookmarkable and server-rendered. */
export function ProjectFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.replace(`${pathname}?${next.toString()}`);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) update("q", q.trim());
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="search">
      <div className="relative min-w-52 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
        <Input aria-label="Search projects" placeholder="Search projects, tags…" className="pl-8" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <NativeSelect aria-label="Filter by status" className="w-40" value={params.get("status") ?? ""} onChange={(e) => update("status", e.target.value)}>
        <option value="">All statuses</option>
        {PROJECT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {label(s)}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label="Filter by priority" className="w-36" value={params.get("priority") ?? ""} onChange={(e) => update("priority", e.target.value)}>
        <option value="">All priorities</option>
        {PRIORITIES.map((s) => (
          <option key={s} value={s}>
            {label(s)}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect aria-label="Show" className="w-36" value={params.get("scope") ?? "active"} onChange={(e) => update("scope", e.target.value === "active" ? "" : e.target.value)}>
        <option value="active">Active</option>
        <option value="archived">Archived</option>
        <option value="all">All</option>
      </NativeSelect>
      <NativeSelect aria-label="Sort by" className="w-44" value={`${params.get("sort") ?? "updated"}:${params.get("dir") ?? "desc"}`} onChange={(e) => {
        const [sort, dir] = e.target.value.split(":");
        const next = new URLSearchParams(params.toString());
        next.set("sort", sort);
        next.set("dir", dir);
        router.replace(`${pathname}?${next.toString()}`);
      }}>
        <option value="updated:desc">Recently updated</option>
        <option value="title:asc">Title A–Z</option>
        <option value="end:asc">Deadline (soonest)</option>
        <option value="start:desc">Start date (latest)</option>
        <option value="priority:desc">Priority (highest)</option>
        <option value="status:asc">Status</option>
      </NativeSelect>
    </div>
  );
}
