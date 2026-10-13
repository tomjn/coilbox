use std::fmt;

/// Why a track could not be read or written.
#[derive(Debug)]
pub enum TrackError {
    /// The file is in a layout this crate does not read. `field` names the
    /// header field and `found` the value that was in it, the way
    /// `require_known_layout` does for replay headers.
    UnknownLayout {
        field: &'static str,
        found: String,
        expected: String,
    },
    /// A part of the file cannot be read: it is cut short, its zlib stream is
    /// bad, or what it says about itself does not add up. `part` names which
    /// part, so a bad window is an error for that window and no other.
    Corrupt { part: String, reason: String },
    /// A value does not fit the format. The format keeps every value at or
    /// under 16,777,215 so that the engine's 32 bit floats hold it exactly.
    OutOfRange {
        what: String,
        value: i64,
        limit: i64,
    },
    /// What the caller handed to the writer, or asked of the reader, cannot
    /// be used.
    Invalid(String),
    /// The source or the destination failed.
    Io(std::io::Error),
}

impl TrackError {
    pub(crate) fn corrupt(part: impl Into<String>, reason: impl Into<String>) -> Self {
        Self::Corrupt {
            part: part.into(),
            reason: reason.into(),
        }
    }

    pub(crate) fn invalid(reason: impl Into<String>) -> Self {
        Self::Invalid(reason.into())
    }
}

impl fmt::Display for TrackError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownLayout {
                field,
                found,
                expected,
            } => write!(
                f,
                "this is a track in a format coilbox does not read: the header's {field} is {found}, not {expected}"
            ),
            Self::Corrupt { part, reason } => write!(f, "the track's {part} is unreadable: {reason}"),
            Self::OutOfRange { what, value, limit } => write!(
                f,
                "{what} is {value}, which does not fit the track format (the limit is {limit})"
            ),
            Self::Invalid(reason) => f.write_str(reason),
            Self::Io(e) => write!(f, "track input or output failed: {e}"),
        }
    }
}

impl std::error::Error for TrackError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<std::io::Error> for TrackError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

pub type Result<T> = std::result::Result<T, TrackError>;
