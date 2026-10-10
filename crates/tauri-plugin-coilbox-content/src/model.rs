//! Serde data model for the content plugin. The `*State`/`ContentRoot`/`Engine`
//! shapes are serialized to the frontend (camelCase) and are the cross-plugin
//! read API; `StoreFile`/`UserRoot` are the durable on-disk shape.
//!
//! Timestamps are epoch-millis `u64` (display data only) so the crate doesn't
//! need a date dependency — the frontend formats them with `new Date(ms)`.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RootSource {
    Auto,
    Manual,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum RootKind {
    /// pr-downloader / installed layout (engine/ games/ maps/ packages/ pool/ rapid/).
    Data,
    /// All-in-one folder: a spring binary + basecontent next to it.
    Portable,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RootCounts {
    pub games: u32,
    pub maps: u32,
    pub engines: u32,
    pub packages: u32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Engine {
    pub id: String,
    pub root_path: String,
    pub path: String,
    pub executable: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<u64>,
    /// The size and modified time of the binary that reported `sync_version`.
    /// A version is only carried over to a binary that still matches, so a
    /// folder whose engine was swapped for another build is asked again.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified_binary: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContentRoot {
    pub id: String,
    pub path: String,
    pub source: RootSource,
    pub kind: RootKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub origins: Vec<String>,
    pub exists: bool,
    pub valid: bool,
    /// True when this root is stored as a path *relative* to the app dir — a
    /// portable root that follows the executable when the package is moved.
    #[serde(default)]
    pub portable: bool,
    /// True for the distribution's bundled content folder (`.coilbox/content`).
    /// Read in place, searched after every other root, never written into, and
    /// never a download destination. Its engines are not listed: a bundled engine
    /// is copied into the player's own folder before it runs.
    #[serde(default)]
    pub bundled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forced: Option<bool>,
    pub counts: RootCounts,
    pub engines: Vec<Engine>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_scanned_at: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ContentState {
    pub schema_version: u32,
    pub roots: Vec<ContentRoot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_scan_at: Option<u64>,
}

/// A user-added root, persisted verbatim (auto roots are recomputed each rescan).
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct UserRoot {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default)]
    pub forced: bool,
}

/// The durable on-disk store: the user's manual roots plus the last computed
/// snapshot (so reads are instant without rescanning).
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoreFile {
    #[serde(default)]
    pub schema_version: u32,
    #[serde(default)]
    pub user_roots: Vec<UserRoot>,
    #[serde(default)]
    pub snapshot: Option<ContentState>,
}

/// A replay file found in a root's `demos/`/`replays/` folder. The summary fields
/// come from a cheap native decode of the demo header + start-script (no demotool,
/// no winner); they're `None` when the file can't be decoded.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReplayFile {
    pub filename: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_sec: Option<u32>,
    /// How many seats the match had: non-spectator players plus skirmish AIs. A
    /// bot occupies a team and a slot in the ally structure, so leaving it out
    /// reported a 1v3 skirmish as a one-player game.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_count: Option<u32>,
    /// Battle start (epoch-millis) from the demo header — more accurate than mtime.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time_ms: Option<u64>,
    /// Min/avg/max of the non-spectator players' skill (parsed from the start-script
    /// `skill=[..]` field), when any player has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_min: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_avg: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_max: Option<f32>,
    /// True when this file carries coilbox's remix marker — a copy rewritten to run
    /// on a different local build, not an engine-recorded demo.
    pub remixed: bool,
}

/// One chat or system line from a demo's network stream.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatLine {
    /// The simulation frame the line arrived in, [`PREGAME_FRAME`] before the
    /// match started. 30 frames are one second of match time.
    pub frame: i32,
    /// The packet's `modGameTime`, in seconds. It orders pregame lines, which
    /// share one frame, and is not match time.
    pub time: f32,
    /// The speaking player's number. 255 is the server.
    pub player: u8,
    /// The player's name, from the start script or a name packet in the
    /// stream. Absent when neither names this number.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_name: Option<String>,
    /// Who a player's line was addressed to. Absent for system lines.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dest: Option<ChatDest>,
    pub text: String,
    /// True for engine `SYSTEMMSG` lines (vs a player chat line).
    pub system: bool,
}

/// A demo's chat log, in the order the engine recorded it.
#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DemoChat {
    pub messages: Vec<ChatLine>,
    /// True when the stream walk stopped before the end, so lines after that
    /// point are missing. The lines before it are good.
    pub incomplete: bool,
}

