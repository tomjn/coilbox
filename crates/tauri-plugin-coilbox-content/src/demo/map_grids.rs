//! One replay reduced to counts on its map's grid, for a picture built from
//! many replays of one map (#1161).
//!
//! A picture of fifty replays cannot be made by sending fifty replays' points
//! to the frontend: one long match is a hundred thousand orders. So each replay
//! is walked here, once, and what leaves is how many events fell in each cell of
//! a grid in each minute of the match. The frontend adds the replays it wants,
//! scaled as it wants, and smooths the sum.
//!
//! The grid is the one `buildHeatField` in `src/lib/heatField.ts` makes for the
//! same map, so a cell here is a cell there. Only the counting happens here.
//! The soft round sprite stays in the frontend, where there is one of it.
//!
//! Three layers come from the demo stream: where each team started, where
//! buildings were ordered (with the unit definition id, so the frontend can say
//! what each was for against the right build of the game), and where every
//! order with a place was aimed. A fourth, where units died, comes from the
//! replay's stored analysis when it has one with events.
//!
//! A replay file does not change, so its counts are kept in the app's cache
//! directory, one small file per replay. See [`replay_grids`] for what makes a
//! kept file stale.

use std::collections::{BTreeMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};

use super::analysis::store::{self, AnalysisState};
use super::build_orders::{build_orders_from_stream, player_teams};
use super::orders::positioned_orders;
use super::{
    build_demo_info, find_game, index_suffix, parse_tdf, player_names, read_header_and_script,
    stream,
};

/// Raised whenever a kept file would no longer be what this code writes: the
/// shape of [`ReplayGrids`], which events a layer counts, how a point finds its
/// cell, [`GRID_RESOLUTION`] or [`FRAMES_PER_SLICE`]. A file kept under another
/// version is not read, and the replay is walked again.
pub const GRIDS_VERSION: u32 = 1;

/// Cells along the map's longer side. `DEFAULT_RESOLUTION` in
/// `src/lib/heatField.ts` is the same number, and
/// `src/content/mapAggregate.test.ts` holds the two together.
pub const GRID_RESOLUTION: u32 = 256;

/// One slice of match time is a minute: 30 frames a second.
pub const FRAMES_PER_SLICE: i32 = 30 * 60;

/// The folder under the app's cache directory that holds the kept files. It is
/// in `caches::CACHE_SUBDIRS`, so the storage screen sizes it and clears it.
pub(crate) const CACHE_DIR: &str = "coilbox-replay-grids";

const CACHE_EXTENSION: &str = ".json.gz";

/// The grid of one map.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Grid {
    /// Cells west to east and north to south.
    pub width: u32,
    pub height: u32,
    /// The map's size in elmos.
    pub world_width: u32,
    pub world_height: u32,
}

impl Grid {
    /// The grid `heatGridSize` gives a map of this size, or `None` for a map
    /// with no size. The arithmetic is the frontend's, in the same order and
    /// in the same number type, so the two round the same way.
    pub fn for_world(world_width: u32, world_height: u32) -> Option<Grid> {
        if world_width == 0 || world_height == 0 {
            return None;
        }
        let longest = f64::from(world_width.max(world_height));
        let cells = f64::from(GRID_RESOLUTION);
        let side = |world: u32| ((cells * f64::from(world)) / longest).round().max(1.0) as u32;
        Some(Grid {
            width: side(world_width),
            height: side(world_height),
            world_width,
            world_height,
        })
    }

    /// The cell a position falls in, row by row from the north west corner, or
    /// `None` for a position off the map or one that is not a number. Off the
    /// map is dropped and not moved to the edge, as the frontend's field does.
    pub fn cell(&self, x: f32, z: f32) -> Option<u32> {
        let (x, z) = (f64::from(x), f64::from(z));
        let (w, h) = (f64::from(self.world_width), f64::from(self.world_height));
        if !(x >= 0.0 && z >= 0.0 && x <= w && z <= h) {
            return None;
        }
        let col = ((x / w * f64::from(self.width)) as u32).min(self.width - 1);
        let row = ((z / h * f64::from(self.height)) as u32).min(self.height - 1);
        Some(row * self.width + col)
    }
}

/// How many events fell in each cell in each slice of match time, packed.
///
/// The columns are parallel, each little endian bytes in standard base64, as
/// `DemoOrderPoints` packs its own. Entry `i` of each is one cell in one slice.
///
/// - `cell`: `u32`, the row times the grid's width plus the column.
/// - `slice`: `u16`, the minute of the match, 0 for the first.
/// - `count`: `u16`, how many events. A cell with more in one slice has a
///   second entry.
/// - `def`: `u32`, the unit definition id, on the buildings layer only. Empty
///   on the others.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CountLayer {
    pub entries: u32,
    pub cell: String,
    pub slice: String,
    pub count: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub def: String,
    /// How many events are in the entries.
    pub total: u32,
    /// How many had a place off the map and were left out.
    pub off_map: u32,
}

