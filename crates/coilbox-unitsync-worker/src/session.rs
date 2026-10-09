//! One `Init` shared by every request a running worker answers (issue #3722).
//!
//! Each mode loads unitsync, calls `Init`, reads, and calls `UnInit`, because
//! each used to be a process of its own. A worker that stays running keeps those
//! calls where they are and changes what they do: [`Unitsync::init`] asks
//! [`reuse`] first, and `Unitsync::uninit` only tidies up. The real `UnInit`
//! runs once, when the worker exits.
//!
//! # What a running worker needs to see a new archive
//!
//! Another `Init`. unitsync looks at the disk in one place, the archive
//! scanner's constructor (`CArchiveScanner::ReadCache` calls `ScanAllDirs`), and
//! only `Init` builds a scanner. The scanner has a `Reload`, and unitsync exports
//! no call that reaches it. `Init` is written to be called again for this: it
//! frees the old scanner under the comment "reinitialize filesystem to detect new
//! files" (`tools/unitsync/unitsync.cpp`).
//!
//! So before reusing an `Init` the worker checks that the scanner would find the
//! same thing. [`walk`] visits what `CArchiveScanner::ScanDir` visits, the
//! `base`, `maps`, `games` and `packages` folders of every data directory, and
//! compares what the scanner compares, a path and its modified time. A change
//! there is a new `Init`, and nothing else is.
//!
//! # What is carried from one request to the next
//!
//! Nothing a read can see. A fresh `Init` starts with an empty file system, no
//! open archive, no Lua parser and no error waiting. `Unitsync::reset` puts each
//! of those back, and runs both before a request and after it. After, so an
//! archive is not held open while the worker idles, which on Windows would stop
//! it being deleted.
//!
//! The state is per thread: a worker has one thread that talks to unitsync, and
//! tests each bring their own stand-in library.

use crate::ffi::Unitsync;
use coilbox_unitsync_worker::protocol::InitTiming;
use std::cell::RefCell;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The folders of a data directory the archive scanner reads, from
/// `DataDirLocater::GetDataDirRoots`. The `SpringDataRoot` setting adds to them.
const SCANNED_ROOTS: [&str; 4] = ["base", "maps", "games", "packages"];

#[derive(Default)]
struct Session {
    /// Whether the last `Init` succeeded and has not been given up on.
    ready: bool,
    /// Where the scanner looked during that `Init`.
    dirs: Vec<PathBuf>,
    roots: Vec<String>,
    /// What it would have found there. `None` when that is not known, which
    /// makes the next request call `Init` again.
    found: Option<u64>,
    /// Archives opened through `OpenArchive` and not closed yet.
    open_archives: Vec<i32>,
    /// The `Init` calls made since [`take_init`] was last asked.
    inits: Vec<InitTiming>,
}

thread_local! {
    static SESSION: RefCell<Option<Session>> = const { RefCell::new(None) };
}

fn with<R>(f: impl FnOnce(&mut Session) -> R) -> Option<R> {
    SESSION.with(|s| s.borrow_mut().as_mut().map(f))
}

/// Start sharing `Init` between requests on this thread.
pub fn begin() {
    SESSION.with(|s| *s.borrow_mut() = Some(Session::default()));
}

/// Whether this thread shares `Init` between requests.
pub fn serving() -> bool {
    SESSION.with(|s| s.borrow().is_some())
}

/// Whether there is an `Init` that still needs its `UnInit`.
pub fn ready() -> bool {
    with(|s| s.ready).unwrap_or(false)
}

/// The `Init` a request ran, if it ran one. A request that ran more than one
/// reports the last.
pub fn take_init() -> Option<InitTiming> {
    with(|s| std::mem::take(&mut s.inits).pop()).flatten()
}

/// Stop trusting the current `Init`, so the next request calls it again. For a
/// request that panicked partway through a read, where what unitsync is left
/// holding is anyone's guess.
pub fn give_up() {
    with(|s| s.found = None);
}

pub fn opened(archive: i32) {
    with(|s| s.open_archives.push(archive));
}

pub fn closed(archive: i32) {
    with(|s| s.open_archives.retain(|&a| a != archive));
}

