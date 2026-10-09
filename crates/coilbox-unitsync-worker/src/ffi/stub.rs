//! A stand-in for `libunitsync` that tests can load, so a test can count what a
//! read asks unitsync for (issue #3724).
//!
//! The real library is a C singleton in the user's engine install, so the worker
//! reaches it through function pointers. This fills the same pointers with the
//! functions below, which answer from a [`World`] the test describes and count
//! each call by its C name. State is per thread, because tests run on one thread
//! each and the library's real state is global.
//!
//! Only the entry points the cached reads touch have a body. Everything else is
//! `None`, which is what an engine build without that export looks like, and the
//! callers already treat that as "no answer".

use super::*;
use std::cell::RefCell;

/// What the stand-in library holds.
#[derive(Default)]
pub(crate) struct World {
    pub map_name: String,
    /// The map's file inside its archive, `GetMapFileName`.
    pub map_file: String,
    /// What `GetMapArchiveName` answers for the map: the archive's file name.
    pub map_archive: String,
    /// Where `GetArchivePath` says every name in `archives` lives.
    pub archive_dir: PathBuf,
    pub archives: Vec<String>,
    /// `GetInfoMapSize` for the `metal` and `height` maps.
    pub metal_size: (i32, i32),
    pub height_size: (i32, i32),
    pub heights: Vec<u16>,
    pub height_bounds: (f32, f32),
    /// The members of every archive `OpenArchive` is asked for.
    pub members: Vec<(String, Vec<u8>)>,
    /// `mapinfo.lua`, flattened: `teams/1/startPos/x` is a number.
    pub lua_numbers: BTreeMap<String, f32>,
    pub lua_bools: BTreeMap<String, bool>,
    /// `GetDataDirectory`: where the library says its archive scanner looked.
    pub data_dirs: Vec<PathBuf>,
}

impl World {
    /// Name of the map [`World::with_map`] describes.
    pub(crate) const MAP: &'static str = "Stub Map 1.0";
    /// The map's archive file, which [`World::with_map`] writes into `dir`.
    pub(crate) const MAP_ARCHIVE: &'static str = "stubmap_1.0.sd7";

    /// A map whose archive exists on disk under `dir`, so its file identity
    /// (path, size, modified time) is real, with two start positions, wind, tidal
    /// strength, some water and sky colours, and a 5 by 5 height grid.
    pub(crate) fn with_map(dir: &Path) -> World {
        std::fs::create_dir_all(dir).expect("archive dir");
        std::fs::write(dir.join(Self::MAP_ARCHIVE), b"a map archive").expect("archive");
        let mut lua_numbers = BTreeMap::new();
        for (team, x, z) in [(0, 512.0, 1024.0), (1, 4096.0, 3072.5)] {
            lua_numbers.insert(format!("teams/{team}/startPos/x"), x);
            lua_numbers.insert(format!("teams/{team}/startPos/z"), z);
        }
        for (key, value) in [
            ("atmosphere/minWind", 4.5),
            ("atmosphere/maxWind", 18.0),
            ("tidalStrength", 13.0),
            ("water/surfaceAlpha", 0.75),
            ("atmosphere/cloudDensity", 0.4),
            ("lighting/groundShadowDensity", 0.8),
        ] {
            lua_numbers.insert(key.to_string(), value);
        }
        for (table, colour) in [
            ("water/surfaceColor", [0.1, 0.2, 0.3]),
            ("atmosphere/skyColor", [0.5, 0.6, 0.7]),
            ("lighting/sunDir", [0.0, 1.0, 0.25]),
        ] {
            for (i, c) in colour.iter().enumerate() {
                lua_numbers.insert(format!("{table}/{}", i + 1), *c);
            }
        }
        World {
            map_name: Self::MAP.into(),
            map_file: "maps/stubmap.smf".into(),
            map_archive: Self::MAP_ARCHIVE.into(),
            archive_dir: dir.to_path_buf(),
            archives: vec![Self::MAP_ARCHIVE.into()],
            metal_size: (64, 48),
            height_size: (5, 5),
            heights: (0..25).map(|i| i * 1000).collect(),
            height_bounds: (-20.5, 310.25),
            lua_numbers,
            lua_bools: BTreeMap::from([("voidWater".to_string(), true)]),
            ..World::default()
        }
    }
}

impl World {
    /// The game [`World::with_game`] describes.
    pub(crate) const GAME: &'static str = "stubgame.sdz";

