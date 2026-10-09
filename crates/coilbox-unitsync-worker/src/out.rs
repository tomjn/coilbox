//! Where a mode's output goes: standard output for a one-shot worker, and a
//! buffer for a worker that stays running (issue #3722).
//!
//! Every mode ends by printing its JSON with `println!`. A one-shot worker's
//! standard output is that JSON and nothing else. A running worker's is a stream
//! of replies, and each has to be sent as a frame with its length, so what a
//! mode prints is collected first.
//!
//! `main.rs` defines its own `println!` over [`line`], ahead of every module, so
//! each of those prints lands here without being rewritten, and so does the
//! next one somebody adds.

use std::cell::RefCell;
use std::fmt::Arguments;
use std::io::Write;

thread_local! {
    static COLLECTING: RefCell<Option<Vec<u8>>> = const { RefCell::new(None) };
}

/// Print one line, to the buffer when [`collect`] is running on this thread and
/// to standard output otherwise.
pub fn line(args: Arguments) {
    let collected = COLLECTING.with(|c| match c.borrow_mut().as_mut() {
        Some(buffer) => {
            let _ = writeln!(buffer, "{args}");
            true
        }
        None => false,
    });
    if !collected {
        std::println!("{args}");
    }
}

/// Run `f`, returning what it returned and everything it printed.
pub fn collect<T>(f: impl FnOnce() -> T) -> (T, Vec<u8>) {
    COLLECTING.with(|c| *c.borrow_mut() = Some(Vec::new()));
    let result = f();
    let printed = COLLECTING
        .with(|c| c.borrow_mut().take())
        .unwrap_or_default();
    (result, printed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_a_mode_prints_is_collected() {
        let (code, printed) = collect(|| {
            println!("{}", "{\"maps\":[]}");
            println!("second {}", 2);
            7
        });
        assert_eq!(code, 7);
        assert_eq!(printed, b"{\"maps\":[]}\nsecond 2\n");
    }

    #[test]
    fn each_request_gets_only_its_own_output() {
        let (_, first) = collect(|| println!("first"));
        let (_, second) = collect(|| println!("second"));
        assert_eq!(first, b"first\n");
        assert_eq!(second, b"second\n");
    }
}
