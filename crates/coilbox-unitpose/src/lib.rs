//! Where a unit's pieces are on each frame, and the motion that moves them.
//!
//! A unit script animates by starting turns, moves and spins and then waiting
//! for them. The waiting and the scheduling belong to whichever runtime is
//! reading the script, but the motion itself does not: a turn started from Lua
//! and a turn started from compiled bytecode are the same turn, taking the same
//! path at the same rate, and the viewport plays both the same way.
//!
//! So the motion lives here, on its own, and the two runtimes drive it. That is
//! also what stops them drifting apart: a preview that agreed with the engine
//! for a Lua unit and disagreed for a compiled one would be worse than useless.
//!
//! Nothing here reads a script or decides when anything happens. It holds
//! poses, ticks the animations one frame, and records what it saw.

use serde::{Deserialize, Serialize};

pub mod nanopiece;
pub mod passenger;
pub mod unitvalue;

pub use nanopiece::NanoPieces;
pub use passenger::Passenger;

/// Said once when a run recorded an effect, an explosion or a sound, none of
/// which the preview draws or plays.
pub const EFFECTS_NOTE: &str = "Effects are marked on the scrubber, not drawn.";

/// Sim frames per second. The engine's `GAME_SPEED`, which every `Sleep` and
/// every per-second speed is measured against.
pub const FPS: u32 = 30;

/// Seconds of sim per frame, which every per-second speed is divided by.
pub const DT: f64 = 1.0 / FPS as f64;

/// Milliseconds a frame lasts as far as a script is concerned. 33, not 33.33:
/// the engine passes `1000 / GAME_SPEED` as an integer, so a script's clock runs
/// 990ms to the second and a `Sleep` is measured in these.
pub const TICK_MS: f64 = 33.0;

/// Most frames one run may simulate: 30 seconds. A preview loops, so more than
/// this buys nothing and costs memory in the timeline.
pub const MAX_FRAMES: u32 = FPS * 30;

/// A call-in to fire at a given frame, which is how a scenario is expressed.
///
/// A script animates in response to events, so a preview has to choose what
/// happens to the unit. The choosing is the caller's: it knows the wording the
/// user picked from and can expand "fires every two seconds" into the events it
/// means. This side only runs them.
#[derive(Debug, Clone, Deserialize)]
pub struct ScriptEvent {
    /// Frame to fire on, counted from 0.
    pub frame: u32,
    /// The call-in's name, such as `Create` or `AimWeapon1`. Empty on an event
    /// the engine acts on rather than calling into the script for.
    #[serde(default)]
    pub callin: String,
    /// Numeric arguments, for the call-ins that take them.
    #[serde(default)]
    pub args: Vec<f64>,
    /// Whether this is the preview describing the world rather than putting the
    /// unit through something.
    ///
    /// The engine tells a unit things it cannot work out for itself, such as
    /// what it is standing on, and a script that branches on one of those stops
    /// dead without it. Almost no unit defines those call-ins, so a runtime that
    /// said "this script has no setSFXoccupy call-in" would say it about nearly
    /// every unit, which is noise rather than news.
    #[serde(default)]
    pub ambient: bool,
    /// The scene on this event's frame, for a script that asks where something
    /// is. None from every caller that is not the model editor's panel.
    #[serde(default)]
    pub world: Option<World>,
    /// Something the engine does to the stand-in itself, rather than a call-in
    /// it fires. Such an event has no `callin`.
    #[serde(default)]
    pub engine: Option<EngineAction>,
}

/// What the engine does to the stand-in without the script asking.
///
/// The air transport arm attaches a passenger to the piece `QueryTransport`
/// answers, and detaches it again, itself
/// (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1451-1453,2041-2042,2090-2091`).
/// Every other transport leaves both to its script.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineAction {
    Attach,
    Detach,
    /// A builder starts spraying nano. `CBuilder` adds build power, and
    /// sprays, on every frame it builds (`rts/Sim/Units/UnitTypes/Builder.cpp:339-354`).
    #[serde(rename = "nano-start")]
    NanoStart,
    /// It stops.
    #[serde(rename = "nano-stop")]
    NanoStop,
    /// A factory has a build queued, and starts it once the script puts the
    /// unit in build stance (`Factory.cpp:138-151`).
    #[serde(rename = "factory-build")]
    FactoryBuild,
    /// The buildee is finished. The factory stops spraying and calls
    /// `StopBuilding`.
    #[serde(rename = "factory-finish")]
    FactoryFinish,
    /// A weapon fires. The engine calls `FireWeapon`, then `Shot`, then asks
    /// `QueryWeapon` for the muzzle, all on one frame
    /// (`rts/Sim/Weapons/Weapon.cpp:509-511,590-595`). The weapon number,
    /// counted from one, is the event's first argument.
    Fire,
}

/// What the preview's scene holds on one event's frame, for a script that asks.
///
/// Sent with each event rather than once per run, because a scenario can pick
/// the stand-in up in one place and put it down in another. A runtime keeps the
/// last one it was handed. That is truthful for everything a script reads about
/// its passenger, because the engine only calls a transport once the passenger
/// has stopped (`rts/Sim/Units/CommandAI/MobileCAI.cpp:430-465,1414-1463`).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct World {
    /// The one other unit in the scene, or none when the scenario has none.
    #[serde(rename = "standIn", default)]
    pub stand_in: Option<StandIn>,
    /// The unit the script runs on, which stands at the origin facing +z.
    #[serde(rename = "self")]
    pub own: Size,
}

