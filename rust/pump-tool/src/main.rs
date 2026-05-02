mod matcher;
mod wallet;

use std::fs::{self, File};
use std::io::{BufReader, Write};
use std::path::PathBuf;

use clap::Parser;
use matcher::Matcher;

#[derive(Parser)]
#[command(name = "pump-tool", about = "Fast ZSTD-decoded JSONL filter for Solana wallet trade data")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(clap::Subcommand)]
enum Command {
    /// Process cached .jsonl.zst files and output matched trades
    Process {
        /// Directory containing YYYY-MM-DD_HH.jsonl.zst files
        #[arg(long)]
        cache_dir: PathBuf,

        /// File with one wallet address per line
        #[arg(long)]
        wallets_file: PathBuf,

        /// Start date filter, e.g. "2026-04-22 00" (inclusive)
        #[arg(long)]
        start: Option<String>,

        /// End date filter, e.g. "2026-05-01 23" (inclusive)
        #[arg(long)]
        end: Option<String>,
    },
}

struct CacheFile {
    path: PathBuf,
    hour_key: String,
    date: DateParts,
}

#[derive(Debug, PartialEq, Eq, PartialOrd, Ord)]
struct DateParts {
    year: u16,
    month: u8,
    day: u8,
    hour: u8,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Command::Process {
            cache_dir,
            wallets_file,
            start,
            end,
        } => process(&cache_dir, &wallets_file, start.as_deref(), end.as_deref()),
    }
}

fn process(
    cache_dir: &PathBuf,
    wallets_file: &PathBuf,
    start: Option<&str>,
    end: Option<&str>,
) -> anyhow::Result<()> {
    let wallets = wallet::load(wallets_file)?;
    eprintln!("{{\"type\":\"wallet_count\",\"count\":{}}}", wallets.len());

    let mut files = list_cache_files(cache_dir)?;
    if files.is_empty() {
        anyhow::bail!("no .jsonl.zst files found in {}", cache_dir.display());
    }

    // Apply date range filter
    if let Some(s) = start {
        let dp = parse_date_spec(s)?;
        files.retain(|f| f.date >= dp);
    }
    if let Some(e) = end {
        let dp = parse_date_spec(e)?;
        files.retain(|f| f.date <= dp);
    }

    if files.is_empty() {
        anyhow::bail!("no files match the date range");
    }

    let total_files = files.len();
    eprintln!(
        "{{\"type\":\"files_found\",\"count\":{}}}",
        total_files
    );

    let matcher = Matcher::new(wallets);
    let mut stdout = std::io::BufWriter::new(std::io::stdout());
    let mut total_processed: u64 = 0;
    let mut total_matched: u64 = 0;
    let start_time = std::time::Instant::now();

    for (i, file) in files.iter().enumerate() {
        let current = (i + 1) as u64;
        let size = fs::metadata(&file.path)
            .map(|m| m.len())
            .unwrap_or(0);

        emit_stderr_event(&serde_json::json!({
            "type": "file_start",
            "hour_key": file.hour_key,
            "total_files": total_files,
            "current_file": current,
            "size_bytes": size,
        }));

        let (processed, matched) = process_file(&file.path, &matcher, &mut stdout, &file.hour_key, current, total_files as u64)?;

        total_processed += processed;
        total_matched += matched;

        let elapsed = start_time.elapsed().as_secs_f64();
        let rate = if elapsed > 0.0 {
            (total_processed as f64 / elapsed) as u64
        } else {
            0
        };

        emit_stderr_event(&serde_json::json!({
            "type": "file_done",
            "hour_key": file.hour_key,
            "current_file": current,
            "total_files": total_files,
            "processed": processed,
            "matched": matched,
            "rate_per_sec": rate,
        }));
    }

    let elapsed = start_time.elapsed().as_secs_f64();
    emit_stderr_event(&serde_json::json!({
        "type": "done",
        "files_processed": total_files,
        "total_processed": total_processed,
        "total_matched": total_matched,
        "elapsed_secs": format!("{:.1}", elapsed),
    }));

    stdout.flush()?;
    Ok(())
}

fn process_file(
    path: &PathBuf,
    matcher: &Matcher,
    output: &mut impl Write,
    hour_key: &str,
    current_file: u64,
    total_files: u64,
) -> anyhow::Result<(u64, u64)> {
    let file = File::open(path)?;
    let decoder = zstd::Decoder::new(file)?;
    let mut reader = BufReader::new(decoder);

    let hk = hour_key.to_string();
    let progress_every = 100_000;

    matcher::filter_stream(
        &mut reader,
        matcher,
        output,
        progress_every,
        |processed, matched| {
            emit_stderr_event(&serde_json::json!({
                "type": "progress",
                "hour_key": hk,
                "current_file": current_file,
                "total_files": total_files,
                "processed": processed,
                "matched": matched,
            }));
        },
    )
    .map_err(|e| anyhow::anyhow!("I/O error processing {}: {}", path.display(), e))
}

