//! Thin, runtime-loaded binding to the engine's `libunitsync` C ABI.
//!
//! unitsync is a global C singleton compiled into every engine install. We never
//! link it: we `dlopen` the user's copy at runtime (`Unitsync::load`) and resolve
//! the handful of symbols we need. A few symbols have drifted across engine
//! versions, so the truly load-bearing ones are *required* (a missing one fails
//! the load) and the rest are *optional* — resolved softly, their data simply
//! omitted when absent.
//!
//! All `*const c_char` the library returns are library-owned: we copy into
//! `String` via [`cstr`] and never free them. Stateful accessor sequences
//! (count-then-iterate) are encapsulated as single methods so callers can't get
//! the order wrong.

use libloading::{Library, Symbol};
use std::collections::BTreeMap;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_float, c_int, c_uint};
use std::path::Path;

// --- C ABI signatures (reused across same-shaped symbols) -------------------

type InitFn = unsafe extern "C" fn(bool, c_int) -> c_int;
type VoidFn = unsafe extern "C" fn();
type StrFn = unsafe extern "C" fn() -> *const c_char; // GetNextError, GetSpringVersion
type CountFn = unsafe extern "C" fn() -> c_int; // GetMapCount, GetPrimaryModCount
type StrByIntFn = unsafe extern "C" fn(c_int) -> *const c_char; // names, archive lists, info accessors
type UintByIntFn = unsafe extern "C" fn(c_int) -> c_uint; // checksums by index
type IntByIntFn = unsafe extern "C" fn(c_int) -> c_int; // archive/info counts by index
type IntByStrFn = unsafe extern "C" fn(*const c_char) -> c_int; // GetMapArchiveCount(name)
type StrByStrFn = unsafe extern "C" fn(*const c_char) -> *const c_char; // GetArchivePath(name)
type UintByStrFn = unsafe extern "C" fn(*const c_char) -> c_uint; // GetArchiveChecksum(name)
type MinimapFn = unsafe extern "C" fn(*const c_char, c_int) -> *const u16; // GetMinimap(name, mip)
                                                                           // GetInfoMapSize(mapName, infoType, *width, *height) -> nonzero on success.
type InfoMapSizeFn =
    unsafe extern "C" fn(*const c_char, *const c_char, *mut c_int, *mut c_int) -> c_int;
type StrArgVoidFn = unsafe extern "C" fn(*const c_char); // AddAllArchives(name)
type LpOpenFn = unsafe extern "C" fn(*const c_char, *const c_char, *const c_char) -> c_int; // lpOpenFile
type IntByStrStrFn = unsafe extern "C" fn(*const c_char, *const c_char) -> c_int; // lpOpenSource(source, accessModes)
type FloatByStrFloatFn = unsafe extern "C" fn(*const c_char, c_float) -> c_float; // lpGetStrKeyFloatVal, GetSpringConfigFloat
type StrByStrStrFn = unsafe extern "C" fn(*const c_char, *const c_char) -> *const c_char; // GetSpringConfigString
type IntByStrIntFn = unsafe extern "C" fn(*const c_char, c_int) -> c_int; // GetSpringConfigInt
                                                                          // archive file access (VFS browsing): open/close an archive, iterate its members,
                                                                          // and read individual member bytes.
type VoidByIntFn = unsafe extern "C" fn(c_int); // CloseArchive(archive)
type VoidByIntIntFn = unsafe extern "C" fn(c_int, c_int); // CloseArchiveFile(archive, file)
type IntByIntIntFn = unsafe extern "C" fn(c_int, c_int) -> c_int; // SizeArchiveFile(archive, file)
type OpenArchiveFileFn = unsafe extern "C" fn(c_int, *const c_char) -> c_int; // OpenArchiveFile(archive, name)
type FindFilesFn = unsafe extern "C" fn(c_int, c_int, *mut c_char, *mut c_int) -> c_int; // FindFilesArchive
type ReadFileFn = unsafe extern "C" fn(c_int, c_int, *mut u8, c_int) -> c_int; // ReadArchiveFile
type FindFilesVfsFn = unsafe extern "C" fn(c_int, *mut c_char, c_int) -> c_int; // FindFilesVFS(idx, buf, size)

/// Copy a library-owned C string into an owned `String`. Null -> `None`.
pub(crate) unsafe fn cstr(p: *const c_char) -> Option<String> {
    if p.is_null() {
        None
    } else {
        Some(CStr::from_ptr(p).to_string_lossy().into_owned())
    }
}

