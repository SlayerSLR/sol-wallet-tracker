use std::collections::HashSet;
use std::fs;
use std::path::Path;

pub fn load(path: &Path) -> anyhow::Result<HashSet<String>> {
    let txt = fs::read_to_string(path)?;
    let wallets: HashSet<String> = txt
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.len() >= 32)
        .collect();
    anyhow::ensure!(!wallets.is_empty(), "wallet file is empty");
    Ok(wallets)
}
