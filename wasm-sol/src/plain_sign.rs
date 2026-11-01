//! Split FROST signing of a plain wallet. It follows `sign.rs`: the nonces and the share are
//! separate calls, the nonces are made for a digest, and a share needs nonces of the digest of
//! the exact bytes. The differences are the checker, which is the plain checker, and the digest.
//!
//! - `digest_of`: BLAKE2b-256("Zigs_SolPlain_v1", lp(wallet label) || message bytes). The label
//!   holds the cluster and the mode, so a Devnet digest never equals a mainnet digest and a plain
//!   digest never equals a pool digest. `sol_nonces` of `sign.rs` takes any digest.
//! - `sign_share`: signs the raw message bytes and nothing else, only after the plain checker
//!   accepted them for the group key.

use crate::bytes::hex;
use crate::codec::{blake2b_256, push_len_prefixed};
use crate::plain::{Mode, Wallet};

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
