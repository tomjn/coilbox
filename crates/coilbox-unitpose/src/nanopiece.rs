//! Which piece a builder sprays nano from, frame by frame.
//!
//! The engine does not ask `QueryNanoPiece` for ever. `NanoPieceCache` asks it
//! for every particle until it has had more than 30 answers in a row that it
//! already knew, then stops asking and picks at random among the pieces it has
//! seen (`rts/Sim/Misc/NanoPieceCache.cpp:17-50`). A script that alternates
//! between two nozzles sprays from both, before and after it stops being asked.

/// `MAX_QUERYNANOPIECE_CALLS` (`rts/Sim/Misc/NanoPieceCache.h:39`).
pub const MAX_QUERYNANOPIECE_CALLS: u32 = 30;

#[derive(Debug, Clone, Default)]
pub struct NanoPieces {
    /// Model piece indices, in the order they were first answered.
    cached: Vec<usize>,
    /// Answers in a row that were already cached or named no piece, the
    /// engine's `lastNanoPieceCnt`.
    repeats: u32,
}

impl NanoPieces {
    /// Whether the engine would still call `QueryNanoPiece` for this particle.
    pub fn wants_answer(&self) -> bool {
        self.repeats <= MAX_QUERYNANOPIECE_CALLS
    }

    /// The piece this frame's particle comes from. `answer` is none when the
    /// call-in was not asked, and `Some(None)` when it was asked and named no
    /// piece of this unit.
    pub fn next(&mut self, frame: u32, answer: Option<Option<usize>>) -> Option<usize> {
        let mut piece = if self.cached.is_empty() {
            None
        } else {
            Some(self.cached[pick(frame, self.cached.len())])
        };
        match answer {
            None => {}
            Some(None) => self.repeats += 1,
            Some(Some(answered)) => {
                piece = Some(answered);
                if self.cached.contains(&answered) {
                    self.repeats += 1;
                } else {
                    self.cached.push(answered);
                    self.repeats = 0;
                }
            }
        }
        piece
    }
}

/// The engine's `gsRNG.NextInt(len)`, made a function of the frame so every
/// run of a preview picks the same.
fn pick(frame: u32, len: usize) -> usize {
    let mut x = u64::from(frame)
        .wrapping_add(1)
        .wrapping_mul(0x9E37_79B9_7F4A_7C15);
    x ^= x >> 31;
    x = x.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    x ^= x >> 29;
    (x % len as u64) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two new answers, then 31 known ones, because the engine asks while
    /// its count is at most 30 (`NanoPieceCache.cpp:29`).
    #[test]
    fn asks_until_thirty_one_known_answers_in_a_row_then_stops() {
        let mut cache = NanoPieces::default();
        let mut asked = 0;
        for frame in 0..100 {
            if cache.wants_answer() {
                asked += 1;
                cache.next(frame, Some(Some((frame % 2) as usize)));
            } else {
                cache.next(frame, None);
            }
        }
        assert_eq!(asked, 33);
    }

    #[test]
    fn once_it_stops_asking_it_picks_only_pieces_it_saw() {
        let mut cache = NanoPieces::default();
        for frame in 0..40 {
            let answer = cache
                .wants_answer()
                .then_some(Some(1 + (frame % 2) as usize));
            cache.next(frame, answer);
        }
        assert!(!cache.wants_answer());
        let picked: Vec<Option<usize>> = (40..140).map(|frame| cache.next(frame, None)).collect();
        assert!(picked
            .iter()
            .all(|piece| matches!(piece, Some(1) | Some(2))));
        assert!(picked.contains(&Some(1)));
        assert!(picked.contains(&Some(2)));
    }

    /// `SafeGetPiece` failing leaves the random cached piece, or none
    /// (`NanoPieceCache.cpp:21-27,44-46`).
    #[test]
    fn an_answer_naming_no_piece_falls_back_to_the_cache_or_nothing() {
        let mut cache = NanoPieces::default();
        assert_eq!(cache.next(0, Some(None)), None);
        cache.next(1, Some(Some(2)));
        assert_eq!(cache.next(2, Some(None)), Some(2));
    }

    #[test]
    fn the_pick_is_the_same_on_every_run() {
        let run = || {
            let mut cache = NanoPieces::default();
            cache.next(0, Some(Some(0)));
            cache.next(1, Some(Some(1)));
            cache.next(2, Some(Some(2)));
            (3..50)
                .map(|frame| cache.next(frame, None))
                .collect::<Vec<_>>()
        };
        assert_eq!(run(), run());
    }
}
