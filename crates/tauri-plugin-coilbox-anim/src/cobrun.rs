//! Run a compiled `.cob` animation script and report the pose its pieces are
//! in on each frame.
//!
//! A game that compiled its animation ships bytecode, and coilbox could name
//! the file and disassemble it but not play it, so a walker imported out of an
//! older game stood still. Decompiling it back to source is the obvious route
//! and does not work: a disassembly is a stack-machine listing, nothing in it
//! distinguishes a signed number from a piece index from a jump target, and
//! recovering source would mean control-flow reconstruction and operand typing.
//! Running the bytecode is both easier and exact.
//!
//! COB is a small stack machine. Each script is a run of 32-bit words, some of
//! them opcodes and some of them operands, executed by threads that sleep and
//! wait on the animations they start. That is the same shape as the Lua unit
//! script runtime, so this drives the same model out of [`coilbox_unitpose`]
//! and hands back the same [`Timeline`]. Nothing downstream knows the
//! difference.
//!
//! `CCobThread::Tick` in the engine is the reference this is ported from, the
//! same way the BOS compiler beside it was ported from the Python. Where the
//! two could differ they do not: the fixed-point conversions, the three sign
//! flips `CobInstance.h` labels COBWTF, and the sleep clock all follow it.
//!
//! It is read-only by construction. It executes words held in memory and never
//! opens a file for anything.
//!
//! What is absent is the world. A script asking about its own health, the
//! ground under it or the wind gets zero and a note saying so, because a
//! preview has no unit and no map, and a number that looks like an answer is
//! worse than being told there is none.

use std::collections::{BTreeSet, HashMap};

use coilbox_unitpose::{
    unitvalue, EngineAction, Model, Rest, ScriptEvent, Timeline, Wait, MAX_FRAMES, TICK_MS,
};
use serde::Serialize;

use crate::cob;
use crate::opcodes::opcode;

/// COB's fixed-point scale: 65536ths of an elmo for a distance, and 65536ths
/// of a full circle for an angle.
const COBSCALE: f64 = 65536.0;

/// One COB angular unit in radians. The engine's `TAANG2RAD`.
const TAANG2RAD: f64 = std::f64::consts::PI / 32768.0;

/// Radians to COB angular units, for the two trigonometry call-outs that answer
/// in them.
const RAD2TAANG: f64 = 32768.0 / std::f64::consts::PI;

/// Instructions one frame may execute before the run is abandoned.
///
/// Refilled each frame, so this is a per-frame budget: a thread that loops
/// without sleeping is caught on the frame it does it, and a long run of well
/// behaved frames is never punished for its length.
const FRAME_INSTRUCTIONS: i64 = 500_000;

/// Most threads that may exist at once. A script starting a thread per frame is
/// a bug, and without a ceiling it is a hang.
const MAX_THREADS: usize = 256;

/// The `GET`, `GET_UNIT_VALUE` and `SET` ids that stand for a Lua call's return
/// slots rather than for anything about the unit.
const LUA0: i32 = 110;
const LUA9: i32 = 119;

/// The frame the run is on, which the preview counts itself.
const GAME_FRAME: i32 = 134;

/// Where a piece is: the pair of map coordinates packed into one number, and
/// the height on its own.
const PIECE_XZ: i32 = 7;
const PIECE_Y: i32 = 8;

/// Two coordinates in one number, sixteen bits each, which is how the engine
/// hands a script a place on the map (`PACKXZ` in `CobInstance.h`).
fn pack_xz(x: f64, z: f64) -> i32 {
    ((x as i32) << 16) + ((z as i32) & 0xffff)
}

/// Run the compiled script in `bytes` for `frames` frames, firing `events` as
/// they come due.
///
/// `pieces` is the model's piece names. A `.cob` numbers its own pieces its own
/// way and carries their names, so the two are tied together by name: a script
/// naming a piece this model does not have is a note rather than a failure,
/// because the rest of the unit still animates and the mismatch usually means
/// the script was written against a variant of the model.
///
/// `values` seeds the unit value store before the first frame runs, so a
/// script asking what its own health is sees what the caller put there. A
/// script's own `SET` still overrides it, as it would in the engine: the seed
/// only fills in what nobody has said yet.
///
/// Never returns an error. A file that will not decode, a thread that loops
/// without sleeping and a word that is not an opcode all come back as a
/// [`Timeline`] with `error` set and whatever frames it managed first.
pub fn run(
    bytes: &[u8],
    pieces: &[String],
    events: &[ScriptEvent],
    frames: u32,
    rest: &[Rest],
    values: &HashMap<i32, i32>,
) -> Timeline {
    match Run::start(bytes, pieces, rest, values) {
        Ok(mut run) => run.play(events, frames.min(MAX_FRAMES)),
        Err(error) => Timeline::failed(pieces, error),
    }
}

/// What one call-in that returns a piece named, for a `.cob`.
///
/// The same shape `coilbox_springlua::unitscript::Probe` reports for a Lua
/// script, mirrored here rather than shared because that crate is only a dev
/// dependency of this one. The frontend's `ScriptProbe` fits either.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    /// Key asked for, such as `AimFromWeapon1`.
    pub callin: String,
    /// The pieces it named, in call order and with repeats kept.
    pub pieces: Vec<String>,
    /// Why it named nothing.
    pub note: Option<String>,
}

/// Every probe of one `.cob`, plus whatever went wrong before any ran.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Probes {
    /// The unit's piece names, so a caller can check they are what it expected.
    pub pieces: Vec<String>,
    pub probes: Vec<Probe>,
    /// Set when the script could not be loaded at all, in which case `probes`
    /// is empty.
    pub error: Option<String>,
}

/// How many times each probe calls its call-in.
///
/// The same limit the Lua probe uses, so a cycling answer, several nozzles on
/// a builder, is reported the same way whichever runtime answered it.
const PROBE_CALLS: usize = 16;

/// Ask a compiled script which pieces it names, by calling the call-ins that
/// return one.
///
/// Not a run. Nothing is animated and no frames pass. Each call-in is called
/// directly, seeded and stepped once, the way `Run::ask_piece` asks for one on
/// the engine's behalf, except a probe reports what stopped it rather than
/// falling back to script piece 1. A caller here wants to know whether the
/// script named a piece, not what the engine would have shown regardless.
///
/// Never returns an error. A file that will not decode comes back with
/// `error` set and no probes. One that loads but answers badly says so on the
/// probe itself.
pub fn probe(bytes: &[u8], pieces: &[String], callins: &[String]) -> Probes {
    let mut run = match Run::start(bytes, pieces, &[], &HashMap::new()) {
        Ok(run) => run,
        Err(error) => {
            return Probes {
                pieces: pieces.to_vec(),
                probes: Vec::new(),
                error: Some(error),
            }
        }
    };
    Probes {
        pieces: pieces.to_vec(),
        probes: callins
            .iter()
            .map(|callin| run.probe_callin(callin))
            .collect(),
        error: None,
    }
}

/// The decoded file, with everything the interpreter needs looked up once.
struct Program {
    /// Script names, in the file's own order.
    names: Vec<String>,
    /// Every script's code end to end. A jump target is an offset into this.
    code: Vec<u32>,
    /// Where each script starts in `code`.
    offsets: Vec<usize>,
    /// How long each script is, because a call to an empty one does nothing.
    lengths: Vec<usize>,
    /// This file's piece index to the model's, matched by name. `None` for a
    /// piece the model does not have.
    pieces: Vec<Option<usize>>,
    /// This file's piece names, so a note can say which one is missing.
    piece_names: Vec<String>,
    /// The sounds a TA:K file names, by the index `PLAY_SOUND` plays them by.
    sounds: Vec<String>,
}