/// Counts being added up, before they are packed.
#[derive(Default)]
struct Counts {
    /// By slice, then cell, then unit definition id (0 where the layer has none).
    cells: BTreeMap<(u16, u32, u32), u32>,
    total: u32,
    off_map: u32,
}

/// The slice a frame is in. Orders given before the game started are in the
/// first.
fn slice_of(frame: i32) -> u16 {
    u16::try_from(frame.max(0) / FRAMES_PER_SLICE).unwrap_or(u16::MAX)
}

impl Counts {
    fn add(&mut self, grid: &Grid, x: f32, z: f32, frame: i32, def: u32) {
        match grid.cell(x, z) {
            Some(cell) => {
                *self.cells.entry((slice_of(frame), cell, def)).or_default() += 1;
                self.total += 1;
            }
            None => self.off_map += 1,
        }
    }

    fn pack(self, with_def: bool) -> CountLayer {
        let mut cell = Vec::new();
        let mut slice = Vec::new();
        let mut count = Vec::new();
        let mut def = Vec::new();
        let mut entries = 0u32;
        for ((s, c, d), mut n) in self.cells {
            while n > 0 {
                let part = n.min(u32::from(u16::MAX));
                cell.extend_from_slice(&c.to_le_bytes());
                slice.extend_from_slice(&s.to_le_bytes());
                count.extend_from_slice(&(part as u16).to_le_bytes());
                if with_def {
                    def.extend_from_slice(&d.to_le_bytes());
                }
                entries += 1;
                n -= part;
            }
        }
        CountLayer {
            entries,
            cell: STANDARD.encode(cell),
            slice: STANDARD.encode(slice),
            count: STANDARD.encode(count),
            def: STANDARD.encode(def),
            total: self.total,
            off_map: self.off_map,
        }
    }
}

/// Where one team started, in elmos.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GridStart {
    /// The `[teamN]` index, which `StatRecord.players[].team` carries too.
    pub team: i32,
    pub x: f32,
    pub z: f32,
}

/// Where units died in a replay's stored analysis.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeathLayer {
    pub layer: CountLayer,
    /// Deaths the log names no attacker for, which is how the engine reports a
    /// cancelled build and a self destruct. They are counted in `layer` like
    /// any other, as the replay's own page counts them.
    pub unattacked: u32,
    /// Deaths left out because the log places them at exactly the map's north
    /// west corner. The logger writes 0 for a position the engine did not give,
    /// so such a death is far more likely to have no position than to have
    /// happened there, and drawing it would light a corner nothing died in.
    pub no_position: u32,
}

/// One replay, reduced.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayGrids {
    pub path: String,
    /// The match's id, which is what tells two files of one match apart from
    /// two matches. Absent for a remix, which carries its original's id, and
    /// for a header with none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_id: Option<String>,
    pub remixed: bool,
    pub map_name: String,
    pub game_type: String,
    /// The last frame the stream reached. 30 frames are one second.
    pub last_frame: i32,
    /// True when the walk stopped early, so later events are missing.
    pub incomplete: bool,
    pub starts: Vec<GridStart>,
    /// Orders to place a building, with the unit definition id of each.
    pub buildings: CountLayer,
    /// Every order aimed at a place on the map, the building orders included.
    pub orders: CountLayer,
    /// Orders aimed at a unit, which have no place and are not in `orders`.
    pub unit_aimed: u32,
    /// Orders with an id the engine does not define, which are not in `orders`.
    pub custom: u32,
    /// Where units died. Absent when the match has no stored analysis with
    /// events, which is a different thing from an analysis with no deaths.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deaths: Option<DeathLayer>,
    /// Whether the stream's counts came from a kept file and not from a walk.
    /// Never true in a kept file itself.
    #[serde(default)]
    pub from_cache: bool,
}