/// The stand-in, in elmos, in the unit's own space, which is world space
/// because the unit stands at the origin facing +z.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct StandIn {
    pub id: i32,
    /// Where its base is, or none when the scenario puts it nowhere on this
    /// frame.
    pub pos: Option<[f64; 3]>,
    pub radius: f64,
    pub height: f64,
}

/// A unit's size as the engine keeps it: `radius` is the collision sphere's,
/// `height` the model's.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct Size {
    pub radius: f64,
    pub height: f64,
}

/// One unit value id a script read while it ran, and what a control offered
/// for it would show.
///
/// Recorded rather than guessed at: a caller wanting to offer "set HEALTH"
/// before a script has ever asked for HEALTH would be offering a control for
/// something that may mean nothing to this particular script.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskedValue {
    pub id: i32,
    /// The name from [`unitvalue::NAMES`], when this id has one.
    pub name: Option<String>,
    /// What [`unitvalue::known`] answers for this id, for a reset to put back.
    pub default: Option<i32>,
}

/// Something a script announced, on the frame it did.
///
/// Pieces are named rather than numbered, because a name means the same in
/// both runtimes and is what the viewport looks a piece up by.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ScriptOutput {
    /// `attach-unit` or `AttachUnit`. `piece` is none for the void.
    Attach {
        frame: u32,
        unit: i32,
        piece: Option<String>,
    },
    /// `drop-unit` or `DropUnit`.
    Drop { frame: u32, unit: i32 },
    /// `emit-sfx` or `EmitSfx`, with the raw effect number. From 1024 it
    /// indexes the unit's own generator list, from 2048 it fires a weapon and
    /// from 4096 it detonates one (`rts/Sim/Units/Scripts/CobDefines.h:9-20`).
    /// The editor has no unit definition to name a generator from.
    Sfx { frame: u32, piece: String, sfx: i32 },
    /// `explode` or `Explode`, with the raw flags.
    Explode {
        frame: u32,
        piece: String,
        flags: i32,
    },
    /// A COB sound table entry or the Lua call's first argument. None for a
    /// compiled script with no sound table, which is a TA script rather than
    /// a TA:K one.
    Sound { frame: u32, name: Option<String> },
    /// The piece one frame's nano particle comes from, as `NanoPieceCache`
    /// chose it. None when the script has named no piece of this unit yet.
    Nano { frame: u32, piece: Option<String> },
    /// `show` inside a fire function, or `ShowFlare`. The engine draws a
    /// muzzle flame at the piece rather than unhiding it
    /// (`rts/Sim/Units/Scripts/CobThread.cpp:715-728`).
    Flare { frame: u32, piece: String },
    /// A shot, and the piece `QueryWeapon` named for its muzzle, or none when
    /// neither it nor `AimFromWeapon` named a piece of this unit.
    Shot {
        frame: u32,
        weapon: u32,
        piece: Option<String>,
    },
    /// `build-start`. The frame the factory started building, once its
    /// script set `INBUILDSTANCE`. Not an effect: the preview draws the
    /// spraying it starts rather than marking it on the scrubber.
    #[serde(rename = "build-start")]
    BuildStart { frame: u32 },
}

impl ScriptOutput {
    /// Whether this is something the preview would draw or play, as opposed
    /// to carrying the stand-in.
    fn is_effect(&self) -> bool {
        matches!(
            self,
            Self::Sfx { .. } | Self::Explode { .. } | Self::Sound { .. }
        )
    }
}

/// Every piece's pose on every frame, which is what the viewport plays.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timeline {
    pub fps: u32,
    /// Piece names, in the order every frame's numbers are laid out.
    pub pieces: Vec<String>,
    /// One entry per frame simulated: `pieces.len() * 6` numbers, six per piece,
    /// being x, y, z offset from the rest pose then x, y, z rotation in radians.
    ///
    /// The rotations compose in the order the engine composes them, which is y,
    /// then x, then z. Whatever draws these has to say so.
    pub frames: Vec<Vec<f64>>,
    /// One flag per piece per frame, or empty when the script never hid
    /// anything. Empty is the common case and worth not paying for.
    pub hidden: Vec<Vec<bool>>,
    /// What stopped the run, or none if it ran to the end. The frames before it
    /// are still here and still worth playing: where a script gets to before it
    /// fails is most of what says why.
    pub error: Option<String>,
    /// Things the run wants to say that did not stop it: a call-in the script
    /// does not define, a call the preview cannot honour.
    pub warnings: Vec<String>,
    /// Every unit value id the script read, in the order it first read each one
    /// and with duplicates left out. A caller offering controls for a script's
    /// unit values has to run it once before it knows which to offer.
    #[serde(default)]
    pub asked: Vec<AskedValue>,
    /// The functions the script defines: a `.cob`'s script name table, or a Lua
    /// unit script's `script` table keys. What a caller offering "call any
    /// function" has to run the script once to learn.
    #[serde(default)]
    pub functions: Vec<String>,
    /// Main-script source lines the run executed at least once, 1-indexed as
    /// Lua counts them. A line in an `include`d file is not one of these: only
    /// the script named at the top counts, which is what a caller dimming the
    /// lines a run never reached is dimming against. Empty for a compiled run,
    /// which reports `offsets_run` instead.
    #[serde(default)]
    pub lines_run: Vec<u32>,
    /// COB instruction word offsets the run executed at least once. Empty for a
    /// Lua run, which reports `lines_run` instead.
    #[serde(default)]
    pub offsets_run: Vec<u32>,
    /// What the script announced, in frame order.
    #[serde(default)]
    pub events: Vec<ScriptOutput>,
}