    /// A game whose archive exists on disk under `dir` and holds one unit,
    /// `objects3d/armcom.s3o`, with one texture, `unittextures/arm.png`.
    pub(crate) fn with_game(dir: &Path) -> World {
        use coilbox_s3o::{Model, Piece, PrimitiveType, Vertex};
        std::fs::create_dir_all(dir).expect("archive dir");
        std::fs::write(dir.join(Self::GAME), b"a game archive").expect("archive");
        let vertex = |pos: [f32; 3]| Vertex {
            pos,
            normal: [0.0, 1.0, 0.0],
            uv: [pos[0], pos[2]],
        };
        let model = Model {
            radius: 12.0,
            height: 8.0,
            mid: [0.0, 4.0, 0.0],
            texture1: "arm.png".into(),
            texture2: String::new(),
            root: Piece {
                name: "base".into(),
                primitive_type: PrimitiveType::Triangles,
                offset: [0.0, 0.0, 0.0],
                vertices: vec![
                    vertex([0.0, 0.0, 0.0]),
                    vertex([1.0, 0.0, 0.0]),
                    vertex([0.0, 0.0, 1.0]),
                ],
                indices: vec![0, 1, 2],
                children: Vec::new(),
            },
        };
        World {
            archive_dir: dir.to_path_buf(),
            archives: vec![Self::GAME.into()],
            members: vec![
                (
                    "objects3d/armcom.s3o".into(),
                    coilbox_s3o::write(&model).expect("a valid model"),
                ),
                ("unittextures/arm.png".into(), b"pretend png".to_vec()),
            ],
            ..World::default()
        }
    }
}

#[derive(Default)]
struct State {
    world: World,
    calls: BTreeMap<&'static str, usize>,
    strings: Vec<CString>,
    minimap: Vec<u16>,
    map_query: String,
    lua_path: Vec<String>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

/// Describe the library this thread's [`Unitsync::stub`] will answer from, and
/// zero its call counts.
pub(crate) fn install(world: World) {
    STATE.with(|s| {
        *s.borrow_mut() = State {
            world,
            ..State::default()
        }
    });
}

/// How many times `symbol` (its C name, such as `AddAllArchives`) was called.
pub(crate) fn calls(symbol: &str) -> usize {
    STATE.with(|s| s.borrow().calls.get(symbol).copied().unwrap_or(0))
}

fn with<R>(symbol: &'static str, f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        *s.calls.entry(symbol).or_default() += 1;
        f(&mut s)
    })
}

fn text(s: &mut State, value: &str) -> *const c_char {
    let c = CString::new(value).unwrap_or_default();
    let ptr = c.as_ptr();
    s.strings.push(c);
    ptr
}

unsafe fn arg(p: *const c_char) -> String {
    cstr(p).unwrap_or_default()
}

