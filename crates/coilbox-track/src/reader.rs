//! The reader: the header and index first, then one window at a time.

use crate::chunk::{decompress, Chunk};
use crate::error::{Result, TrackError};
use crate::header::*;
use crate::keys::*;
use crate::meta;
use crate::quant::{Quantiser, VALUE_LIMIT};
use crate::terrain;
use crate::window::{FrameState, Window};
use std::io::{Read, Seek, SeekFrom};

/// A track opened for reading. Opening reads the header and the window index
/// and nothing else. Each other call reads the one chunk it needs.
///
/// A chunk that is cut short or fails its checksum is an error for the call
/// that asked for it. The header, the index and every other chunk still read.
pub struct TrackReader<R> {
    source: R,
    header: Header,
    entries: Vec<WindowEntry>,
    loaded: Option<Window>,
}

/// Puts a window's number in front of what a chunk error names.
fn in_window(e: TrackError, k: usize, what: &str) -> TrackError {
    match e {
        TrackError::Corrupt { part, reason } => TrackError::Corrupt {
            part: format!("window {k} {what} ({part})"),
            reason,
        },
        other => other,
    }
}

impl<R: Read + Seek> TrackReader<R> {
    pub fn open(mut source: R) -> Result<Self> {
        source.seek(SeekFrom::Start(0))?;
        let mut fixed = [0u8; HEADER_SIZE];
        read_all(&mut source, &mut fixed, "header")?;
        let header = Header::decode(&fixed)?;

        source.seek(SeekFrom::Start(header.header_size as u64))?;
        let mut index = vec![0u8; INDEX_ENTRY_SIZE * header.window_count as usize];
        read_all(&mut source, &mut index, "window index")?;
        let entries = index
            .as_chunks::<INDEX_ENTRY_SIZE>()
            .0
            .iter()
            .map(|e| WindowEntry::decode(e))
            .collect();
        Ok(Self {
            source,
            header,
            entries,
            loaded: None,
        })
    }

    pub fn header(&self) -> &Header {
        &self.header
    }

    pub fn quantiser(&self) -> Result<Quantiser> {
        self.header.quantiser()
    }

    /// Where each window's chunks are.
    pub fn window_entries(&self) -> &[WindowEntry] {
        &self.entries
    }

    pub fn into_inner(self) -> R {
        self.source
    }

    /// Reads and inflates the chunk at `at`.
    fn chunk_at(&mut self, at: Extent, part: &str) -> Result<Chunk> {
        let bad = |reason: String| TrackError::corrupt(part, reason);
        if at.length == 0 {
            return Err(bad("it is not in the file".into()));
        }
        if at.length as i64 > VALUE_LIMIT || at.block as i64 > VALUE_LIMIT {
            return Err(bad(format!(
                "the index puts it at block {} with length {}",
                at.block, at.length
            )));
        }
        self.source.seek(SeekFrom::Start(at.offset()))?;
        let mut packed = Vec::new();
        (&mut self.source)
            .take(at.length as u64)
            .read_to_end(&mut packed)?;
        if packed.len() < at.length as usize {
            return Err(bad(format!(
                "the file ends {} bytes into it, before its {} bytes",
                packed.len(),
                at.length
            )));
        }
        Chunk::decode(&decompress(&packed)?)
    }

    pub fn info(&mut self) -> Result<Info> {
        let at = self.header.info;
        meta::decode_info(&self.chunk_at(at, "info chunk")?)
    }

    pub fn features(&mut self) -> Result<Vec<Feature>> {
        let at = self.header.features;
        meta::decode_features(&self.chunk_at(at, "features chunk")?)
    }

    fn entry(&self, k: usize) -> Result<WindowEntry> {
        self.entries.get(k).copied().ok_or_else(|| {
            TrackError::invalid(format!(
                "there is no window {k}, only {}",
                self.entries.len()
            ))
        })
    }

    /// Window `k`'s main chunk as columns, for a caller that wants the
    /// arrays and not the keys.
    pub fn window_chunk(&mut self, k: usize) -> Result<Chunk> {
        let at = self.entry(k)?.main;
        self.chunk_at(at, "main chunk")
            .map_err(|e| in_window(e, k, "main chunk"))
    }

    /// Window `k`, with its units and projectiles. Terrain and features are
    /// not part of it.
    pub fn window(&mut self, k: usize) -> Result<Window> {
        let chunk = self.window_chunk(k)?;
        let (start, end) = self.header.window_bounds(k as u32);
        Window::from_chunk(&chunk, k, start, end).map_err(|e| in_window(e, k, "main chunk"))
    }

    /// The terrain rows of window `k`, or none if no terrain changed in it.
    pub fn terrain(&mut self, k: usize) -> Result<Vec<TerrainRow>> {
        let at = self.entry(k)?.terrain;
        if at.length == 0 {
            return Ok(vec![]);
        }
        let chunk = self
            .chunk_at(at, "terrain chunk")
            .map_err(|e| in_window(e, k, "terrain chunk"))?;
        let (start, _) = self.header.window_bounds(k as u32);
        terrain::decode(&chunk, start).map_err(|e| in_window(e, k, "terrain chunk"))
    }

    /// Every unit and projectile at `frame`. The window that holds it is read
    /// if it is not the one already loaded.
    pub fn sample(&mut self, frame: u32) -> Result<FrameState> {
        let k = self.header.window_of_frame(frame) as usize;
        if self.loaded.as_ref().map(|w| w.index) != Some(k) {
            self.loaded = Some(self.window(k)?);
        }
        let q = self.quantiser()?;
        self.loaded
            .as_ref()
            .expect("loaded above")
            .sample(frame, &q)
    }
}

/// Fills `buf`, naming `part` if the file ends first.
fn read_all(source: &mut impl Read, buf: &mut [u8], part: &str) -> Result<()> {
    source.read_exact(buf).map_err(|e| match e.kind() {
        std::io::ErrorKind::UnexpectedEof => TrackError::corrupt(
            part,
            format!("the file ends before its {} bytes", buf.len()),
        ),
        _ => TrackError::Io(e),
    })
}