impl Timeline {
    /// A timeline for a run about to start: the pieces named, no frames yet.
    pub fn new(pieces: Vec<String>, frames: usize) -> Self {
        Self {
            fps: FPS,
            pieces,
            frames: Vec::with_capacity(frames),
            hidden: Vec::new(),
            error: None,
            warnings: Vec::new(),
            asked: Vec::new(),
            functions: Vec::new(),
            lines_run: Vec::new(),
            offsets_run: Vec::new(),
            events: Vec::new(),
        }
    }

    /// A run that produced nothing, because it could not start.
    pub fn failed(pieces: &[String], error: String) -> Self {
        Self {
            error: Some(error),
            ..Self::new(pieces.to_vec(), 0)
        }
    }
}

/// A rotation in progress on one axis of one piece.
///
/// One or the other, never both: the engine keeps a single turn and a single
/// spin per piece and axis, and starting either removes the other
/// (`CUnitScript::AddAnim`).
#[derive(Debug, Clone, Copy)]
pub enum Rotate {
    /// Toward `dest` at `speed` radians per second, then stop.
    Turn { dest: f64, speed: f64 },
    /// Continuously, at `speed` radians per second, changing that speed by
    /// `accel` radians per second on every frame until it reaches `target`. An
    /// `accel` of zero means `speed` is already `target`.
    Spin { speed: f64, target: f64, accel: f64 },
}

/// A translation in progress on one axis of one piece.
#[derive(Debug, Clone, Copy)]
pub struct Translate {
    pub dest: f64,
    pub speed: f64,
}

/// Which kind of animation a thread is waiting on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wait {
    Turn,
    Move,
}

/// Where a piece sits in the unit before anything moves it.
///
/// The model's own geometry, which a runtime is given rather than working out:
/// a script asking where one of its pieces is is asking about the model, and
/// neither runtime reads models.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
pub struct Rest {
    /// The piece this one hangs off, or none for the root. An index into the
    /// same list of pieces the names came in.
    pub parent: Option<usize>,
    /// Its offset from that parent, in elmos.
    pub position: [f64; 3],
}

#[derive(Debug, Clone)]
pub struct Piece {
    pub name: String,
    /// Where it sits, and what it hangs off, before anything moves it.
    pub rest: Rest,
    /// Offset from the rest pose, in elmos, per axis.
    pub pos: [f64; 3],
    /// Rotation about the piece's own origin, in radians, per axis.
    pub rot: [f64; 3],
    pub hidden: bool,
    pub rotate: [Option<Rotate>; 3],
    pub translate: [Option<Translate>; 3],
}

impl Piece {
    pub fn new(name: String) -> Self {
        Self {
            name,
            rest: Rest::default(),
            pos: [0.0; 3],
            rot: [0.0; 3],
            hidden: false,
            rotate: [None; 3],
            translate: [None; 3],
        }
    }
}

/// The model as a whole: its pieces, and what the run wants to say about them.
#[derive(Debug, Default)]
pub struct Model {
    pub pieces: Vec<Piece>,
    /// True once anything has been hidden, shown or exploded, which is what
    /// decides whether the timeline carries visibility at all.
    pub visibility_used: bool,
    /// Whether the caller said where the pieces sit. Without it a script asking
    /// where one of them is has to be told nobody knows, rather than handed the
    /// origin as though every piece were stacked at the unit's feet.
    pub placed: bool,
    pub warnings: Vec<String>,
    /// What scripts have done with the stand-in.
    pub passenger: Passenger,
    /// What the script announced, in the order it did.
    pub events: Vec<ScriptOutput>,
    /// Whether a builder is spraying nano, between an engine `nano-start` and
    /// `nano-stop`.
    pub spraying: bool,
    /// Which piece it sprays from. Kept for the whole run, as the engine keeps
    /// one cache per builder.
    pub nano: NanoPieces,
    /// A factory has a build queued and is waiting for its script to set
    /// `INBUILDSTANCE`, between an engine `factory-build` and the frame the
    /// runtime sees the stance set.
    pub awaiting_build: bool,
    /// Whether a factory is building, between the frame its script put it in
    /// build stance and an engine `factory-finish`.
    pub building: bool,
}

impl Model {
    pub fn new(names: &[String]) -> Self {
        Self {
            pieces: names.iter().cloned().map(Piece::new).collect(),
            ..Self::default()
        }
    }

    /// Say where the pieces sit, in the order their names came in.
    ///
    /// Ignored unless there is one entry per piece, because a list that does
    /// not line up with the names would put every piece somewhere that is not
    /// where it is.
    pub fn place(&mut self, rest: &[Rest]) {
        if rest.len() != self.pieces.len() {
            return;
        }
        for (piece, rest) in self.pieces.iter_mut().zip(rest) {
            piece.rest = *rest;
        }
        self.placed = true;
    }

