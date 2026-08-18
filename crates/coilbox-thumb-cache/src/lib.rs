//! A tiny, dependency-free on-disk byte cache.
//!
//! The heart of it is one function: [`cached`]. The caller owns the key scheme —
//! it passes the full cache-file path it wants — and supplies a closure that
//! produces the bytes. On a hit the file is read and returned; on a miss the
//! closure runs and its bytes are best-effort written back. This is the
//! read-before-compute / write-after boilerplate that the mapconv plugin and the
//! unitsync worker both need (for JSON thumbnail entries and raw PNGs
//! respectively), kept in one place.
//!
//! [`sweep`] and [`touch`] are the other half: a caller whose entries add up can
//! bound them, least recently used first (issues #1535 and #1550). The budget
//! covers a named set of suffixes, so one directory can hold two sets of files
//! on two policies.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Return the bytes for `cache_file`, computing them with `compute` on a miss.
///
/// - `cache_file == None` disables caching: `compute` always runs and nothing is
///   written. Callers pass `None` when they can't form a stable key.
/// - A read error or absent file is a miss; `compute` runs and the result is
///   written back (creating the parent directory if needed). Write failures are
///   ignored — caching is best-effort and never fails the operation.
pub fn cached<F>(cache_file: Option<PathBuf>, compute: F) -> Result<Vec<u8>, String>
where
    F: FnOnce() -> Result<Vec<u8>, String>,
{
    cached_at(cache_file, compute).map(|(bytes, _)| bytes)
}

/// Like [`cached`], but also reports where the bytes ended up on disk.
///
/// The path is `Some` only when the file is readable afterwards, so a caller that
/// wants to hand the file itself out (over the asset protocol, say) can tell a
/// real cache entry from a disabled or failed write and fall back.
pub fn cached_at<F>(
    cache_file: Option<PathBuf>,
    compute: F,
) -> Result<(Vec<u8>, Option<PathBuf>), String>
where
    F: FnOnce() -> Result<Vec<u8>, String>,
{
    if let Some(file) = &cache_file {
        if let Ok(bytes) = std::fs::read(file) {
            // Serving an entry is using it, and [`sweep`] reads recency off the
            // file, so say so here rather than leaving every caller to remember.
            touch(file);
            return Ok((bytes, Some(file.clone())));
        }
    }
    let bytes = compute()?;
    let mut written = None;
    if let Some(file) = &cache_file {
        if let Some(dir) = file.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if std::fs::write(file, &bytes).is_ok() {
            written = Some(file.clone());
        }
    }
    Ok((bytes, written))
}

/// Delete the least recently used files in `dir` carrying any of `suffixes`,
/// until what is left fits in `budget` bytes. Returns the bytes deleted.
///
/// Written for the map height grids the terrain check reads (issue #1535): tens
/// of megabytes each, one per map an author opens a scenario on, and nothing
/// ever removed them. The rendered pictures beside them are bounded the same way
/// on a budget of their own (issue #1550), which is what the suffixes are for:
/// they are the whole of one policy's scope, and the two sets of files never
/// meet. A policy takes more than one because a picture's format is the
/// renderer's business rather than the budget's.
///
/// Nothing in `keep` is deleted, whatever its age and even if it alone is over
/// budget. It is what the caller has just produced or handed out, which is the
/// one thing in here that is certainly in use. A batch answers with hundreds of
/// files at once, and none of them is a candidate.
///
/// Recency is the file's modified time, which [`cached_at`] bumps when it serves
/// a hit, so this is least recently used rather than least recently written. A
/// file whose metadata will not read is left where it is: an entry nothing can
/// judge is not an entry to delete.
///
/// Only immediate children are considered, and only regular files, so a symlink
/// in the dir is counted by neither the total nor the deletions and nothing
/// outside `dir` can be reached.
pub fn sweep(dir: &Path, suffixes: &[&str], budget: u64, keep: &[PathBuf]) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let keep: HashSet<&Path> = keep.iter().map(PathBuf::as_path).collect();
    let mut files: Vec<(SystemTime, u64, PathBuf)> = Vec::new();
    let mut spent = 0u64;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.file_name().is_some_and(|name| {
            let name = name.to_string_lossy();
            suffixes.iter().any(|suffix| name.ends_with(suffix))
        }) {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        if keep.contains(path.as_path()) {
            spent += meta.len();
            continue;
        }
        let Ok(used) = meta.modified() else {
            continue;
        };
        files.push((used, meta.len(), path));
    }

    // Most recently used first, so the budget is spent on what is being looked
    // at now and the tail of the list is what nobody has come back to.
    files.sort_by_key(|(used, _, _)| std::cmp::Reverse(*used));
    let mut removed = 0u64;
    for (_, size, path) in files {
        if spent + size <= budget {
            spent += size;
        } else if std::fs::remove_file(&path).is_ok() {
            removed += size;
        }
    }
    removed
}

