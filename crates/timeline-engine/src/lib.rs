//! `timeline-engine` — foundation scaffold.
//!
//! Deterministic, pure timeline primitives mirroring the TypeScript
//! `editor-state` rules: rationals and half-open microsecond intervals. No
//! clock, randomness, or I/O — the same determinism contract the reducers obey.

#![forbid(unsafe_code)]

/// A rational number with positive numerator and denominator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rational {
    numerator: u64,
    denominator: u64,
}

impl Rational {
    /// Construct a rational. Returns `None` when either term is zero.
    #[must_use]
    pub const fn new(numerator: u64, denominator: u64) -> Option<Self> {
        if numerator == 0 || denominator == 0 {
            None
        } else {
            Some(Self {
                numerator,
                denominator,
            })
        }
    }

    #[must_use]
    pub const fn numerator(self) -> u64 {
        self.numerator
    }

    #[must_use]
    pub const fn denominator(self) -> u64 {
        self.denominator
    }

    /// Reduce to lowest terms.
    #[must_use]
    pub const fn reduced(self) -> Self {
        let g = gcd(self.numerator, self.denominator);
        Self {
            numerator: self.numerator / g,
            denominator: self.denominator / g,
        }
    }
}

const fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        let t = b;
        b = a % b;
        a = t;
    }
    a
}

/// A half-open microsecond interval `[start, start + duration)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Interval {
    start: u64,
    duration: u64,
}

impl Interval {
    #[must_use]
    pub const fn new(start: u64, duration: u64) -> Self {
        Self { start, duration }
    }

    #[must_use]
    pub const fn end(self) -> u64 {
        self.start + self.duration
    }

    /// True when two intervals overlap under half-open semantics. Adjacent
    /// intervals (one's end equal to the other's start) do **not** overlap.
    #[must_use]
    pub const fn overlaps(self, other: Interval) -> bool {
        self.start < other.end() && other.start < self.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rational_rejects_zero_terms() {
        assert!(Rational::new(0, 1).is_none());
        assert!(Rational::new(1, 0).is_none());
        assert!(Rational::new(30, 1).is_some());
    }

    #[test]
    fn rational_reduces() {
        let r = Rational::new(30000, 1000).unwrap().reduced();
        assert_eq!(r, Rational::new(30, 1).unwrap());
    }

    #[test]
    fn half_open_intervals_allow_adjacency() {
        let a = Interval::new(0, 1_000_000);
        let b = Interval::new(1_000_000, 1_000_000);
        assert!(!a.overlaps(b), "adjacent intervals must not overlap");
    }

    #[test]
    fn overlapping_intervals_are_detected() {
        let a = Interval::new(0, 1_000_000);
        let b = Interval::new(999_999, 1_000_000);
        assert!(a.overlaps(b));
        assert!(b.overlaps(a));
    }
}