    /// Where a piece is in the unit, or nothing if nobody said where it sits.
    ///
    /// Its offset from its parent plus whatever has moved it, added up the
    /// chain to the root. That is the position in the unit's own space, which
    /// is the same as the position in the world because a preview puts the unit
    /// at the origin facing forwards.
    ///
    /// Rotations are not composed, so a piece hanging off an arm that has
    /// turned is reported where it would be if the arm had not. Composing them
    /// needs each piece's rest rotation as well, which is model data no runtime
    /// carries, and the callers of this are scripts asking how high a piece is
    /// on a unit that is standing up. The answer is labelled where it is given
    /// rather than quietly being treated as exact.
    pub fn piece_position(&self, index: usize) -> Option<[f64; 3]> {
        if !self.placed {
            return None;
        }
        let mut at = Some(index);
        let mut out = [0.0; 3];
        // Bounded by the number of pieces, so a parent chain that loops back on
        // itself stops rather than running forever.
        for _ in 0..=self.pieces.len() {
            let Some(index) = at else { return Some(out) };
            let piece = self.pieces.get(index)?;
            for (axis, sum) in out.iter_mut().enumerate() {
                *sum += piece.rest.position[axis] + piece.pos[axis];
            }
            at = piece.rest.parent;
        }
        Some(out)
    }

    /// Say something once. A warning repeated per frame is noise, and the same
    /// call is usually made every frame.
    pub fn note(&mut self, note: String) {
        if !self.warnings.contains(&note) {
            self.warnings.push(note);
        }
    }

    /// Move every animation on one frame.
    pub fn tick(&mut self) {
        for piece in &mut self.pieces {
            for axis in 0..3 {
                if let Some(rotate) = piece.rotate[axis] {
                    piece.rotate[axis] = tick_rotate(&mut piece.rot[axis], rotate);
                }
                if let Some(translate) = piece.translate[axis] {
                    piece.translate[axis] = tick_translate(&mut piece.pos[axis], translate);
                }
            }
        }
    }

    /// Whether an animation of `kind` is still running on this piece and axis.
    ///
    /// A spin started on an axis a thread was waiting to finish turning counts
    /// as finished, because the spin removed the turn it was waiting on.
    pub fn animating(&self, piece: usize, axis: usize, kind: Wait) -> bool {
        self.pieces.get(piece).is_some_and(|piece| match kind {
            Wait::Turn => matches!(piece.rotate[axis], Some(Rotate::Turn { .. })),
            Wait::Move => piece.translate[axis].is_some(),
        })
    }

    /// Start a turn, or put the piece there at once when there is no speed.
    ///
    /// No speed, or a speed of zero, is the engine's `TurnNow`, which
    /// deliberately leaves any turn already running to carry on from where it
    /// lands.
    pub fn turn(&mut self, piece: usize, axis: usize, dest: f64, speed: f64) {
        let dest = clamp_rad(dest);
        let piece = &mut self.pieces[piece];
        if speed == 0.0 {
            piece.rot[axis] = dest;
        } else {
            piece.rotate[axis] = Some(Rotate::Turn {
                dest,
                speed: speed.abs(),
            });
        }
    }

