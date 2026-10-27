"use client";

import {
  Bell,
  CalendarRange,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FileBarChart,
  FolderKanban,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  User,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, useSyncExternalStore } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { authClient } from "@/lib/auth/client";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ShellProps {
  slug: string;
  workspaceName: string;
  workspaces: { slug: string; name: string }[];
  user: { name: string; email: string };
  unread: number;
  /** Whether the viewer may open User Management (server enforces this independently). */
  canManageUsers: boolean;
  children: React.ReactNode;
}

const NAV = [
  { href: "", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/tasks", label: "My Tasks", icon: CheckSquare },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/timeline", label: "Timeline", icon: CalendarRange },
  { href: "/reports", label: "Reports", icon: FileBarChart },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/users", label: "User Management", icon: Users, requiresManage: true },
  { href: "/settings", label: "Workspace Settings", icon: Settings },
  { href: "/profile", label: "Profile Settings", icon: User },
] as const;

/** Round, outlined icon button used in the green top bar. */
const barIcon =
  "relative grid size-10 place-items-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-mint focus-visible:outline-none";

function NavList({ slug, unread, collapsed, canManageUsers, onNavigate }: { slug: string; unread: number; collapsed: boolean; canManageUsers: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="py-2">
      {NAV.filter((item) => !("requiresManage" in item) || canManageUsers).map(({ href, label, icon: Icon, ...rest }) => {
        const full = `/w/${slug}${href}`;
        const active = "exact" in rest && rest.exact ? pathname === full : pathname === full || pathname.startsWith(`${full}/`);
        const link = (
          <Link
            href={full}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-3 border-l-[3px] px-5 py-3 text-sm font-medium transition-colors focus-visible:bg-white/10 focus-visible:outline-none",
              active ? "border-mint bg-white/[0.06] text-gold" : "border-transparent text-white/85 hover:bg-white/5 hover:text-white",
              collapsed && "justify-center px-0",
            )}
          >
            <Icon className="size-[18px] shrink-0" />
            {collapsed ? <span className="sr-only">{label}</span> : <span className="flex-1 truncate">{label}</span>}
            {label === "Notifications" && unread > 0 ? (
              <span
                className={cn("grid min-w-5 place-items-center rounded-full bg-gold px-1 text-[10px] font-semibold text-emerald-950", collapsed && "absolute top-1 right-2")}
                aria-label={`${unread} unread`}
              >
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </Link>
        );
        return collapsed ? (
          <Tooltip key={href}>
            <TooltipTrigger render={link} />
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ) : (
          <div key={href}>{link}</div>
        );
      })}
    </nav>
  );
}

function UserBlock({ slug, user, collapsed, onNavigate }: { slug: string; user: { name: string; email: string }; collapsed: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={`/w/${slug}/profile`}
      onClick={onNavigate}
      className={cn("flex items-center gap-3 px-5 py-5 text-white transition-colors hover:bg-white/5 focus-visible:bg-white/10 focus-visible:outline-none", collapsed && "justify-center px-0")}
      aria-label={`${user.name} – profile settings`}
    >
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-gold to-amber-700 text-sm font-semibold text-emerald-950 ring-2 ring-white/20">
        {initials(user.name)}
      </span>
      {!collapsed ? (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-xs text-white/55">{user.email}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-white/50" />
        </>
      ) : null}
    </Link>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button type="button" className={barIcon} aria-label="Toggle light and dark theme" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
      <Sun className="hidden size-5 dark:block" />
      <Moon className="size-5 dark:hidden" />
    </button>
  );
}