unsafe extern "C" fn init(_: bool, _: c_int) -> c_int {
    with("Init", |_| 1)
}
unsafe extern "C" fn uninit() {
    with("UnInit", |_| ())
}
unsafe extern "C" fn data_dir_count() -> c_int {
    with("GetDataDirectoryCount", |s| {
        s.world.data_dirs.len() as c_int
    })
}
unsafe extern "C" fn data_dir(i: c_int) -> *const c_char {
    with("GetDataDirectory", |s| {
        let dir = s.world.data_dirs[i as usize].to_string_lossy().into_owned();
        text(s, &dir)
    })
}
unsafe extern "C" fn next_error() -> *const c_char {
    std::ptr::null()
}
unsafe extern "C" fn map_count() -> c_int {
    with("GetMapCount", |_| 1)
}
unsafe extern "C" fn map_name(_: c_int) -> *const c_char {
    with("GetMapName", |s| {
        let name = s.world.map_name.clone();
        text(s, &name)
    })
}
unsafe extern "C" fn map_file_name(_: c_int) -> *const c_char {
    with("GetMapFileName", |s| {
        let name = s.world.map_file.clone();
        text(s, &name)
    })
}
unsafe extern "C" fn map_archive_count(name: *const c_char) -> c_int {
    let name = arg(name);
    with("GetMapArchiveCount", |s| {
        s.map_query = name;
        1
    })
}
unsafe extern "C" fn map_archive_name(_: c_int) -> *const c_char {
    with("GetMapArchiveName", |s| {
        let name = if s.map_query == s.world.map_name {
            s.world.map_archive.clone()
        } else {
            s.map_query.clone()
        };
        text(s, &name)
    })
}
unsafe extern "C" fn zero() -> c_int {
    0
}
unsafe extern "C" fn zero_by_int(_: c_int) -> c_int {
    0
}
unsafe extern "C" fn null_by_int(_: c_int) -> *const c_char {
    std::ptr::null()
}
unsafe extern "C" fn archive_path(name: *const c_char) -> *const c_char {
    let name = arg(name);
    with("GetArchivePath", |s| {
        if s.world.archives.contains(&name) {
            let dir = s.world.archive_dir.to_string_lossy().into_owned();
            text(s, &dir)
        } else {
            std::ptr::null()
        }
    })
}
unsafe extern "C" fn minimap(_: *const c_char, mip: c_int) -> *const u16 {
    with("GetMinimap", |s| {
        let side = 1024usize >> mip.clamp(0, 10);
        s.minimap = (0..side * side).map(|i| (i % 251) as u16).collect();
        s.minimap.as_ptr()
    })
}
unsafe extern "C" fn info_map_size(
    _: *const c_char,
    kind: *const c_char,
    w: *mut c_int,
    h: *mut c_int,
) -> c_int {
    let kind = arg(kind);
    with("GetInfoMapSize", |s| {
        let (mw, mh) = match kind.as_str() {
            "metal" => s.world.metal_size,
            "height" => s.world.height_size,
            _ => (0, 0),
        };
        *w = mw;
        *h = mh;
        1
    })
}
unsafe extern "C" fn info_map(
    _: *const c_char,
    kind: *const c_char,
    out: *mut u8,
    _: c_int,
) -> c_int {
    let kind = arg(kind);
    with("GetInfoMap", |s| {
        if kind != "height" {
            return 0;
        }
        for (i, sample) in s.world.heights.iter().enumerate() {
            std::ptr::copy_nonoverlapping(sample.to_ne_bytes().as_ptr(), out.add(i * 2), 2);
        }
        1
    })
}
unsafe extern "C" fn min_height(_: *const c_char) -> c_float {
    with("GetMapMinHeight", |s| s.world.height_bounds.0)
}
unsafe extern "C" fn max_height(_: *const c_char) -> c_float {
    with("GetMapMaxHeight", |s| s.world.height_bounds.1)
}
unsafe extern "C" fn add_all_archives(_: *const c_char) {
    with("AddAllArchives", |_| ())
}
unsafe extern "C" fn remove_all_archives() {
    with("RemoveAllArchives", |_| ())
}
unsafe extern "C" fn open_archive(_: *const c_char) -> c_int {
    with("OpenArchive", |_| 1)
}
unsafe extern "C" fn close_archive(_: c_int) {
    with("CloseArchive", |_| ())
}
unsafe extern "C" fn find_files_archive(
    _: c_int,
    cur: c_int,
    buf: *mut c_char,
    size: *mut c_int,
) -> c_int {
    with("FindFilesArchive", |s| {
        let Some((name, bytes)) = s.world.members.get(cur as usize) else {
            return 0;
        };
        let c = CString::new(name.as_str()).unwrap_or_default();
        std::ptr::copy_nonoverlapping(c.as_ptr(), buf, c.as_bytes_with_nul().len());
        *size = bytes.len() as c_int;
        cur + 1
    })
}
unsafe extern "C" fn open_archive_file(_: c_int, name: *const c_char) -> c_int {
    let name = arg(name);
    with("OpenArchiveFile", |s| {
        s.world
            .members
            .iter()
            .position(|(member, _)| *member == name)
            .map_or(-1, |i| i as c_int)
    })
}
unsafe extern "C" fn size_archive_file(_: c_int, file: c_int) -> c_int {
    with("SizeArchiveFile", |s| {
        s.world.members[file as usize].1.len() as c_int
    })
}
unsafe extern "C" fn read_archive_file(_: c_int, file: c_int, out: *mut u8, n: c_int) -> c_int {
    with("ReadArchiveFile", |s| {
        let bytes = &s.world.members[file as usize].1;
        let n = (n as usize).min(bytes.len());
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, n);
        n as c_int
    })
}
unsafe extern "C" fn close_archive_file(_: c_int, _: c_int) {}

// ---- the Lua parser: a stack of table names over the flattened `mapinfo.lua`

fn lua_join(path: &[String], key: &str) -> String {
    path.iter()
        .map(String::as_str)
        .chain(std::iter::once(key))
        .collect::<Vec<_>>()
        .join("/")
}

fn lua_has_table(s: &State, key: &str) -> bool {
    let prefix = format!("{}/", lua_join(&s.lua_path, key));
    s.world.lua_numbers.keys().any(|k| k.starts_with(&prefix))
}