/// A loaded unitsync library plus its resolved entry points. The `Library` is
/// kept alive in `_lib` so the copied function pointers stay valid.
pub struct Unitsync {
    _lib: Library,
    init_fn: InitFn,
    uninit_fn: VoidFn,
    get_next_error_fn: StrFn,
    get_spring_version_fn: Option<StrFn>,
    // maps
    map_count_fn: CountFn,
    map_name_fn: StrByIntFn,
    map_file_name_fn: Option<StrByIntFn>,
    map_checksum_fn: Option<UintByIntFn>,
    map_archive_count_fn: IntByStrFn,
    map_archive_name_fn: StrByIntFn,
    map_info_count_fn: Option<IntByIntFn>,
    minimap_fn: Option<MinimapFn>,
    info_map_size_fn: Option<InfoMapSizeFn>,
    // games (primary mods)
    mod_count_fn: CountFn,
    mod_archive_fn: StrByIntFn,
    mod_checksum_fn: Option<UintByIntFn>,
    mod_archive_count_fn: IntByIntFn,
    mod_archive_list_fn: StrByIntFn,
    mod_info_count_fn: IntByIntFn,
    // info accessors (shared by maps/mods)
    info_key_fn: StrByIntFn,
    info_type_fn: Option<StrByIntFn>,
    info_value_string_fn: StrByIntFn,
    // optional archive metadata
    archive_path_fn: Option<StrByStrFn>,
    archive_checksum_fn: Option<UintByStrFn>,
    // optional archive file access (browse + read members through the VFS)
    open_archive_fn: Option<IntByStrFn>,
    close_archive_fn: Option<VoidByIntFn>,
    init_dir_list_vfs_fn: Option<LpOpenFn>,
    find_files_vfs_fn: Option<FindFilesVfsFn>,
    find_files_archive_fn: Option<FindFilesFn>,
    open_archive_file_fn: Option<OpenArchiveFileFn>,
    read_archive_file_fn: Option<ReadFileFn>,
    close_archive_file_fn: Option<VoidByIntIntFn>,
    size_archive_file_fn: Option<IntByIntIntFn>,
    // sides / units (require a game's archives to be added first)
    add_all_archives_fn: Option<StrArgVoidFn>,
    remove_all_archives_fn: Option<VoidFn>,
    side_count_fn: Option<CountFn>,
    side_name_fn: Option<StrByIntFn>,
    side_start_unit_fn: Option<StrByIntFn>,
    process_units_fn: Option<CountFn>,
    unit_count_fn: Option<CountFn>,
    unit_name_fn: Option<StrByIntFn>,
    full_unit_name_fn: Option<StrByIntFn>,
    // options (map: by name; mod: current loaded game) + shared accessors
    map_option_count_fn: Option<IntByStrFn>,
    mod_option_count_fn: Option<CountFn>,
    option_key_fn: Option<StrByIntFn>,
    option_name_fn: Option<StrByIntFn>,
    option_desc_fn: Option<StrByIntFn>,
    // Lua parser (parse mapinfo.lua from the VFS for start positions)
    lp_open_file_fn: Option<LpOpenFn>,
    lp_execute_fn: Option<CountFn>,
    lp_close_fn: Option<VoidFn>,
    lp_root_table_fn: Option<CountFn>,
    lp_sub_table_str_fn: Option<IntByStrFn>,
    lp_sub_table_int_fn: Option<IntByIntFn>,
    lp_pop_table_fn: Option<VoidFn>,
    lp_int_key_list_count_fn: Option<CountFn>,
    lp_int_key_list_entry_fn: Option<IntByIntFn>,
    lp_str_key_float_val_fn: Option<FloatByStrFloatFn>,
    lp_open_source_fn: Option<IntByStrStrFn>,
    lp_error_log_fn: Option<StrFn>,
    lp_str_key_str_val_fn: Option<StrByStrStrFn>,
    // engine configuration (springsettings.cfg, read by key)
    set_spring_config_file_fn: Option<StrArgVoidFn>,
    spring_config_string_fn: Option<StrByStrStrFn>,
    spring_config_int_fn: Option<IntByStrIntFn>,
    spring_config_float_fn: Option<FloatByStrFloatFn>,
    spring_config_file_fn: Option<StrFn>,
}

unsafe fn req<T: Copy>(lib: &Library, name: &[u8]) -> Result<T, String> {
    let sym: Symbol<T> = lib.get(name).map_err(|e| {
        let n = String::from_utf8_lossy(&name[..name.len().saturating_sub(1)]);
        format!("missing required unitsync symbol {n}: {e}")
    })?;
    Ok(*sym)
}

unsafe fn opt<T: Copy>(lib: &Library, name: &[u8]) -> Option<T> {
    lib.get::<T>(name).ok().map(|s| *s)
}