    /// Start a move, or put the piece there at once when there is no speed.
    ///
    /// The destination is measured from where the piece was built, which is what
    /// a pose of zero means here and why the viewport adds these to the rest
    /// pose.
    pub fn r#move(&mut self, piece: usize, axis: usize, dest: f64, speed: f64) {
        let piece = &mut self.pieces[piece];
        if speed == 0.0 {
            piece.pos[axis] = dest;
        } else {
            piece.translate[axis] = Some(Translate {
                dest,
                speed: speed.abs(),
            });
        }
    }

    /// Start or change a spin. A spin replaces a turn on the same axis, as it
    /// does in the engine: one animation per axis.
    pub fn spin(&mut self, piece: usize, axis: usize, speed: f64, accel: f64) {
        let accel = accel.abs();
        let current = match self.pieces[piece].rotate[axis] {
            Some(Rotate::Spin { speed, .. }) => speed,
            _ => 0.0,
        };
        self.pieces[piece].rotate[axis] = Some(Rotate::Spin {
            speed: if accel > 0.0 { current } else { speed },
            target: speed,
            accel,
        });
    }

    /// Wind a spin down, or stop it dead when there is no deceleration.
    pub fn stop_spin(&mut self, piece: usize, axis: usize, decel: f64) {
        let decel = decel.abs();
        let current = match self.pieces[piece].rotate[axis] {
            Some(Rotate::Spin { speed, .. }) => speed,
            _ => 0.0,
        };
        self.pieces[piece].rotate[axis] = (decel > 0.0).then_some(Rotate::Spin {
            speed: current,
            target: 0.0,
            accel: decel,
        });
    }

    pub fn set_hidden(&mut self, piece: usize, hidden: bool) {
        self.visibility_used = true;
        self.pieces[piece].hidden = hidden;
    }

    /// A piece a script named is not one of this unit's. The engine reports it
    /// and does nothing (`ShowUnitScriptError`), so nothing is recorded.
    pub fn no_such_piece(&mut self, call: &str, piece: i64) {
        self.note(format!(
            "{call} names piece {piece}, which this unit does not have, so it did nothing."
        ));
    }

    pub fn emit_sfx(&mut self, frame: u32, piece: usize, sfx: i32) {
        let piece = self.pieces[piece].name.clone();
        self.events.push(ScriptOutput::Sfx { frame, piece, sfx });
    }

    pub fn show_flare(&mut self, frame: u32, piece: usize) {
        let piece = self.pieces[piece].name.clone();
        self.events.push(ScriptOutput::Flare { frame, piece });
    }

    pub fn shot(&mut self, frame: u32, weapon: u32, piece: Option<usize>) {
        if piece.is_none() {
            self.note("The script named no weapon piece.".to_string());
        }
        let piece = piece.map(|index| self.pieces[index].name.clone());
        self.events.push(ScriptOutput::Shot {
            frame,
            weapon,
            piece,
        });
    }

    pub fn explode(&mut self, frame: u32, piece: usize, flags: i32) {
        let piece = self.pieces[piece].name.clone();
        self.events.push(ScriptOutput::Explode {
            frame,
            piece,
            flags,
        });
    }

    pub fn play_sound(&mut self, frame: u32, name: Option<String>) {
        self.events.push(ScriptOutput::Sound { frame, name });
    }

    /// One spraying frame. `answer` is what `QueryNanoPiece` named, or none
    /// when the cache has stopped asking (`NanoPieceCache.cpp:29-47`).
    pub fn spray(&mut self, frame: u32, answer: Option<Option<usize>>) {
        let piece = self.nano.next(frame, answer);
        if piece.is_none() {
            self.note("The script has named no nano piece, so nothing sprays.".to_string());
        }
        let piece = piece.map(|index| self.pieces[index].name.clone());
        self.events.push(ScriptOutput::Nano { frame, piece });
    }

    /// Note the frame a factory started building.
    pub fn build_start(&mut self, frame: u32) {
        self.events.push(ScriptOutput::BuildStart { frame });
    }

    /// Attach a unit to `piece`, or to the void when there is none.
    ///
    /// Recorded whichever unit it names. Only the stand-in moves, because it is
    /// the only other unit there is, and the engine does nothing for an id
    /// with no unit behind it (`UnitScript.cpp:838-841`).
    pub fn attach_unit(
        &mut self,
        frame: u32,
        unit: i32,
        piece: Option<usize>,
        world: Option<&World>,
    ) {
        let name = piece.map(|piece| self.pieces[piece].name.clone());
        self.events.push(ScriptOutput::Attach {
            frame,
            unit,
            piece: name,
        });
        if unit == unitvalue::UNIT_ID {
            self.carries_itself();
        } else if let Some(stand_in) = stand_in(unit, world) {
            self.passenger.attach(piece, stand_in.pos);
        }
    }

    /// Let a unit go. Recorded whichever unit it names, as an attach is
    /// (`UnitScript.cpp:852-855`).
    pub fn drop_unit(&mut self, frame: u32, unit: i32, world: Option<&World>) {
        self.events.push(ScriptOutput::Drop { frame, unit });
        if unit == unitvalue::UNIT_ID {
            self.carries_itself();
        } else if stand_in(unit, world).is_some() {
            self.passenger.release();
        }
    }

    /// The engine asserts against a unit carrying itself (`Unit.cpp:2638`).
    fn carries_itself(&mut self) {
        self.note(
            "This script tells the unit to carry or drop itself, which the engine does not allow, so nothing happened.".to_string(),
        );
    }

    /// Move the stand-in onto its piece once every thread has run this frame,
    /// which is the engine's `UpdatePostAnimation` (`rts/Game/Game.cpp:1796-1798`).
    pub fn after_frame(&mut self) {
        let mut passenger = std::mem::take(&mut self.passenger);
        passenger.after_frame(self);
        self.passenger = passenger;
    }

    /// Append this frame's poses to a timeline.
    pub fn sample(&self, timeline: &mut Timeline) {
        let mut frame = Vec::with_capacity(self.pieces.len() * 6);
        let mut hidden = Vec::with_capacity(self.pieces.len());
        for piece in &self.pieces {
            frame.extend_from_slice(&piece.pos);
            frame.extend_from_slice(&piece.rot);
            hidden.push(piece.hidden);
        }
        timeline.frames.push(frame);
        timeline.hidden.push(hidden);
    }

    /// Close a timeline off: carry the warnings and events over, say once that
    /// effects are marked rather than drawn, and drop the visibility track when
    /// nothing ever used it.
    pub fn finish(&self, timeline: &mut Timeline) {
        timeline.warnings.extend(self.warnings.iter().cloned());
        timeline.events = self.events.clone();
        if self.events.iter().any(ScriptOutput::is_effect) {
            timeline.warnings.push(EFFECTS_NOTE.to_string());
        }
        if !self.visibility_used {
            timeline.hidden.clear();
        }
    }
}

/// The stand-in, when `unit` is its id.
fn stand_in(unit: i32, world: Option<&World>) -> Option<&StandIn> {
    world?
        .stand_in
        .as_ref()
        .filter(|stand_in| stand_in.id == unit)
}

/// Move one axis one frame toward its target, and report the animation that is
/// left, which is none once it arrives.
///
/// A turn takes the shortest way round, as `CUnitScript::TurnToward` does, so a
/// piece at 0.1 told to turn to 6.2 goes backwards past zero rather than nearly
/// all the way round.
fn tick_rotate(value: &mut f64, animation: Rotate) -> Option<Rotate> {
    match animation {
        Rotate::Turn { dest, speed } => {
            let step = speed.abs() * DT;
            let delta = shortest(dest - clamp_rad(*value));
            if delta.abs() <= step {
                *value = dest;
                return None;
            }
            *value = clamp_rad(clamp_rad(*value) + delta.signum() * step);
            Some(animation)
        }
        Rotate::Spin {
            speed,
            target,
            accel,
        } => {
            // Acceleration is per frame rather than per second: the engine
            // scales it by `GAME_SPEED / tickRate`, and those are the same
            // number, so a spin gains `accel` radians per second every frame.
            let reached = (target - speed).abs() <= accel;
            let speed = if reached {
                target
            } else {
                speed + (target - speed).signum() * accel
            };
            *value = clamp_rad(*value + speed * DT);
            // Only a spin that has arrived at a target of nothing is over. One
            // passing through zero on its way to a speed the other way is not.
            if reached && speed == 0.0 {
                return None;
            }
            Some(Rotate::Spin {
                speed,
                target,
                accel,
            })
        }
    }
}