fn lua_enter(s: &mut State, key: &str) -> c_int {
    if lua_has_table(s, key) {
        s.lua_path.push(key.to_string());
        1
    } else {
        0
    }
}

fn lua_int_keys(s: &State) -> Vec<c_int> {
    let prefix = if s.lua_path.is_empty() {
        String::new()
    } else {
        format!("{}/", s.lua_path.join("/"))
    };
    let mut keys: Vec<c_int> = s
        .world
        .lua_numbers
        .keys()
        .filter_map(|k| k.strip_prefix(&prefix))
        .filter_map(|rest| rest.split('/').next()?.parse().ok())
        .collect();
    keys.sort_unstable();
    keys.dedup();
    keys
}

unsafe extern "C" fn lp_open_file(_: *const c_char, _: *const c_char, _: *const c_char) -> c_int {
    with("lpOpenFile", |_| 1)
}
unsafe extern "C" fn lp_execute() -> c_int {
    1
}
unsafe extern "C" fn lp_close() {}
unsafe extern "C" fn lp_root_table() -> c_int {
    with("lpRootTable", |s| {
        s.lua_path.clear();
        1
    })
}
unsafe extern "C" fn lp_sub_table_str(key: *const c_char) -> c_int {
    let key = arg(key);
    with("lpSubTableStr", |s| lua_enter(s, &key))
}
unsafe extern "C" fn lp_sub_table_int(key: c_int) -> c_int {
    with("lpSubTableInt", |s| lua_enter(s, &key.to_string()))
}
unsafe extern "C" fn lp_pop_table() {
    with("lpPopTable", |s| {
        s.lua_path.pop();
    })
}
unsafe extern "C" fn lp_int_key_list_count() -> c_int {
    with("lpGetIntKeyListCount", |s| lua_int_keys(s).len() as c_int)
}
unsafe extern "C" fn lp_int_key_list_entry(i: c_int) -> c_int {
    with("lpGetIntKeyListEntry", |s| lua_int_keys(s)[i as usize])
}
unsafe extern "C" fn lp_str_key_float_val(key: *const c_char, default: c_float) -> c_float {
    let key = arg(key);
    with("lpGetStrKeyFloatVal", |s| {
        s.world
            .lua_numbers
            .get(&lua_join(&s.lua_path, &key))
            .copied()
            .unwrap_or(default)
    })
}
unsafe extern "C" fn lp_int_key_float_val(key: c_int, default: c_float) -> c_float {
    with("lpGetIntKeyFloatVal", |s| {
        s.world
            .lua_numbers
            .get(&lua_join(&s.lua_path, &key.to_string()))
            .copied()
            .unwrap_or(default)
    })
}
unsafe extern "C" fn lp_str_key_bool_val(key: *const c_char, default: c_int) -> c_int {
    let key = arg(key);
    with("lpGetStrKeyBoolVal", |s| {
        s.world
            .lua_bools
            .get(&lua_join(&s.lua_path, &key))
            .map_or(default, |&b| c_int::from(b))
    })
}

