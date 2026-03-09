import { NextRequest, NextResponse } from "next/server";
import { validateDirectory } from "@/lib/server/process-manager";
import { spawn } from "child_process";
import { isValidToolId, getSpawnCommand } from "@/lib/server/tool-registry";
import { getMergedToolsConfig } from "@/lib/server/config-manager";

interface OpenDirectoryRequest {
  directory: string;
  tool: string;
}

// POST /api/open-directory — open a workspace directory in an editor, terminal, or file explorer
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: OpenDirectoryRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { directory, tool } = body;

  // Validate required fields
  if (!directory || typeof directory !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'directory' field" },
      { status: 400 }
    );
  }

  if (!tool || typeof tool !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'tool' field" },
      { status: 400 }
    );
  }

  // SECURITY GATE: validate tool ID against registry + custom tools from config
  const toolsConfig = getMergedToolsConfig();
  const isBuiltin = isValidToolId(tool);
  const isCustom = !!toolsConfig.custom?.[tool];

  if (!isBuiltin && !isCustom) {
    return NextResponse.json(
      { error: `Invalid tool '${tool}'. Tool not found in registry or config.` },
      { status: 400 }
    );
  }

  // Validate directory is within allowed workspace roots and exists
  let resolvedDirectory: string;
  try {
    resolvedDirectory = validateDirectory(directory);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid directory";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Resolve spawn command from registry (with config overrides)
  try {
    const spawnCmd = getSpawnCommand(tool, resolvedDirectory, toolsConfig);
    if (!spawnCmd) {
      return NextResponse.json(
        { error: `Tool '${tool}' is not available on this platform (${process.platform}).` },
        { status: 400 }
      );
    }

    const child = spawn(spawnCmd.command, spawnCmd.args, spawnCmd.options);
    child.unref();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to open directory";
    console.error(`[POST /api/open-directory] Failed to spawn ${tool}:`, err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