impl Unitsync {
    /// `dlopen` the library at `libpath` and resolve every entry point. Loading
    /// by absolute path lets the dynamic loader resolve the library's own
    /// `@loader_path`/`@rpath`-relative dependencies from the engine dir.
    pub unsafe fn load(libpath: &Path) -> Result<Self, String> {
        let lib = Library::new(libpath)
            .map_err(|e| format!("failed to load {}: {e}", libpath.display()))?;
        let us = Unitsync {
            init_fn: req(&lib, b"Init\0")?,
            uninit_fn: req(&lib, b"UnInit\0")?,
            get_next_error_fn: req(&lib, b"GetNextError\0")?,
            get_spring_version_fn: opt(&lib, b"GetSpringVersion\0"),
            map_count_fn: req(&lib, b"GetMapCount\0")?,
            map_name_fn: req(&lib, b"GetMapName\0")?,
            map_file_name_fn: opt(&lib, b"GetMapFileName\0"),
            map_checksum_fn: opt(&lib, b"GetMapChecksum\0"),
            map_archive_count_fn: req(&lib, b"GetMapArchiveCount\0")?,
            map_archive_name_fn: req(&lib, b"GetMapArchiveName\0")?,
            map_info_count_fn: opt(&lib, b"GetMapInfoCount\0"),
            minimap_fn: opt(&lib, b"GetMinimap\0"),
            info_map_size_fn: opt(&lib, b"GetInfoMapSize\0"),
            mod_count_fn: req(&lib, b"GetPrimaryModCount\0")?,
            mod_archive_fn: req(&lib, b"GetPrimaryModArchive\0")?,
            mod_checksum_fn: opt(&lib, b"GetPrimaryModChecksum\0"),
            mod_archive_count_fn: req(&lib, b"GetPrimaryModArchiveCount\0")?,
            mod_archive_list_fn: req(&lib, b"GetPrimaryModArchiveList\0")?,
            mod_info_count_fn: req(&lib, b"GetPrimaryModInfoCount\0")?,
            info_key_fn: req(&lib, b"GetInfoKey\0")?,
            info_type_fn: opt(&lib, b"GetInfoType\0"),
            info_value_string_fn: req(&lib, b"GetInfoValueString\0")?,
            archive_path_fn: opt(&lib, b"GetArchivePath\0"),
            archive_checksum_fn: opt(&lib, b"GetArchiveChecksum\0"),
            open_archive_fn: opt(&lib, b"OpenArchive\0"),
            close_archive_fn: opt(&lib, b"CloseArchive\0"),
            init_dir_list_vfs_fn: opt(&lib, b"InitDirListVFS\0"),
            find_files_vfs_fn: opt(&lib, b"FindFilesVFS\0"),
            find_files_archive_fn: opt(&lib, b"FindFilesArchive\0"),
            open_archive_file_fn: opt(&lib, b"OpenArchiveFile\0"),
            read_archive_file_fn: opt(&lib, b"ReadArchiveFile\0"),
            close_archive_file_fn: opt(&lib, b"CloseArchiveFile\0"),
            size_archive_file_fn: opt(&lib, b"SizeArchiveFile\0"),
            add_all_archives_fn: opt(&lib, b"AddAllArchives\0"),
            remove_all_archives_fn: opt(&lib, b"RemoveAllArchives\0"),
            side_count_fn: opt(&lib, b"GetSideCount\0"),
            side_name_fn: opt(&lib, b"GetSideName\0"),
            side_start_unit_fn: opt(&lib, b"GetSideStartUnit\0"),
            process_units_fn: opt(&lib, b"ProcessUnits\0"),
            unit_count_fn: opt(&lib, b"GetUnitCount\0"),
            unit_name_fn: opt(&lib, b"GetUnitName\0"),
            full_unit_name_fn: opt(&lib, b"GetFullUnitName\0"),
            map_option_count_fn: opt(&lib, b"GetMapOptionCount\0"),
            mod_option_count_fn: opt(&lib, b"GetModOptionCount\0"),
            option_key_fn: opt(&lib, b"GetOptionKey\0"),
            option_name_fn: opt(&lib, b"GetOptionName\0"),
            option_desc_fn: opt(&lib, b"GetOptionDesc\0"),
            lp_open_file_fn: opt(&lib, b"lpOpenFile\0"),
            lp_execute_fn: opt(&lib, b"lpExecute\0"),
            lp_close_fn: opt(&lib, b"lpClose\0"),
            lp_root_table_fn: opt(&lib, b"lpRootTable\0"),
            lp_sub_table_str_fn: opt(&lib, b"lpSubTableStr\0"),
            lp_sub_table_int_fn: opt(&lib, b"lpSubTableInt\0"),
            lp_pop_table_fn: opt(&lib, b"lpPopTable\0"),
            lp_int_key_list_count_fn: opt(&lib, b"lpGetIntKeyListCount\0"),
            lp_int_key_list_entry_fn: opt(&lib, b"lpGetIntKeyListEntry\0"),
            lp_str_key_float_val_fn: opt(&lib, b"lpGetStrKeyFloatVal\0"),
            lp_open_source_fn: opt(&lib, b"lpOpenSource\0"),
            lp_error_log_fn: opt(&lib, b"lpErrorLog\0"),
            lp_str_key_str_val_fn: opt(&lib, b"lpGetStrKeyStrVal\0"),
            set_spring_config_file_fn: opt(&lib, b"SetSpringConfigFile\0"),
            spring_config_string_fn: opt(&lib, b"GetSpringConfigString\0"),
            spring_config_int_fn: opt(&lib, b"GetSpringConfigInt\0"),
            spring_config_float_fn: opt(&lib, b"GetSpringConfigFloat\0"),
            spring_config_file_fn: opt(&lib, b"GetSpringConfigFile\0"),
            _lib: lib,
        };
        Ok(us)
    }

