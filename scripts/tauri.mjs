// Wrapper around the `tauri` CLI so `bun tauri dev` always opens the MCP
// socket without anyone having to remember a flag, while `tauri build` and
// every other subcommand stay untouched.
//
// `tauri.conf.json`'s `build.features` cannot draw this line because it
// applies to `tauri build` as well as `tauri dev`. The `tauri` script in
// package.json used to point at the bare `tauri` binary, which cannot see
// which subcommand is running either. This script can, because it receives
// argv before the CLI does.
//
// Forwards argv unchanged to the real `tauri` binary (resolved from
// node_modules/.bin via PATH), inserting `--features mcp` right after `dev`
// when that is the subcommand, so it lands as a CLI option ahead of any `--`
// the caller adds rather than being swallowed as a runner or app argument.

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args[0] === "dev") {
  args.splice(1, 0, "--features", "mcp");
}

const result = spawnSync("tauri", args, { stdio: "inherit", shell: true });
if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
