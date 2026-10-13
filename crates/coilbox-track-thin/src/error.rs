use coilbox_track::TrackError;
use std::fmt;

/// The recorded sample that is furthest from the track.
#[derive(Debug, Clone, PartialEq)]
pub struct Worst {
    /// In elmos, or as a fraction for health and build progress.
    pub error: f64,
    /// Which curve of which unit or projectile, by name.
    pub what: String,
    pub frame: u32,
}

impl fmt::Display for Worst {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{} at frame {}, off by {}",
            self.what, self.frame, self.error
        )
    }
}

/// Why a dump could not be turned into a track.
#[derive(Debug)]
pub enum ThinError {
    /// The dump cannot be read, or is not a whole recording.
    Dump(String),
    /// The track is further from a recorded sample than the tolerance in its
    /// own header. A track like that is a failed recording.
    OverTolerance {
        tolerance: f64,
        worst: Worst,
    },
    /// The track says something the dump does not, where there is no
    /// tolerance: a target, a build queue, or which frames a unit exists on.
    Mismatch(String),
    /// The track could not be written or read back.
    Track(TrackError),
    Io(std::io::Error),
}

impl fmt::Display for ThinError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Dump(reason) => f.write_str(reason),
            Self::OverTolerance { tolerance, worst } => write!(
                f,
                "the track is further from the recording than its tolerance of {tolerance}: {worst}"
            ),
            Self::Mismatch(reason) => {
                write!(f, "the track does not match the recording: {reason}")
            }
            Self::Track(e) => e.fmt(f),
            Self::Io(e) => write!(f, "reading the dump or writing the track failed: {e}"),
        }
    }
}

impl std::error::Error for ThinError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Track(e) => Some(e),
            Self::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<TrackError> for ThinError {
    fn from(e: TrackError) -> Self {
        Self::Track(e)
    }
}

impl From<std::io::Error> for ThinError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

pub type Result<T> = std::result::Result<T, ThinError>;