    /// `Init(isServer, id)` — returns nonzero on success. Must be called before
    /// any enumeration.
    pub fn init(&self, is_server: bool, id: i32) -> i32 {
        unsafe { (self.init_fn)(is_server, id) }
    }

    pub fn uninit(&self) {
        unsafe { (self.uninit_fn)() }
    }

    /// Drain the asynchronous error queue (call `GetNextError` until it returns
    /// null/empty).
    pub fn drain_errors(&self) -> Vec<String> {
        let mut errs = Vec::new();
        loop {
            match unsafe { cstr((self.get_next_error_fn)()) } {
                Some(s) if !s.is_empty() => errs.push(s),
                _ => break,
            }
        }
        errs
    }

    pub fn spring_version(&self) -> Option<String> {
        let f = self.get_spring_version_fn?;
        unsafe { cstr(f()) }.filter(|s| !s.is_empty())
    }

    // ---- maps --------------------------------------------------------------

    pub fn map_count(&self) -> i32 {
        unsafe { (self.map_count_fn)() }
    }

    pub fn map_name(&self, i: i32) -> Option<String> {
        unsafe { cstr((self.map_name_fn)(i)) }
    }

    pub fn map_file_name(&self, i: i32) -> Option<String> {
        let f = self.map_file_name_fn?;
        unsafe { cstr(f(i)) }.filter(|s| !s.is_empty())
    }

    pub fn map_checksum(&self, i: i32) -> Option<u32> {
        self.map_checksum_fn.map(|f| unsafe { f(i) })
    }

    /// Archives backing a map. `GetMapArchiveCount(name)` populates the internal
    /// list that `GetMapArchiveName(i)` then reads, so this does both in order.
    pub fn map_archives(&self, map_name: &str) -> Vec<String> {
        let Ok(cname) = CString::new(map_name) else {
            return Vec::new();
        };
        let count = unsafe { (self.map_archive_count_fn)(cname.as_ptr()) };
        (0..count)
            .filter_map(|i| unsafe { cstr((self.map_archive_name_fn)(i)) })
            .collect()
    }

    // ---- games (primary mods) ---------------------------------------------

    pub fn mod_count(&self) -> i32 {
        unsafe { (self.mod_count_fn)() }
    }

    /// The game's own archive filename (the *primary* archive).
    pub fn mod_archive(&self, i: i32) -> Option<String> {
        unsafe { cstr((self.mod_archive_fn)(i)) }
    }

    pub fn mod_checksum(&self, i: i32) -> Option<u32> {
        self.mod_checksum_fn.map(|f| unsafe { f(i) })
    }

    /// The full archive list for a game (its primary archive plus every
    /// dependency). `GetPrimaryModArchiveCount(i)` loads the list, then
    /// `GetPrimaryModArchiveList(j)` reads each entry.
    pub fn mod_archives(&self, i: i32) -> Vec<String> {
        let count = unsafe { (self.mod_archive_count_fn)(i) };
        (0..count)
            .filter_map(|j| unsafe { cstr((self.mod_archive_list_fn)(j)) })
            .collect()
    }

    /// Read `count` already-loaded info entries via the shared `GetInfo*`
    /// accessors. Only string-typed entries are read — that covers every field we
    /// display and avoids asserting on typed getters that some builds handle
    /// differently. The caller must have loaded the block first (e.g. via
    /// `GetPrimaryModInfoCount` / `GetMapInfoCount`).
    fn read_info(&self, count: i32) -> BTreeMap<String, String> {
        let mut info = BTreeMap::new();
        for k in 0..count {
            let Some(key) = (unsafe { cstr((self.info_key_fn)(k)) }) else {
                continue;
            };
            let is_string = match self.info_type_fn {
                Some(f) => unsafe { cstr(f(k)) }.map(|t| t == "string").unwrap_or(true),
                None => true,
            };
            if !is_string {
                continue;
            }
            if let Some(v) = unsafe { cstr((self.info_value_string_fn)(k)) } {
                info.insert(key, v);
            }
        }
        info
    }