impl Program {
    fn read(bytes: &[u8], model_pieces: &[String]) -> Result<Self, String> {
        let decoded = cob::decode(bytes)?;
        let lookup: HashMap<String, usize> = model_pieces
            .iter()
            .enumerate()
            .map(|(index, name)| (name.to_lowercase(), index))
            .collect();
        let pieces = decoded
            .pieces
            .iter()
            .map(|name| lookup.get(&name.to_lowercase()).copied())
            .collect();
        let offsets = decoded.offsets.clone();
        let lengths = (0..offsets.len())
            .map(|i| {
                offsets
                    .get(i + 1)
                    .copied()
                    .unwrap_or(decoded.code.len())
                    .saturating_sub(offsets[i])
            })
            .collect();
        Ok(Self {
            names: decoded
                .scripts
                .iter()
                .map(|(name, _)| name.clone())
                .collect(),
            code: decoded.code,
            offsets,
            lengths,
            pieces,
            sounds: decoded.sounds,
            piece_names: decoded.pieces,
        })
    }

    /// The script a call-in name means.
    ///
    /// Exact first, then the older name for the same thing: a `.cob` from
    /// before the rename calls its first weapon Primary, and the scenarios the
    /// builder offers are written the way Recoil names them now.
    fn script(&self, callin: &str) -> Option<usize> {
        let find = |want: &str| {
            self.names
                .iter()
                .position(|name| name.eq_ignore_ascii_case(want))
        };
        find(callin).or_else(|| alias(callin).and_then(|older| find(&older)))
    }
}

/// The name an older `.cob` uses for a call-in Recoil now numbers.
///
/// `CobScriptNames.cpp` keeps both spellings in its map for exactly this
/// reason. Only the first three weapons ever had words rather than numbers.
fn alias(callin: &str) -> Option<String> {
    const ORDINALS: [&str; 3] = ["Primary", "Secondary", "Tertiary"];
    for (index, ordinal) in ORDINALS.iter().enumerate() {
        let numbered = format!("{}", index + 1);
        for stem in ["Query", "Aim", "AimFrom", "Fire"] {
            if callin.eq_ignore_ascii_case(&format!("{stem}Weapon{numbered}")) {
                return Some(format!("{stem}{ordinal}"));
            }
        }
    }
    None
}

/// The arguments a `.cob` expects for a call-in, from the Lua form a scenario
/// is written in.
///
/// The two runtimes are handed the same scenario and do not want the same
/// numbers. Every difference below is the engine's, and each one is a different
/// kind of difference:
///
/// - Aiming and building are handed angles. Lua takes radians, COB counts
///   65536ths of a circle (`CobInstance.cpp:45-56`).
/// - A transport identifies its passenger by unit id in Lua and by model height
///   in 65536ths in COB (`LuaUnitScript.cpp:139-141` against
///   `CobInstance.cpp:355-372`). The scenario's one number is the stand-in's
///   height in elmos, which is the only form both can be built from.
/// - `TransportDrop` takes x, y and z in Lua and one packed word in COB, with y
///   dropped entirely (`CobInstance.cpp:385-395`, `PACKXZ` in
///   `CobInstance.h:10`).
///
/// Everything else is handed straight through.
///
/// `QueryTransport` is not here. It is never fired as an event: the engine asks
/// it for a piece when it attaches, which `Run::query_transport` does.
fn cob_args(callin: &str, args: &[f64], world: Option<&coilbox_unitpose::World>) -> Vec<i32> {
    let lower = callin.to_ascii_lowercase();

    if lower.starts_with("aim") || lower == "startbuilding" {
        return args.iter().map(|arg| (arg * RAD2TAANG) as i32).collect();
    }

    if lower == "begintransport" {
        // The passenger's model height, which is what COB is handed where Lua
        // is handed the id. Without a scene the argument is taken as that
        // height, which is what a caller outside the panel means by it.
        if let Some(stand_in) = world.and_then(|world| world.stand_in.as_ref()) {
            return vec![(stand_in.height * 65536.0) as i32];
        }
        return args.iter().map(|arg| (arg * 65536.0) as i32).collect();
    }

    if lower == "transportdrop" {
        // (unitID, x, y, z) becomes (unitID, PACKXZ(x, z)).
        let id = args.first().copied().unwrap_or(0.0) as i32;
        let x = args.get(1).copied().unwrap_or(0.0) as i32;
        let z = args.get(3).copied().unwrap_or(0.0) as i32;
        return vec![id, (x << 16) + (z & 0xffff)];
    }

    args.iter().map(|arg| *arg as i32).collect()
}

/// One frame of a script's call stack.
struct Call {
    /// Where to carry on in the caller, or `None` for the thread's first frame,
    /// which is where returning ends the thread.
    ret: Option<usize>,
    /// How much of the data stack belongs to callers, so a return can drop
    /// everything this frame put on it.
    stack_top: usize,
    /// The function this frame is running, which is what `SHOW` checks
    /// (`CobThread.cpp:715-718`).
    function: usize,
}

enum State {
    /// Run as soon as the scheduler gets to it.
    Ready,
    /// Run once the clock passes this, in milliseconds.
    Sleeping(i64),
    /// Run once this piece's animation on this axis finishes.
    Waiting {
        piece: Option<usize>,
        axis: usize,
        kind: Wait,
    },
    Dead,
}

struct Thread {
    pc: usize,
    data: Vec<i32>,
    calls: Vec<Call>,
    /// How many of this frame's arguments are still on the stack rather than
    /// having been claimed by a `CREATE_LOCAL_VAR`.
    params: i32,
    /// What a `SIGNAL` kills by.
    mask: u32,
    state: State,
    /// The ten slots a Lua call would answer in. Nothing answers in them here,
    /// which is what the first one being zero means.
    lua: [i32; 10],
    /// The call-in this thread came from, so an error can name it.
    origin: String,
}

impl Thread {
    fn new(function: usize, pc: usize, mask: u32, origin: String) -> Self {
        Self {
            pc,
            data: Vec::new(),
            calls: vec![Call {
                ret: None,
                stack_top: 0,
                function,
            }],
            params: 0,
            mask,
            state: State::Ready,
            lua: [0; 10],
            origin,
        }
    }

    fn frame(&self) -> usize {
        self.calls.last().map_or(0, |call| call.stack_top)
    }
}

struct Run {
    program: Program,
    model: Model,
    statics: Vec<i32>,
    threads: Vec<Thread>,
    /// Threads a running thread started. The engine queues these and adds them
    /// after the tick that made them, so a started script never runs inside the
    /// call that started it.
    queued: Vec<Thread>,
    frame: u32,
    /// The clock a `SLEEP` is measured against, in milliseconds.
    time: i64,
    budget: i64,
    /// Set when something has gone wrong with the run itself rather than with
    /// one of its threads, which is the difference between stopping and
    /// carrying on.
    fatal: bool,
    /// State for the deterministic `RAND`. A preview that shuffled itself every
    /// time it was asked would be impossible to look at.
    rng: u64,
    /// Values the script has set on its unit, so it can read back what it
    /// stored. Scripts keep real state this way: whether the yard is open,
    /// whether the unit is armoured, whether it is switched on. Seeded from
    /// whatever the caller supplied before the first frame runs.
    set_values: HashMap<i32, i32>,
    /// The scene the latest event brought, which is what a script asking where
    /// something is gets told until the next event brings another.
    world: Option<coilbox_unitpose::World>,
    /// Every unit value id a script has asked for, in the order it first asked.
    asked: Vec<coilbox_unitpose::AskedValue>,
    /// Offsets, into the whole code stream, of every opcode word actually
    /// executed. Sorted by construction, since it fills from a `BTreeSet`.
    offsets_run: BTreeSet<u32>,
    /// The functions the engine calls as `FireWeapon1` to `FireWeapon32`, in
    /// which `SHOW` draws a flare instead of unhiding
    /// (`CobThread.cpp:715-728`, `MAX_WEAPONS_PER_UNIT` being 32).
    fire_functions: Vec<usize>,
}

