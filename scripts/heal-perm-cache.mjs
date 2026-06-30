// Heal stale Tauri plugin permission caches in a shared target/ dir.
//
// cline symlinks each worktree's target/ to the main checkout's target/, so all
// worktrees share one Cargo build cache. Tauri plugin build scripts bake the
// ABSOLUTE paths of their permission .toml files into
//   target/<profile>/build/<crate>-<hash>/out/<crate>-permission-files
// and the app crate's build script reads those at compile time. Cargo's
// build-script fingerprint ignores the manifest path, so two worktrees collide
// on the same cache entry. When a worktree that previously built is deleted,
// those paths dangle and the build fails with:
//   failed to read plugin permissions: ... No such file or directory
//
// This scans the listings and, only if a referenced path is missing, removes
// the affected plugin build-output dir (so its build script regenerates with a
// path valid for the current worktree) plus the app crate's build-output dirs
// (so it re-reads them). When nothing is stale it is a fast no-op -- the common
// case, including CI's unshared target. Direct fs removal is used rather than
// `cargo clean -p` because a stale listing may belong to a plugin that has since
// been removed from the workspace, which `cargo clean -p` rejects.

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const SUFFIX = "-permission-files";
const APP_DIR = /^coilbox-[0-9a-f]+$/; // app crate build dirs: coilbox-<hash>
const root = process.cwd();
const removeDirs = new Set();

for (const profile of ["debug", "release"]) {
  const buildDir = join(root, "target", profile, "build");
  if (!existsSync(buildDir)) continue;
  const entries = readdirSync(buildDir);

  let staleInProfile = false;
  for (const entry of entries) {
    const outDir = join(buildDir, entry, "out");
    if (!existsSync(outDir)) continue;
    for (const file of readdirSync(outDir)) {
      if (!file.endsWith(SUFFIX)) continue;
      let paths;
      try {
        paths = JSON.parse(readFileSync(join(outDir, file), "utf8"));
      } catch {
        continue;
      }
      if (!Array.isArray(paths)) continue;
      if (paths.some((p) => typeof p === "string" && !existsSync(p))) {
        removeDirs.add(join(buildDir, entry));
        staleInProfile = true;
      }
    }
  }

  // Force the app crate's build script to re-run so it re-reads the now-valid
  // plugin permission listings.
  if (staleInProfile) {
    for (const entry of entries) {
      if (APP_DIR.test(entry)) removeDirs.add(join(buildDir, entry));
    }
  }
}

if (removeDirs.size === 0) process.exit(0);

console.log(
  `[heal-perm-cache] clearing ${removeDirs.size} stale build dir(s) left by a deleted worktree:`,
);
for (const dir of removeDirs) {
  console.log(`  ${dir}`);
  rmSync(dir, { recursive: true, force: true });
}