impl Unitsync {
    /// A [`Unitsync`] whose entry points are the functions above. Describe what
    /// it holds with [`install`] first.
    pub(crate) fn stub() -> Unitsync {
        #[cfg(unix)]
        let lib: Library = libloading::os::unix::Library::this().into();
        #[cfg(windows)]
        let lib: Library = libloading::os::windows::Library::this()
            .expect("the running test binary")
            .into();
        let mut us = Unitsync {
            _lib: lib,
            init_lock: std::env::temp_dir()
                .join(format!("coilbox-stub-unitsync-{}.lock", std::process::id())),
            init_fn: init,
            uninit_fn: uninit,
            get_next_error_fn: next_error,
            map_count_fn: map_count,
            map_name_fn: map_name,
            map_archive_count_fn: map_archive_count,
            map_archive_name_fn: map_archive_name,
            mod_count_fn: zero,
            mod_archive_fn: null_by_int,
            mod_archive_count_fn: zero_by_int,
            mod_archive_list_fn: null_by_int,
            mod_info_count_fn: zero_by_int,
            info_key_fn: null_by_int,
            info_value_string_fn: null_by_int,
            get_spring_version_fn: None,
            map_file_name_fn: None,
            map_info_count_fn: None,
            minimap_fn: None,
            info_map_size_fn: None,
            info_map_fn: None,
            map_min_height_fn: None,
            map_max_height_fn: None,
            info_type_fn: None,
            info_value_float_fn: None,
            info_value_int_fn: None,
            archive_path_fn: None,
            archive_checksum_fn: None,
            mod_checksum_fn: None,
            map_checksum_from_name_fn: None,
            open_archive_fn: None,
            close_archive_fn: None,
            init_dir_list_vfs_fn: None,
            init_sub_dirs_vfs_fn: None,
            find_files_vfs_fn: None,
            find_files_archive_fn: None,
            open_archive_file_fn: None,
            read_archive_file_fn: None,
            close_archive_file_fn: None,
            size_archive_file_fn: None,
            open_file_vfs_fn: None,
            close_file_vfs_fn: None,
            read_file_vfs_fn: None,
            file_size_vfs_fn: None,
            add_all_archives_fn: None,
            remove_all_archives_fn: None,
            side_count_fn: None,
            side_name_fn: None,
            side_start_unit_fn: None,
            process_units_fn: None,
            unit_count_fn: None,
            unit_name_fn: None,
            full_unit_name_fn: None,
            skirmish_ai_count_fn: None,
            skirmish_ai_info_count_fn: None,
            map_option_count_fn: None,
            mod_option_count_fn: None,
            option_key_fn: None,
            option_name_fn: None,
            option_desc_fn: None,
            option_section_fn: None,
            option_type_fn: None,
            option_bool_def_fn: None,
            option_number_def_fn: None,
            option_number_min_fn: None,
            option_number_max_fn: None,
            option_number_step_fn: None,
            option_string_def_fn: None,
            option_list_count_fn: None,
            option_list_def_fn: None,
            option_list_item_key_fn: None,
            option_list_item_name_fn: None,
            lp_open_file_fn: None,
            lp_execute_fn: None,
            lp_close_fn: None,
            lp_root_table_fn: None,
            lp_sub_table_str_fn: None,
            lp_sub_table_int_fn: None,
            lp_pop_table_fn: None,
            lp_int_key_list_count_fn: None,
            lp_int_key_list_entry_fn: None,
            lp_str_key_float_val_fn: None,
            lp_int_key_float_val_fn: None,
            lp_str_key_bool_val_fn: None,
            lp_open_source_fn: None,
            lp_error_log_fn: None,
            lp_str_key_str_val_fn: None,
            set_spring_config_file_fn: None,
            spring_config_string_fn: None,
            spring_config_int_fn: None,
            spring_config_float_fn: None,
            set_spring_config_string_fn: None,
            set_spring_config_int_fn: None,
            set_spring_config_float_fn: None,
            spring_config_file_fn: None,
            data_dir_count_fn: Some(data_dir_count),
            data_dir_fn: Some(data_dir),
        };
        us.map_file_name_fn = Some(map_file_name);
        us.minimap_fn = Some(minimap);
        us.info_map_size_fn = Some(info_map_size);
        us.info_map_fn = Some(info_map);
        us.map_min_height_fn = Some(min_height);
        us.map_max_height_fn = Some(max_height);
        us.archive_path_fn = Some(archive_path);
        us.open_archive_fn = Some(open_archive);
        us.close_archive_fn = Some(close_archive);
        us.find_files_archive_fn = Some(find_files_archive);
        us.open_archive_file_fn = Some(open_archive_file);
        us.size_archive_file_fn = Some(size_archive_file);
        us.read_archive_file_fn = Some(read_archive_file);
        us.close_archive_file_fn = Some(close_archive_file);
        us.add_all_archives_fn = Some(add_all_archives);
        us.remove_all_archives_fn = Some(remove_all_archives);
        us.lp_open_file_fn = Some(lp_open_file);
        us.lp_execute_fn = Some(lp_execute);
        us.lp_close_fn = Some(lp_close);
        us.lp_root_table_fn = Some(lp_root_table);
        us.lp_sub_table_str_fn = Some(lp_sub_table_str);
        us.lp_sub_table_int_fn = Some(lp_sub_table_int);
        us.lp_pop_table_fn = Some(lp_pop_table);
        us.lp_int_key_list_count_fn = Some(lp_int_key_list_count);
        us.lp_int_key_list_entry_fn = Some(lp_int_key_list_entry);
        us.lp_str_key_float_val_fn = Some(lp_str_key_float_val);
        us.lp_int_key_float_val_fn = Some(lp_int_key_float_val);
        us.lp_str_key_bool_val_fn = Some(lp_str_key_bool_val);
        us
    }

    /// The same library as an engine build without `GetDataDirectory`.
    pub(crate) fn forget_data_dirs(&mut self) {
        self.data_dir_count_fn = None;
        self.data_dir_fn = None;
    }
}