impl Run {
    fn start(
        bytes: &[u8],
        pieces: &[String],
        rest: &[Rest],
        values: &HashMap<i32, i32>,
    ) -> Result<Self, String> {
        let program = Program::read(bytes, pieces)?;
        let mut model = Model::new(pieces);
        model.place(rest);
        for (index, name) in program.piece_names.iter().enumerate() {
            if program.pieces[index].is_none() {
                model.note(format!(
                    "This script animates a piece called {name}, which this unit does not have."
                ));
            }
        }
        let fire_functions = (1..=32)
            .filter_map(|weapon| program.script(&format!("FireWeapon{weapon}")))
            .collect();
        Ok(Self {
            program,
            model,
            statics: vec![0; 256],
            threads: Vec::new(),
            queued: Vec::new(),
            frame: 0,
            time: 0,
            budget: FRAME_INSTRUCTIONS,
            fatal: false,
            rng: 0x2545_F491_4F6C_DD1D,
            set_values: values.clone(),
            world: None,
            asked: Vec::new(),
            offsets_run: BTreeSet::new(),
            fire_functions,
        })
    }

    fn play(&mut self, events: &[ScriptEvent], frames: u32) -> Timeline {
        let names = self
            .model
            .pieces
            .iter()
            .map(|piece| piece.name.clone())
            .collect();
        let mut timeline = Timeline::new(names, frames as usize);

        for frame in 0..frames {
            self.frame = frame;
            self.time = i64::from(frame) * TICK_MS as i64;
            if let Err(error) = self.step(events) {
                timeline.error = Some(error);
                break;
            }
            self.model.sample(&mut timeline);
        }

        self.model.finish(&mut timeline);
        timeline.asked = std::mem::take(&mut self.asked);
        timeline.functions = self.program.names.clone();
        timeline.offsets_run = self.offsets_run.iter().copied().collect();
        timeline
    }

    /// One frame: tick the animations, wake what they finished, fire what is
    /// due, run every thread that can run, then carry the stand-in.
    ///
    /// Animations tick before threads run, so a turn issued this frame first
    /// moves on the next one. That is the engine's order, and it is what makes
    /// a sleep cost time rather than nothing.
    fn step(&mut self, events: &[ScriptEvent]) -> Result<(), String> {
        self.budget = FRAME_INSTRUCTIONS;
        self.model.tick();
        self.wake_finished();
        self.fire_due(events)?;
        self.run_threads()?;
        // After every thread, as the engine moves its passengers once every
        // script has ticked (`rts/Game/Game.cpp:1796-1798`).
        self.model.after_frame();
        Ok(())
    }

    /// Anything waiting on an animation that is no longer running is ready.
    ///
    /// A wait on an axis with nothing on it is satisfied at once, which is what
    /// the engine does and what stops a wait on a turn that already finished
    /// hanging the thread forever.
    fn wake_finished(&mut self) {
        for thread in &mut self.threads {
            let State::Waiting { piece, axis, kind } = thread.state else {
                continue;
            };
            let still_going = piece.is_some_and(|piece| self.model.animating(piece, axis, kind));
            if !still_going {
                thread.state = State::Ready;
            }
        }
    }

    fn fire_due(&mut self, events: &[ScriptEvent]) -> Result<(), String> {
        let frame = self.frame;
        // Where this call's own queued threads start, so an engine event can
        // give them their first tick ahead of itself. See
        // `tick_queued_call_ins`.
        let start = self.threads.len();
        for event in events.iter().filter(|event| event.frame == frame) {
            // Before the call-in, and whether or not the script has one, so
            // the scene is right for every thread from this frame on.
            if let Some(world) = &event.world {
                self.world = Some(world.clone());
            }
            if let Some(action) = event.engine {
                self.tick_queued_call_ins(start)?;
                if action == EngineAction::Fire {
                    let weapon = event.args.first().copied().unwrap_or(1.0) as u32;
                    self.fire(weapon)?;
                } else {
                    self.engine(action)?;
                }
                continue;
            }
            if !self.start_callin(&event.callin, &event.args)? {
                if !event.ambient {
                    self.model
                        .note(format!("This script has no {} call-in.", event.callin));
                }
                continue;
            }

            // The engine tells a script its longest reload straight after
            // Create (`CCobInstance::Create`), and scripts that wait on a
            // restore delay read it there. The preview has no weapons, so the
            // longest reload is none.
            if event.callin.eq_ignore_ascii_case("Create") {
                if let Some(reload) = self.program.script("SetMaxReloadTime") {
                    let mut thread = Thread::new(
                        reload,
                        self.program.offsets[reload],
                        0,
                        "SetMaxReloadTime".into(),
                    );
                    thread.data = vec![0];
                    thread.params = 1;
                    self.add(thread)?;
                }
            }
        }
        // A factory waiting for its script to set build stance, which is what
        // starts a build (`Factory.cpp:138-151`). Checked before the spraying
        // block below, so the frame the stance is seen is also the first frame
        // that sprays.
        if self.model.awaiting_build {
            // A call-in queued later in this same frame, such as `Activate`
            // listed after `factory-build`, needs its first tick before the
            // stance check below, the way the engine-action path above does.
            self.tick_queued_call_ins(start)?;
            if self
                .set_values
                .get(&unitvalue::INBUILDSTANCE)
                .copied()
                .unwrap_or(0)
                != 0
            {
                self.model.awaiting_build = false;
                self.model.building = true;
                self.model.spraying = true;
                self.model.build_start(frame);
                let queued_at = self.threads.len();
                self.start_callin("StartBuilding", &[])?;
                self.tick_queued_call_ins(queued_at)?;
            }
        }
        // After the frame's call-ins and before its threads, because the engine
        // updates builders before scripts tick (`rts/Game/Game.cpp:1782-1798`).
        if self.model.spraying {
            self.tick_queued_call_ins(start)?;
            let answer = if self.model.nano.wants_answer() {
                let piece = self.query_nano_piece()?;
                Some(model_piece(&self.program, piece))
            } else {
                None
            };
            self.model.spray(frame, answer);
        }
        Ok(())
    }

    /// Start a thread for a call-in by name, with these arguments, exactly as
    /// an event naming it would. `false` when the script defines no such
    /// call-in, so a caller can decide what that means to it.
    fn start_callin(&mut self, callin: &str, args: &[f64]) -> Result<bool, String> {
        let Some(function) = self.program.script(callin) else {
            return Ok(false);
        };
        let mut thread = Thread::new(function, self.program.offsets[function], 0, callin.into());
        // Arguments arrive on the stack, the way a call leaves them, and
        // `CREATE_LOCAL_VAR` claims them one at a time.
        thread.data = cob_args(callin, args, self.world.as_ref());
        thread.params = thread.data.len() as i32;
        self.add(thread)?;
        Ok(true)
    }