    /// Key/value metadata for a game (name, shortname, version, description, ...).
    pub fn mod_info(&self, i: i32) -> BTreeMap<String, String> {
        let count = unsafe { (self.mod_info_count_fn)(i) };
        self.read_info(count)
    }

    /// Key/value metadata for a map (description, author, dimensions, ...), when
    /// the engine build exposes `GetMapInfoCount`.
    pub fn map_info(&self, i: i32) -> BTreeMap<String, String> {
        match self.map_info_count_fn {
            Some(f) => self.read_info(unsafe { f(i) }),
            None => BTreeMap::new(),
        }
    }

    /// The map's proportions as `(width, height)`. unitsync's minimap is always a
    /// square texture (the map sampled into 1024x1024), so the real aspect ratio
    /// is needed to display it undistorted. The metal infomap's dimensions are
    /// proportional to the map, so their ratio is the map's aspect ratio.
    pub fn map_dimensions(&self, map_name: &str) -> Option<(u32, u32)> {
        let f = self.info_map_size_fn?;
        let name = CString::new(map_name).ok()?;
        let which = CString::new("metal").ok()?;
        let mut w: c_int = 0;
        let mut h: c_int = 0;
        let ok = unsafe { f(name.as_ptr(), which.as_ptr(), &mut w, &mut h) };
        (ok != 0 && w > 0 && h > 0).then_some((w as u32, h as u32))
    }

    /// The map's minimap as a raw RGB565 buffer (`side x side`, where
    /// `side = 1024 >> mip`). `None` if the build lacks `GetMinimap` or the map
    /// has none. The returned buffer is library-owned and copied out immediately.
    pub fn minimap(&self, map_name: &str, mip: i32) -> Option<Vec<u16>> {
        let f = self.minimap_fn?;
        let c = CString::new(map_name).ok()?;
        let ptr = unsafe { f(c.as_ptr(), mip) };
        if ptr.is_null() {
            return None;
        }
        let side = 1024usize >> mip.clamp(0, 10);
        let len = side * side;
        Some(unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec())
    }

    // ---- optional archive metadata ----------------------------------------

    pub fn archive_path(&self, name: &str) -> Option<String> {
        let f = self.archive_path_fn?;
        let c = CString::new(name).ok()?;
        unsafe { cstr(f(c.as_ptr())) }.filter(|s| !s.is_empty())
    }

    pub fn archive_checksum(&self, name: &str) -> Option<u32> {
        let f = self.archive_checksum_fn?;
        let c = CString::new(name).ok()?;
        Some(unsafe { f(c.as_ptr()) })
    }

    // ---- archive file access (browse + read members) ----------------------

    /// Open an archive in the VFS by its name (`*.sd7`/`*.sdz`/`*.sdd`, or a
    /// rapid `*.sdp`). Returns its handle, or `None` if the build lacks the
    /// symbol or the open failed (a zero handle means error).
    pub fn open_archive(&self, name: &str) -> Option<i32> {
        let f = self.open_archive_fn?;
        let c = CString::new(name).ok()?;
        let h = unsafe { f(c.as_ptr()) };
        (h != 0).then_some(h)
    }

    /// Enumerate VFS file-paths under `path` matching `pattern`, restricted to the
    /// archive `modes` (VFSModes.h: "r" raw, "M" mod, "m" map, "b" base). Mirrors
    /// the engine's contract: InitDirListVFS returns 0/-1 (success/error) and fills
    /// an internal list; FindFilesVFS(idx) copies entry `idx` and returns `idx+1`,
    /// or 0 once `idx` is past the end. So iterate from index 0.
    pub fn list_vfs_dir(&self, path: &str, pattern: &str, modes: &str) -> Vec<String> {
        let (Some(init), Some(find)) = (self.init_dir_list_vfs_fn, self.find_files_vfs_fn) else {
            return Vec::new();
        };
        let (Ok(cp), Ok(cpat), Ok(cm)) = (
            CString::new(path),
            CString::new(pattern),
            CString::new(modes),
        ) else {
            return Vec::new();
        };
        if unsafe { init(cp.as_ptr(), cpat.as_ptr(), cm.as_ptr()) } < 0 {
            return Vec::new();
        }
        let mut out = Vec::new();
        let mut buf = vec![0u8; 4096];
        let mut idx: c_int = 0;
        loop {
            let next = unsafe { find(idx, buf.as_mut_ptr() as *mut c_char, buf.len() as c_int) };
            if next == 0 {
                break;
            }
            if let Some(name) = unsafe { cstr(buf.as_ptr() as *const c_char) } {
                if !name.is_empty() {
                    out.push(name);
                }
            }
            idx = next;
            if out.len() >= 200_000 {
                break;
            }
        }
        out
    }

