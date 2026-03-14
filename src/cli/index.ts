#!/usr/bin/env node
/**
 * CLI entry point for weave-fleet.
 * Handles `init` and `skill` subcommands.
 * This script is compiled to cli.js via esbuild and runs standalone
 * using the bundled Node.js binary — no server required.
 */

import { runInit } from "./init";
import { runSkillList, runSkillInstall, runSkillRemove } from "./skill";
import { runServe } from "./serve";

const VERSION = "0.1.6";

function printUsage(): void {
  console.log(`weave-fleet CLI v${VERSION}`);
  console.log();
  console.log("Usage: weave-fleet <command> [options]");
  console.log();
  console.log("Commands:");
  console.log("  init <directory>              Initialize a project with skill configuration");
  console.log("  skill list                    List installed skills");
  console.log("  skill install <source>        Install a skill from URL or local path");
  console.log("  skill remove <name>           Remove an installed skill");
  console.log("  serve                         Start the Fleet API server (standalone mode)");
  console.log();
  console.log("Init Options:");
  console.log("  --force                       Overwrite existing configuration");
  console.log("  --dry-run                     Print what would be generated without writing");
  console.log();
  console.log("Skill Install Options:");
  console.log("  --force                       Overwrite existing skill");
  console.log("  --agent <agents>              Comma-separated agent names to assign the skill to");
  console.log();
  console.log("Sources for skill install:");
  console.log("  https://...                   Raw URL to a SKILL.md file");
  console.log("  github:user/repo/path         GitHub repository shorthand");
  console.log("  /path/to/SKILL.md             Local file path");
  console.log();
  console.log("Serve Options:");
  console.log("  --port <port>               Port to bind (default: 3000, env: FLEET_PORT)");
  console.log("  --host <host>               Host to bind (default: 0.0.0.0, env: FLEET_HOST)");
  console.log("  --rotate-token              Rotate the API token (server must be stopped)");
  console.log();
  console.log("Serve Environment Variables:");
  console.log("  FLEET_PORT                  Port to bind (overridden by --port)");
  console.log("  FLEET_HOST                  Host to bind (overridden by --host)");
  console.log("  FLEET_NAME                  Server display name (default: Fleet Server)");
  console.log("  FLEET_DESCRIPTION           Server description (default: empty)");
  console.log("  FLEET_ALLOWED_ORIGINS       Comma-separated allowed CORS origins (default: *)");
  console.log("  FLEET_AUTH_DISABLED         Set to 'true' to disable auth (dev mode only)");
}

function parseArgs(argv: string[]): { command: string; args: string[]; flags: Record<string, string | boolean> } {
  const command = argv[0] ?? "";
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const flagName = arg.slice(2);
      // Check if the next arg is a value (not another flag)
      if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags[flagName] = argv[i + 1];
        i += 2;
      } else {
        flags[flagName] = true;
        i++;
      }
    } else if (arg.startsWith("-")) {
      const flagName = arg.slice(1);
      flags[flagName] = true;
      i++;
    } else {
      args.push(arg);
      i++;
    }
  }

  return { command, args, flags };
}

async function main(): Promise<void> {
  // Skip 'node' and 'cli.js' from argv
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
    printUsage();
    process.exit(0);
  }

  const { command, args, flags } = parseArgs(argv);

  switch (command) {
    case "init": {
      if (flags["help"] || flags["h"]) {
        console.log("Usage: weave-fleet init <directory> [--force] [--dry-run]");
        console.log();
        console.log("Initialize a project directory with Weave skill configuration.");
        console.log("Detects project technologies and generates .opencode/weave-opencode.jsonc");
        console.log();
        console.log("Options:");
        console.log("  --force     Overwrite existing configuration");
        console.log("  --dry-run   Print what would be generated without writing");
        process.exit(0);
      }

      const directory = args[0];
      if (!directory) {
        console.error("Error: directory argument is required.");
        console.error("Usage: weave-fleet init <directory>");
        process.exit(1);
      }

      try {
        const result = runInit(directory, {
          force: Boolean(flags["force"]),
          dryRun: Boolean(flags["dry-run"]),
        });

        console.log();
        if (result.profile.languages.length > 0) {
          const techs = [
            ...result.profile.languages,
            ...result.profile.frameworks,
          ].join(", ");
          console.log(`Detected: ${techs}`);
        } else {
          console.log("No specific language/framework detected.");
        }

        if (result.profile.isGitRepo) {
          console.log("Git repository: yes");
        }

        if (result.enabledSkills.length > 0) {
          console.log(`Enabled skills: ${result.enabledSkills.join(", ")}`);
        } else {
          console.log("No matching skills found (install skills with: weave-fleet skill install <source>)");
        }

        if (result.written) {
          console.log(`\nConfig written to: ${result.configPath}`);
        } else {
          console.log(`\nDry run — would write to: ${result.configPath}`);
        }

        console.log();
        console.log("Next steps:");
        console.log("  Run `weave-fleet` to start the dashboard");
        console.log("  Run `weave-fleet skill list` to see all available skills");
        console.log();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${message}`);
        process.exit(1);
      }
      break;
    }

    case "skill": {
      const subCommand = args[0];

      if (!subCommand || flags["help"] || flags["h"]) {
        console.log("Usage: weave-fleet skill <subcommand> [options]");
        console.log();
        console.log("Subcommands:");
        console.log("  list                    List installed skills");
        console.log("  install <source>        Install a skill from URL or local path");
        console.log("  remove <name>           Remove an installed skill");
        process.exit(0);
      }

      switch (subCommand) {
        case "list":
          runSkillList();
          break;

        case "install": {
          const source = args[1];
          if (!source) {
            console.error("Error: source argument is required.");
            console.error("Usage: weave-fleet skill install <url-or-path> [--force] [--agent <agents>]");
            process.exit(1);
          }

          const agentStr = flags["agent"];
          const agents =
            typeof agentStr === "string"
              ? agentStr.split(",").map((a) => a.trim())
              : undefined;

          await runSkillInstall(source, {
            force: Boolean(flags["force"]),
            agents,
          });
          break;
        }

        case "remove": {
          const name = args[1];
          if (!name) {
            console.error("Error: skill name is required.");
            console.error("Usage: weave-fleet skill remove <name>");
            process.exit(1);
          }
          runSkillRemove(name);
          break;
        }

        default:
          console.error(`Unknown skill subcommand: ${subCommand}`);
          console.error("Run 'weave-fleet skill --help' for usage.");
          process.exit(1);
      }
      break;
    }

    case "serve": {
      const rotateTokenFlag = Boolean(flags["rotate-token"]);
      const portFlag = flags["port"] ? Number(flags["port"]) : undefined;
      const hostFlag = typeof flags["host"] === "string" ? flags["host"] : undefined;

      await runServe({ port: portFlag, host: hostFlag, rotateToken: rotateTokenFlag });
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error("Run 'weave-fleet --help' for usage.");
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
