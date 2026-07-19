//! Rapid pool housekeeping: background cache-warming and orphan pruning.
//!
//! Rapid stores content under a data root as `packages/<md5>.sdp` manifests plus
//! a content-addressed `pool/<md5[:2]>/<md5[2:]>.gz` blob store. Each `.sdp` is a
//! gzip stream of records — `u8 name-len | name | 16-byte pool-md5 | 4-byte crc32
//! | 4-byte size` (byte-exact with pr-downloader's `FileSystem::parseSdp`). The
//! 16-byte md5 identifies a pool blob.
//!
//! Two invariants drive this module:
//! - A pool blob is needed **iff** some `.sdp` still on disk references it (loose
//!   maps/games never touch the pool), so the on-disk `.sdp` set is the source of
//!   truth for safe garbage collection.
//! - Pools are **per-root** (blobs aren't shared across roots), so GC runs per root.

use flate2::read::GzDecoder;
use serde::Serialize;
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Result of warming: how many `.sdp` manifests were read into the page cache and
/// their total byte size.
#[derive(Serialize, Default, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct WarmSummary {
    pub packages: u64,
    pub bytes: u64,
}

/// Result of a prune (dry-run or applied). Counts are identical either way; on a
/// dry run nothing is deleted.
#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PruneSummary {
    /// Whether these files were actually deleted (`false` for a dry run).
    pub applied: bool,
    /// Orphaned pool blobs (referenced by no on-disk `.sdp`).
    pub blobs: u64,
    pub blob_bytes: u64,
    /// Leftover `*.incomplete` temp files under `packages/` and `pool/`.
    pub incompletes: u64,
    pub incomplete_bytes: u64,
    /// `.sdp` files that failed to parse (corrupt/zero-byte); their blobs are still
    /// treated as reclaimable, but we surface the count so a bad file is visible.
    pub unreadable_sdp: u64,
}