fn list_cache_files(dir: &PathBuf) -> anyhow::Result<Vec<CacheFile>> {
    let mut files: Vec<CacheFile> = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".jsonl.zst") {
            continue;
        }
        if let Some((hour_key, date)) = parse_cache_filename(&name) {
            files.push(CacheFile {
                path: entry.path(),
                hour_key,
                date,
            });
        }
    }
    files.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(files)
}

fn parse_cache_filename(name: &str) -> Option<(String, DateParts)> {
    // "2026-04-22_00.jsonl.zst" -> ("2026/04/22/00", DateParts)
    let stem = name.strip_suffix(".jsonl.zst")?;
    let parts: Vec<&str> = stem.split(&['-', '_']).collect();
    if parts.len() != 4 {
        return None;
    }
    let year: u16 = parts[0].parse().ok()?;
    let month: u8 = parts[1].parse().ok()?;
    let day: u8 = parts[2].parse().ok()?;
    let hour: u8 = parts[3].parse().ok()?;
    let dp = DateParts {
        year,
        month,
        day,
        hour,
    };
    let hour_key = format!("{}/{:02}/{:02}/{:02}", year, month, day, hour);
    Some((hour_key, dp))
}

fn parse_date_spec(s: &str) -> anyhow::Result<DateParts> {
    // Accepts "2026-04-22 00" or ISO-like "2026-04-22T00:00:00Z"
    let s = s.trim();
    let (date, time) = if let Some(pos) = s.find('T') {
        (&s[..pos], &s[pos + 1..])
    } else if let Some(pos) = s.find(' ') {
        (&s[..pos], &s[pos + 1..])
    } else {
        anyhow::bail!("expected date format YYYY-MM-DD HH or YYYY-MM-DDTHH:MM:SSZ, got: {}", s);
    };
    let date_parts: Vec<&str> = date.split('-').collect();
    let time_parts: Vec<&str> = time.split(':').collect();
    if date_parts.len() < 3 || time_parts.is_empty() {
        anyhow::bail!("invalid date: {}", s);
    }
    let year: u16 = date_parts[0].parse()?;
    let month: u8 = date_parts[1].parse()?;
    let day: u8 = date_parts[2].parse()?;
    let hour: u8 = time_parts[0].parse()?;
    Ok(DateParts {
        year,
        month,
        day,
        hour,
    })
}

