use std::collections::HashSet;
use std::io::BufRead;

use serde_json::Value;

pub struct Matcher {
    wallets: HashSet<String>,
}

impl Matcher {
    pub fn new(wallets: HashSet<String>) -> Self {
        Self { wallets }
    }

    /// Returns true if the line's tradersInvolved contains any tracked wallet.
    /// Also filters non-buy/sell txTypes and empty trader sets.
    /// Only does serde parse on lines that contain "tradersInvolved" (fast pre-filter).
    pub fn matches(&self, line: &[u8]) -> bool {
        // Fast pre-filter: skip lines without "tradersInvolved"
        if !contains_subsequence(line, b"\"tradersInvolved\"") {
            return false;
        }
        // Fast pre-filter: skip lines without "buy" or "sell" (tx_type check)
        if !contains_subsequence(line, b"\"buy\"") && !contains_subsequence(line, b"\"sell\"") {
            return false;
        }

        let v: Value = match serde_json::from_slice(line) {
            Ok(v) => v,
            Err(_) => return false,
        };

        let tx_type = v.get("txType").and_then(|v| v.as_str()).unwrap_or("");
        if tx_type != "buy" && tx_type != "sell" {
            return false;
        }

        let traders = match v.get("tradersInvolved").and_then(|v| v.as_object()) {
            Some(t) => t,
            None => return false,
        };

        traders.keys().any(|k| self.wallets.contains(k.as_str()))
    }
}

/// KMP-like substring search. Simple and fast enough for short needles.
fn contains_subsequence(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

/// Filter lines from a buffered reader, writing matched lines to the output.
/// Returns (lines_processed, lines_matched).
pub fn filter_stream(
    reader: &mut impl BufRead,
    matcher: &Matcher,
    output: &mut impl std::io::Write,
    progress_every: u64,
    mut on_progress: impl FnMut(u64, u64),
) -> std::io::Result<(u64, u64)> {
    let mut processed: u64 = 0;
    let mut matched: u64 = 0;
    let mut buf = Vec::with_capacity(1024);

    loop {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf)?;
        if n == 0 {
            break;
        }
        let line = &buf[..n];
        let line = if line.ends_with(b"\n") {
            &line[..line.len() - 1]
        } else {
            line
        };
        let line = if line.ends_with(b"\r") {
            &line[..line.len() - 1]
        } else {
            line
        };

        if line.is_empty() {
            continue;
        }

        processed += 1;

        if matcher.matches(line) {
            output.write_all(line)?;
            output.write_all(b"\n")?;
            matched += 1;
        }

        if processed % progress_every == 0 {
            on_progress(processed, matched);
        }
    }

    // Flush any remaining progress
    if processed % progress_every != 0 {
        on_progress(processed, matched);
    }

    Ok((processed, matched))
}
