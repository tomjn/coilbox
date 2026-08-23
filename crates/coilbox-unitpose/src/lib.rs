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

pub mod unitvalue;

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
    /// The call-in's name, such as `Create` or `AimWeapon1`.
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

    /// Close a timeline off: carry the warnings over, and drop the visibility
    /// track when nothing ever used it.
    pub fn finish(&self, timeline: &mut Timeline) {
        timeline.warnings.extend(self.warnings.iter().cloned());
        if !self.visibility_used {
            timeline.hidden.clear();
        }
    }
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
}
