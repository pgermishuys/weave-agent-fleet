"use client";

import { useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Github, Settings, FolderGit2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  useSidebar,
  viewHasPanel,
  type SidebarView,
} from "@/contexts/sidebar-context";


// ── Default routes per view ──────────────────────────────────────────────────

const VIEW_DEFAULT_ROUTE: Record<SidebarView, string> = {
  welcome: "/welcome",
  fleet: "/",
  github: "/github",
  repositories: "/repositories",
};

/** Routes that belong to the fleet view */
function isFleetRoute(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/sessions");
}

/** Map a pathname to the view it belongs to (if any) */
export function viewForPathname(pathname: string): SidebarView | null {
  if (pathname === "/welcome") return "welcome";
  if (pathname === "/github" || pathname.startsWith("/github/")) return "github";
  if (pathname === "/repositories" || pathname.startsWith("/repositories/")) return "repositories";
  if (isFleetRoute(pathname)) return "fleet";
  return null;
}

export function nextViewForSwitch(
  activeView: SidebarView,
  targetView: SidebarView
): SidebarView {
  if (activeView === targetView && viewHasPanel(targetView)) {
    return "welcome";
  }

  return targetView;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface IconRailButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  view: SidebarView;
  onSwitch: (view: SidebarView) => void;
}

function IconRailButton({ icon: Icon, label, view, onSwitch }: IconRailButtonProps) {
  const { activeView } = useSidebar();
  const isActive = activeView === view;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={isActive}
          aria-label={label}
          onClick={() => onSwitch(view)}
          className={cn(
            "relative flex h-10 w-full items-center justify-center rounded-sm transition-colors",
            isActive
              ? "text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
          )}
        >
          {/* Active left-border indicator */}
          {isActive && (
            <span
              aria-hidden="true"
              className="absolute left-0 top-1/4 h-1/2 w-0.5 rounded-r-sm bg-icon-rail-active"
            />
          )}
          <Icon className="h-5 w-5 shrink-0" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

interface IconRailLinkProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href: string;
}

function IconRailLink({ icon: Icon, label, href }: IconRailLinkProps) {
  const pathname = usePathname();
  const isActive = pathname.startsWith(href);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={label}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "relative flex h-10 w-full items-center justify-center rounded-sm transition-colors",
            isActive
              ? "text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground"
          )}
        >
          {/* Active left-border indicator */}
          {isActive && (
            <span
              aria-hidden="true"
              className="absolute left-0 top-1/4 h-1/2 w-0.5 rounded-r-sm bg-icon-rail-active"
            />
          )}
          <Icon className="h-5 w-5 shrink-0" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function VersionBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <p className="text-center text-[9px] text-muted-foreground/40 select-none py-1 cursor-default leading-tight">
          v{process.env.NEXT_PUBLIC_APP_VERSION?.split(".")[0]}
        </p>
      </TooltipTrigger>
      <TooltipContent side="right">
        v{process.env.NEXT_PUBLIC_APP_VERSION} ·{" "}
        {process.env.NEXT_PUBLIC_COMMIT_SHA}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SidebarIconRail() {
  const { activeView, panelOpen, setActiveView } = useSidebar();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isWelcome = activeView === "welcome";

  // Full URL including search params (e.g. /sessions/abc?instanceId=xyz)
  const fullUrl = searchParams.toString()
    ? `${pathname}?${searchParams.toString()}`
    : pathname;

  // Track the last pathname visited for each view so we can restore it
  const lastPathByView = useRef<Record<string, string>>({
    welcome: VIEW_DEFAULT_ROUTE.welcome,
    fleet: VIEW_DEFAULT_ROUTE.fleet,
    github: VIEW_DEFAULT_ROUTE.github,
    repositories: VIEW_DEFAULT_ROUTE.repositories,
  });

  // Keep the map up-to-date as the user navigates within a view
  useEffect(() => {
    const owningView = viewForPathname(pathname);
    if (owningView) {
      lastPathByView.current[owningView] = fullUrl;
    }
  }, [fullUrl, pathname]);

  // Route is source-of-truth for active view on direct navigation/history.
  useEffect(() => {
    const owningView = viewForPathname(pathname);
    if (owningView && owningView !== activeView) {
      setActiveView(owningView);
    }
  }, [activeView, pathname, setActiveView]);

  // Navigate when activeView changes (handles both clicks AND ⌘B toggle).
  // We use a ref to track the previous view so this only fires on actual changes,
  // not on every render.
  const prevViewRef = useRef(activeView);
  useEffect(() => {
    if (prevViewRef.current === activeView) return;
    prevViewRef.current = activeView;

    const target = lastPathByView.current[activeView] ?? VIEW_DEFAULT_ROUTE[activeView];
    // Only navigate if we're not already on a route belonging to this view
    if (viewForPathname(pathname) !== activeView) {
      router.push(target);
    }
  }, [activeView, pathname, router]);

  // Switch to a view (used by icon rail buttons)
  const handleSwitch = useCallback(
    (view: SidebarView) => {
      setActiveView(nextViewForSwitch(activeView, view));
    },
    [activeView, setActiveView]
  );

  return (
    <div
      role="toolbar"
      aria-label="Sidebar navigation"
      aria-orientation="vertical"
      className={cn(
        "flex w-12 shrink-0 flex-col bg-icon-rail py-1",
        // Only show the right border when the panel is open (it acts as the
        // rail/panel separator). When the panel is closed the <aside>'s own
        // border-r handles the sidebar/main boundary.
        panelOpen && "border-r border-icon-rail-border"
      )}
    >
      {/* Weave logo — welcome tab */}
      <div className="flex flex-col items-center px-1 pb-1 mb-1 border-b border-icon-rail-border">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-pressed={isWelcome}
              aria-label="Weave Agent Fleet"
              onClick={() => handleSwitch("welcome")}
              className={cn(
                "relative flex h-10 w-full items-center justify-center rounded-sm transition-opacity hover:opacity-80",
                isWelcome && "ring-1 ring-icon-rail-active/30 rounded-md"
              )}
            >
              {isWelcome && (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-1/4 h-1/2 w-0.5 rounded-r-sm bg-icon-rail-active"
                />
              )}
              <Image
                src="/weave_logo.png"
                alt="Weave"
                width={28}
                height={28}
                className="shrink-0 rounded-md"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Weave Agent Fleet</TooltipContent>
        </Tooltip>
      </div>

      {/* Top section: view togglers */}
      <div className="flex flex-col gap-0.5 px-1">
        <IconRailButton icon={LayoutGrid} label="Fleet" view="fleet" onSwitch={handleSwitch} />
        <IconRailButton icon={Github} label="GitHub" view="github" onSwitch={handleSwitch} />
        <IconRailButton icon={FolderGit2} label="Repositories" view="repositories" onSwitch={handleSwitch} />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom section: page links + version */}
      <div className="flex flex-col gap-0.5 px-1">
        <IconRailLink icon={Settings} label="Settings" href="/settings" />
        <VersionBadge />
      </div>
    </div>
  );
}