fn tick_translate(value: &mut f64, animation: Translate) -> Option<Translate> {
    let step = animation.speed.abs() * DT;
    if (animation.dest - *value).abs() <= step {
        *value = animation.dest;
        return None;
    }
    *value += (animation.dest - *value).signum() * step;
    Some(animation)
}

/// An angle in `[0, TAU)`, which is the range the engine keeps piece rotations
/// in and what stops a long spin drifting out of a float's precision.
pub fn clamp_rad(angle: f64) -> f64 {
    let tau = std::f64::consts::TAU;
    angle - tau * (angle / tau).floor()
}

/// The way round from one angle to another that is not the long way: the result
/// is in `(-PI, PI]`.
fn shortest(delta: f64) -> f64 {
    let tau = std::f64::consts::TAU;
    (delta + 3.0 * std::f64::consts::PI).rem_euclid(tau) - std::f64::consts::PI
}

/// The axis a script named, as an index into a piece's three.
///
/// A script's `x_axis`, `y_axis` and `z_axis` are 1, 2 and 3. The engine's own
/// arrays are 0, 1 and 2, and it subtracts one on the way in.
pub fn axis_index(axis: i64) -> Option<usize> {
    (1..=3).contains(&axis).then_some(axis as usize - 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names() -> Vec<String> {
        ["base", "torso", "arm"]
            .iter()
            .map(|n| (*n).to_string())
            .collect()
    }

    /// A base on the ground, a torso above it, an arm out to one side of that.
    fn placed() -> Model {
        let mut model = Model::new(&names());
        model.place(&[
            Rest {
                parent: None,
                position: [0.0, 0.0, 0.0],
            },
            Rest {
                parent: Some(0),
                position: [0.0, 10.0, 0.0],
            },
            Rest {
                parent: Some(1),
                position: [4.0, 2.0, 0.0],
            },
        ]);
        model
    }

    #[test]
    fn a_piece_sits_where_its_parents_put_it() {
        assert_eq!(placed().piece_position(2), Some([4.0, 12.0, 0.0]));
    }

    /// Moving a piece moves everything hanging off it, which is what makes a
    /// raised arm's hand raised as well.
    #[test]
    fn moving_a_parent_carries_its_children() {
        let mut model = placed();
        model.pieces[1].pos[1] = 5.0;

        assert_eq!(model.piece_position(2), Some([4.0, 17.0, 0.0]));
    }

    /// Without geometry there is no answer, and saying so is the point: a
    /// script handed the origin for every piece decides they are all at the
    /// unit's feet.
    #[test]
    fn a_model_nobody_placed_has_no_positions() {
        assert_eq!(Model::new(&names()).piece_position(0), None);
    }

    /// A list that does not line up with the pieces would put every one of them
    /// somewhere that is not where it is.
    #[test]
    fn a_placement_of_the_wrong_length_is_ignored() {
        let mut model = Model::new(&names());
        model.place(&[Rest::default()]);

        assert_eq!(model.piece_position(0), None);
    }

    /// A parent chain that loops is a broken model, and stopping is what makes
    /// it a wrong answer rather than a hang.
    #[test]
    fn a_parent_chain_that_loops_still_answers() {
        let mut model = Model::new(&names());
        model.place(&[
            Rest {
                parent: Some(1),
                position: [1.0, 0.0, 0.0],
            },
            Rest {
                parent: Some(0),
                position: [1.0, 0.0, 0.0],
            },
            Rest::default(),
        ]);

        assert!(model.piece_position(0).is_some());
    }

    fn scene(pos: [f64; 3]) -> World {
        World {
            stand_in: Some(StandIn {
                id: 2,
                pos: Some(pos),
                radius: 5.0,
                height: 6.0,
            }),
            own: Size {
                radius: 10.0,
                height: 12.0,
            },
        }
    }

    /// `CUnit::AttachUnit` records the piece and nothing else. The passenger
    /// moves once every script has ticked (`rts/Game/Game.cpp:1796-1798`).
    #[test]
    fn an_attach_does_not_move_the_stand_in_until_the_frame_ends() {
        let mut model = placed();
        model.attach_unit(0, 2, Some(2), Some(&scene([30.0, 0.0, 40.0])));

        assert_eq!(model.passenger.at(), Some([30.0, 0.0, 40.0]));
        model.after_frame();
        assert_eq!(model.passenger.at(), Some([4.0, 12.0, 0.0]));
    }

    /// A later event's scene says where it last saw the stand-in, which is
    /// no longer where a held stand-in is.
    #[test]
    fn a_later_scene_does_not_move_an_attached_stand_in() {
        let mut model = placed();
        model.attach_unit(0, 2, Some(2), Some(&scene([30.0, 0.0, 40.0])));
        model.after_frame();
        let later = scene([90.0, 0.0, 90.0]);

        let answer = unitvalue::world(
            unitvalue::UNIT_XZ,
            2,
            Some(&later),
            model.passenger.at(),
            false,
        );
        assert_eq!(answer.map(|a| a.value), Some(unitvalue::pack_xz(4.0, 0.0)));
    }

    /// A riding stand-in follows its piece frame by frame.
    #[test]
    fn a_riding_stand_in_follows_its_piece() {
        let mut model = placed();
        model.attach_unit(0, 2, Some(2), Some(&scene([30.0, 0.0, 40.0])));
        model.after_frame();
        model.pieces[1].pos[1] = 5.0;
        model.after_frame();

        assert_eq!(model.passenger.at(), Some([4.0, 17.0, 0.0]));
    }

    /// A negative piece puts a passenger at the transporter's own position
    /// (`rts/Sim/Units/Unit.cpp:726-732`), which is the origin here.
    #[test]
    fn the_void_is_the_origin() {
        let mut model = placed();
        model.attach_unit(0, 2, None, Some(&scene([30.0, 0.0, 40.0])));
        model.after_frame();

        assert_eq!(model.passenger, Passenger::Void { at: [0.0; 3] });
    }

    /// `DetachUnit` does not move the passenger (`Unit.cpp:2715-2780`).
    #[test]
    fn a_drop_keeps_the_last_position() {
        let mut model = placed();
        let world = scene([30.0, 0.0, 40.0]);
        model.attach_unit(0, 2, Some(2), Some(&world));
        model.after_frame();
        model.drop_unit(1, 2, Some(&world));
        model.pieces[1].pos[1] = 50.0;
        model.after_frame();

        assert_eq!(
            model.passenger,
            Passenger::Released {
                at: [4.0, 12.0, 0.0]
            }
        );
    }

    /// A second attach while carried moves the passenger to the new piece
    /// (`Unit.cpp:2640-2654`), and still waits for the frame to end.
    #[test]
    fn a_second_attach_moves_to_the_new_piece() {
        let mut model = placed();
        let world = scene([30.0, 0.0, 40.0]);
        model.attach_unit(0, 2, Some(2), Some(&world));
        model.after_frame();
        model.attach_unit(1, 2, Some(1), Some(&world));

        assert_eq!(model.passenger.at(), Some([4.0, 12.0, 0.0]));
        model.after_frame();
        assert_eq!(model.passenger.at(), Some([0.0, 10.0, 0.0]));
    }

    /// `DetachUnitCore` refuses a unit it is not carrying (`Unit.cpp:2715-2720`).
    #[test]
    fn dropping_a_stand_in_nobody_carries_moves_nothing() {
        let mut model = placed();
        model.drop_unit(0, 2, Some(&scene([30.0, 0.0, 40.0])));

        assert_eq!(model.passenger, Passenger::Loose);
        assert_eq!(model.events, [ScriptOutput::Drop { frame: 0, unit: 2 }]);
    }

    /// The engine does nothing for an id with no unit behind it
    /// (`rts/Sim/Units/Scripts/UnitScript.cpp:838-841,852-855`), and the
    /// stand-in is the only other unit.
    #[test]
    fn attaching_another_unit_is_recorded_and_moves_nothing() {
        let mut model = placed();
        model.attach_unit(3, 7, Some(2), Some(&scene([30.0, 0.0, 40.0])));

        assert_eq!(model.passenger, Passenger::Loose);
        assert_eq!(
            model.events,
            [ScriptOutput::Attach {
                frame: 3,
                unit: 7,
                piece: Some("arm".to_string()),
            }]
        );
    }

    /// The engine asserts against a unit carrying itself (`Unit.cpp:2638`).
    #[test]
    fn attaching_the_unit_to_itself_is_noted() {
        let mut model = placed();
        model.attach_unit(0, unitvalue::UNIT_ID, Some(2), None);

        assert_eq!(model.passenger, Passenger::Loose);
        assert_eq!(model.events.len(), 1);
        assert!(model
            .warnings
            .iter()
            .any(|w| w.contains("carry or drop itself")));
    }

    #[test]
    fn records_effects_by_piece_name() {
        let mut model = placed();
        model.emit_sfx(4, 2, 1025);
        model.explode(5, 1, 257);
        model.play_sound(6, Some("krogtaunt".to_string()));

        assert_eq!(
            model.events,
            [
                ScriptOutput::Sfx {
                    frame: 4,
                    piece: "arm".to_string(),
                    sfx: 1025
                },
                ScriptOutput::Explode {
                    frame: 5,
                    piece: "torso".to_string(),
                    flags: 257
                },
                ScriptOutput::Sound {
                    frame: 6,
                    name: Some("krogtaunt".to_string())
                },
            ]
        );
    }

    /// The effects note is said only when there is an effect to mark. An
    /// attach on its own is not one.
    #[test]
    fn notes_effects_only_when_the_run_recorded_one() {
        let mut quiet = placed();
        quiet.attach_unit(0, 2, None, None);
        let mut timeline = Timeline::new(names(), 0);
        quiet.finish(&mut timeline);
        assert!(!timeline.warnings.iter().any(|w| w == EFFECTS_NOTE));
        assert_eq!(timeline.events.len(), 1);

        let mut loud = placed();
        loud.play_sound(0, None);
        let mut timeline = Timeline::new(names(), 0);
        loud.finish(&mut timeline);
        assert!(timeline.warnings.iter().any(|w| w == EFFECTS_NOTE));
    }

    /// The shape `ScriptTimeline.events` reads in `src/lego/scriptPlayback.ts`.
    #[test]
    fn serialises_an_event_the_way_the_panel_reads_it() {
        let attach = ScriptOutput::Attach {
            frame: 3,
            unit: 2,
            piece: None,
        };
        assert_eq!(
            serde_json::to_value(&attach).unwrap(),
            serde_json::json!({ "kind": "attach", "frame": 3, "unit": 2, "piece": null })
        );
        let sfx = ScriptOutput::Sfx {
            frame: 1,
            piece: "flare".to_string(),
            sfx: 1025,
        };
        assert_eq!(
            serde_json::to_value(&sfx).unwrap(),
            serde_json::json!({ "kind": "sfx", "frame": 1, "piece": "flare", "sfx": 1025 })
        );
    }

    #[test]
    fn serialises_a_flare_and_a_shot_with_their_kinds() {
        let flare = serde_json::to_value(ScriptOutput::Flare {
            frame: 3,
            piece: "flare1".into(),
        })
        .unwrap();
        assert_eq!(flare["kind"], "flare");
        let shot = serde_json::to_value(ScriptOutput::Shot {
            frame: 3,
            weapon: 1,
            piece: None,
        })
        .unwrap();
        assert_eq!(shot["kind"], "shot");
        assert_eq!(shot["piece"], serde_json::Value::Null);
    }
}

#[cfg(test)]
mod world_tests {
    use super::*;

    /// The shape the panel sends, field for field.
    #[test]
    fn reads_the_world_the_panel_sends() {
        let event: ScriptEvent = serde_json::from_str(
            r#"{
                "frame": 120, "callin": "TransportPickup", "args": [2],
                "world": {
                    "standIn": { "id": 2, "pos": [0, 0, 84], "radius": 28, "height": 30.8 },
                    "self": { "radius": 60, "height": 40 }
                }
            }"#,
        )
        .unwrap();
        let world = event.world.unwrap();
        let stand_in = world.stand_in.unwrap();
        assert_eq!(stand_in.id, 2);
        assert_eq!(stand_in.pos, Some([0.0, 0.0, 84.0]));
        assert_eq!(world.own.radius, 60.0);
    }

    /// Every caller outside the panel sends no world, and a stand-in with no
    /// place on this frame sends no position.
    #[test]
    fn reads_an_event_with_no_world_and_a_stand_in_with_no_place() {
        let bare: ScriptEvent =
            serde_json::from_str(r#"{ "frame": 0, "callin": "Create" }"#).unwrap();
        assert!(bare.world.is_none());
        let gone: World = serde_json::from_str(
            r#"{ "standIn": { "id": 2, "pos": null, "radius": 4, "height": 4 }, "self": { "radius": 1, "height": 1 } }"#,
        )
        .unwrap();
        assert_eq!(gone.stand_in.unwrap().pos, None);
    }

    /// An event the engine acts on carries no call-in at all.
    #[test]
    fn reads_an_event_the_engine_acts_on() {
        let attach: ScriptEvent =
            serde_json::from_str(r#"{ "frame": 120, "engine": "attach" }"#).unwrap();
        assert_eq!(attach.engine, Some(EngineAction::Attach));
        assert_eq!(attach.callin, "");
        let detach: ScriptEvent =
            serde_json::from_str(r#"{ "frame": 330, "engine": "detach" }"#).unwrap();
        assert_eq!(detach.engine, Some(EngineAction::Detach));
        let plain: ScriptEvent =
            serde_json::from_str(r#"{ "frame": 0, "callin": "Create" }"#).unwrap();
        assert_eq!(plain.engine, None);
    }

    #[test]
    fn reads_the_nano_actions() {
        let start: ScriptEvent =
            serde_json::from_str(r#"{ "frame": 15, "engine": "nano-start" }"#).unwrap();
        assert_eq!(start.engine, Some(EngineAction::NanoStart));
        let stop: ScriptEvent =
            serde_json::from_str(r#"{ "frame": 150, "engine": "nano-stop" }"#).unwrap();
        assert_eq!(stop.engine, Some(EngineAction::NanoStop));
    }

    #[test]
    fn reads_the_factory_actions() {
        let build: ScriptEvent =
            serde_json::from_str(r#"{ "frame": 15, "engine": "factory-build" }"#).unwrap();
        assert_eq!(build.engine, Some(EngineAction::FactoryBuild));
        let finish: ScriptEvent =
            serde_json::from_str(r#"{ "frame": 150, "engine": "factory-finish" }"#).unwrap();
        assert_eq!(finish.engine, Some(EngineAction::FactoryFinish));
    }

    #[test]
    fn serialises_a_build_start_the_way_the_panel_reads_it() {
        let build_start = ScriptOutput::BuildStart { frame: 42 };
        assert_eq!(
            serde_json::to_value(&build_start).unwrap(),
            serde_json::json!({ "kind": "build-start", "frame": 42 })
        );
    }

    #[test]
    fn a_spraying_frame_records_its_piece_by_name() {
        let mut model = Model::new(&["base".to_string(), "nozzle".to_string()]);
        model.spray(4, Some(Some(1)));
        model.spray(5, Some(None));
        assert_eq!(
            model.events,
            [
                ScriptOutput::Nano {
                    frame: 4,
                    piece: Some("nozzle".to_string())
                },
                ScriptOutput::Nano {
                    frame: 5,
                    piece: Some("nozzle".to_string())
                },
            ]
        );
        assert_eq!(
            serde_json::to_value(&model.events[0]).unwrap(),
            serde_json::json!({ "kind": "nano", "frame": 4, "piece": "nozzle" })
        );
    }

    /// Nano is drawn, so it does not bring the note that effects are not.
    #[test]
    fn nano_alone_does_not_say_effects_are_not_drawn() {
        let mut model = Model::new(&["base".to_string()]);
        model.spray(0, Some(Some(0)));
        let mut timeline = Timeline::new(vec!["base".to_string()], 1);
        model.finish(&mut timeline);
        assert!(!timeline.warnings.iter().any(|w| w == EFFECTS_NOTE));
    }
}
