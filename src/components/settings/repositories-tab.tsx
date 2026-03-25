"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderGit2, Loader2, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DirectoryPicker } from "@/components/session/directory-picker";
import { apiFetch } from "@/lib/api-client";
import type {
  WorkspaceRootsResponse,
  WorkspaceRootItem,
  AddWorkspaceRootResponse,
} from "@/lib/api-types";

export function RepositoriesTab() {
  const [roots, setRoots] = useState<WorkspaceRootItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newPath, setNewPath] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchRoots = useCallback(async () => {
    try {
      const res = await apiFetch("/api/workspace-roots");
      if (!res.ok) throw new Error("Failed to load workspace roots");
      const data: WorkspaceRootsResponse = await res.json();
      setRoots(data.roots);
    } catch {
      // Keep existing roots on error
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRoots();
  }, [fetchRoots]);

  const handleAdd = useCallback(async () => {
    const trimmed = newPath.trim();
    if (!trimmed) return;
    setAddError(null);
    setIsAdding(true);
    try {
      const res = await apiFetch("/api/workspace-roots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmed }),
      });
      const data: AddWorkspaceRootResponse | { error: string } = await res.json();
      if (!res.ok) {
        setAddError("error" in data ? data.error : "Failed to add directory");
        return;
      }
      setNewPath("");
      await fetchRoots();
      // Invalidate the repository scan cache so the panel reflects the new root
      await apiFetch("/api/repositories/refresh", { method: "POST" });
    } catch {
      setAddError("Unexpected error. Please try again.");
    } finally {
      setIsAdding(false);
    }
  }, [newPath, fetchRoots]);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        const res = await apiFetch(`/api/workspace-roots/${id}`, { method: "DELETE" });
        if (!res.ok) return;
        await fetchRoots();
        // Invalidate the repository scan cache
        await apiFetch("/api/repositories/refresh", { method: "POST" });
      } finally {
        setDeletingId(null);
      }
    },
    [fetchRoots]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") void handleAdd();
      if (e.key === "Escape") {
        setNewPath("");
        setAddError(null);
      }
    },
    [handleAdd]
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <p className="text-sm text-muted-foreground">
          Configure parent directories to scan for git repositories. Immediate
          child folders of each directory are checked for a{" "}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">.git</code>{" "}
          folder.
        </p>
      </div>

      {/* Current roots */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Configured directories</h3>

        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : roots.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <FolderGit2 className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">No directories configured.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {roots.map((root) => (
              <Card key={root.id ?? root.path}>
                <CardContent className="p-3 flex items-center gap-3">
                  <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-sm font-mono truncate" title={root.path}>
                    {root.path}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      variant="outline"
                      className="text-[10px]"
                    >
                      {root.source === "env" ? "Environment" : "Custom"}
                    </Badge>
                    {!root.exists && (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-destructive border-destructive/50"
                      >
                        Missing
                      </Badge>
                    )}
                    {root.source === "user" && root.id !== null && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        disabled={deletingId === root.id}
                        onClick={() => root.id !== null && void handleDelete(root.id)}
                        aria-label={`Remove ${root.path}`}
                      >
                        {deletingId === root.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Add directory */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Add directory</h3>
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
        <div
          className="flex gap-2 items-start"
          onKeyDown={handleKeyDown}
        >
          <div className="flex-1">
            <DirectoryPicker
              value={newPath}
              onChange={(path) => {
                setNewPath(path);
                setAddError(null);
              }}
              placeholder="/home/user/repos"
              disabled={isAdding}
            />
          </div>
          <Button
            onClick={() => void handleAdd()}
            disabled={isAdding || !newPath.trim()}
            size="sm"
            className="gap-1.5 shrink-0"
          >
            {isAdding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add
          </Button>
        </div>
        {addError && (
          <p className="text-xs text-destructive">{addError}</p>
        )}
      </div>
    </div>
  );
}
