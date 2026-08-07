//! A tiny, dependency-free on-disk byte cache.
//!
//! The whole crate is one function: [`cached`]. The caller owns the key scheme —
//! it passes the full cache-file path it wants — and supplies a closure that
//! produces the bytes. On a hit the file is read and returned; on a miss the
//! closure runs and its bytes are best-effort written back. This is the
//! read-before-compute / write-after boilerplate that the mapconv plugin and the
//! unitsync worker both need (for JSON thumbnail entries and raw PNGs
//! respectively), kept in one place.

use std::path::PathBuf;

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("coilbox_thumb_cache_{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        dir
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