/// One player (or spectator) from a demo's start-script, with the side/ally-team
/// resolved from their team.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlayerInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ally_team: Option<i32>,
    /// Faction (the team's `side`, e.g. `Armada`/`Cortex`/`Legion`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub side: Option<String>,
    /// Normalized team colour `[r, g, b]` (0..1), when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rgb_color: Option<[f32; 3]>,
    pub spectator: bool,
    /// True/false when the winner is known and the player isn't a spectator;
    /// `None` when the winner couldn't be determined.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub won: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country_code: Option<String>,
    /// This seat's five counters from the trailer. Absent when the recording
    /// never reached a game over, when the trailer is in a format the decoder
    /// refuses, and when the engine recorded no statistics at all (see
    /// [`DemoTrailer::players`]).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<PlayerStats>,
    /// Actions per minute: `stats.num_commands` over the match's minutes.
    ///
    /// Derived here rather than in each surface that shows it, so the one
    /// division and the "there is no answer" case are decided once. Absent
    /// exactly when `stats` is, plus for a match with no measured duration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub apm: Option<f32>,
}

/// One skirmish AI from a demo's start-script `[aiN]` section, with the
/// side/ally-team/colour resolved from the team it controls. That is the same
/// resolution `PlayerInfo` gets, so a roster or a chart series can treat an AI
/// seat like any other.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiInfo {
    /// The display name the host gave this bot, e.g. `AI 1`.
    pub name: String,
    /// The AI's identifier, e.g. `SurvivalAI` or `BARb`. This is what names the
    /// opponent, since `name` is often just a slot number.
    pub short_name: String,
    /// The AI's version, e.g. `<game>` for a game-supplied Lua AI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ally_team: Option<i32>,
    /// The player number whose machine ran the AI (`host` in the script).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host: Option<i32>,
    /// Faction (the team's `side`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub side: Option<String>,
    /// Normalized team colour `[r, g, b]` (0..1), when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rgb_color: Option<[f32; 3]>,
    /// The team's `Advantage` (a resource bonus fraction, 0.25 for +25%), as
    /// the script wrote it. `None` when the script carries none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub advantage: Option<f32>,
    /// The team's `IncomeMultiplier`, as the script wrote it. `None` when the
    /// script carries none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub income_multiplier: Option<f32>,
    /// True/false when the winner is known, and `None` when it couldn't be
    /// determined.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub won: Option<bool>,
}

/// A start box (`startrect`), normalized 0..1 over the map (origin top-left).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StartBox {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

/// An ally team: its start box (when the game used box placement) and a
/// representative team colour, for overlaying on the minimap.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AllyTeamInfo {
    pub id: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_box: Option<StartBox>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<[f32; 3]>,
}

/// Where one team started, in world units (elmos): `x` and `z` across the map,
/// `y` up. Not scaled to the map, which a replay does not state the size of.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamStartPosition {
    /// The `[teamN]` index, the same number `PlayerInfo::team` and
    /// `AiInfo::team` carry.
    pub team: i32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

/// Decoded replay metadata: native header + start-script + trailer, with
/// demotool as a fallback for the winner when the trailer's format is one the
/// decoder refuses.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DemoInfo {
    pub engine_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_id: Option<String>,
    /// Battle start, epoch-millis (format with `new Date(ms)`).
    pub start_time_ms: u64,
    /// In-game duration, seconds.
    pub duration_sec: u32,
    /// Wall-clock duration, seconds.
    pub wallclock_sec: u32,
    pub map_name: String,
    /// The game + version, e.g. `Beyond All Reason test-30018-d71d659`.
    pub game_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_pos_type: Option<i32>,
    pub winning_ally_teams: Vec<u32>,
    /// False when this file has no answer: the recording never reached a
    /// recorded game over, or its trailer is in a format this decoder
    /// doesn't know and demotool wasn't there (or couldn't say either). The
    /// UI shows "winner unknown" rather than implying a draw.
    pub winners_known: bool,
    pub num_ally_teams: u32,
    pub ally_teams: Vec<AllyTeamInfo>,
    pub players: Vec<PlayerInfo>,
    /// The skirmish AIs the script seated. Separate from `players` because a bot
    /// is not a person: it has no dossier, no skill and no country, and its name
    /// (`AI 1`) is a slot label that repeats across unrelated matches.
    pub ais: Vec<AiInfo>,
    /// The `[modoptions]` section verbatim (key -> value), for surfaces that want
    /// to reproduce the battle's options (e.g. refight-as-skirmish, #368). Empty
    /// when the script carried no `[modoptions]` section.
    pub mod_options: std::collections::HashMap<String, String>,
    /// The `[mapoptions]` section verbatim, as `mod_options` is. A refight that
    /// leaves these out runs on the map's current defaults, not the values the
    /// match was played with (#1886).
    pub map_options: std::collections::HashMap<String, String>,
    /// Where each team started, by team id, from the replay's stream (#1146).
    /// A team with no recorded position is absent, since 0,0,0 is a real map
    /// corner. Empty, and left out of the JSON, when the stream has none, is
    /// missing or is in a format this decoder refuses, and always empty from
    /// the cheap decodes the replay list and the stats ingest use.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub start_positions: Vec<TeamStartPosition>,
    /// True when this file carries coilbox's remix marker (a rewritten copy, not an
    /// engine-recorded demo).
    pub remixed: bool,
    /// For a remix, the `gametype` the replay was originally recorded on (before it
    /// was pointed at a local build).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_gametype: Option<String>,
    /// For a remix, the filename of the original replay it was made from, so the UI
    /// can link back to it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_filename: Option<String>,
}