    /// What the engine does to the stand-in itself: the air transport arm's
    /// attach and detach (`rts/Sim/Units/CommandAI/MobileCAI.cpp:1451-1453,2090-2091`).
    ///
    /// `fire_due` gives every call-in it has queued so far this frame its
    /// first tick, with `tick_queued_call_ins`, before calling this. That is
    /// what makes `BeginTransport` and `TransportDrop` have run before this
    /// acts, the way the engine's own call to each runs its first tick inline
    /// before the next call (`CobInstance.cpp:593`).
    fn engine(&mut self, action: EngineAction) -> Result<(), String> {
        if matches!(action, EngineAction::NanoStart | EngineAction::NanoStop) {
            self.model.spraying = action == EngineAction::NanoStart;
            return Ok(());
        }
        if action == EngineAction::FactoryBuild {
            self.model.awaiting_build = true;
            return Ok(());
        }
        if action == EngineAction::FactoryFinish {
            if self.model.building {
                self.model.building = false;
                self.model.spraying = false;
                let queued_at = self.threads.len();
                self.start_callin("StopBuilding", &[])?;
                self.tick_queued_call_ins(queued_at)?;
            } else if self.model.awaiting_build {
                self.model.awaiting_build = false;
                self.model.note(
                    "The script never set INBUILDSTANCE, so the factory never started building, as in the engine (Factory.cpp:149). Switch on Build stance under Unit values to see it build anyway."
                        .to_string(),
                );
            }
            return Ok(());
        }
        let Some(stand_in) = self.world.as_ref().and_then(|world| world.stand_in) else {
            self.model.note(
                "The scenario has the engine carry the stand-in, and there is no stand-in in the scene."
                    .to_string(),
            );
            return Ok(());
        };
        if action == EngineAction::Attach {
            let piece = self.query_transport(stand_in.height)?;
            self.attach(stand_in.id, piece);
        } else {
            self.model
                .drop_unit(self.frame, stand_in.id, self.world.as_ref());
        }
        Ok(())
    }

    /// Ask `QueryTransport` for the piece to carry the stand-in on, straight
    /// away, the way the engine's `Call` runs a call-in's first tick inline
    /// (`CobInstance.cpp:593`). `fire_due` has already given `BeginTransport`'s
    /// queued thread its first tick when this frame has one, so this sees
    /// whatever it set.
    ///
    /// COB hands it the passenger's height in 65536ths and reads the answer
    /// back out of its first argument (`rts/Sim/Units/Scripts/CobInstance.cpp:363-374`).
    /// The engine's argument array starts with its count, 2, and a script
    /// with no `QueryTransport`, or one that waits rather than finishing in one
    /// tick, leaves it there (`CobInstance.cpp:564-622`). So those answer
    /// script piece 2.
    fn query_transport(&mut self, height: f64) -> Result<i32, String> {
        const UNANSWERED: i32 = 2;
        let Some(function) = self.program.script("QueryTransport") else {
            self.model.note(
                "This script has no QueryTransport call-in, so the stand-in rides script piece 2, which is what the engine answers for it."
                    .to_string(),
            );
            return Ok(UNANSWERED);
        };
        let mut thread = Thread::new(
            function,
            self.program.offsets[function],
            0,
            "QueryTransport".into(),
        );
        thread.data = vec![0, (height * COBSCALE) as i32];
        thread.params = 2;
        self.add(thread)?;
        let index = self.threads.len() - 1;
        self.step_thread(index)?;
        for thread in std::mem::take(&mut self.queued) {
            self.add(thread)?;
        }
        if matches!(self.threads[index].state, State::Dead) {
            return Ok(self.threads[index].data.first().copied().unwrap_or(0));
        }
        // Still running, as the engine leaves it (`CobInstance.cpp:620`).
        self.model.note(
            "QueryTransport waited rather than answering, so the stand-in rides script piece 2, which is what the engine answers for it."
                .to_string(),
        );
        Ok(UNANSWERED)
    }

    /// Ask `QueryNanoPiece` straight away, as the engine's `Call` does.
    ///
    /// The engine seeds its arguments with a count of 1 and a -1, and returns
    /// the first slot (`rts/Sim/Units/Scripts/CobInstance.cpp:411-421`). A
    /// script with no `QueryNanoPiece`, or one that waits, leaves the count
    /// there, so it answers script piece 1.
    fn query_nano_piece(&mut self) -> Result<i32, String> {
        const UNANSWERED: i32 = 1;
        let Some(function) = self.program.script("QueryNanoPiece") else {
            self.model.note(
                "This script has no QueryNanoPiece call-in, so nano sprays from script piece 1, which is what the engine answers for it."
                    .to_string(),
            );
            return Ok(UNANSWERED);
        };
        let mut thread = Thread::new(
            function,
            self.program.offsets[function],
            0,
            "QueryNanoPiece".into(),
        );
        thread.data = vec![-1];
        thread.params = 1;
        self.add(thread)?;
        let index = self.threads.len() - 1;
        self.step_thread(index)?;
        for thread in std::mem::take(&mut self.queued) {
            self.add(thread)?;
        }
        if matches!(self.threads[index].state, State::Dead) {
            return Ok(self.threads[index].data.first().copied().unwrap_or(0));
        }
        self.model.note(
            "QueryNanoPiece waited rather than answering, so nano sprays from script piece 1, which is what the engine answers for it."
                .to_string(),
        );
        Ok(UNANSWERED)
    }

    /// A weapon fires: `FireWeapon`, then `Shot` with its one argument of 0,
    /// then `QueryWeapon` for the muzzle, each call-in's first tick run inline
    /// as the engine's `Call` runs it (`Weapon.cpp:509-511,590-595`,
    /// `CobInstance.cpp:489-493,593`).
    fn fire(&mut self, weapon: u32) -> Result<(), String> {
        let queued_at = self.threads.len();
        self.start_callin(&format!("FireWeapon{weapon}"), &[])?;
        self.tick_queued_call_ins(queued_at)?;
        let queued_at = self.threads.len();
        self.start_callin(&format!("Shot{weapon}"), &[0.0])?;
        self.tick_queued_call_ins(queued_at)?;
        let piece = self.weapon_piece(weapon)?;
        self.model.shot(self.frame, weapon, piece);
        Ok(())
    }

    /// The muzzle piece, as `CWeapon::UpdateWeaponPieces` settles it: what
    /// `QueryWeapon` answers, or the `AimFromWeapon` piece when that is not a
    /// piece (`Weapon.cpp:235-260`).
    ///
    /// The engine only calls this once, at weapon init, and caches the
    /// answer for every later shot (`UpdateWeaponPieces(false)` at
    /// `Weapon.cpp:591`). Asking the script again here at shot time gives the
    /// same piece unless the script's answer changes between init and firing.
    fn weapon_piece(&mut self, weapon: u32) -> Result<Option<usize>, String> {
        let muzzle = self.ask_piece(&format!("QueryWeapon{weapon}"), "the shot")?;
        if let Some(piece) = model_piece(&self.program, muzzle) {
            return Ok(Some(piece));
        }
        let aim_from = self.ask_piece(&format!("AimFromWeapon{weapon}"), "the shot")?;
        Ok(model_piece(&self.program, aim_from))
    }