/// The archives still open, which are then forgotten.
pub fn take_open_archives() -> Vec<i32> {
    with(|s| std::mem::take(&mut s.open_archives)).unwrap_or_default()
}

/// Whether the last `Init` still stands, in which case it has been tidied for
/// the next request and there is no need to call `Init`.
pub fn reuse(us: &Unitsync) -> bool {
    if !us.can_reset() {
        return false;
    }
    let known = with(|s| {
        if !s.ready {
            return None;
        }
        let found = s.found?;
        Some((found, s.dirs.clone(), s.roots.clone()))
    })
    .flatten();
    let Some((found, dirs, roots)) = known else {
        return false;
    };
    if walk(&dirs, &roots).hash != found {
        return false;
    }
    us.reset();
    true
}

/// What the scanner would find now, taken just before a real `Init`. `None` on
/// the first one, when unitsync has not yet said where it looks.
pub fn before_init() -> Option<u64> {
    with(|s| (!s.dirs.is_empty()).then(|| walk(&s.dirs, &s.roots).hash)).flatten()
}

/// Record a real `Init` that has just returned.
///
/// What the scanner found is kept only when nothing changed while it looked.
/// From the second `Init` on that is a walk before and a walk after that agree.
/// The first has no walk before, because unitsync only says where it looks once
/// `Init` has run, so it is kept when nothing in those folders is newer than the
/// moment `Init` was called.
pub fn after_init(
    us: &Unitsync,
    ok: bool,
    before: Option<u64>,
    started: SystemTime,
    timing: InitTiming,
) {
    if !serving() {
        return;
    }
    let dirs = if ok { us.data_dirs() } else { None };
    let roots = scanned_roots(us);
    with(|s| {
        s.inits.push(timing);
        s.ready = ok;
        s.found = None;
        let Some(dirs) = dirs else {
            return;
        };
        let same_places = s.dirs == dirs && s.roots == roots;
        let after = walk(&dirs, &roots);
        s.found = match before {
            Some(before) if same_places => (before == after.hash).then_some(after.hash),
            _ => after
                .newest
                .is_none_or(|newest| newest < whole_second(started))
                .then_some(after.hash),
        };
        s.dirs = dirs;
        s.roots = roots;
    });
}

/// `time` with its fraction of a second dropped, so a file system that keeps
/// modified times to the second cannot make a file written after `time` look
/// older than it.
fn whole_second(time: SystemTime) -> SystemTime {
    let since = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    UNIX_EPOCH + Duration::from_secs(since.as_secs())
}

fn scanned_roots(us: &Unitsync) -> Vec<String> {
    let mut roots: Vec<String> = SCANNED_ROOTS.iter().map(|r| r.to_string()).collect();
    let extra = us.spring_config_string("SpringDataRoot", "");
    let sep = if cfg!(windows) { ';' } else { ':' };
    roots.extend(
        extra
            .unwrap_or_default()
            .split(sep)
            .filter(|r| !r.is_empty())
            .map(str::to_string),
    );
    roots
}

/// What [`walk`] found.
pub struct Found {
    /// Every path with its modified time and size, as one number. The order
    /// the entries were listed in does not change it.
    pub hash: u64,
    /// The newest modified time among them.
    pub newest: Option<SystemTime>,
}

/// Visit what `CArchiveScanner::ScanDir` visits under each root of each data
/// directory: every entry, going into folders but not into a `.sdd`, which is
/// an archive itself.
///
/// It notes more than the scanner reads. Every file counts, not only archives,
/// and every folder's own modified time, which is what changes when a file is
/// moved in or deleted. Noting too much costs an `Init` that was not needed.
/// Noting too little would leave a new archive unseen.
pub fn walk(dirs: &[PathBuf], roots: &[String]) -> Found {
    let mut found = Found {
        hash: 0,
        newest: None,
    };
    for dir in dirs {
        for root in roots {
            let top = dir.join(root);
            if !top.is_dir() {
                continue;
            }
            let mut pending = vec![top];
            while let Some(folder) = pending.pop() {
                note(&mut found, &folder);
                let Ok(entries) = std::fs::read_dir(&folder) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.is_dir() {
                        note(&mut found, &path);
                    } else if is_sdd(&path) {
                        note(&mut found, &path);
                        // The scanner also reads when these two last changed.
                        note(&mut found, &path.join("modinfo.lua"));
                        note(&mut found, &path.join("mapinfo.lua"));
                    } else {
                        pending.push(path);
                    }
                }
            }
        }
    }
    found
}