/// One `TeamStatistics` sample: 20 fields, 80 bytes, written every
/// `teamStatPeriod` seconds of a match.
///
/// Every figure except `frame` is a running total for the whole match so far, so
/// a per-minute view is the difference between two consecutive samples and needs
/// no second series.
///
/// Field order is the engine's `rts/Sim/Misc/TeamStatistics.h` declaration order,
/// which is also the on-disk order: `frame`, twelve `f32`, seven `i32`.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamStatSample {
    /// Sim frame the sample was taken at. 30 frames is one second.
    pub frame: i32,
    pub metal_used: f32,
    pub energy_used: f32,
    pub metal_produced: f32,
    pub energy_produced: f32,
    pub metal_excess: f32,
    pub energy_excess: f32,
    pub metal_received: f32,
    pub energy_received: f32,
    pub metal_sent: f32,
    pub energy_sent: f32,
    pub damage_dealt: f32,
    pub damage_received: f32,
    pub units_produced: i32,
    pub units_died: i32,
    pub units_received: i32,
    pub units_sent: i32,
    pub units_captured: i32,
    pub units_out_captured: i32,
    pub units_killed: i32,
}

/// One team's samples for a whole match, in the order the engine recorded them.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamStatSeries {
    /// The `[teamN]` index this series belongs to.
    pub team: i32,
    /// Empty for a team the engine recorded no samples for, which is an answer
    /// ("no statistics") rather than an error.
    pub samples: Vec<TeamStatSample>,
}

/// One player's `PlayerStatistics`: five `i32` counters for the whole match,
/// written once per `[playerN]` seat when the game ended.
///
/// The on-disk order is the one here, which is *not* the order the engine's
/// `rts/Game/Players/PlayerStatistics.h` declares its own members in:
/// `PlayerStatistics` derives from `TeamControllerStatistics`, so the base
/// class's `num_commands`/`unit_commands` come first. Read as declared, a real
/// row reports 416,476 commands over eight minutes instead of 163.
#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStats {
    /// Orders the player gave. Over the match's minutes this is actions per
    /// minute, the number every RTS player quotes at each other.
    pub num_commands: i32,
    /// Orders that reached a unit, as opposed to orders given. The gap between
    /// this and `num_commands` is a real signal about how someone plays.
    pub unit_commands: i32,
    pub mouse_pixels: i32,
    pub mouse_clicks: i32,
    pub key_presses: i32,
}

/// What the fixed-size records after a replay's demo stream hold.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DemoTrailer {
    /// The ally-teams that won, straight from the file. Empty is a real outcome
    /// (a game over with nobody winning), not a missing answer.
    pub winning_ally_teams: Vec<u32>,
    /// Seconds between samples, so a caller can turn a frame into a time without
    /// assuming 15.
    pub team_stat_period_sec: u32,
    /// One entry per team the header counts, in team order.
    pub teams: Vec<TeamStatSeries>,
    /// One entry per player the header counts, indexed by the player id the
    /// start-script's `[playerN]` sections use.
    ///
    /// `None` when this match's statistics were never recorded, which the file
    /// says by giving every team zero samples. The bytes are still there and
    /// they still read as integers, but they are whatever was in that memory
    /// (issue #1190): three of the nine replays measured hold command counts
    /// like -335216640 next to nine empty sample series. So the presence of the
    /// block is not evidence, and the decoder refuses to hand it over rather
    /// than leave every caller to remember why.
    pub players: Option<Vec<PlayerStats>>,
}