    pub fn close_archive(&self, archive: i32) {
        if let Some(f) = self.close_archive_fn {
            unsafe { f(archive) }
        }
    }

    /// List every member of an opened archive as `(path, size)`. Walks the
    /// engine's cursor idiom: `FindFilesArchive(archive, cur, buf, &size)` fills
    /// `buf` with the entry at `cur` and returns `cur + 1`, returning `0` once
    /// `cur` is past the end (filling nothing) — so we break on `0` before
    /// reading. `size` is in/out: on input it must hold `buf`'s capacity (the
    /// engine refuses to copy a name that doesn't fit, setting "name-buffer is
    /// too small" and returning `0`); on output it holds the member's byte size,
    /// so it must be reset to the buffer length before every call.
    pub fn list_archive_files(&self, archive: i32) -> Vec<(String, u64)> {
        let Some(find) = self.find_files_archive_fn else {
            return Vec::new();
        };
        let mut out = Vec::new();
        let mut buf = vec![0u8; 4096];
        let mut cur: c_int = 0;
        loop {
            let mut size: c_int = buf.len() as c_int;
            let next = unsafe { find(archive, cur, buf.as_mut_ptr() as *mut c_char, &mut size) };
            if next <= 0 {
                break;
            }
            if let Some(name) = unsafe { cstr(buf.as_ptr() as *const c_char) } {
                if !name.is_empty() {
                    out.push((name, size.max(0) as u64));
                }
            }
            cur = next;
            // Safety stop against a misbehaving build that never returns 0.
            if out.len() >= 200_000 {
                break;
            }
        }
        out
    }

    /// Read a member of an opened archive, capped at `cap` bytes. Returns the
    /// member's real size and the (possibly truncated) bytes, or `None` if the
    /// build lacks the symbols or the member can't be opened.
    pub fn read_archive_member(
        &self,
        archive: i32,
        inner: &str,
        cap: usize,
    ) -> Option<(u64, Vec<u8>)> {
        let open = self.open_archive_file_fn?;
        let size_fn = self.size_archive_file_fn?;
        let read = self.read_archive_file_fn?;
        let c = CString::new(inner).ok()?;
        let fh = unsafe { open(archive, c.as_ptr()) };
        if fh < 0 {
            return None;
        }
        let real = unsafe { size_fn(archive, fh) }.max(0) as u64;
        let to_read = (real as usize).min(cap);
        let mut buf = vec![0u8; to_read];
        let mut got = 0usize;
        if to_read > 0 {
            let n = unsafe { read(archive, fh, buf.as_mut_ptr(), to_read as c_int) };
            if n > 0 {
                got = (n as usize).min(to_read);
            }
        }
        buf.truncate(got);
        if let Some(close) = self.close_archive_file_fn {
            unsafe { close(archive, fh) }
        }
        Some((real, buf))
    }

    // ---- sides / units (after a game's archives are added) ----------------

    /// Load a game's archive set (its primary archive plus dependencies) into the
    /// VFS so its sides/units become queryable. Returns false if unsupported.
    pub fn add_all_archives(&self, archive: &str) -> bool {
        let (Some(f), Ok(c)) = (self.add_all_archives_fn, CString::new(archive)) else {
            return false;
        };
        unsafe { f(c.as_ptr()) };
        true
    }

    /// Reset the VFS to just the base archives (undo `add_all_archives`).
    pub fn remove_all_archives(&self) {
        if let Some(f) = self.remove_all_archives_fn {
            unsafe { f() }
        }
    }

    pub fn side_count(&self) -> i32 {
        self.side_count_fn.map(|f| unsafe { f() }).unwrap_or(0)
    }

    pub fn side_name(&self, i: i32) -> Option<String> {
        self.side_name_fn
            .and_then(|f| unsafe { cstr(f(i)) })
            .filter(|s| !s.is_empty())
    }

    pub fn side_start_unit(&self, i: i32) -> Option<String> {
        self.side_start_unit_fn
            .and_then(|f| unsafe { cstr(f(i)) })
            .filter(|s| !s.is_empty())
    }

    /// Process unit defs (call until it returns 0) before unit queries.
    pub fn process_units(&self) -> i32 {
        self.process_units_fn.map(|f| unsafe { f() }).unwrap_or(0)
    }