fn is_sdd(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("sdd"))
}

fn note(found: &mut Found, path: &Path) {
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    let modified = meta.modified().ok();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    modified.hash(&mut hasher);
    if meta.is_file() {
        meta.len().hash(&mut hasher);
    }
    found.hash = found.hash.wrapping_add(hasher.finish());
    if modified > found.newest {
        found.newest = modified;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ffi::stub::{self, World};

    fn temp(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("coilbox-session-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("maps")).unwrap();
        std::fs::create_dir_all(dir.join("games")).unwrap();
        dir
    }

    fn roots() -> Vec<String> {
        SCANNED_ROOTS.iter().map(|r| r.to_string()).collect()
    }

    /// Set a file's modified time to long before the test started, so the first
    /// `Init` of a test does not look as though it raced a download.
    fn age(path: &Path) {
        let old = SystemTime::now() - Duration::from_secs(3600);
        let file = std::fs::File::options().write(true).open(path);
        match file {
            Ok(file) => file.set_modified(old).unwrap(),
            // A folder cannot be opened for writing on Windows.
            Err(_) => std::fs::File::open(path)
                .unwrap()
                .set_modified(old)
                .unwrap(),
        }
    }

    /// Stops sharing `Init` on this thread when the test ends, in case the
    /// test runner hands the thread to another test.
    struct Serving(Unitsync);

    impl std::ops::Deref for Serving {
        type Target = Unitsync;
        fn deref(&self) -> &Unitsync {
            &self.0
        }
    }

    impl Drop for Serving {
        fn drop(&mut self) {
            SESSION.with(|s| *s.borrow_mut() = None);
        }
    }

    /// A data directory holding one map, all of it an hour old, and a stand-in
    /// library that says it scans there.
    fn serving_world(tag: &str) -> (Serving, PathBuf) {
        let dir = temp(tag);
        std::fs::write(dir.join("maps/one.sd7"), b"one").unwrap();
        age(&dir.join("maps/one.sd7"));
        age(&dir.join("maps"));
        age(&dir.join("games"));
        stub::install(World {
            data_dirs: vec![dir.clone()],
            ..World::default()
        });
        begin();
        (Serving(Unitsync::stub()), dir)
    }

    #[test]
    fn a_walk_is_the_same_until_something_changes() {
        let dir = temp("walk");
        std::fs::write(dir.join("maps/one.sd7"), b"one").unwrap();
        let first = walk(std::slice::from_ref(&dir), &roots()).hash;
        assert_eq!(first, walk(std::slice::from_ref(&dir), &roots()).hash);

        std::fs::write(dir.join("maps/two.sd7"), b"two").unwrap();
        let added = walk(std::slice::from_ref(&dir), &roots()).hash;
        assert_ne!(first, added, "a new archive is seen");

        std::fs::create_dir_all(dir.join("maps/sub")).unwrap();
        std::fs::write(dir.join("maps/sub/three.sdz"), b"three").unwrap();
        let nested = walk(std::slice::from_ref(&dir), &roots()).hash;
        assert_ne!(added, nested, "an archive in a folder below is seen");

        std::fs::remove_file(dir.join("maps/two.sd7")).unwrap();
        assert_ne!(
            nested,
            walk(std::slice::from_ref(&dir), &roots()).hash,
            "a deleted archive is seen"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_walk_sees_an_archive_replaced_by_one_the_same_size() {
        let dir = temp("replace");
        let map = dir.join("maps/one.sd7");
        std::fs::write(&map, b"one").unwrap();
        age(&map);
        let first = walk(std::slice::from_ref(&dir), &roots()).hash;
        std::fs::write(&map, b"eno").unwrap();
        assert_ne!(first, walk(std::slice::from_ref(&dir), &roots()).hash);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_walk_does_not_look_inside_a_folder_archive() {
        let dir = temp("sdd");
        std::fs::create_dir_all(dir.join("games/dev.sdd/units")).unwrap();
        std::fs::write(dir.join("games/dev.sdd/modinfo.lua"), b"return {}").unwrap();
        let first = walk(std::slice::from_ref(&dir), &roots()).hash;
        std::fs::write(dir.join("games/dev.sdd/units/a.lua"), b"return {}").unwrap();
        assert_eq!(
            first,
            walk(std::slice::from_ref(&dir), &roots()).hash,
            "the scanner does not read a unit file, so it is not a reason to Init"
        );
        std::fs::write(dir.join("games/dev.sdd/modinfo.lua"), b"return { }").unwrap();
        assert_ne!(
            first,
            walk(std::slice::from_ref(&dir), &roots()).hash,
            "the scanner does read modinfo.lua"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn requests_share_one_init() {
        let (us, dir) = serving_world("share");
        for _ in 0..10 {
            assert_eq!(us.init(false, 0), 1);
            us.uninit();
        }
        assert_eq!(stub::calls("Init"), 1);
        assert_eq!(
            stub::calls("UnInit"),
            0,
            "UnInit waits for the worker to exit"
        );
        us.shutdown();
        assert_eq!(stub::calls("UnInit"), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_the_request_that_ran_init_reports_it() {
        let (us, dir) = serving_world("report");
        us.init(false, 0);
        assert!(take_init().is_some());
        us.init(false, 0);
        assert!(take_init().is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_new_archive_is_a_new_init() {
        let (us, dir) = serving_world("new");
        us.init(false, 0);
        us.uninit();
        us.init(false, 0);
        us.uninit();
        assert_eq!(stub::calls("Init"), 1);

        std::fs::write(dir.join("maps/downloaded.sd7"), b"new").unwrap();
        us.init(false, 0);
        assert_eq!(
            stub::calls("Init"),
            2,
            "the new map needs an Init to be seen"
        );
        us.uninit();
        us.init(false, 0);
        assert_eq!(stub::calls("Init"), 2, "and only one");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_archive_that_lands_during_the_first_init_is_not_missed() {
        let (us, dir) = serving_world("race");
        // Newer than the moment `Init` started: the scanner may or may not have
        // seen it.
        let landed = dir.join("maps/mid-init.sd7");
        std::fs::write(&landed, b"new").unwrap();
        std::fs::File::options()
            .write(true)
            .open(&landed)
            .unwrap()
            .set_modified(SystemTime::now() + Duration::from_secs(10))
            .unwrap();
        us.init(false, 0);
        us.uninit();
        us.init(false, 0);
        assert_eq!(stub::calls("Init"), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn each_request_starts_from_a_clean_library() {
        let (us, dir) = serving_world("clean");
        us.init(false, 0);
        let archive = us.open_archive("left-open.sdz").expect("the stub opens");
        let _ = archive;
        us.uninit();
        assert_eq!(stub::calls("CloseArchive"), 1, "closed for the request");
        let removed = stub::calls("RemoveAllArchives");
        assert!(removed >= 1, "the file system is emptied after a request");
        us.init(false, 0);
        assert!(
            stub::calls("RemoveAllArchives") > removed,
            "and before the next, in case the last one never got to its UnInit"
        );
        assert_eq!(stub::calls("Init"), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_request_that_was_given_up_on_is_followed_by_an_init() {
        let (us, dir) = serving_world("give-up");
        us.init(false, 0);
        give_up();
        us.init(false, 0);
        assert_eq!(stub::calls("Init"), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_library_that_cannot_say_where_it_looks_inits_every_time() {
        stub::install(World::default());
        begin();
        let mut us = Unitsync::stub();
        us.forget_data_dirs();
        let us = Serving(us);
        us.init(false, 0);
        us.uninit();
        us.init(false, 0);
        assert_eq!(stub::calls("Init"), 2);
    }

    #[test]
    fn a_one_shot_worker_is_left_as_it_was() {
        SESSION.with(|s| *s.borrow_mut() = None);
        stub::install(World::default());
        let us = Unitsync::stub();
        us.init(false, 0);
        us.uninit();
        us.init(false, 0);
        us.uninit();
        assert_eq!(stub::calls("Init"), 2);
        assert_eq!(stub::calls("UnInit"), 2);
    }
}