/// Mark `file` as used now, so [`sweep`] counts a cache hit as a use rather than
/// only a write. Best effort, like every other write in here.
pub fn touch(file: &Path) {
    if let Ok(handle) = std::fs::File::options().write(true).open(file) {
        let _ = handle.set_modified(SystemTime::now());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::time::{Duration, SystemTime};

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("coilbox_thumb_cache_{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    /// Write `bytes` bytes to `dir/name`, last used `age` seconds ago.
    fn aged(dir: &PathBuf, name: &str, bytes: usize, age: u64) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let file = dir.join(name);
        std::fs::write(&file, vec![0u8; bytes]).unwrap();
        std::fs::File::options()
            .write(true)
            .open(&file)
            .unwrap()
            .set_modified(SystemTime::now() - Duration::from_secs(age))
            .unwrap();
        file
    }

    #[test]
    fn keeps_everything_inside_the_budget() {
        let dir = temp_dir("sweep_under");
        let a = aged(&dir, "a-hf.bin", 100, 60);
        let b = aged(&dir, "b-hf.bin", 100, 30);
        assert_eq!(sweep(&dir, &["-hf.bin"], 1000, std::slice::from_ref(&b)), 0);
        assert!(a.exists() && b.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn drops_the_least_recently_used_first() {
        let dir = temp_dir("sweep_over");
        let old = aged(&dir, "old-hf.bin", 100, 300);
        let middle = aged(&dir, "middle-hf.bin", 100, 200);
        let new = aged(&dir, "new-hf.bin", 100, 10);
        // Room for two of the three.
        assert_eq!(
            sweep(&dir, &["-hf.bin"], 250, std::slice::from_ref(&new)),
            100
        );
        assert!(new.exists() && middle.exists());
        assert!(!old.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The one file that must survive every sweep: the map somebody is looking
    /// at, which is about to be read over the asset protocol.
    #[test]
    fn never_drops_the_file_in_use() {
        let dir = temp_dir("sweep_keep");
        let old = aged(&dir, "old-hf.bin", 100, 300);
        // In use, older than the other, and bigger than the whole budget.
        let using = aged(&dir, "using-hf.bin", 500, 900);
        assert_eq!(
            sweep(&dir, &["-hf.bin"], 250, std::slice::from_ref(&using)),
            100
        );
        assert!(using.exists());
        assert!(!old.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The picture sweep answers with a whole map list at once, and a list that
    /// came back half evicted would be blank boxes on the page it drew (issue
    /// #1550). Every file the call is answering with is kept, however old and
    /// however far over budget the batch is.
    #[test]
    fn never_drops_any_of_a_batch_it_is_answering_with() {
        let dir = temp_dir("sweep_batch");
        let batch: Vec<PathBuf> = (0..3)
            .map(|i| aged(&dir, &format!("list{i}-3.png"), 100, 900))
            .collect();
        let spare = aged(&dir, "spare-3.png", 100, 10);
        assert_eq!(sweep(&dir, &[".png"], 100, &batch), 100);
        assert!(batch.iter().all(|f| f.exists()));
        assert!(!spare.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The two budgets share a directory and never reach into each other: a
    /// grid is tens of megabytes and one map's, a picture is a few hundred
    /// kilobytes and fifty are on screen.
    #[test]
    fn leaves_everything_else_in_the_dir_alone() {
        let dir = temp_dir("sweep_others");
        let png = aged(&dir, "a-0.png", 100, 900);
        let dims = aged(&dir, "a-dims.json", 100, 900);
        let grid = aged(&dir, "a-hf.bin", 100, 10);
        assert_eq!(sweep(&dir, &["-hf.bin"], 0, std::slice::from_ref(&grid)), 0);
        assert!(png.exists() && dims.exists() && grid.exists());
        // And the picture budget cannot reach the grid or the proportions.
        assert_eq!(sweep(&dir, &[".png"], 0, &[]), 100);
        assert!(!png.exists());
        assert!(dims.exists() && grid.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_dir_that_is_not_there_is_nothing_to_sweep() {
        let dir = temp_dir("sweep_missing");
        assert_eq!(sweep(&dir, &["-hf.bin"], 100, &[dir.join("a-hf.bin")]), 0);
    }

    /// Recency has to mean used rather than written, or a map list read from
    /// cache on every launch would age out under one page of fresh renders.
    #[test]
    fn a_cache_hit_counts_as_a_use() {
        let dir = temp_dir("sweep_hit");
        let old = aged(&dir, "old-3.png", 100, 900);
        let new = aged(&dir, "new-3.png", 100, 10);
        // Read the old one back, which is a use of it.
        let (bytes, _) = cached_at(Some(old.clone()), || Ok(Vec::new())).unwrap();
        assert_eq!(bytes.len(), 100);
        // Room for one, and it is the one that was just served.
        assert_eq!(sweep(&dir, &[".png"], 100, &[]), 100);
        assert!(old.exists());
        assert!(!new.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn computes_then_caches_then_reads() {
        let dir = temp_dir("roundtrip");
        let file = dir.join("k.bin");
        let calls = Cell::new(0);
        let compute = || {
            calls.set(calls.get() + 1);
            Ok(b"hello".to_vec())
        };

        // Miss: computes and writes.
        let first = cached(Some(file.clone()), compute).unwrap();
        assert_eq!(first, b"hello");
        assert_eq!(calls.get(), 1);
        assert!(file.exists());

        // Hit: reads from disk, closure not invoked.
        let second = cached(Some(file.clone()), || {
            calls.set(calls.get() + 1);
            Ok(b"different".to_vec())
        })
        .unwrap();
        assert_eq!(second, b"hello");
        assert_eq!(calls.get(), 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn none_disables_caching() {
        let calls = Cell::new(0);
        for _ in 0..2 {
            let out = cached(None, || {
                calls.set(calls.get() + 1);
                Ok(b"x".to_vec())
            })
            .unwrap();
            assert_eq!(out, b"x");
        }
        assert_eq!(calls.get(), 2);
    }

    #[test]
    fn cached_at_reports_the_file_only_when_it_is_on_disk() {
        let dir = temp_dir("path");
        let file = dir.join("k.bin");

        // Miss then hit both report the written file.
        let (_, written) = cached_at(Some(file.clone()), || Ok(b"hello".to_vec())).unwrap();
        assert_eq!(written, Some(file.clone()));
        let (_, hit) = cached_at(Some(file.clone()), || Ok(b"other".to_vec())).unwrap();
        assert_eq!(hit, Some(file.clone()));

        // Caching off, so there is no file to hand out.
        let (bytes, none) = cached_at(None, || Ok(b"hello".to_vec())).unwrap();
        assert_eq!(bytes, b"hello");
        assert_eq!(none, None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn compute_error_propagates_and_writes_nothing() {
        let dir = temp_dir("err");
        let file = dir.join("k.bin");
        let err = cached(Some(file.clone()), || Err("boom".to_string()));
        assert_eq!(err, Err("boom".to_string()));
        assert!(!file.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