/// Walk one replay and count its stream layers. The whole file is read and
/// held while it is walked, so call this for one replay at a time.
pub fn reduce_replay(demo: &Path, grid: &Grid) -> Result<ReplayGrids, String> {
    let raw = read_header_and_script(demo)?;
    let game = find_game(&parse_tdf(&raw.script));
    let teams: HashSet<i32> = game
        .children
        .iter()
        .filter_map(|(name, _)| index_suffix(name, "team"))
        .collect();
    let names = player_names(&game);
    let seats = player_teams(&game);
    let info = build_demo_info(raw, &game, None, None);
    let walked = stream::read_stream(demo)?;

    let mut buildings = Counts::default();
    for order in build_orders_from_stream(&walked, names.clone(), seats.clone()).orders {
        if let Some(at) = order.position {
            buildings.add(
                grid,
                at.x,
                at.z,
                order.frame,
                u32::try_from(order.unit_def_id).unwrap_or(0),
            );
        }
    }

    let placed = positioned_orders(&walked, names, seats);
    let mut orders = Counts::default();
    for ((x, z), frame) in placed.x.iter().zip(&placed.z).zip(&placed.frame) {
        orders.add(grid, *x, *z, *frame, 0);
    }

    Ok(ReplayGrids {
        path: demo.to_string_lossy().into_owned(),
        game_id: info
            .game_id
            .as_deref()
            .filter(|_| !info.remixed)
            .and_then(|id| store::valid_game_id(id).ok()),
        remixed: info.remixed,
        map_name: info.map_name,
        game_type: info.game_type,
        last_frame: walked.last_frame,
        incomplete: walked.stopped.is_some(),
        starts: stream::start_positions(&walked, |t| teams.contains(&t))
            .into_iter()
            .map(|s| GridStart {
                team: s.team,
                x: s.x,
                z: s.z,
            })
            .collect(),
        buildings: buildings.pack(true),
        orders: orders.pack(false),
        unit_aimed: placed.unit_aimed,
        custom: placed.custom,
        deaths: None,
        from_cache: false,
    })
}

/// What says whether a match's stored analysis is the one a kept file counted:
/// when it was written. `None` when there is no analysis with events.
fn analysis_signature(analyses: &Path, game_id: &str) -> Option<u64> {
    let stored = store::read(analyses, game_id).ok().flatten()?;
    (stored.state != AnalysisState::Diverged).then_some(stored.provenance.analysed_at_ms)
}

/// Count where units died in a match's stored analysis.
///
/// The rule for what counts is the replay page's own (`placedEvents` in
/// `src/content/replayEventLayers.ts`): every `unit_destroyed` line with a
/// frame and a position, whether or not it names an attacker.
pub fn reduce_deaths(analyses: &Path, game_id: &str, grid: &Grid) -> Option<DeathLayer> {
    let kinds = ["unit_destroyed".to_string()];
    let page = store::read_events(analyses, game_id, Some(&kinds), 0, None).ok()?;
    let mut counts = Counts::default();
    let mut unattacked = 0;
    let mut no_position = 0;
    for event in &page.events {
        let number = |key: &str| event.get(key).and_then(|v| v.as_f64());
        let (Some(x), Some(z), Some(frame)) = (number("x"), number("z"), number("frame")) else {
            continue;
        };
        if x == 0.0 && z == 0.0 {
            no_position += 1;
            continue;
        }
        if number("attacker").is_none() && number("attackerTeam").is_none() {
            unattacked += 1;
        }
        counts.add(grid, x as f32, z as f32, frame as i32, 0);
    }
    Some(DeathLayer {
        layer: counts.pack(false),
        unattacked,
        no_position,
    })
}

/// A kept file: one replay's counts and what they were counted from.
#[derive(Serialize, Deserialize)]
struct Kept {
    version: u32,
    /// The replay file's size and modified time when it was walked.
    size_bytes: u64,
    modified_ms: u64,
    grid: Grid,
    /// When the analysis the deaths were counted from was written, or `None`
    /// when there was none.
    deaths_from: Option<u64>,
    grids: ReplayGrids,
}

/// The name of a replay's kept file. From the path, so two folders holding the
/// same file name do not share one.
fn kept_name(demo: &Path) -> String {
    format!(
        "{}{CACHE_EXTENSION}",
        crate::hash_id(&[&demo.to_string_lossy()])
    )
}

fn load_kept(path: &Path) -> Option<Kept> {
    let mut json = Vec::new();
    GzDecoder::new(std::fs::File::open(path).ok()?)
        .read_to_end(&mut json)
        .ok()?;
    serde_json::from_slice(&json).ok()
}

fn save_kept(path: &Path, kept: &Kept) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut gz = GzEncoder::new(Vec::new(), Compression::default());
    gz.write_all(&serde_json::to_vec(kept)?)?;
    coilbox_gamebackup::write_atomic(path, &gz.finish()?)
}

fn file_signature(demo: &Path) -> Result<(u64, u64), String> {
    let md = std::fs::metadata(demo).map_err(|e| format!("read demo: {e}"))?;
    let modified_ms = md
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok((md.len(), modified_ms))
}