    /// Ask a call-in for a piece, straight away, as the engine's `Call` does.
    ///
    /// Seeded `[-1]`, one parameter, and the first slot is the answer, the
    /// same shape `QueryNanoPiece` and `QueryTransport` are asked in
    /// (`CobInstance.cpp:437-446`). A script with no call-in of that name, or
    /// one that waits, leaves the seed there, so it answers script piece 1.
    fn ask_piece(&mut self, callin: &str, what: &str) -> Result<i32, String> {
        const UNANSWERED: i32 = 1;
        let Some(function) = self.program.script(callin) else {
            self.model.note(format!(
                "This script has no {callin} call-in, so {what} comes from script piece 1, which is what the engine answers for it."
            ));
            return Ok(UNANSWERED);
        };
        let mut thread = Thread::new(function, self.program.offsets[function], 0, callin.into());
        thread.data = vec![-1];
        thread.params = 1;
        self.add(thread)?;
        let index = self.threads.len() - 1;
        self.step_thread(index)?;
        for thread in std::mem::take(&mut self.queued) {
            self.add(thread)?;
        }
        if matches!(self.threads[index].state, State::Dead) {
            return Ok(self.threads[index].data.first().copied().unwrap_or(0));
        }
        self.model.note(format!(
            "{callin} waited rather than answering, so {what} comes from script piece 1, which is what the engine answers for it."
        ));
        Ok(UNANSWERED)
    }

    /// Ask one call-in for the pieces it names, `PROBE_CALLS` times so a
    /// cycling answer is reported in order, the same shape the Lua probe
    /// reports.
    ///
    /// Each call is asked the way `ask_piece` asks one, seeded `[-1]` and
    /// stepped once, but a probe does not fall back to script piece 1: a
    /// call-in the script lacks, one that waits rather than answering, or one
    /// that names a piece this model does not have all stop the probe with a
    /// note instead.
    ///
    /// The budget and the fatal flag are refilled before each call, the way
    /// `step` refills them once a frame and the Lua probe refills them once a
    /// call, so a call that spends its own budget does not leave the next one
    /// short.
    fn probe_callin(&mut self, callin: &str) -> Probe {
        let Some(function) = self.program.script(callin) else {
            return Probe {
                callin: callin.to_string(),
                pieces: Vec::new(),
                note: Some(format!("This script has no {callin} call-in.")),
            };
        };

        let mut pieces = Vec::new();
        let mut note = None;
        for _ in 0..PROBE_CALLS {
            self.budget = FRAME_INSTRUCTIONS;
            self.fatal = false;
            let mut thread =
                Thread::new(function, self.program.offsets[function], 0, callin.into());
            thread.data = vec![-1];
            thread.params = 1;
            if let Err(error) = self.add(thread) {
                note = Some(error);
                break;
            }
            let index = self.threads.len() - 1;
            let stepped = self.tick_thread(index);
            for queued in std::mem::take(&mut self.queued) {
                let _ = self.add(queued);
            }
            if let Err(error) = stepped {
                // A thread that dies mid-instruction leaves no answer behind,
                // so the error it died on is the useful note, not a claim
                // that whatever is left in its data slot is a bad piece.
                if !self.fatal {
                    self.threads[index].state = State::Dead;
                }
                note = Some(error);
                break;
            }
            if !matches!(self.threads[index].state, State::Dead) {
                note = Some(format!("{callin} waited rather than answering."));
                break;
            }
            let answer = self.threads[index].data.first().copied().unwrap_or(0);
            match model_piece(&self.program, answer) {
                Some(at) => pieces.push(self.model.pieces[at].name.clone()),
                None => {
                    note = Some(format!(
                        "{callin} answered with something that is not a piece of this unit."
                    ));
                    break;
                }
            }
            self.threads.retain(|t| !matches!(t.state, State::Dead));
        }

        Probe {
            callin: callin.to_string(),
            pieces,
            note,
        }
    }

    /// Give a first tick to every call-in thread this frame's `fire_due` has
    /// queued so far, from `start` to wherever the thread list now ends, in
    /// the order they were queued, then leave them exactly as `run_threads`
    /// would find them next.
    ///
    /// The engine runs a call-in's first tick inline before moving on to the
    /// next thing on the same frame (`CobInstance.cpp:593`), which is what
    /// makes `BeginTransport` run before `AttachUnit(QueryTransport(...))`
    /// and `TransportDrop` run before the landing detach
    /// (`MobileCAI.cpp:1451-1453,2090-2091`). Here the queue only adds a
    /// thread to the list, so this ticks it early to match.
    ///
    /// A step runs a thread until it sleeps, waits or dies, never leaving it
    /// `Ready` again, so the later pass in `run_threads` only continues it.
    fn tick_queued_call_ins(&mut self, start: usize) -> Result<(), String> {
        let end = self.threads.len();
        for index in start..end {
            if matches!(self.threads[index].state, State::Ready) {
                self.step_thread(index)?;
                for thread in std::mem::take(&mut self.queued) {
                    self.add(thread)?;
                }
            }
        }
        Ok(())
    }

    fn add(&mut self, thread: Thread) -> Result<(), String> {
        if self.alive() >= MAX_THREADS {
            // The ceiling is what stops a script that starts a thread per frame
            // from hanging, so carrying on past it is the hang it prevents.
            self.fatal = true;
            return Err(format!(
                "this script has more than {MAX_THREADS} threads running at once"
            ));
        }
        self.threads.push(thread);
        Ok(())
    }

    fn alive(&self) -> usize {
        self.threads
            .iter()
            .filter(|thread| !matches!(thread.state, State::Dead))
            .count()
    }

    /// Run every thread that can run, then anything they started, until nothing
    /// is left that can run this frame.
    fn run_threads(&mut self) -> Result<(), String> {
        // A thread that comes back ready every time, on a wait already
        // satisfied, would spin here forever without a ceiling.
        for _ in 0..MAX_THREADS * 4 {
            let Some(index) = self.next_ready() else {
                self.threads.retain(|t| !matches!(t.state, State::Dead));
                return Ok(());
            };
            self.step_thread(index)?;
            for thread in std::mem::take(&mut self.queued) {
                self.add(thread)?;
            }
        }
        Err("this frame's threads never settled: one is waiting on itself".to_string())
    }

    fn next_ready(&self) -> Option<usize> {
        self.threads.iter().position(|thread| match thread.state {
            State::Ready => true,
            // The engine wakes a sleeper once the clock has passed its wake
            // time rather than reached it, so `Sleep(33)` costs two frames.
            State::Sleeping(wake) => wake < self.time,
            _ => false,
        })
    }

    // The stack and program counter, reached by index so a motion opcode can
    // touch the model in the same breath.

    fn push(&mut self, thread: usize, value: i32) {
        self.threads[thread].data.push(value);
    }

    fn pop(&mut self, thread: usize) -> i32 {
        self.threads[thread].data.pop().unwrap_or(0)
    }

    /// The next word, which is an operand rather than an opcode.
    fn word(&mut self, thread: usize) -> Result<i32, String> {
        let pc = self.threads[thread].pc;
        let word = self
            .program
            .code
            .get(pc)
            .copied()
            .ok_or_else(|| self.ran_off_the_end(thread))?;
        self.threads[thread].pc += 1;
        Ok(word as i32)
    }

    fn ran_off_the_end(&self, thread: usize) -> String {
        format!(
            "{}: ran past the end of the script",
            self.threads[thread].origin
        )
    }

    /// Run one thread, and decide what its failing means.
    ///
    /// A thread that walks into something it cannot execute takes itself down
    /// and nothing else, the way the Lua runtime treats a thread that throws
    /// and the way the engine treats both. A unit is several threads and one
    /// of them being wrong is not the others being wrong.
    ///
    /// Running out of instructions is the exception, because the budget is
    /// spent for the whole frame rather than by this thread alone.
    fn step_thread(&mut self, index: usize) -> Result<(), String> {
        match self.tick_thread(index) {
            Ok(()) => Ok(()),
            Err(error) if self.fatal => Err(error),
            Err(error) => {
                self.threads[index].state = State::Dead;
                self.model.note(format!(
                    "{error}. That thread stopped and the rest of the unit carried on."
                ));
                Ok(())
            }
        }
    }