/// The frame every event carries until the simulation starts. It is the
/// engine's own `gs->frameNum` before the first `NETMSG_KEYFRAME`, so a start
/// position or a line of lobby chat sits at -1 and the first order at 0 or later.
pub const PREGAME_FRAME: i32 = -1;

/// What a walk over a replay's demo stream found: what each player did, in the
/// order the engine recorded it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DemoStream {
    pub events: Vec<StreamEvent>,
    /// The last simulation frame the stream reached, or [`PREGAME_FRAME`] when
    /// the match never started. 30 frames are one second of match time.
    ///
    /// It can be later than the header's game time. A client writes that field
    /// when the game ends and keeps recording until the player leaves.
    pub last_frame: i32,
    /// How many packets the walk stepped over, of every kind.
    pub packets: u32,
    /// Packets of a kind the walk reads whose bytes did not fit that kind's
    /// layout. Each was skipped by its declared length and produced no event.
    pub undecoded: u32,
    /// Set when the walk stopped before the end of the stream. The events up to
    /// that point are still good, and so is the trailer, which is found from
    /// the header and not from where the walk got to.
    pub stopped: Option<StreamStop>,
}

/// Where and why a stream walk stopped early.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamStop {
    /// Bytes into the stream, counted from its first packet.
    pub offset: usize,
    pub reason: String,
}

/// One thing a player did, with the match time it happened at.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamEvent {
    /// The simulation frame the event arrived in. [`PREGAME_FRAME`] before the
    /// match starts.
    pub frame: i32,
    /// The packet's `modGameTime`, in seconds. It runs from before the match
    /// starts and does not advance while the game is paused, so it orders the
    /// pregame events that all share one frame. It is not match time.
    pub time: f32,
    #[serde(flatten)]
    pub kind: StreamEventKind,
}

/// The messages the walk reads. `player` is the number the start script's
/// `[playerN]` sections use, and 255 is the server.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEventKind {
    /// `NETMSG_PLAYERNAME`. A player connected under this name.
    #[serde(rename_all = "camelCase")]
    PlayerName { player: u8, name: String },
    /// `NETMSG_CHAT`.
    #[serde(rename_all = "camelCase")]
    Chat {
        from: u8,
        dest: ChatDest,
        text: String,
    },
    /// `NETMSG_SYSTEMMSG`. A line the server said, such as a connection attempt.
    #[serde(rename_all = "camelCase")]
    SystemMessage { player: u8, text: String },
    /// One packet of orders: `NETMSG_COMMAND`, `NETMSG_AICOMMAND`,
    /// `NETMSG_AICOMMAND_TRACKED` or `NETMSG_AICOMMANDS`. One packet is one
    /// action by the player, however many orders it carries.
    #[serde(rename_all = "camelCase")]
    Command {
        player: u8,
        origin: CommandOrigin,
        /// The units the orders are for. Empty when the origin is
        /// [`CommandOrigin::Selection`], where they go to whatever that player
        /// last selected.
        units: Vec<u16>,
        /// True when `orders[i]` goes to `units[i]`. Otherwise every order goes
        /// to every unit.
        pairwise: bool,
        orders: Vec<Order>,
    },
    /// `NETMSG_SELECT`. The player's selection is now exactly these units.
    #[serde(rename_all = "camelCase")]
    Select { player: u8, units: Vec<u16> },
    /// `NETMSG_GAMEOVER`. Each player's client reports the result it saw, so a
    /// match has several of these and they can disagree.
    #[serde(rename_all = "camelCase")]
    GameOver {
        player: u8,
        winning_ally_teams: Vec<u8>,
    },
    /// `NETMSG_STARTPOS`. Where a team asked to start, in world coordinates.
    /// A team can send many, and the last one is the one that counted. The
    /// server sends it for a team no player controls.
    #[serde(rename_all = "camelCase")]
    StartPos {
        player: u8,
        team: u8,
        /// `CPlayer::PLAYER_RDYSTATE_*` in `rts/Game/Players/Player.h`: 0 the
        /// player moved their marker without readying, 1 readied, 2 the server
        /// forced the start, 3 the player never readied.
        ready: u8,
        x: f32,
        y: f32,
        z: f32,
    },
    /// `NETMSG_PAUSE`. `player` paused or unpaused the game.
    #[serde(rename_all = "camelCase")]
    Pause { player: u8, paused: bool },
    /// `NETMSG_PLAYERLEFT`. `player` dropped out of the game.
    #[serde(rename_all = "camelCase")]
    PlayerLeft { player: u8, reason: LeaveReason },
    /// `NETMSG_TEAM`. `player` did something that changes who controls a team.
    #[serde(rename_all = "camelCase")]
    Team { player: u8, action: TeamAction },
    /// `NETMSG_CREATE_NEWPLAYER`. A player who is not in the start script
    /// joined mid game, and this is the only place their name is.
    #[serde(rename_all = "camelCase")]
    NewPlayer {
        player: u8,
        spectator: bool,
        team: u8,
        name: String,
    },
}