/// One replay's counts on `grid`, from its kept file when that is still good.
///
/// `cache_dir` is where kept files live, and `None` keeps nothing. `analyses`
/// is the analysis store, and `None` gives no deaths.
///
/// A kept file answers for the stream's layers when it was written by this
/// [`GRIDS_VERSION`], for this grid, from a file of this size and modified
/// time, which is the test the stats store and the replay list use for "this
/// file has not changed". Its deaths answer when the match's stored analysis
/// is the one they were counted from. An analysis that arrived, changed or
/// went since then costs a read of the analysis and no walk of the replay.
///
/// Failing to write a kept file is not an error: the next call walks again.
pub fn replay_grids(
    demo: &Path,
    grid: &Grid,
    cache_dir: Option<&Path>,
    analyses: Option<&Path>,
) -> Result<ReplayGrids, String> {
    let (size_bytes, modified_ms) = file_signature(demo)?;
    let kept_path = cache_dir.map(|dir| dir.join(kept_name(demo)));
    let kept = kept_path.as_deref().and_then(load_kept).filter(|k| {
        k.version == GRIDS_VERSION
            && k.size_bytes == size_bytes
            && k.modified_ms == modified_ms
            && k.grid == *grid
    });
    let (mut grids, walked, kept_deaths_from) = match kept {
        Some(k) => (k.grids, false, k.deaths_from),
        None => (reduce_replay(demo, grid)?, true, None),
    };

    let game_id = grids.game_id.clone();
    let analysis = analyses
        .zip(game_id.as_deref())
        .and_then(|(dir, id)| analysis_signature(dir, id).map(|sig| (dir, id, sig)));
    let deaths_from = analysis.map(|(_, _, at)| at);
    if walked || kept_deaths_from != deaths_from {
        grids.deaths = analysis.and_then(|(dir, id, _)| reduce_deaths(dir, id, grid));
        if let Some(path) = &kept_path {
            let _ = save_kept(
                path,
                &Kept {
                    version: GRIDS_VERSION,
                    size_bytes,
                    modified_ms,
                    grid: *grid,
                    deaths_from,
                    grids: ReplayGrids {
                        from_cache: false,
                        ..grids.clone()
                    },
                },
            );
        }
    }
    grids.from_cache = !walked;
    Ok(grids)
}

/// A replay that was asked for and not reduced, and why.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GridFailure {
    pub path: String,
    pub error: String,
}

/// [`replay_grids`] for paths the frontend handed over, one replay at a time.
///
/// A path is input, so each must be a replay in a folder the Replays list
/// reads under `roots`, by the same test the delete commands apply
/// ([`super::is_listed_replay`]). One that is not is refused and nothing of it
/// is opened. A replay that will not read is a failure of its own and does not
/// stop the rest.
pub fn listed_replay_grids(
    paths: &[PathBuf],
    grid: &Grid,
    cache_dir: Option<&Path>,
    analyses: Option<&Path>,
    roots: &[PathBuf],
) -> (Vec<ReplayGrids>, Vec<GridFailure>) {
    let mut replays = Vec::new();
    let mut failed = Vec::new();
    for demo in paths {
        let read = if super::is_listed_replay(demo, roots) {
            replay_grids(demo, grid, cache_dir, analyses)
        } else {
            Err("not in a folder the Replays list reads".to_string())
        };
        match read {
            Ok(grids) => replays.push(grids),
            Err(error) => failed.push(GridFailure {
                path: demo.to_string_lossy().into_owned(),
                error,
            }),
        }
    }
    (replays, failed)
}

/// Delete every kept file that is not for one of `live`, and say how many
/// went. This is what bounds the folder: after it there is at most one file
/// for each replay in the library.
pub fn sweep(cache_dir: &Path, live: impl IntoIterator<Item = PathBuf>) -> usize {
    let wanted: HashSet<String> = live.into_iter().map(|p| kept_name(&p)).collect();
    let Ok(entries) = std::fs::read_dir(cache_dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|e| !wanted.contains(e.file_name().to_string_lossy().as_ref()))
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter(|e| std::fs::remove_file(e.path()).is_ok())
        .count()
}

#[cfg(test)]
mod tests {
    use super::super::analysis::log::{LogLine, UnitEvent};
    use super::super::stream::fixture::Packets;
    use super::super::tests::DemoFixture;
    use super::*;
    use crate::model::Order;

    const CMD_MOVE: i32 = 10;

    fn unpack<const N: usize>(text: &str) -> Vec<[u8; N]> {
        STANDARD.decode(text).unwrap().as_chunks::<N>().0.to_vec()
    }

    /// A layer's entries as `(slice, cell, count)`.
    fn entries(layer: &CountLayer) -> Vec<(u16, u32, u16)> {
        let cells = unpack::<4>(&layer.cell).into_iter().map(u32::from_le_bytes);
        let slices = unpack::<2>(&layer.slice)
            .into_iter()
            .map(u16::from_le_bytes);
        let counts = unpack::<2>(&layer.count)
            .into_iter()
            .map(u16::from_le_bytes);
        slices
            .zip(cells)
            .zip(counts)
            .map(|((s, c), n)| (s, c, n))
            .collect()
    }

    fn defs(layer: &CountLayer) -> Vec<u32> {
        unpack::<4>(&layer.def)
            .into_iter()
            .map(u32::from_le_bytes)
            .collect()
    }

