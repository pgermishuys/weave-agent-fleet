"use client";

import Link from "next/link";
import { FolderGit2 } from "lucide-react";
import { Header } from "@/components/layout/header";
import { useRepositories } from "@/hooks/use-repositories";

export default function RepositoriesPage() {
  const { repositories, isLoading } = useRepositories();

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Repositories"
        subtitle="Browse local git repositories"
      />
      <div className="flex-1 overflow-auto thin-scrollbar p-6">
        {isLoading ? null : repositories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <FolderGit2 className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No repositories found.
            </p>
            <p className="text-xs text-muted-foreground/70">
              Configure workspace roots in{" "}
              <Link href="/settings" className="underline hover:text-foreground">
                Settings &rsaquo; Repositories
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <FolderGit2 className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Select a repository from the sidebar to view details.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