const SIDEBAR_KEY = "sidebar-collapsed";
const sidebarListeners = new Set<() => void>();
function subscribeSidebar(cb: () => void) {
  sidebarListeners.add(cb);
  return () => void sidebarListeners.delete(cb);
}
function readSidebar() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export function AppShell({ slug, workspaceName, workspaces, user, unread, canManageUsers, children }: ShellProps) {
  const router = useRouter();
  // Per-viewer preference kept in localStorage (read without hydration mismatch; falls back to expanded).
  const collapsed = useSyncExternalStore(subscribeSidebar, readSidebar, () => false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [q, setQ] = useState("");

  function toggle() {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "0" : "1");
    } catch {}
    sidebarListeners.forEach((cb) => cb());
  }
  async function signOut() {
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>

      {/* Top bar */}
      <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-2 bg-sidebar px-3 text-white print:hidden md:px-0">
        <div className={cn("hidden shrink-0 items-center gap-3 px-5 transition-[width] md:flex", collapsed ? "w-[4.5rem] justify-center px-0" : "w-64")}>
          <Image src="/Kuwait_Logo.png" alt="" width={40} height={40} className="size-10 shrink-0 object-contain brightness-0 invert" priority />
          {!collapsed ? (
            <span className="truncate text-xl tracking-tight">
              <span className="font-semibold">Project</span>
              <span className="font-light">Tracker</span>
            </span>
          ) : null}
        </div>
        <button type="button" className={cn(barIcon, "md:hidden")} aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
          <Menu className="size-6" />
        </button>
        <button type="button" className={cn(barIcon, "hidden md:grid")} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} onClick={toggle}>
          <Menu className="size-6" />
        </button>

        <form
          role="search"
          className="relative ml-1 hidden w-72 max-w-[40vw] sm:block"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/w/${slug}/projects${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
          }}
        >
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-neutral-500" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search projects"
            placeholder="Search & enter"
            className="h-11 w-full rounded-full bg-white pr-4 pl-10 text-sm text-neutral-900 placeholder:text-neutral-500 focus-visible:ring-2 focus-visible:ring-mint focus-visible:outline-none"
          />
        </form>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Switch workspace"
            className="ml-2 hidden max-w-52 items-center gap-1.5 rounded-full border border-white/25 px-3.5 py-2 text-sm text-white transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-mint focus-visible:outline-none lg:flex"
          >
            <span className="truncate">{workspaceName}</span>
            <ChevronDown className="size-4 shrink-0 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {workspaces.map((w) => (
                <DropdownMenuItem key={w.slug} render={<Link href={`/w/${w.slug}`} />}>
                  <span className="truncate">{w.name}</span>
                  {w.slug === slug ? <span className="ml-auto text-xs text-muted-foreground">current</span> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/onboarding" />}>
              <Plus /> New workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-0.5 pr-2 md:pr-5">
          <Link href={`/w/${slug}`} className={barIcon} aria-label="Dashboard home">
            <Home className="size-5" />
          </Link>
          <Link href={`/w/${slug}/notifications`} className={barIcon} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
            <Bell className="size-5" />
            {unread > 0 ? <span className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-red-500 ring-2 ring-sidebar" /> : null}
          </Link>
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Account menu"
              className="ml-1 flex items-center gap-2 rounded-full py-1 pr-2 pl-1 text-sm text-white/90 transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-mint focus-visible:outline-none"
            >
              <Avatar>
                <AvatarFallback className="bg-gradient-to-br from-gold to-amber-700 font-semibold text-emerald-950">{initials(user.name)}</AvatarFallback>
              </Avatar>
              <span className="hidden max-w-32 truncate md:inline">{user.name}</span>
              <ChevronDown className="size-4 opacity-70" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
                  <span className="block truncate">{user.email}</span>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href={`/w/${slug}/profile`} />}>
                <User /> Profile settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={signOut}>
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className={cn("sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 overflow-y-auto bg-sidebar transition-[width] print:!hidden md:block", collapsed ? "w-[4.5rem]" : "w-64")}>
          <UserBlock slug={slug} user={user} collapsed={collapsed} />
          <div className="h-px bg-white/10" />
          <NavList slug={slug} unread={unread} collapsed={collapsed} canManageUsers={canManageUsers} />
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0 text-white sm:max-w-72 [&_[data-slot=sheet-close]]:text-white">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <div className="flex items-center gap-3 px-5 pt-5">
              <Image src="/Kuwait_Logo.png" alt="" width={36} height={36} className="size-9 object-contain brightness-0 invert" />
              <span className="text-lg">
                <span className="font-semibold">Project</span>
                <span className="font-light">Tracker</span>
              </span>
            </div>
            <UserBlock slug={slug} user={user} collapsed={false} onNavigate={() => setMobileOpen(false)} />
            <div className="h-px bg-white/10" />
            <NavList slug={slug} unread={unread} collapsed={false} canManageUsers={canManageUsers} onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <main id="main" className="min-w-0 flex-1 px-4 pb-10 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