    fn order(id: i32, params: &[f32]) -> Order {
        Order {
            id,
            options: 0,
            params: params.to_vec(),
        }
    }

    // ---- the grid ------------------------------------------------------

    /// The sizes `heatGridSize` gives, worked by hand from its formula. The
    /// frontend's own test asserts the same numbers from its side.
    #[test]
    fn the_grid_is_the_frontends_for_a_square_and_a_non_square_map() {
        let square = Grid::for_world(8192, 8192).unwrap();
        assert_eq!((square.width, square.height), (256, 256));
        let wide = Grid::for_world(8192, 4096).unwrap();
        assert_eq!((wide.width, wide.height), (256, 128));
        let tall = Grid::for_world(6144, 10240).unwrap();
        // 256 * 6144 / 10240 is 153.6, which rounds to 154.
        assert_eq!((tall.width, tall.height), (154, 256));
        assert_eq!(Grid::for_world(0, 4096), None);
    }

    /// x picks the column and z the row. A grid with its axes swapped or one of
    /// them mirrored puts this point in another cell.
    #[test]
    fn a_point_lands_in_the_cell_its_x_and_z_say() {
        let grid = Grid::for_world(8192, 4096).unwrap();
        // A cell is 32 elmos each way. x 100 is column 3 and z 1000 is row 31.
        assert_eq!(grid.cell(100.0, 1000.0), Some(31 * 256 + 3));
        // The transposed point is somewhere else.
        assert_eq!(grid.cell(1000.0, 100.0), Some(3 * 256 + 31));
        // The corners: north west is the first cell, south east the last.
        assert_eq!(grid.cell(0.0, 0.0), Some(0));
        assert_eq!(grid.cell(8192.0, 4096.0), Some(128 * 256 - 1));
        assert_eq!(grid.cell(8191.0, 0.0), Some(255));
    }

    #[test]
    fn a_point_off_the_map_or_not_a_number_has_no_cell() {
        let grid = Grid::for_world(8192, 4096).unwrap();
        assert_eq!(grid.cell(-1.0, 10.0), None);
        assert_eq!(grid.cell(10.0, 4097.0), None);
        assert_eq!(grid.cell(8193.0, 10.0), None);
        assert_eq!(grid.cell(f32::NAN, 10.0), None);
    }

    // ---- one replay ----------------------------------------------------

    const GRID: Grid = Grid {
        width: 256,
        height: 256,
        world_width: 8192,
        world_height: 8192,
    };

    /// A replay file in `dir` with these packets as its stream.
    fn replay(dir: &Path, name: &str, packets: Packets, game_id: u8) -> PathBuf {
        let path = dir.join(name);
        let fixture = DemoFixture {
            stream: packets.bytes(),
            game_id: [game_id; 16],
            ..Default::default()
        };
        std::fs::write(&path, fixture.gzipped()).unwrap();
        path
    }

    /// Two starts, a building in the first minute, and two moves on one spot
    /// in the second. The fixture's script seats player 0 on team 0.
    fn short_match() -> Packets {
        Packets::default()
            .start_pos(0, 0, 1, [1000.0, 0.0, 2000.0])
            .start_pos(1, 1, 1, [7000.0, 0.0, 6000.0])
            .keyframe(0)
            .newframes(10)
            .command(0, &order(-42, &[100.0, 0.0, 1000.0, 0.0]))
            .keyframe(FRAMES_PER_SLICE)
            .newframes(5)
            .command(0, &order(CMD_MOVE, &[4000.0, 0.0, 4000.0]))
            .command(0, &order(CMD_MOVE, &[4001.0, 0.0, 4001.0]))
    }

    #[test]
    fn a_replay_reduces_to_its_starts_and_counted_cells() {
        let tmp = tempfile::tempdir().unwrap();
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        let got = reduce_replay(&demo, &GRID).unwrap();

        assert_eq!(got.game_id.as_deref(), Some("07".repeat(16).as_str()));
        assert!(!got.remixed && !got.incomplete);
        assert_eq!(
            got.starts,
            vec![
                GridStart {
                    team: 0,
                    x: 1000.0,
                    z: 2000.0
                },
                GridStart {
                    team: 1,
                    x: 7000.0,
                    z: 6000.0
                },
            ]
        );
        // A cell is 32 elmos. The building is in column 3, row 31, minute 0.
        assert_eq!(entries(&got.buildings), vec![(0, 31 * 256 + 3, 1)]);
        assert_eq!(defs(&got.buildings), vec![42]);
        assert_eq!(got.buildings.total, 1);
        // Every positioned order, the building's included. The two moves share
        // a cell in the second minute.
        assert_eq!(
            entries(&got.orders),
            vec![(0, 31 * 256 + 3, 1), (1, 125 * 256 + 125, 2)]
        );
        assert_eq!(got.orders.total, 3);
        assert_eq!(got.orders.def, "");
        assert_eq!(got.deaths, None);
    }