    pub fn unit_count(&self) -> i32 {
        self.unit_count_fn.map(|f| unsafe { f() }).unwrap_or(0)
    }

    pub fn unit_name(&self, i: i32) -> Option<String> {
        self.unit_name_fn.and_then(|f| unsafe { cstr(f(i)) })
    }

    pub fn full_unit_name(&self, i: i32) -> Option<String> {
        self.full_unit_name_fn
            .and_then(|f| unsafe { cstr(f(i)) })
            .filter(|s| !s.is_empty())
    }

    // ---- options ----------------------------------------------------------
    //
    // The `GetOption*` accessors read a global table populated by the most recent
    // `GetMapOptionCount` / `GetModOptionCount` call, so read them right after.

    pub fn map_option_count(&self, map_name: &str) -> i32 {
        let (Some(f), Ok(c)) = (self.map_option_count_fn, CString::new(map_name)) else {
            return 0;
        };
        unsafe { f(c.as_ptr()) }
    }

    pub fn mod_option_count(&self) -> i32 {
        self.mod_option_count_fn
            .map(|f| unsafe { f() })
            .unwrap_or(0)
    }

    pub fn option_key(&self, i: i32) -> Option<String> {
        self.option_key_fn
            .and_then(|f| unsafe { cstr(f(i)) })
            .filter(|s| !s.is_empty())
    }

    pub fn option_name(&self, i: i32) -> Option<String> {
        self.option_name_fn
            .and_then(|f| unsafe { cstr(f(i)) })
            .filter(|s| !s.is_empty())
    }

    pub fn option_desc(&self, i: i32) -> Option<String> {
        self.option_desc_fn
            .and_then(|f| unsafe { cstr(f(i)) })
            .filter(|s| !s.is_empty())
    }

    // ---- start positions --------------------------------------------------

    /// Parse `mapinfo.lua` from the VFS (the calling code must have added the
    /// map's archives) and extract team start positions as `(x, z)` world coords
    /// from `teams[i].startPos`. Uses unitsync's own Lua parser so it handles the
    /// archive VFS and any includes. Empty if unavailable or the map has none.
    pub fn start_positions(&self) -> Vec<(f32, f32)> {
        let (
            Some(open),
            Some(execute),
            Some(close),
            Some(root),
            Some(sub_str),
            Some(sub_int),
            Some(pop),
            Some(int_count),
            Some(int_entry),
            Some(float_val),
        ) = (
            self.lp_open_file_fn,
            self.lp_execute_fn,
            self.lp_close_fn,
            self.lp_root_table_fn,
            self.lp_sub_table_str_fn,
            self.lp_sub_table_int_fn,
            self.lp_pop_table_fn,
            self.lp_int_key_list_count_fn,
            self.lp_int_key_list_entry_fn,
            self.lp_str_key_float_val_fn,
        )
        else {
            return Vec::new();
        };

        // "rmMbe" = unitsync's SPRING_VFS_ALL — search raw + map + mod + base, so
        // mapinfo.lua resolves inside the added archive (not just the filesystem).
        let (Ok(file), Ok(modes), Ok(x_key), Ok(z_key)) = (
            CString::new("mapinfo.lua"),
            CString::new("rmMbe"),
            CString::new("x"),
            CString::new("z"),
        ) else {
            return Vec::new();
        };
        let teams_key = CString::new("teams").unwrap_or_default();
        let startpos_key = CString::new("startPos").unwrap_or_default();

        let mut positions = Vec::new();
        unsafe {
            if open(file.as_ptr(), modes.as_ptr(), modes.as_ptr()) == 0 {
                return Vec::new();
            }
            execute();
            if root() != 0 && sub_str(teams_key.as_ptr()) != 0 {
                let count = int_count();
                for i in 0..count {
                    let key = int_entry(i);
                    if sub_int(key) != 0 {
                        if sub_str(startpos_key.as_ptr()) != 0 {
                            let x = float_val(x_key.as_ptr(), f32::MIN);
                            let z = float_val(z_key.as_ptr(), f32::MIN);
                            if x > f32::MIN && z > f32::MIN {
                                positions.push((x, z));
                            }
                            pop(); // startPos
                        }
                        pop(); // teams[i]
                    }
                }
                pop(); // teams
            }
            close();
        }
        positions
    }

