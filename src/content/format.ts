import type { Archive } from "./bindings";

/** Human-readable byte size (e.g. 29518991 -> "28.2 MB"). */
export function formatBytes(n?: number): string | null {
  if (n == null) return null;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** Whether an archive is a loose `.sdd` directory (uncompressed dev content). */
export function isSdd(archive?: Archive): boolean {
  return !!archive && archive.name.toLowerCase().endsWith(".sdd");
}
