"use client";

/**
 * Generic smart links sidebar panel.
 *
 * Groups links by provider, renders a provider header (icon + name + count),
 * and delegates each link row to the provider's own `LinkRow` component.
 *
 * Replaces `GitHubLinksSidebarPanel` — providers control their own rendering.
 */

import { getProvider, getProviders } from "@/lib/smart-links/registry";
import type { SmartLinkReference } from "@/lib/smart-links/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SmartLinksSidebarPanelProps {
  refs: SmartLinkReference[];
  statuses: Map<string, unknown>;
  onDismiss: (url: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SmartLinksSidebarPanel({
  refs,
  statuses,
  onDismiss,
}: SmartLinksSidebarPanelProps) {
  if (refs.length === 0) return null;

  // Group by provider, preserving registration order
  const providerOrder = getProviders().map((p) => p.name);
  const grouped = new Map<string, SmartLinkReference[]>();

  for (const ref of refs) {
    const existing = grouped.get(ref.provider) ?? [];
    existing.push(ref);
    grouped.set(ref.provider, existing);
  }

  // Sort groups by provider registration order; unknown providers go last
  const sortedGroups = [...grouped.entries()].sort(([a], [b]) => {
    const ai = providerOrder.indexOf(a);
    const bi = providerOrder.indexOf(b);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return (
    <div className="space-y-4" data-testid="smart-links-sidebar-panel">
      {sortedGroups.map(([providerName, providerRefs]) => {
        const provider = getProvider(providerName);
        if (!provider) return null;

        const Icon = provider.icon;
        const LinkRow = provider.LinkRow;

        return (
          <section key={providerName}>
            {/* Provider header */}
            <div className="flex items-center gap-1.5 mb-2">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {provider.displayName}
              </p>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {providerRefs.length}
              </span>
            </div>

            {/* Link rows */}
            <div className="space-y-1.5">
              {providerRefs.map((ref) => (
                <LinkRow
                  key={ref.url}
                  ref_={ref}
                  status={statuses.get(ref.url)}
                  onDismiss={() => onDismiss(ref.url)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