    /// Run one thread until it sleeps, waits or dies.
    fn tick_thread(&mut self, index: usize) -> Result<(), String> {
        self.threads[index].state = State::Ready;
        while matches!(self.threads[index].state, State::Ready) {
            self.budget -= 1;
            if self.budget < 0 {
                self.fatal = true;
                return Err(format!(
                    "{}: this frame ran too long, so a thread is looping without a sleep",
                    self.threads[index].origin
                ));
            }
            let pc = self.threads[index].pc as u32;
            let word = self.word(index)? as u32;
            self.offsets_run.insert(pc);
            self.execute(index, word)?;
        }
        Ok(())
    }
}

/// The model piece a `.cob` piece index means, and whether the model has it.
fn model_piece(program: &Program, piece: i32) -> Option<usize> {
    usize::try_from(piece)
        .ok()
        .and_then(|piece| program.pieces.get(piece).copied())
        .flatten()
}

/// The axis index a COB operand means. COB counts from zero, unlike Lua.
fn axis_of(axis: i32) -> Option<usize> {
    (0..3).contains(&axis).then_some(axis as usize)
}

impl Run {
    /// One instruction. A port of the `switch` in `CCobThread::Tick`.
    fn execute(&mut self, i: usize, word: u32) -> Result<(), String> {
        let op = |name: &str| opcode(name).expect("mnemonic is in the opcode table");

        match word {
            // Stack.
            w if w == op("PUSH_CONSTANT") => {
                let value = self.word(i)?;
                self.push(i, value);
            }
            w if w == op("PUSH_LOCAL_VAR") => {
                let slot = self.word(i)? as usize;
                let at = self.threads[i].frame() + slot;
                let value = self.threads[i].data.get(at).copied().unwrap_or(0);
                self.push(i, value);
            }
            w if w == op("POP_LOCAL_VAR") => {
                let slot = self.word(i)? as usize;
                let value = self.pop(i);
                let at = self.threads[i].frame() + slot;
                if at < self.threads[i].data.len() {
                    self.threads[i].data[at] = value;
                }
            }
            w if w == op("PUSH_STATIC") => {
                let slot = self.word(i)? as usize;
                let value = self.statics.get(slot).copied().unwrap_or(0);
                self.push(i, value);
            }
            w if w == op("POP_STATIC") => {
                let slot = self.word(i)? as usize;
                let value = self.pop(i);
                if let Some(held) = self.statics.get_mut(slot) {
                    *held = value;
                }
            }
            w if w == op("POP_STACK") => {
                self.pop(i);
            }
            // A local var either claims an argument already on the stack or
            // makes itself a fresh zero.
            w if w == op("CREATE_LOCAL_VAR") => {
                if self.threads[i].params == 0 {
                    self.push(i, 0);
                } else {
                    self.threads[i].params -= 1;
                }
            }

            // Arithmetic. Both operands are popped, the second one being the
            // left hand side, so `SUB` and `DIV` are not the other way round.
            w if w == op("ADD") => self.binary(i, |a, b| a.wrapping_add(b)),
            w if w == op("SUB") => self.binary(i, |a, b| a.wrapping_sub(b)),
            w if w == op("MUL") => self.binary(i, |a, b| a.wrapping_mul(b)),
            w if w == op("DIV") => {
                let (a, b) = self.operands(i);
                if b == 0 {
                    // The engine's own answer: a thousand, and carry on.
                    self.model
                        .note("This script divides by zero somewhere.".to_string());
                    self.push(i, 1000);
                } else {
                    self.push(i, a.wrapping_div(b));
                }
            }
            w if w == op("MOD") => {
                let (a, b) = self.operands(i);
                if b == 0 {
                    self.model
                        .note("This script divides by zero somewhere.".to_string());
                    self.push(i, 0);
                } else {
                    self.push(i, a.wrapping_rem(b));
                }
            }
            w if w == op("BITWISE_AND") => self.binary(i, |a, b| a & b),
            w if w == op("BITWISE_OR") => self.binary(i, |a, b| a | b),
            w if w == op("BITWISE_XOR") => self.binary(i, |a, b| a ^ b),
            w if w == op("BITWISE_NOT") => {
                let value = self.pop(i);
                self.push(i, !value);
            }

            // Comparison. `SET_EQUAL` and `SET_NOT_EQUAL` do not care about the
            // order, so the engine pops them the other way and it makes no
            // difference.
            w if w == op("SET_LESS") => self.binary(i, |a, b| i32::from(a < b)),
            w if w == op("SET_LESS_OR_EQUAL") => self.binary(i, |a, b| i32::from(a <= b)),
            w if w == op("SET_GREATER") => self.binary(i, |a, b| i32::from(a > b)),
            w if w == op("SET_GREATER_OR_EQUAL") => self.binary(i, |a, b| i32::from(a >= b)),
            w if w == op("SET_EQUAL") => self.binary(i, |a, b| i32::from(a == b)),
            w if w == op("SET_NOT_EQUAL") => self.binary(i, |a, b| i32::from(a != b)),
            w if w == op("LOGICAL_AND") => self.binary(i, |a, b| i32::from(a != 0 && b != 0)),
            w if w == op("LOGICAL_OR") => self.binary(i, |a, b| i32::from(a != 0 || b != 0)),
            w if w == op("LOGICAL_XOR") => self.binary(i, |a, b| i32::from((a != 0) ^ (b != 0))),
            w if w == op("LOGICAL_NOT") => {
                let value = self.pop(i);
                self.push(i, i32::from(value == 0));
            }

            w if w == op("RAND") => {
                let (low, high) = self.operands(i);
                let span = high.saturating_sub(low).saturating_add(1).max(1);
                let value = low.wrapping_add((self.next_random() % span as u64) as i32);
                self.push(i, value);
            }

            // Motion. Every one of these converts out of COB's fixed point and
            // applies the sign flips `CobInstance.h` labels COBWTF.
            w if w == op("MOVE") => {
                let piece = self.word(i)?;
                let axis = self.word(i)?;
                let dest = self.pop(i);
                let speed = self.pop(i);
                self.do_move(i, piece, axis, dest, speed);
            }
            w if w == op("MOVE_NOW") => {
                let piece = self.word(i)?;
                let axis = self.word(i)?;
                let dest = self.pop(i);
                self.do_move(i, piece, axis, dest, 0);
            }
            w if w == op("TURN") => {
                let dest = self.pop(i);
                let speed = self.pop(i);
                let piece = self.word(i)?;
                let axis = self.word(i)?;
                self.do_turn(i, piece, axis, dest, speed);
            }
            w if w == op("TURN_NOW") => {
                let piece = self.word(i)?;
                let axis = self.word(i)?;
                let dest = self.pop(i);
                self.do_turn(i, piece, axis, dest, 0);
            }
            w if w == op("SPIN") => {
                let piece = self.word(i)?;
                let axis = self.word(i)?;
                let speed = self.pop(i);
                let accel = self.pop(i);
                if let (Some(piece), Some(axis)) =
                    (model_piece(&self.program, piece), axis_of(axis))
                {
                    // A spin about z turns the other way, which is the flip a
                    // turn about z gets on its destination instead.
                    let speed = if axis == 2 { -speed } else { speed };
                    self.model.spin(
                        piece,
                        axis,
                        f64::from(speed) * TAANG2RAD,
                        f64::from(accel) * TAANG2RAD,
                    );
                }
            }
            w if w == op("STOP_SPIN") => {
                let piece = self.word(i)?;
                let axis = self.word(i)?;
                let decel = self.pop(i);
                if let (Some(piece), Some(axis)) =
                    (model_piece(&self.program, piece), axis_of(axis))
                {
                    self.model
                        .stop_spin(piece, axis, f64::from(decel) * TAANG2RAD);
                }
            }
            w if w == op("SHOW") || w == op("HIDE") => {
                let hide = word == op("HIDE");
                let piece = self.word(i)?;
                if let Some(piece) = model_piece(&self.program, piece) {
                    let function = self.threads[i].calls.last().map(|call| call.function);
                    let in_fire = function.is_some_and(|f| self.fire_functions.contains(&f));
                    if !hide && in_fire {
                        self.model.show_flare(self.frame, piece);
                    } else {
                        self.model.set_hidden(piece, hide);
                    }
                }
            }
            // Scaling arrived in Recoil and no `.cob` in the wild uses it, but
            // the opcodes exist and stepping over them is better than dying.
            w if w == op("SCALE") => {
                self.word(i)?;
                self.pop(i);
                self.pop(i);
                self.model
                    .note("Scaling a piece does nothing in the preview.".to_string());
            }
            w if w == op("SCALE_NOW") => {
                self.word(i)?;
                self.pop(i);
                self.model
                    .note("Scaling a piece does nothing in the preview.".to_string());
            }

            // Waiting.
            w if w == op("SLEEP") => {
                let ms = self.pop(i);
                self.threads[i].state = State::Sleeping(self.time + i64::from(ms));
            }
            w if w == op("WAIT_FOR_TURN") || w == op("WAIT_FOR_MOVE") => {
                let kind = if word == op("WAIT_FOR_TURN") {
                    Wait::Turn
                } else {
                    Wait::Move
                };
                let piece = self.word(i)?;
                let axis = self.word(i)?;
                let piece = model_piece(&self.program, piece);
                let Some(axis) = axis_of(axis) else {
                    return Ok(());
                };
                // Nothing to wait for costs nothing at all rather than a frame.
                if piece.is_some_and(|piece| self.model.animating(piece, axis, kind)) {
                    self.threads[i].state = State::Waiting { piece, axis, kind };
                }
            }
            w if w == op("WAIT_FOR_SCALE") => {
                self.word(i)?;
            }

            // Flow control.
            w if w == op("JUMP") => {
                self.threads[i].pc = self.word(i)? as usize;
            }
            w if w == op("JUMP_NOT_EQUAL") => {
                let target = self.word(i)? as usize;
                if self.pop(i) == 0 {
                    self.threads[i].pc = target;
                }
            }
            w if w == op("RETURN") => {
                self.pop(i);
                let call = self.threads[i].calls.pop();
                match call {
                    // The frame that is returning says how much of the stack to
                    // drop, not the one being returned to. Reading it off the
                    // caller instead takes the caller's own locals with it, and
                    // a unit whose walk loop calls out to a stand script then
                    // stands there doing nothing.
                    Some(Call {
                        ret: Some(ret),
                        stack_top,
                        ..
                    }) => {
                        self.threads[i].pc = ret;
                        self.threads[i].data.truncate(stack_top);
                    }
                    _ => self.threads[i].state = State::Dead,
                }
            }
            w if w == op("CALL_SCRIPT") || w == op("REAL_CALL") => {
                let function = self.word(i)? as usize;
                let args = self.word(i)? as usize;
                // A `.cob` names a Lua call-out with a `lua_` prefix, which is
                // the engine's own test for one. Nothing here answers it.
                if self.is_lua_call(function) {
                    self.lua_call(i, args);
                    return Ok(());
                }
                self.call(i, function, args);
            }
            w if w == op("LUA_CALL") => {
                let _ = self.word(i)?;
                let args = self.word(i)? as usize;
                self.lua_call(i, args);
            }
            w if w == op("START_SCRIPT") => {
                let function = self.word(i)? as usize;
                let args = self.word(i)? as usize;
                self.start_thread(i, function, args);
            }
            w if w == op("SIGNAL") => {
                let signal = self.pop(i) as u32;
                self.signal(signal);
            }
            w if w == op("SET_SIGNAL_MASK") => {
                self.threads[i].mask = self.pop(i) as u32;
            }

            // Asking about a world the preview does not have.
            w if w == op("GET_UNIT_VALUE") => {
                let id = self.pop(i);
                let value = self.unit_value(i, id, 0, 0);
                self.push(i, value);
            }
            w if w == op("GET") => {
                let p4 = self.pop(i);
                let p3 = self.pop(i);
                let p2 = self.pop(i);
                let p1 = self.pop(i);
                let id = self.pop(i);
                let _ = (p3, p4);
                let value = self.unit_value(i, id, p1, p2);
                self.push(i, value);
            }
            w if w == op("SET") => {
                let value = self.pop(i);
                let id = self.pop(i);
                if (LUA0..=LUA9).contains(&id) {
                    self.threads[i].lua[(id - LUA0) as usize] = value;
                } else {
                    if unitvalue::removed_shared(id) {
                        self.model.note(format!(
                            "This script sets shared value {id}, which the preview keeps, but the engine no longer keeps shared values, so the game ignores it unless the script is converted to Lua."
                        ));
                    }
                    // Kept rather than dropped, so a script that stores its own
                    // state in a unit value reads back what it wrote.
                    self.set_values.insert(id, value);
                }
            }

            // What a script announces. Each is recorded on the frame it
            // happens, for the scrubber, and none is drawn.
            w if w == op("EMIT_SFX") => {
                let sfx = self.pop(i);
                let piece = self.word(i)?;
                match model_piece(&self.program, piece) {
                    Some(at) => self.model.emit_sfx(self.frame, at, sfx),
                    None => self.model.no_such_piece("emit-sfx", i64::from(piece)),
                }
            }
            w if w == op("EXPLODE") => {
                let piece = self.word(i)?;
                let flags = self.pop(i);
                match model_piece(&self.program, piece) {
                    Some(at) => self.model.explode(self.frame, at, flags),
                    None => self.model.no_such_piece("explode", i64::from(piece)),
                }
            }
            w if w == op("PLAY_SOUND") => {
                let index = self.word(i)?;
                self.pop(i);
                let name = usize::try_from(index)
                    .ok()
                    .and_then(|at| self.program.sounds.get(at))
                    .cloned();
                if name.is_none() {
                    self.model.note(format!(
                        "This script plays sound {index}, and the file names no sound {index}, so the scrubber cannot say which."
                    ));
                }
                self.model.play_sound(self.frame, name);
            }
            // Popped in the engine's order: a third operand nothing reads, then
            // the piece, then the unit (`CobThread.cpp:677-682`).
            w if w == op("ATTACH_UNIT") => {
                self.pop(i);
                let piece = self.pop(i);
                let unit = self.pop(i);
                self.attach(unit, piece);
            }
            w if w == op("DROP_UNIT") => {
                let unit = self.pop(i);
                self.model.drop_unit(self.frame, unit, self.world.as_ref());
            }

            // Renderer hints with one operand each, which the engine also
            // reads and discards.
            w if w == op("CACHE")
                || w == op("DONT_CACHE")
                || w == op("SHADE")
                || w == op("DONT_SHADE") =>
            {
                self.word(i)?;
            }

            _ => {
                return Err(format!(
                    "{}: {:08x} is not an instruction this understands",
                    self.threads[i].origin, word
                ))
            }
        }
        Ok(())
    }

