"use client";

import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState, useMemo } from "react";
import { useSessionHistory } from "@/hooks/use-session-history";

// ─── Status helpers (local to avoid coupling to mock-data) ──────────────────

function getStatusDot(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-500";
    case "idle":
      return "bg-zinc-400";
    case "stopped":
      return "bg-red-500";
    case "completed":
      return "bg-blue-500";
    case "disconnected":
      return "bg-amber-500";
    default:
      return "bg-zinc-500";
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "active":
      return "text-green-500";
    case "idle":
      return "text-zinc-400";
    case "stopped":
      return "text-red-500";
    case "completed":
      return "text-blue-500";
    case "disconnected":
      return "text-amber-500";
    default:
      return "text-zinc-500";
  }
}

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "idle", label: "Idle" },
  { value: "stopped", label: "Stopped" },
  { value: "completed", label: "Completed" },
  { value: "disconnected", label: "Disconnected" },
];

const PAGE_SIZE = 20;

export default function HistoryPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(0);

  const filters = useMemo(
    () => ({
      search,
      status,
      fromDate,
      toDate,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [search, status, fromDate, toDate, page]
  );

  const { sessions, total, isLoading, error } = useSessionHistory(filters);

  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min((page + 1) * PAGE_SIZE, total);
  const hasPrev = page > 0;
  const hasNext = (page + 1) * PAGE_SIZE < total;

  // Reset to page 0 when filters change
  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(0);
  };
  const handleStatusChange = (value: string) => {
    setStatus(value);
    setPage(0);
  };
  const handleFromChange = (value: string) => {
    setFromDate(value);
    setPage(0);
  };
  const handleToChange = (value: string) => {
    setToDate(value);
    setPage(0);
  };

  return (
    <div className="flex flex-col h-full">
      <Header
        title="History"
        subtitle={`${total} total sessions`}
      />
      <div className="flex-1 overflow-auto p-6 space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-md flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search sessions by title..."
              className="pl-10"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
            />
          </div>

          <select
            value={status}
            onChange={(e) => handleStatusChange(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={fromDate}
            onChange={(e) => handleFromChange(e.target.value)}
            placeholder="From"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />

          <input
            type="date"
            value={toDate}
            onChange={(e) => handleToChange(e.target.value)}
            placeholder="To"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {/* Error state */}
        {error && (
          <p className="text-center text-red-500 py-4">Error loading sessions: {error}</p>
        )}

        {/* Loading skeleton */}
        {isLoading && sessions.length === 0 && (
          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-accent/30">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-12" />
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Title</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Directory</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Created</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-4 py-2.5"><div className="h-2 w-2 rounded-full bg-muted animate-pulse" /></td>
                    <td className="px-4 py-2.5"><div className="h-4 w-48 rounded bg-muted animate-pulse" /></td>
                    <td className="px-4 py-2.5"><div className="h-4 w-36 rounded bg-muted animate-pulse" /></td>
                    <td className="px-4 py-2.5"><div className="h-5 w-16 rounded bg-muted animate-pulse" /></td>
                    <td className="px-4 py-2.5 text-right"><div className="h-4 w-24 rounded bg-muted animate-pulse ml-auto" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Table */}
        {!isLoading && sessions.length > 0 && (
          <div className="rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-accent/30">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground w-12" />
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Title</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Directory</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Created</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.id} className="border-b hover:bg-accent/20 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className={`inline-block h-2 w-2 rounded-full ${getStatusDot(session.status)}`} />
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/sessions/${session.id}?instanceId=${session.instanceId}`}
                        className="font-medium hover:underline"
                      >
                        {session.title || "Untitled"}
                      </Link>
                      {session.workspaceDisplayName && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {session.workspaceDisplayName}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 max-w-xs truncate text-muted-foreground">
                      {session.directory}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="secondary" className={`text-[10px] ${getStatusColor(session.status)}`}>
                        {session.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground whitespace-nowrap">
                      {new Date(session.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && sessions.length === 0 && !error && (
          <p className="text-center text-muted-foreground py-8">No sessions found</p>
        )}

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-sm text-muted-foreground">
              Showing {rangeStart}–{rangeEnd} of {total} sessions
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={!hasPrev}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background hover:bg-accent disabled:opacity-50 disabled:pointer-events-none"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!hasNext}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background hover:bg-accent disabled:opacity-50 disabled:pointer-events-none"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