fn emit_stderr_event(v: &serde_json::Value) {
    writeln!(std::io::stderr(), "{}", v).ok();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn test_parse_cache_filename_valid() {
        let (hk, dp) = parse_cache_filename("2026-04-22_00.jsonl.zst").unwrap();
        assert_eq!(hk, "2026/04/22/00");
        assert_eq!(dp.year, 2026);
        assert_eq!(dp.month, 4);
        assert_eq!(dp.day, 22);
        assert_eq!(dp.hour, 0);
    }

    #[test]
    fn test_parse_cache_filename_invalid() {
        assert!(parse_cache_filename("not-a-file.txt").is_none());
        assert!(parse_cache_filename("2026-04-22.jsonl.zst").is_none());
        assert!(parse_cache_filename("").is_none());
    }

    #[test]
    fn test_date_parts_ordering() {
        let a = DateParts { year: 2026, month: 4, day: 22, hour: 0 };
        let b = DateParts { year: 2026, month: 4, day: 22, hour: 1 };
        let c = DateParts { year: 2026, month: 4, day: 23, hour: 0 };
        assert!(a < b);
        assert!(b < c);
        assert!(a < c);
    }

    #[test]
    fn test_parse_date_spec_space() {
        let dp = parse_date_spec("2026-04-22 00").unwrap();
        assert_eq!(dp.year, 2026);
        assert_eq!(dp.month, 4);
        assert_eq!(dp.day, 22);
        assert_eq!(dp.hour, 0);
    }

    #[test]
    fn test_parse_date_spec_iso() {
        let dp = parse_date_spec("2026-05-01T23:00:00Z").unwrap();
        assert_eq!(dp.year, 2026);
        assert_eq!(dp.month, 5);
        assert_eq!(dp.day, 1);
        assert_eq!(dp.hour, 23);
    }

    #[test]
    fn test_parse_date_spec_invalid() {
        assert!(parse_date_spec("garbage").is_err());
        assert!(parse_date_spec("").is_err());
    }

    #[test]
    fn test_matcher_buy_with_wallet() {
        let line = br#"{"signature":"x","txType":"buy","tradersInvolved":{"addr1111111111111111111111111111111111111111":{}}}"#;
        let mut wallets = HashSet::new();
        wallets.insert("addr1111111111111111111111111111111111111111".to_string());
        let m = Matcher::new(wallets);
        assert!(m.matches(line));
    }

    #[test]
    fn test_matcher_sell_with_wallet() {
        let line = br#"{"signature":"x","txType":"sell","tradersInvolved":{"Wallet222222222222222222222222222222222222":{}}}"#;
        let mut wallets = HashSet::new();
        wallets.insert("Wallet222222222222222222222222222222222222".to_string());
        let m = Matcher::new(wallets);
        assert!(m.matches(line));
    }

    #[test]
    fn test_matcher_no_match() {
        let line = br#"{"signature":"x","txType":"buy","tradersInvolved":{"OtherWallet33333333333333333333333333333333":{}}}"#;
        let mut wallets = HashSet::new();
        wallets.insert("TrackedWallet444444444444444444444444444444".to_string());
        let m = Matcher::new(wallets);
        assert!(!m.matches(line));
    }

    #[test]
    fn test_matcher_create_tx_type_skipped() {
        let line = br#"{"signature":"x","txType":"create","tradersInvolved":{"addr1111111111111111111111111111111111111111":{}}}"#;
        let mut wallets = HashSet::new();
        wallets.insert("addr1111111111111111111111111111111111111111".to_string());
        let m = Matcher::new(wallets);
        assert!(!m.matches(line));
    }

    #[test]
    fn test_matcher_no_traders_involved() {
        let line = br#"{"signature":"x","txType":"buy"}"#;
        let mut wallets = HashSet::new();
        wallets.insert("addr1111111111111111111111111111111111111111".to_string());
        let m = Matcher::new(wallets);
        assert!(!m.matches(line));
    }

    #[test]
    fn test_matcher_empty_wallets() {
        let line = br#"{"signature":"x","txType":"buy","tradersInvolved":{"addr1111111111111111111111111111111111111111":{}}}"#;
        let m = Matcher::new(HashSet::new());
        assert!(!m.matches(line));
    }

    #[test]
    fn test_filter_stream_matches() {
        let input = b"{\"signature\":\"x\",\"txType\":\"buy\",\"tradersInvolved\":{\"A11111111111111111111111111111111111111111\":{}}}\n";
        let mut wallets = HashSet::new();
        wallets.insert("A11111111111111111111111111111111111111111".to_string());
        let m = Matcher::new(wallets);
        let mut reader = std::io::BufReader::new(&input[..]);
        let mut output = Vec::new();

        let (processed, matched) = matcher::filter_stream(
            &mut reader, &m, &mut output, 1000, |_, _| {},
        ).unwrap();

        assert_eq!(processed, 1);
        assert_eq!(matched, 1);
        assert!(!output.is_empty());
    }

    #[test]
    fn test_filter_stream_no_match() {
        let input = b"{\"signature\":\"x\",\"txType\":\"buy\",\"tradersInvolved\":{\"Other33333333333333333333333333333333\":{}}}\n";
        let mut wallets = HashSet::new();
        wallets.insert("Tracked44444444444444444444444444444444".to_string());
        let m = Matcher::new(wallets);
        let mut reader = std::io::BufReader::new(&input[..]);
        let mut output = Vec::new();

        let (processed, matched) = matcher::filter_stream(
            &mut reader, &m, &mut output, 1000, |_, _| {},
        ).unwrap();

        assert_eq!(processed, 1);
        assert_eq!(matched, 0);
        assert!(output.is_empty());
    }

    #[test]
    fn test_wallet_load() {
        let dir = std::env::temp_dir().join("pump-test-wallets.txt");
        fs::write(&dir, "addr1111111111111111111111111111111111111111\nWallet222222222222222222222222222222222222\n\n  \n").unwrap();
        let wallets = wallet::load(&dir).unwrap();
        assert_eq!(wallets.len(), 2);
        assert!(wallets.contains("addr1111111111111111111111111111111111111111"));
        assert!(wallets.contains("Wallet222222222222222222222222222222222222"));
        fs::remove_file(&dir).ok();
    }
}
