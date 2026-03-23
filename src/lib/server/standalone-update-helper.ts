import { spawn } from "child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { UpdateChannel } from "@/lib/api-types";
import type { StandaloneRestartContext } from "@/lib/server/standalone-update-state";

interface SpawnStandaloneUpdateHelperOptions {
  context: StandaloneRestartContext;
  channel: UpdateChannel;
  stateFilePath: string;
}

export function spawnDetachedStandaloneUpdateHelper(
  options: SpawnStandaloneUpdateHelperOptions,
): void {
  const { context, channel, stateFilePath } = options;

  const templateName = context.platform === "windows" ? "update-helper.ps1" : "update-helper.sh";
  const candidatePaths = [
    join(context.installDir, "scripts", templateName),
    join(context.installDir, "app", "scripts", templateName),
  ];
  const helperTemplatePath = candidatePaths.find((candidatePath) => existsSync(candidatePath));
  if (!helperTemplatePath) {
    throw new Error(
      `Standalone update helper template missing: ${candidatePaths.join(", ")}`,
    );
  }

  const helperTempDir = mkdtempSync(join(tmpdir(), "weave-standalone-update-"));
  const helperPath = join(helperTempDir, templateName);
  copyFileSync(helperTemplatePath, helperPath);

  if (context.platform !== "windows") {
    chmodSync(helperPath, 0o755);
  }

  const env = {
    ...process.env,
    WEAVE_UPDATE_CHANNEL: channel,
    WEAVE_UPDATE_STATE_PATH: stateFilePath,
    WEAVE_UPDATE_LAUNCHER_PATH: context.launcherPath,
    WEAVE_UPDATE_PORT: String(context.port),
    WEAVE_UPDATE_HOSTNAME: context.hostname,
    WEAVE_UPDATE_STARTED_AT: new Date().toISOString(),
  };

  if (context.platform === "windows") {
    spawn(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        helperPath,
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env,
      },
    ).unref();
    return;
  }

  spawn("sh", [helperPath], {
    detached: true,
    stdio: "ignore",
    env,
  }).unref();
}