    /// Execute a Lua source string through unitsync's `LuaParser` with `modes`
    /// VFS access. The caller must wrap the user's code so the chunk returns a
    /// table with a string `result` field (and an optional `__error` field) —
    /// see [`crate::lua::wrap_source`]. Returns the `result` string on success,
    /// or `Err(message)` for a compile error (`lpOpenSource` failed), a chunk
    /// failure (`lpRootTable` empty), a captured runtime error (`__error` set),
    /// or a build that lacks the Lua-parser symbols.
    pub fn run_lua_source(&self, source: &str, modes: &str) -> Result<String, String> {
        let (Some(open), Some(execute), Some(close), Some(root), Some(get_str)) = (
            self.lp_open_source_fn,
            self.lp_execute_fn,
            self.lp_close_fn,
            self.lp_root_table_fn,
            self.lp_str_key_str_val_fn,
        ) else {
            return Err("this engine's libunitsync does not expose the Lua parser \
                        (lpOpenSource/lpGetStrKeyStrVal)"
                .into());
        };
        let (Ok(csrc), Ok(cmodes), Ok(result_key), Ok(err_key), Ok(empty)) = (
            CString::new(source),
            CString::new(modes),
            CString::new("result"),
            CString::new("__error"),
            CString::new(""),
        ) else {
            return Err("Lua source or arguments contained a NUL byte".into());
        };

        unsafe {
            if open(csrc.as_ptr(), cmodes.as_ptr()) == 0 {
                return Err(self
                    .lp_error_log()
                    .unwrap_or_else(|| "could not compile the script".into()));
            }
            // lpExecute returns nonzero on success; we don't read it here because a
            // failed run leaves no root table, so root() == 0 below is the signal.
            let _ = execute();
            if root() == 0 {
                let log = self.lp_error_log();
                close();
                return Err(log.unwrap_or_else(|| {
                    "script did not produce a result table (lpRootTable failed)".into()
                }));
            }
            let runtime_err =
                cstr(get_str(err_key.as_ptr(), empty.as_ptr())).filter(|s| !s.is_empty());
            let result = cstr(get_str(result_key.as_ptr(), empty.as_ptr())).unwrap_or_default();
            close();
            match runtime_err {
                Some(e) => Err(e),
                None => Ok(result),
            }
        }
    }

    /// The Lua parser's accumulated error log, when non-empty.
    fn lp_error_log(&self) -> Option<String> {
        let f = self.lp_error_log_fn?;
        unsafe { cstr(f()) }.filter(|s| !s.is_empty())
    }

    // ---- engine configuration ---------------------------------------------
    //
    // `GetSpringConfig{String,Int,Float}(name, default)` read the user's
    // springsettings.cfg by key. The engine returns the configured value if the
    // key is *set*, otherwise the passed `default` (it does not substitute the
    // engine's own registered default), so the caller supplies each key's real
    // default to display an effective value. There is no enumeration accessor, so
    // the caller reads a curated set of known keys. `None` here means the build
    // lacks the symbol (treated as "config unavailable" by the caller).

    /// Instantiate unitsync's config handler from the default config source,
    /// without a full `Init` (which would also scan the VFS). Required before any
    /// `spring_config_*` read — they throw if the handler isn't set up. Passing an
    /// empty source uses the default `springsettings.cfg` location and leaves the
    /// `name` setting untouched. Returns false if the build lacks the symbol.
    pub fn preinit_config(&self) -> bool {
        let Some(f) = self.set_spring_config_file_fn else {
            return false;
        };
        let empty = CString::new("").unwrap_or_default();
        unsafe { f(empty.as_ptr()) };
        true
    }

    pub fn spring_config_string(&self, name: &str, default: &str) -> Option<String> {
        let f = self.spring_config_string_fn?;
        let (Ok(c), Ok(d)) = (CString::new(name), CString::new(default)) else {
            return None;
        };
        unsafe { cstr(f(c.as_ptr(), d.as_ptr())) }
    }

    pub fn spring_config_int(&self, name: &str, default: i32) -> Option<i32> {
        let f = self.spring_config_int_fn?;
        let c = CString::new(name).ok()?;
        Some(unsafe { f(c.as_ptr(), default) })
    }

    pub fn spring_config_float(&self, name: &str, default: f32) -> Option<f32> {
        let f = self.spring_config_float_fn?;
        let c = CString::new(name).ok()?;
        Some(unsafe { f(c.as_ptr(), default) })
    }

    /// Whether any config accessor resolved — false means this build can't read
    /// engine configuration at all.
    pub fn has_spring_config(&self) -> bool {
        self.spring_config_string_fn.is_some()
            || self.spring_config_int_fn.is_some()
            || self.spring_config_float_fn.is_some()
    }

    /// Path of the config file unitsync reads (`springsettings.cfg`), for display.
    pub fn spring_config_file(&self) -> Option<String> {
        let f = self.spring_config_file_fn?;
        unsafe { cstr(f()) }.filter(|s| !s.is_empty())
    }
}
