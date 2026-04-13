#!/usr/bin/env node
/**
 * @sesam/cli — drop-in sesam-py replacement.
 *
 * Thin commander shell wrapping @sesam/core operations.
 * Matches the sesam-py CLI surface: upload, download, run, status, validate.
 */

import { Command } from "commander";

import {
  downloadConfig,
  getStatus,
  runAllPipes,
  runPipe,
  uploadConfig,
  validateWorkspace,
} from "@sesam/core";

import type { NodeCredentials } from "@sesam/core";

// ---------------------------------------------------------------------------
// CLI setup
// ---------------------------------------------------------------------------

const program = new Command("sesam");
program.version("0.1.0").description("Sesam CLI — TypeScript replacement for sesam-py");

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Add --node / --jwt options to a command.
 * Values default to NODE / JWT environment variables (matching sesam-py behaviour).
 */
const addCredOptions = (cmd: Command): Command =>
  cmd
    .option("-n, --node <url>", "Sesam node URL (overrides NODE env var)")
    .option("-j, --jwt <token>", "JWT token (overrides JWT env var)");

interface CredOpts {
  node?: string;
  jwt?: string;
}

const resolveCredentials = (opts: CredOpts): NodeCredentials => {
  const nodeUrl = opts.node ?? process.env["NODE"] ?? "";
  const jwtToken = opts.jwt ?? process.env["JWT"] ?? "";

  if (!nodeUrl) {
    console.error(
      "Error: Sesam node URL required. Use --node or set the NODE environment variable.",
    );
    process.exit(1);
  }

  if (!jwtToken) {
    console.error("Error: JWT token required. Use --jwt or set the JWT environment variable.");
    process.exit(1);
  }

  return { nodeUrl, jwtToken };
};

// ---------------------------------------------------------------------------
// sesam upload
// ---------------------------------------------------------------------------

addCredOptions(
  program.command("upload").description("Upload local pipe/system configs to the Sesam node"),
)
  .option("--force", "Force upload even if the node reports conflicts")
  .action(async (opts: CredOpts & { force?: boolean }) => {
    const creds = resolveCredentials(opts);

    try {
      const result = await uploadConfig(creds, process.cwd(), { force: opts.force });
      console.log(
        `Upload complete: ${result.pipesUploaded} pipe(s), ${result.systemsUploaded} system(s).`,
      );
    } catch (err) {
      console.error(`Upload failed: ${String(err)}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// sesam download
// ---------------------------------------------------------------------------

addCredOptions(
  program.command("download").description("Download pipe/system configs from the Sesam node"),
).action(async (opts: CredOpts) => {
  const creds = resolveCredentials(opts);

  try {
    const result = await downloadConfig(creds, { outDir: process.cwd() });
    console.log(
      `Download complete: ${result.pipesWritten} pipe(s), ${result.systemsWritten} system(s).`,
    );
  } catch (err) {
    console.error(`Download failed: ${String(err)}`);
    process.exit(1);
  }
});

// ---------------------------------------------------------------------------
// sesam run [pipe-id]
// ---------------------------------------------------------------------------

addCredOptions(
  program.command("run [pipe-id]").description("Run all pipes, or a specific pipe by its _id"),
).action(async (pipeId: string | undefined, opts: CredOpts) => {
  const creds = resolveCredentials(opts);

  try {
    if (pipeId) {
      await runPipe(creds, pipeId);
      console.log(`Pipe "${pipeId}" started.`);
    } else {
      await runAllPipes(creds);
      console.log("All pipes started.");
    }
  } catch (err) {
    console.error(`Run failed: ${String(err)}`);
    process.exit(1);
  }
});

// ---------------------------------------------------------------------------
// sesam status
// ---------------------------------------------------------------------------

addCredOptions(program.command("status").description("Show execution status for all pipes")).action(
  async (opts: CredOpts) => {
    const creds = resolveCredentials(opts);

    try {
      const statuses = await getStatus(creds);

      if (statuses.length === 0) {
        console.log("No pipes found.");
        return;
      }

      for (const s of statuses) {
        const id = s.id.padEnd(40);
        const state = s.state.padEnd(12);
        console.log(`${id} ${state} ok=${s.successCount} fail=${s.failureCount}`);
      }
    } catch (err) {
      console.error(`Status failed: ${String(err)}`);
      process.exit(1);
    }
  },
);

// ---------------------------------------------------------------------------
// sesam validate
// ---------------------------------------------------------------------------

program
  .command("validate")
  .description("Validate local pipe/system config files (offline — no node connection required)")
  .action(async () => {
    try {
      const result = await validateWorkspace(process.cwd());

      if (result.valid) {
        console.log("All configs are valid.");
      } else {
        for (const err of result.errors) {
          console.error(`${err.file}: ${err.message}`);
        }

        process.exit(1);
      }
    } catch (err) {
      console.error(`Validate failed: ${String(err)}`);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// Parse argv
// ---------------------------------------------------------------------------

program.parse();