/// Lowercase hex of a 16-byte md5.
fn md5_hex(md5: &[u8; 16]) -> String {
    let mut s = String::with_capacity(32);
    for b in md5 {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// Parse a rapid `.sdp` manifest, returning the pool md5 (16 bytes) referenced by
/// each entry. Byte-exact with pr-downloader: a gzip stream of `u8 name-len | name
/// | 16-byte md5 | 4-byte crc32 | 4-byte size` records until EOF.
pub fn parse_sdp_pool_refs(path: &Path) -> Result<Vec<[u8; 16]>, String> {
    let compressed = std::fs::read(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    // A real `.sdp` is a non-empty gzip stream; an empty file is corrupt, and
    // `GzDecoder` (unlike the lenient multi-member decoder) errors on non-gzip
    // bytes rather than treating them as an empty stream.
    if compressed.is_empty() {
        return Err(format!("empty .sdp: {}", path.display()));
    }
    let mut raw = Vec::new();
    GzDecoder::new(&compressed[..])
        .read_to_end(&mut raw)
        .map_err(|e| format!("inflate {}: {e}", path.display()))?;

    // Each record: u8 name-len | name | 16-byte md5 | 4-byte crc32 | 4-byte size.
    let mut refs = Vec::new();
    let mut pos = 0usize;
    while pos < raw.len() {
        let name_len = raw[pos] as usize;
        let record_end = pos + 1 + name_len + 16 + 8;
        if record_end > raw.len() {
            return Err(format!("truncated record in {}", path.display()));
        }
        let md5_start = pos + 1 + name_len;
        let mut md5 = [0u8; 16];
        md5.copy_from_slice(&raw[md5_start..md5_start + 16]);
        refs.push(md5);
        pos = record_end;
    }
    Ok(refs)
}

/// True for a `packages/*.sdp` file (not `.sdp.incomplete`).
fn is_sdp(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()) == Some("sdp")
}

/// Warm the OS page cache by reading every `packages/*.sdp` manifest across the
/// given roots. Manifests only — never the (potentially multi-GB) pool blobs.
pub fn warm(roots: &[PathBuf]) -> WarmSummary {
    let mut out = WarmSummary::default();
    for root in roots {
        let Ok(rd) = std::fs::read_dir(root.join("packages")) else {
            continue;
        };
        for entry in rd.flatten() {
            let p = entry.path();
            if !is_sdp(&p) {
                continue;
            }
            if let Ok(data) = std::fs::read(&p) {
                out.packages += 1;
                out.bytes += data.len() as u64;
            }
        }
    }
    out
}

/// Collect the set of pool md5s (lowercase hex) referenced by every `.sdp` in
/// `packages_dir`. Returns the referenced set plus the count of `.sdp` files that
/// failed to parse (a corrupt file simply contributes no refs).
fn referenced_md5s(packages_dir: &Path) -> (HashSet<String>, u64) {
    let mut set = HashSet::new();
    let mut unreadable = 0u64;
    let Ok(rd) = std::fs::read_dir(packages_dir) else {
        return (set, unreadable);
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if !is_sdp(&p) {
            continue;
        }
        match parse_sdp_pool_refs(&p) {
            Ok(refs) => {
                for md5 in &refs {
                    set.insert(md5_hex(md5));
                }
            }
            Err(_) => unreadable += 1,
        }
    }
    (set, unreadable)
}

/// A two-char hex shard dir (`00`..`ff`).
fn is_shard_name(name: &str) -> bool {
    name.len() == 2 && name.chars().all(|c| c.is_ascii_hexdigit())
}

/// Reconstruct a pool blob's md5 (lowercase hex) from its shard dir + filename,
/// e.g. `("00", "56f2…00.gz") -> "0056f2…00"`. `None` if it isn't a pool blob.
fn blob_md5(shard: &str, file_name: &str) -> Option<String> {
    if !is_shard_name(shard) {
        return None;
    }
    let stem = file_name.strip_suffix(".gz")?;
    if stem.len() != 30 || !stem.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("{shard}{stem}").to_lowercase())
}

fn file_len(p: &Path) -> u64 {
    std::fs::metadata(p).map(|m| m.len()).unwrap_or(0)
}

/// Sweep `*.incomplete` leftover temp files directly under `dir`, tallying (and,
/// when `apply`, deleting) them.
fn sweep_incompletes(dir: &Path, apply: bool, count: &mut u64, bytes: &mut u64) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_file()
            && p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(".incomplete"))
        {
            *count += 1;
            *bytes += file_len(&p);
            if apply {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
}

/// Prune orphaned pool data under a single root. Orphaned = a pool blob referenced
/// by no `.sdp` still on disk, plus `*.incomplete` leftovers. `apply=false` is a
/// dry run (computes the summary, deletes nothing).
pub fn prune(root: &Path, apply: bool) -> Result<PruneSummary, String> {
    let packages = root.join("packages");
    let pool = root.join("pool");

    let (referenced, unreadable) = referenced_md5s(&packages);
    let mut out = PruneSummary {
        applied: apply,
        unreadable_sdp: unreadable,
        ..Default::default()
    };

    // Incomplete leftovers: `packages/*.incomplete` + `pool/<shard>/*.incomplete`.
    sweep_incompletes(
        &packages,
        apply,
        &mut out.incompletes,
        &mut out.incomplete_bytes,
    );

    // Walk the pool shards; delete blobs no surviving `.sdp` references.
    if let Ok(shards) = std::fs::read_dir(&pool) {
        for shard in shards.flatten() {
            let shard_path = shard.path();
            if !shard_path.is_dir() {
                continue;
            }
            let shard_name = shard.file_name().to_string_lossy().to_string();
            sweep_incompletes(
                &shard_path,
                apply,
                &mut out.incompletes,
                &mut out.incomplete_bytes,
            );
            let Ok(blobs) = std::fs::read_dir(&shard_path) else {
                continue;
            };
            for blob in blobs.flatten() {
                let bp = blob.path();
                let file_name = blob.file_name().to_string_lossy().to_string();
                let Some(md5) = blob_md5(&shard_name, &file_name) else {
                    continue; // not a recognizable pool blob — never touch it
                };
                if referenced.contains(&md5) {
                    continue;
                }
                out.blobs += 1;
                out.blob_bytes += file_len(&bp);
                if apply {
                    let _ = std::fs::remove_file(&bp);
                }
            }
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::fs;
    use std::io::Write;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("rapid_pool_test_{name}"));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    /// Build a `.sdp` manifest referencing the given md5s (as pr-downloader writes
    /// it: gzip of `u8 len | name | 16-byte md5 | 4-byte crc32 | 4-byte size`).
    fn write_sdp(path: &Path, entries: &[(&str, [u8; 16])]) {
        let mut raw = Vec::new();
        for (name, md5) in entries {
            raw.push(name.len() as u8);
            raw.extend_from_slice(name.as_bytes());
            raw.extend_from_slice(md5);
            raw.extend_from_slice(&[0u8; 4]); // crc32
            raw.extend_from_slice(&[0u8; 4]); // size
        }
        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        enc.write_all(&raw).unwrap();
        let gz = enc.finish().unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, gz).unwrap();
    }

    /// Write a pool blob for `md5` (lowercase hex) with `contents`.
    fn write_blob(root: &Path, md5: &str, contents: &[u8]) {
        let dir = root.join("pool").join(&md5[..2]);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{}.gz", &md5[2..])), contents).unwrap();
    }

    #[test]
    fn parses_pool_refs_byte_exact() {
        let d = tmp("parse");
        let a = [0xaau8; 16];
        let b = [0xbbu8; 16];
        let sdp = d.join("packages").join("pkg.sdp");
        write_sdp(&sdp, &[("units/a.lua", a), ("units/b.lua", b)]);
        let refs = parse_sdp_pool_refs(&sdp).unwrap();
        assert_eq!(refs, vec![a, b]);
    }

    #[test]
    fn corrupt_sdp_is_an_error_not_a_panic() {
        let d = tmp("corrupt");
        let sdp = d.join("packages").join("bad.sdp");
        fs::create_dir_all(sdp.parent().unwrap()).unwrap();
        fs::write(&sdp, b"not gzip at all").unwrap();
        assert!(parse_sdp_pool_refs(&sdp).is_err());
        let empty = d.join("packages").join("empty.sdp");
        fs::write(&empty, b"").unwrap();
        assert!(parse_sdp_pool_refs(&empty).is_err());
    }

    #[test]
    fn prune_keeps_referenced_removes_orphan() {
        let d = tmp("gc");
        let keep = [0x11u8; 16];
        let keep_hex = md5_hex(&keep);
        // referenced blob + an orphan not named by any .sdp
        write_sdp(&d.join("packages").join("game.sdp"), &[("f", keep)]);
        write_blob(&d, &keep_hex, b"referenced");
        let orphan_hex = "22".to_string() + &"2".repeat(30);
        write_blob(&d, &orphan_hex, b"orphan-data");

        // dry run: reports the orphan, deletes nothing
        let dry = prune(&d, false).unwrap();
        assert_eq!(dry.blobs, 1);
        assert_eq!(dry.blob_bytes, "orphan-data".len() as u64);
        assert!(!dry.applied);
        assert!(d
            .join("pool")
            .join(&orphan_hex[..2])
            .join(format!("{}.gz", &orphan_hex[2..]))
            .exists());

        // apply: orphan gone, referenced blob survives
        let applied = prune(&d, true).unwrap();
        assert_eq!(applied.blobs, 1);
        assert!(applied.applied);
        assert!(!d
            .join("pool")
            .join(&orphan_hex[..2])
            .join(format!("{}.gz", &orphan_hex[2..]))
            .exists());
        assert!(d
            .join("pool")
            .join(&keep_hex[..2])
            .join(format!("{}.gz", &keep_hex[2..]))
            .exists());
    }

    #[test]
    fn prune_sweeps_incompletes() {
        let d = tmp("incomplete");
        fs::create_dir_all(d.join("packages")).unwrap();
        fs::write(d.join("packages").join("x.sdp.incomplete"), b"partial").unwrap();
        fs::create_dir_all(d.join("pool").join("ab")).unwrap();
        fs::write(d.join("pool").join("ab").join("c.gz.incomplete"), b"tmp").unwrap();
        let s = prune(&d, true).unwrap();
        assert_eq!(s.incompletes, 2);
        assert_eq!(s.incomplete_bytes, ("partial".len() + "tmp".len()) as u64);
        assert!(!d.join("packages").join("x.sdp.incomplete").exists());
    }

    #[test]
    fn prune_counts_unreadable_sdp_and_reclaims_its_blobs() {
        let d = tmp("unreadable");
        // a corrupt .sdp contributes no refs, so its would-be blob is an orphan
        fs::create_dir_all(d.join("packages")).unwrap();
        fs::write(d.join("packages").join("bad.sdp"), b"junk").unwrap();
        let orphan_hex = "33".to_string() + &"3".repeat(30);
        write_blob(&d, &orphan_hex, b"reclaim");
        let s = prune(&d, true).unwrap();
        assert_eq!(s.unreadable_sdp, 1);
        assert_eq!(s.blobs, 1);
    }

    #[test]
    fn prune_root_without_pool_is_noop() {
        let d = tmp("nopool");
        fs::create_dir_all(d.join("packages")).unwrap();
        let s = prune(&d, true).unwrap();
        assert_eq!(s.blobs, 0);
        assert_eq!(s.incompletes, 0);
    }

    #[test]
    fn warm_counts_manifests_only() {
        let d = tmp("warm");
        write_sdp(&d.join("packages").join("a.sdp"), &[("f", [1u8; 16])]);
        write_sdp(&d.join("packages").join("b.sdp"), &[("f", [2u8; 16])]);
        // an .incomplete must not be counted
        fs::write(d.join("packages").join("c.sdp.incomplete"), b"x").unwrap();
        // a pool blob must not be read/counted
        write_blob(&d, &("44".to_string() + &"4".repeat(30)), b"blob");
        let s = warm(std::slice::from_ref(&d));
        assert_eq!(s.packages, 2);
        assert!(s.bytes > 0);
    }

    #[test]
    fn blob_md5_rejects_non_pool_files() {
        assert!(blob_md5("00", "readme.txt").is_none());
        assert!(blob_md5("zz", &format!("{}.gz", "0".repeat(30))).is_none());
        assert!(blob_md5("00", &format!("{}.gz", "0".repeat(29))).is_none());
        assert_eq!(
            blob_md5("00", &format!("{}.gz", "a".repeat(30))),
            Some("00".to_string() + &"a".repeat(30))
        );
    }
}