    #[test]
    fn an_order_off_the_map_is_counted_and_left_out() {
        let tmp = tempfile::tempdir().unwrap();
        let packets = Packets::default()
            .keyframe(0)
            .command(0, &order(CMD_MOVE, &[9000.0, 0.0, 100.0]));
        let got = reduce_replay(&replay(tmp.path(), "a.sdfz", packets, 7), &GRID).unwrap();
        assert_eq!(got.orders.entries, 0);
        assert_eq!((got.orders.total, got.orders.off_map), (0, 1));
    }

    /// More than a `u16` holds in one cell in one slice is split, not cut.
    #[test]
    fn a_count_too_big_for_one_entry_takes_two() {
        let mut counts = Counts::default();
        for _ in 0..70_000 {
            counts.add(&GRID, 10.0, 10.0, 0, 0);
        }
        let layer = counts.pack(false);
        assert_eq!(entries(&layer), vec![(0, 0, u16::MAX), (0, 0, 4465)]);
        assert_eq!(layer.total, 70_000);
    }

    #[test]
    fn the_slice_is_the_minute_and_the_pregame_is_the_first() {
        assert_eq!(slice_of(-1), 0);
        assert_eq!(slice_of(FRAMES_PER_SLICE - 1), 0);
        assert_eq!(slice_of(FRAMES_PER_SLICE), 1);
        assert_eq!(slice_of(5 * FRAMES_PER_SLICE + 3), 5);
    }

    // ---- deaths --------------------------------------------------------

    fn provenance(game_id: &str, outcome: &str, analysed_at_ms: u64) -> store::Provenance {
        serde_json::from_value(serde_json::json!({
            "kind": "analysis",
            "storeFormat": store::STORE_FORMAT,
            "outcome": outcome,
            "gameId": game_id,
            "loggerFormat": super::super::analysis::log::FORMAT_VERSION,
            "loggerVersion": super::super::analysis::log::LOGGER_VERSION,
            "engine": "2025.06.19",
            "game": "Some Game 1.0",
            "map": "Some Map",
            "analysedAtMs": analysed_at_ms,
            "matchSeconds": 600,
            "wallSeconds": 12.0,
        }))
        .unwrap()
    }

    /// A line as the logger writes it, which is what the store is handed.
    fn text(line: &LogLine) -> String {
        serde_json::to_string(line).unwrap()
    }

    fn death(frame: i32, x: f32, z: f32, attacker: Option<i32>) -> String {
        text(&LogLine::UnitDestroyed(UnitEvent {
            frame,
            x,
            z,
            attacker,
            ..Default::default()
        }))
    }

    #[test]
    fn deaths_come_from_the_stored_analysis_by_game_id() {
        let tmp = tempfile::tempdir().unwrap();
        let analyses = tmp.path().join("analyses");
        let id = "07".repeat(16);
        let events = [
            death(10, 100.0, 1000.0, Some(3)),
            death(FRAMES_PER_SLICE * 2, 100.0, 1000.0, None),
            // The logger's stand in for a position the engine did not give.
            death(20, 0.0, 0.0, Some(3)),
            text(&LogLine::UnitFinished(UnitEvent::default())),
        ];
        store::write(
            &analyses,
            &provenance(&id, "reproduced", 5),
            Some(&events[..]),
        )
        .unwrap();

        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        let got = replay_grids(&demo, &GRID, None, Some(&analyses)).unwrap();
        let deaths = got.deaths.expect("the analysis has events");
        assert_eq!(
            entries(&deaths.layer),
            vec![(0, 31 * 256 + 3, 1), (2, 31 * 256 + 3, 1)]
        );
        assert_eq!(deaths.unattacked, 1);
        assert_eq!(deaths.no_position, 1);
        assert_eq!(deaths.layer.total, 2);
    }

    #[test]
    fn a_match_with_no_analysis_or_a_diverged_one_has_no_deaths() {
        let tmp = tempfile::tempdir().unwrap();
        let analyses = tmp.path().join("analyses");
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        assert_eq!(
            replay_grids(&demo, &GRID, None, Some(&analyses))
                .unwrap()
                .deaths,
            None
        );
        store::write(
            &analyses,
            &provenance(&"07".repeat(16), "diverged", 5),
            None,
        )
        .unwrap();
        assert_eq!(
            replay_grids(&demo, &GRID, None, Some(&analyses))
                .unwrap()
                .deaths,
            None
        );
    }

    // ---- the kept file -------------------------------------------------