    /// The two operands of a binary opcode, left hand side first. Both are
    /// popped, and the one popped second was pushed first.
    fn operands(&mut self, i: usize) -> (i32, i32) {
        let right = self.pop(i);
        let left = self.pop(i);
        (left, right)
    }

    fn binary(&mut self, i: usize, f: impl Fn(i32, i32) -> i32) {
        let (left, right) = self.operands(i);
        self.push(i, f(left, right));
    }

    fn do_move(&mut self, _i: usize, piece: i32, axis: i32, dest: i32, speed: i32) {
        let (Some(piece), Some(axis)) = (model_piece(&self.program, piece), axis_of(axis)) else {
            return;
        };
        // A move along x goes the other way, which is the first of the engine's
        // three sign flips.
        let dest = if axis == 0 { -dest } else { dest };
        self.model.r#move(
            piece,
            axis,
            f64::from(dest) / COBSCALE,
            f64::from(speed) / COBSCALE,
        );
    }

    fn do_turn(&mut self, _i: usize, piece: i32, axis: i32, dest: i32, speed: i32) {
        let (Some(piece), Some(axis)) = (model_piece(&self.program, piece), axis_of(axis)) else {
            return;
        };
        // A turn about z goes the other way.
        let dest = if axis == 2 { -dest } else { dest };
        self.model.turn(
            piece,
            axis,
            f64::from(dest) * TAANG2RAD,
            f64::from(speed) * TAANG2RAD,
        );
    }

    /// A negative piece is the void, and any other has to be one of this
    /// unit's (`rts/Sim/Units/Scripts/UnitScript.cpp:828-835`).
    fn attach(&mut self, unit: i32, piece: i32) {
        let at = if piece < 0 {
            None
        } else {
            let Some(at) = model_piece(&self.program, piece) else {
                self.model.no_such_piece("attach-unit", i64::from(piece));
                return;
            };
            Some(at)
        };
        self.model
            .attach_unit(self.frame, unit, at, self.world.as_ref());
    }

    /// Whether a script is a Lua call-out rather than a script in this file,
    /// which the engine decides from a `lua_` prefix on the name.
    fn is_lua_call(&self, function: usize) -> bool {
        self.program
            .names
            .get(function)
            .is_some_and(|name| name.starts_with("lua_"))
    }

    /// Drop a Lua call's arguments and answer that it failed, which is what the
    /// engine does when there are no Lua rules to call.
    fn lua_call(&mut self, i: usize, args: usize) {
        for _ in 0..args {
            self.pop(i);
        }
        self.threads[i].lua[0] = 0;
        self.model.note(
            "This script calls out to the game's Lua, which the preview does not run.".to_string(),
        );
    }

    /// Call another script in the same file, on the same thread.
    fn call(&mut self, i: usize, function: usize, args: usize) {
        // The engine does not call an empty script at all, and the arguments
        // stay where they are when it does not.
        if self.program.lengths.get(function).copied().unwrap_or(0) == 0 {
            return;
        }
        let stack_top = self.threads[i].data.len().saturating_sub(args);
        let ret = self.threads[i].pc;
        self.threads[i].calls.push(Call {
            ret: Some(ret),
            stack_top,
            function,
        });
        self.threads[i].params = args as i32;
        self.threads[i].pc = self.program.offsets[function];
    }

    /// Start another script on a thread of its own.
    ///
    /// It takes on the signal mask of the thread that started it, so a signal
    /// raised later reaches both, and it does not run until the tick that
    /// started it has finished.
    fn start_thread(&mut self, i: usize, function: usize, args: usize) {
        if self.program.lengths.get(function).copied().unwrap_or(0) == 0 {
            for _ in 0..args {
                self.pop(i);
            }
            return;
        }
        let origin = self.threads[i].origin.clone();
        let mask = self.threads[i].mask;
        let mut thread = Thread::new(function, self.program.offsets[function], mask, origin);
        // The arguments move from the parent's stack to the child's, in the
        // order the engine moves them, which reverses them.
        for _ in 0..args {
            let value = self.pop(i);
            thread.data.push(value);
        }
        self.queued.push(thread);
    }

    /// Kill every thread carrying this mask, the one that raised it included.
    ///
    /// The engine does not spare the raiser, and the idiom in every BOS script
    /// relies on that order: `signal` comes before `set-signal-mask`, so a
    /// thread raises a signal while its own mask is still whatever it was.
    fn signal(&mut self, signal: u32) {
        for thread in &mut self.threads {
            if thread.mask & signal != 0 {
                thread.state = State::Dead;
            }
        }
    }

    /// What a script gets when it asks about its unit.
    ///
    /// The arithmetic call-outs are answered exactly, because they are
    /// arithmetic: a `.cob` has no sine, no square root and no absolute value
    /// of its own, so a script wanting one asks for it here. Those come first,
    /// because none of them is about the unit and none can be set.
    ///
    /// Everything after that is about the unit, and then about a world the
    /// preview has none of, which is zero and a note.
    fn unit_value(&mut self, i: usize, id: i32, p1: i32, p2: i32) -> i32 {
        unitvalue::note_asked(&mut self.asked, id);
        if (LUA0..=LUA9).contains(&id) {
            return self.threads[i].lua[(id - LUA0) as usize];
        }
        if let Some(value) = unitvalue::arithmetic(id, p1, p2) {
            return value;
        }
        if unitvalue::removed_shared(id) {
            self.model.note(format!(
                "This script asks for shared value {id}, and the engine no longer keeps shared values, so it reads 0 in the game unless the script is converted to Lua."
            ));
            return self.set_values.get(&id).copied().unwrap_or(0);
        }
        if id == GAME_FRAME {
            return self.frame as i32;
        }
        // Where a piece is, which the model knows once somebody has said where
        // its pieces sit. The unit stands at the origin facing forwards, so a
        // piece's place in the unit is also its place in the world, which is
        // what the engine answers with.
        if id == PIECE_XZ || id == PIECE_Y {
            // Counted from 0, as every other piece a `.cob` names is.
            let at = model_piece(&self.program, p1).and_then(|at| self.model.piece_position(at));
            let Some(at) = at else {
                self.model.note(
                    "This script asks where one of its pieces is, and the preview was not told where this unit's pieces sit.".to_string(),
                );
                return 0;
            };
            return if id == PIECE_Y {
                (at[1] * COBSCALE) as i32
            } else {
                pack_xz(at[0], at[2])
            };
        }
        // Where a unit is and how big, from the scene the latest event brought.
        // Before the stored values, because a script cannot set these.
        if let Some(answer) = unitvalue::world(
            id,
            p1,
            self.world.as_ref(),
            self.model.passenger.at(),
            self.model.awaiting_build,
        ) {
            if let Some(note) = answer.note {
                self.model.note(note);
            }
            return answer.value;
        }
        if let Some(value) = self.set_values.get(&id) {
            return *value;
        }
        // Shared with the Lua runtime, which is asked the same questions by the
        // same numbers and has to give the same answers.
        if let Some(value) = unitvalue::known(id) {
            return value;
        }
        self.model.note(format!(
            "This script asks the world for value {id}, and the preview has no world to ask."
        ));
        0
    }

    /// A deterministic pseudo-random number, so the same preview plays the same
    /// way twice.
    fn next_random(&mut self) -> u64 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        self.rng
    }
}

#[cfg(test)]
#[path = "cobrun_tests.rs"]
mod tests;
