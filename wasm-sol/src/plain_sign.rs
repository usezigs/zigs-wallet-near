//! Split FROST signing of a plain wallet. It follows `sign.rs`: the nonces and the share are
//! separate calls, the nonces are made for a digest, and a share needs nonces of the digest of
//! the exact bytes. The differences are the checker, which is the plain checker, and the digest.
//!
//! - `digest_of`: BLAKE2b-256("Zigs_SolPlain_v1", lp(wallet label) || message bytes). The label
//!   holds the cluster and the mode, so a Devnet digest never equals a mainnet digest and a plain
//!   digest never equals a pool digest. `sol_nonces` of `sign.rs` takes any digest.
//! - `sign_share`: signs the raw message bytes and nothing else, only after the plain checker
//!   accepted them for the group key.

use frost_ed25519::{round2, SigningPackage};
use serde_json::json;

use crate::bytes::hex;
use crate::codec::{blake2b_256, push_len_prefixed};
use crate::frost::{key_bytes, seat_of};
use crate::plain::{Mode, Wallet};
use crate::plain_check::{approved, PlainCheck, PlainSigner};
use crate::sign::Round;

const DIGEST_PERSONAL: &[u8; 16] = b"Zigs_SolPlain_v1";

/// The digest of the exact bytes that a plain wallet signs, as 32 bytes.
pub fn digest_of(wallet: &Wallet, message: &[u8]) -> Result<[u8; 32], String> {
    if wallet.mode != Mode::Plain {
        return Err("a pool wallet has no plain digest".to_string());
    }
    let mut label = Vec::new();
    push_len_prefixed(&mut label, wallet.label().as_bytes())?;
    Ok(blake2b_256(DIGEST_PERSONAL, &[&label, message]))
}

/// `digest_of` as hex.
pub fn digest(wallet: &Wallet, message: &[u8]) -> Result<String, String> {
    Ok(hex(&digest_of(wallet, message)?))
}

/// The signature share of one seat for `message`: `{"seat", "digest", "share"}`. `round` is
/// `{"now", "cluster", "keyPackage", "nonces", "commitments"}`, as for `sign::sign_share`, and
/// `cluster` is the label of the wallet. The plain checker must accept the exact bytes for the
/// group key, the label must be that of the pinned wallet, the nonces must be those of the
/// digest of these bytes, and the key package must be the pinned group key.
pub fn sign_share(message: &[u8], check: &PlainCheck, round: &str) -> Result<String, String> {
    let round = Round::parse(round)?;
    let pins = approved(message, check, PlainSigner::Group)?;
    if round.cluster != pins.wallet.label() {
        return Err("the round is for another cluster or mode".to_string());
    }
    let digest = digest_of(&pins.wallet, message)?;
    if round.digest != digest {
        return Err("the nonces were made for another message".to_string());
    }
    if key_bytes(round.key_package.verifying_key())? != pins.group {
        return Err("the key package is not the pinned group key".to_string());
    }
    let package = SigningPackage::new(round.commitments, message);
    let share = round2::sign(&package, &round.nonces, &round.key_package)
        .map_err(|e| format!("round 2: {e}"))?;
    Ok(json!({
        "seat": seat_of(round.key_package.identifier())?,
        "digest": hex(&digest),
        "share": hex(&share.serialize()),
    })
    .to_string())
}