    #[test]
    fn a_second_read_comes_from_the_kept_file_and_is_the_same() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("cache");
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        let first = replay_grids(&demo, &GRID, Some(&cache), None).unwrap();
        assert!(!first.from_cache);
        let second = replay_grids(&demo, &GRID, Some(&cache), None).unwrap();
        assert!(second.from_cache);
        assert_eq!(
            ReplayGrids {
                from_cache: false,
                ..second
            },
            first
        );
        assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 1);
    }

    /// Rewrite a kept file with one field changed.
    fn edit_kept(cache: &Path, demo: &Path, edit: impl FnOnce(&mut Kept)) {
        let path = cache.join(kept_name(demo));
        let mut kept = load_kept(&path).unwrap();
        edit(&mut kept);
        save_kept(&path, &kept).unwrap();
    }

    /// A kept file from another version is not believed. The marker is a count
    /// no walk of this replay produces, so reading it back would show.
    #[test]
    fn a_kept_file_from_another_version_is_walked_again() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("cache");
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        replay_grids(&demo, &GRID, Some(&cache), None).unwrap();

        edit_kept(&cache, &demo, |k| k.grids.unit_aimed = 999);
        assert_eq!(
            replay_grids(&demo, &GRID, Some(&cache), None)
                .unwrap()
                .unit_aimed,
            999,
            "the edited file is read while its version is current"
        );

        edit_kept(&cache, &demo, |k| k.version = GRIDS_VERSION + 1);
        let got = replay_grids(&demo, &GRID, Some(&cache), None).unwrap();
        assert!(!got.from_cache);
        assert_eq!(got.unit_aimed, 0);
        // And the walk replaced the file, so the next read is kept again.
        assert!(
            replay_grids(&demo, &GRID, Some(&cache), None)
                .unwrap()
                .from_cache
        );
    }

    #[test]
    fn a_changed_replay_file_is_walked_again() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("cache");
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        assert_eq!(
            replay_grids(&demo, &GRID, Some(&cache), None)
                .unwrap()
                .orders
                .total,
            3
        );
        // One more order, so the file is a different size.
        let longer = short_match().command(0, &order(CMD_MOVE, &[50.0, 0.0, 50.0]));
        replay(tmp.path(), "a.sdfz", longer, 7);
        let got = replay_grids(&demo, &GRID, Some(&cache), None).unwrap();
        assert!(!got.from_cache);
        assert_eq!(got.orders.total, 4);
    }

    #[test]
    fn another_grid_is_walked_again() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("cache");
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        replay_grids(&demo, &GRID, Some(&cache), None).unwrap();
        let other = Grid::for_world(8192, 4096).unwrap();
        assert!(
            !replay_grids(&demo, &other, Some(&cache), None)
                .unwrap()
                .from_cache
        );
    }

    /// An analysis that lands after the stream was kept is read without
    /// walking the replay again, and so is one that is replaced or deleted.
    #[test]
    fn an_analysis_that_arrives_changes_or_goes_refreshes_only_the_deaths() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("cache");
        let analyses = tmp.path().join("analyses");
        let id = "07".repeat(16);
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        let read = || replay_grids(&demo, &GRID, Some(&cache), Some(&analyses)).unwrap();
        assert_eq!(read().deaths, None);

        let one = [death(10, 100.0, 1000.0, Some(3))];
        store::write(&analyses, &provenance(&id, "reproduced", 5), Some(&one[..])).unwrap();
        let got = read();
        assert!(got.from_cache, "the stream was not walked again");
        assert_eq!(got.deaths.unwrap().layer.total, 1);

        let two = [
            death(10, 100.0, 1000.0, Some(3)),
            death(20, 100.0, 1000.0, Some(3)),
        ];
        store::write(&analyses, &provenance(&id, "reproduced", 6), Some(&two[..])).unwrap();
        assert_eq!(read().deaths.unwrap().layer.total, 2);
        // Unchanged since, so the kept deaths answer.
        assert_eq!(read().deaths.unwrap().layer.total, 2);

        store::delete(&analyses, &id).unwrap();
        assert_eq!(read().deaths, None);
    }

    /// The check the delete commands make: only a replay in a folder the list
    /// reads. A file elsewhere is refused before it is opened, and so is
    /// anything that is not a replay.
    #[test]
    fn a_path_outside_the_replay_folders_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("root");
        let demos = root.join("demos");
        std::fs::create_dir_all(&demos).unwrap();
        let cache = tmp.path().join("cache");
        let inside = replay(&demos, "in.sdfz", short_match(), 7);
        let outside = replay(tmp.path(), "out.sdfz", short_match(), 8);
        let sneaky = demos.join("..").join("..").join("out.sdfz");
        let not_a_replay = demos.join("notes.txt");
        std::fs::write(&not_a_replay, b"x").unwrap();

        let (replays, failed) = listed_replay_grids(
            &[
                inside.clone(),
                outside.clone(),
                sneaky,
                not_a_replay,
                demos.join("gone.sdfz"),
            ],
            &GRID,
            Some(&cache),
            None,
            std::slice::from_ref(&root),
        );
        assert_eq!(replays.len(), 1);
        assert_eq!(replays[0].path, inside.to_string_lossy());
        assert_eq!(failed.len(), 4);
        for refused in &failed[..3] {
            assert_eq!(refused.error, "not in a folder the Replays list reads");
        }
        // In the folder and missing: let through, and it fails to read.
        assert!(failed[3].error.starts_with("read demo"), "{:?}", failed[3]);
        // Nothing was kept for a refused path.
        assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 1);
    }

    #[test]
    fn the_sweep_leaves_one_file_for_each_live_replay() {
        let tmp = tempfile::tempdir().unwrap();
        let cache = tmp.path().join("cache");
        let a = replay(tmp.path(), "a.sdfz", short_match(), 7);
        let b = replay(tmp.path(), "b.sdfz", short_match(), 8);
        replay_grids(&a, &GRID, Some(&cache), None).unwrap();
        replay_grids(&b, &GRID, Some(&cache), None).unwrap();
        assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 2);

        assert_eq!(sweep(&cache, [a.clone()]), 1);
        assert!(cache.join(kept_name(&a)).is_file());
        assert!(!cache.join(kept_name(&b)).exists());
        // A folder that is not there is nothing to sweep.
        assert_eq!(sweep(&tmp.path().join("absent"), [a]), 0);
    }

    #[test]
    fn the_answer_serialises_camel_case_with_absent_deaths_left_out() {
        let tmp = tempfile::tempdir().unwrap();
        let demo = replay(tmp.path(), "a.sdfz", short_match(), 7);
        let json = serde_json::to_value(reduce_replay(&demo, &GRID).unwrap()).unwrap();
        for key in [
            "path",
            "gameId",
            "remixed",
            "mapName",
            "gameType",
            "lastFrame",
            "incomplete",
            "starts",
            "buildings",
            "orders",
            "unitAimed",
            "custom",
            "fromCache",
        ] {
            assert!(json.get(key).is_some(), "{key} is missing");
        }
        assert!(json.get("deaths").is_none());
        assert_eq!(json["buildings"]["offMap"], 0);
        assert!(json["orders"].get("def").is_none());
    }

    /// Every replay in `~/.spring/demos`, read only: how many each map name
    /// has, and what one costs to reduce and to keep. Run with
    /// `cargo test -p tauri-plugin-coilbox-content real_replays_by_map -- --ignored --nocapture`.
    /// The map's size is not in a replay, so a square of 8192 elmos stands in.
    /// That changes which cell a point lands in and not how long counting takes.
    /// Prints no names.
    #[test]
    #[ignore = "reads the replays on this machine"]
    fn real_replays_by_map() {
        let Some(home) = std::env::var_os("HOME") else {
            return;
        };
        let dir = Path::new(&home).join(".spring/demos");
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
            .map(|d| d.flatten().map(|e| e.path()).collect())
            .unwrap_or_default();
        files.retain(|f| super::super::is_replay_path(f));
        files.sort();
        let cache = tempfile::tempdir().unwrap();
        let mut by_map: BTreeMap<String, (u32, HashSet<String>, u32)> = BTreeMap::new();
        println!("bytes\twalk ms\tkept ms\tkept bytes\torder entries\torders\tbuild entries\tbuilds\tstarts");
        for file in &files {
            let bytes = std::fs::metadata(file).map(|m| m.len()).unwrap_or(0);
            let started = std::time::Instant::now();
            let Ok(got) = replay_grids(file, &GRID, Some(cache.path()), None) else {
                println!("{bytes}\tdid not read");
                continue;
            };
            let walk = started.elapsed();
            let started = std::time::Instant::now();
            let again = replay_grids(file, &GRID, Some(cache.path()), None).unwrap();
            let kept = started.elapsed();
            assert!(again.from_cache);
            let kept_bytes = std::fs::metadata(cache.path().join(kept_name(file)))
                .map(|m| m.len())
                .unwrap_or(0);
            println!(
                "{bytes}\t{}\t{}\t{kept_bytes}\t{}\t{}\t{}\t{}\t{}",
                walk.as_millis(),
                kept.as_millis(),
                got.orders.entries,
                got.orders.total,
                got.buildings.entries,
                got.buildings.total,
                got.starts.len(),
            );
            let entry = by_map.entry(got.map_name.clone()).or_default();
            entry.0 += 1;
            if got.remixed {
                entry.2 += 1;
            } else if let Some(id) = got.game_id {
                entry.1.insert(id);
            }
        }
        println!("map\tfiles\tdistinct matches\tremixes");
        for (map, (files, ids, remixes)) in by_map {
            println!("{map}\t{files}\t{}\t{remixes}", ids.len());
        }
    }
}
