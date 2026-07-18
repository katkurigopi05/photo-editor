//! `project-store` — foundation scaffold.
//!
//! Provider-independent persistence primitives mirroring the TypeScript
//! `editor-state` contract: a canonical microsecond string type and an
//! in-memory operation-log store that never shares references with callers. No
//! database, no I/O beyond memory.

#![forbid(unsafe_code)]

/// Errors from parsing a canonical microsecond string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MicrosecondsError {
    /// The string was empty, had a leading zero, a sign, or non-digit content.
    NotCanonical,
}

/// A nonnegative integer count of microseconds. Serializes to a canonical
/// decimal string matching `^(0|[1-9][0-9]*)$`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Microseconds(u64);

impl Microseconds {
    #[must_use]
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn get(self) -> u64 {
        self.0
    }

    /// Parse a canonical decimal string. Rejects empty input, leading zeros
    /// (other than the single "0"), signs, whitespace, and non-digits.
    ///
    /// # Errors
    /// Returns [`MicrosecondsError::NotCanonical`] when the input is not a
    /// canonical nonnegative-integer decimal string.
    pub fn parse(input: &str) -> Result<Self, MicrosecondsError> {
        if input.is_empty() {
            return Err(MicrosecondsError::NotCanonical);
        }
        if input != "0" && input.starts_with('0') {
            return Err(MicrosecondsError::NotCanonical);
        }
        if !input.bytes().all(|b| b.is_ascii_digit()) {
            return Err(MicrosecondsError::NotCanonical);
        }
        input
            .parse::<u64>()
            .map(Self)
            .map_err(|_| MicrosecondsError::NotCanonical)
    }

    /// Format as a canonical decimal string.
    #[must_use]
    pub fn to_canonical_string(self) -> String {
        self.0.to_string()
    }
}

/// A provider-independent persistence contract for the serialized operation
/// log (the source of truth). Loads and saves never share mutable references
/// with callers.
pub trait OperationLogStore {
    /// Persist the serialized operation log.
    fn save(&mut self, serialized: &[u8]);
    /// Load the serialized operation log, or `None` if nothing was saved.
    fn load(&self) -> Option<Vec<u8>>;
}

/// In-memory store for tests. Copies bytes on save and load, so stored data
/// never aliases caller-owned buffers.
#[derive(Debug, Default)]
pub struct InMemoryOperationLogStore {
    data: Option<Vec<u8>>,
}

impl InMemoryOperationLogStore {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }
}

impl OperationLogStore for InMemoryOperationLogStore {
    fn save(&mut self, serialized: &[u8]) {
        self.data = Some(serialized.to_vec());
    }

    fn load(&self) -> Option<Vec<u8>> {
        self.data.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_canonical_strings() {
        assert_eq!(Microseconds::parse("0").unwrap().get(), 0);
        assert_eq!(Microseconds::parse("1000000").unwrap().get(), 1_000_000);
    }

    #[test]
    fn rejects_non_canonical_strings() {
        for bad in ["", "01", "-1", "1.5", " 1", "1 ", "+1", "0x10"] {
            assert_eq!(
                Microseconds::parse(bad),
                Err(MicrosecondsError::NotCanonical),
                "expected {bad:?} to be rejected",
            );
        }
    }

    #[test]
    fn round_trips_canonical_string() {
        let us = Microseconds::new(42);
        assert_eq!(us.to_canonical_string(), "42");
        assert_eq!(Microseconds::parse("42").unwrap(), us);
    }

    #[test]
    fn in_memory_store_copies_on_save_and_load() {
        let mut store = InMemoryOperationLogStore::new();
        let mut buffer = b"[]".to_vec();
        store.save(&buffer);
        buffer.clear(); // mutate caller buffer after save
        let loaded = store.load().expect("something was saved");
        assert_eq!(loaded, b"[]");
    }
}
