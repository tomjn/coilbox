//! Where the stand-in is once a script has taken hold of it.
//!
//! The engine does not move a passenger when a script attaches it.
//! `CUnit::AttachUnit` records the piece and nothing else
//! (`rts/Sim/Units/Unit.cpp:2635-2712`). Every frame, once every script has
//! ticked, `UpdateTransportees` moves each passenger onto its piece
//! (`rts/Game/Game.cpp:1796-1798`, `Unit.cpp:718-757`). So a script that reads
//! its passenger straight after attaching it sees where the passenger was.
//!
//! Both runtimes carry the stand-in through this, so a script asking where it
//! is gets the same answer from either.

use crate::Model;

type Vec3 = [f64; 3];

/// What scripts have done with the stand-in, and where that leaves it.
///
/// Every state but `Loose` carries the stand-in's position, because from its
/// first attach the runtime owns where it is. A later event's scene still says
/// how big it is, but no longer where.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum Passenger {
    /// Nothing has attached it. Where it is comes from the scene.
    #[default]
    Loose,
    /// Carried on a piece, by its index in the model.
    Riding { piece: usize, at: Vec3 },
    /// Carried out of sight. A negative piece puts a passenger at the
    /// transporter's own position and in the void, where it is not drawn
    /// (`Unit.cpp:726-732,2672`, `rts/Rendering/Units/UnitDrawer.cpp:418`).
    Void { at: Vec3 },
    /// Let go. A drop does not move it (`Unit.cpp:2715-2780`).
    Released { at: Vec3 },
}

impl Passenger {
    /// Where the stand-in is, or none while it is loose and the scene says.
    pub fn at(&self) -> Option<Vec3> {
        match *self {
            Self::Loose => None,
            Self::Riding { at, .. } | Self::Void { at } | Self::Released { at } => Some(at),
        }
    }

    /// Carry it on `piece`, or in the void when there is none.
    ///
    /// It stays where it is until [`Passenger::after_frame`] moves it.
    /// `loose_at` is where the scene has it, for a stand-in nothing has held
    /// yet. One the scene puts nowhere starts from the origin.
    pub fn attach(&mut self, piece: Option<usize>, loose_at: Option<Vec3>) {
        let at = self.at().or(loose_at).unwrap_or([0.0; 3]);
        *self = match piece {
            Some(piece) => Self::Riding { piece, at },
            None => Self::Void { at },
        };
    }

    /// Let it go where it is. A stand-in nobody is carrying is not let go
    /// again, as `DetachUnitCore` refuses a unit it is not carrying
    /// (`Unit.cpp:2715-2720`).
    pub fn release(&mut self) {
        if let Self::Riding { at, .. } | Self::Void { at } = *self {
            *self = Self::Released { at };
        }
    }

    /// Move a carried stand-in onto its piece, once every thread has run this
    /// frame, as `UpdateTransportees` does.
    ///
    /// A model nobody placed has no piece positions, and a riding stand-in
    /// then stays where it was rather than dropping to the origin.
    pub fn after_frame(&mut self, model: &Model) {
        match self {
            Self::Riding { piece, at } => {
                if let Some(now) = model.piece_position(*piece) {
                    *at = now;
                }
            }
            Self::Void { at } => *at = [0.0; 3],
            Self::Loose | Self::Released { .. } => {}
        }
    }
}
