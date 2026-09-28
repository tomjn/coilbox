//! One unitsync `Init` or `UnInit` at a time per engine, across every worker
//! process (issue #1916).
//!
//! unitsync keeps one archive cache per engine, `cache/ArchiveCache22.lua`, and
//! rewrites it in place at the end of every `Init` and again in `UnInit` when a
//! checksum was worked out. The rewrite truncates the file first. A second
//! worker whose `Init` reads the cache during that window sees it cut short,
//! takes the archives it lost as new, and extracts their `modinfo.lua` or
//! `mapinfo.lua` again, which for a solid `.sd7` means decompressing it. Then it
//! rewrites the cache too, and cuts short the next worker's read.
//!
//! Measured against `~/.spring`: one model read takes 0.27s with a whole cache
//! and 7.08s with one cut off halfway. Over 666 model reads run sixteen at a
//! time, the slowest took 27.24s without this lock and 10.78s with it. The
//! lock costs the median: queued `Init`s run one after another, so it went from
//! 2.31s to 2.64s.
//!
//! The lock is an advisory file lock, so a worker killed while holding it
//! releases it with the process. Only coilbox workers take it: the engine and
//! pr-downloader write the same cache without asking.

use std::fs::{File, OpenOptions, TryLockError};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// How long a worker waits for another's `Init` before going ahead without the
/// lock. Cold, with no cache at all, `Init` was measured at 23.4s over 9.1 GB of
/// content, so this is that with room for a second cold one queued behind it.
/// Going ahead unlocked is what every worker did before this lock existed, so a
/// wedged holder costs the old behaviour rather than a stuck read.
pub const WAIT: Duration = Duration::from_secs(60);

/// The lock file for the engine whose `libunitsync` is at `lib`.
///
/// In the temp dir rather than beside the engine's cache, because an engine
/// folder is not always writable and the temp dir always is. Named after a hash
/// of the library's path so two engines never wait on each other: each keeps
/// its own cache.
pub fn path_for(lib: &Path) -> PathBuf {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    lib.hash(&mut h);
    std::env::temp_dir().join(format!("coilbox-unitsync-init-{:016x}.lock", h.finish()))
}

/// Take the lock at `path`, waiting up to `wait` for another process to let it
/// go. `None` when the file cannot be opened or the wait runs out, and the
/// caller then goes ahead unlocked. The lock is held until the file is dropped.
pub fn acquire(path: &Path, wait: Duration) -> Option<File> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path)
        .ok()?;
    let start = Instant::now();
    loop {
        match file.try_lock() {
            Ok(()) => return Some(file),
            Err(TryLockError::WouldBlock) if start.elapsed() < wait => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => return None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_lock(tag: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "coilbox-initlock-test-{}-{tag}.lock",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn a_second_holder_waits_until_the_first_lets_go() {
        let path = temp_lock("wait");
        let first = acquire(&path, Duration::ZERO).expect("free lock is taken");
        let waiter = {
            let path = path.clone();
            std::thread::spawn(move || {
                let t = Instant::now();
                let got = acquire(&path, Duration::from_secs(10));
                (got.is_some(), t.elapsed())
            })
        };
        std::thread::sleep(Duration::from_millis(300));
        drop(first);
        let (got, waited) = waiter.join().unwrap();
        assert!(got, "the waiter takes the lock once it is released");
        assert!(
            waited >= Duration::from_millis(250),
            "the waiter must not get in while the first holds it, got in after {waited:?}"
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_held_lock_gives_up_after_the_wait() {
        let path = temp_lock("give-up");
        let _held = acquire(&path, Duration::ZERO).expect("free lock is taken");
        let t = Instant::now();
        assert!(acquire(&path, Duration::from_millis(100)).is_none());
        assert!(t.elapsed() >= Duration::from_millis(100));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn each_engine_gets_its_own_lock() {
        let a = path_for(Path::new("/engines/a/libunitsync.dylib"));
        let b = path_for(Path::new("/engines/b/libunitsync.dylib"));
        assert_ne!(a, b);
        assert_eq!(a, path_for(Path::new("/engines/a/libunitsync.dylib")));
    }
}