/// Why a player left, from `NETMSG_PLAYERLEFT`'s `bIntended` byte.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LeaveReason {
    LostConnection,
    Left,
    Kicked,
    /// A value the engine does not define, carried as sent.
    Other {
        code: u8,
    },
}

/// The sub action of a `NETMSG_TEAM` packet, from the `TEAMMSG_*` enum.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TeamAction {
    /// `TEAMMSG_GIVEAWAY`. Everything `from_team` owns goes to `to_team`.
    #[serde(rename_all = "camelCase")]
    GiveAway { to_team: u8, from_team: u8 },
    /// `TEAMMSG_RESIGN`. The player stops playing. The packet carries no team.
    Resign,
    /// `TEAMMSG_JOIN_TEAM`. The player asks to join `team`.
    #[serde(rename_all = "camelCase")]
    JoinTeam { team: u8 },
    /// `TEAMMSG_TEAM_DIED`. The player reports `team` has died. Every player
    /// sends one, so a team's death arrives once per player.
    #[serde(rename_all = "camelCase")]
    TeamDied { team: u8 },
    /// An action the engine does not define, carried as sent.
    #[serde(rename_all = "camelCase")]
    Other { action: u8, param1: u8, param2: u8 },
}

/// Who a chat line was addressed to.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatDest {
    Player { player: u8 },
    Allies,
    Spectators,
    Everyone,
}

/// What issued a packet of orders.
///
/// The message id alone does not say. Every `NETMSG_AICOMMAND` in the replays
/// measured came from a player's own Lua widgets, not from an AI, so counting
/// that message as AI activity would hand a human's orders to a bot.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommandOrigin {
    /// The player ordered their current selection through the engine's own
    /// interface.
    Selection,
    /// A Lua widget on the player's machine ordered named units.
    Lua,
    /// A skirmish AI hosted by `player` ordered a unit of its own team.
    Ai { ai: u8, team: u8 },
}

/// One order as the engine's `Command` holds it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    /// The command id. Negative means build, and the unit definition id is the
    /// absolute value.
    pub id: i32,
    /// The engine's option bits: 4 meta, 8 internal, 16 right mouse, 32 shift,
    /// 64 control, 128 alt.
    pub options: u8,
    pub params: Vec<f32>,
}

pub const SCHEMA_VERSION: u32 = 1;

/// Read the store from `path`, returning a default (empty) store if it's absent.
pub fn load_store(path: &std::path::Path) -> Result<StoreFile, String> {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("invalid content store json: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(StoreFile::default()),
        Err(e) => Err(format!("could not read content store: {e}")),
    }
}

/// Write the full store to `path`, creating the parent dir if needed.
pub fn save_store(path: &std::path::Path, store: &StoreFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create content store dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("could not write content store: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_store_is_default() {
        let p = std::env::temp_dir().join("content_store_does_not_exist_xyz.json");
        let _ = std::fs::remove_file(&p);
        let store = load_store(&p).unwrap();
        assert!(store.user_roots.is_empty());
        assert!(store.snapshot.is_none());
    }

    #[test]
    fn roundtrips_user_roots() {
        let dir = std::env::temp_dir().join("content_store_test");
        let p = dir.join("state.json");
        let _ = std::fs::remove_dir_all(&dir);
        let mut store = StoreFile {
            schema_version: SCHEMA_VERSION,
            ..Default::default()
        };
        store.user_roots.push(UserRoot {
            path: "/tmp/spring".into(),
            label: Some("test".into()),
            forced: true,
        });
        save_store(&p, &store).unwrap();
        let back = load_store(&p).unwrap();
        assert_eq!(back.user_roots.len(), 1);
        assert_eq!(back.user_roots[0].path, "/tmp/spring");
        assert!(back.user_roots[0].forced);
    }
}
