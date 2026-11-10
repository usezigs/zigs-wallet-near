//! The X25519 viewing key, the transaction viewing key and the slot cipher of a confidential
//! output (ZOLANA.md section 5, rule Ciphertexts).
//!
//! References, all under the repo root of privacy-rings at 3c018b82: docs/spec.md "Derived
//! secrets" 373-398 and "AES Key derivation" 707-725; sdk-libs/keypair/src/derivation.rs
//! 24, 101, 111 and 202-208 (`view_root`), viewing_key.rs 60-69 and 187-200 (the clamp and
//! `get_transaction_viewing_key`), x25519.rs 10-93 (the `0x04 || u` key) and encryption.rs
//! 20-32, 73-98 and 133-148 (the key schedule and `Ctr32BE`);
//! sdk-libs/transaction/src/serialization/confidential.rs 137-145 and mod.rs 111-131 (the blob).
//!
//! The slot cipher is AES-256-CTR with no tag. The spec names no AEAD: integrity comes from the
//! proof-bound `utxo_hash`, which `rules_out` recomputes.

use aes::Aes256;
use ctr::cipher::{KeyIvInit, StreamCipher};
use ctr::Ctr32BE;
use curve25519_dalek::constants::X25519_BASEPOINT;
use curve25519_dalek::montgomery::MontgomeryPoint;
use hkdf::Hkdf;
use sha2::Sha256;
use spr_hasher::primitives::is_canonical_x25519_public_key;

use crate::consts::Key;

const DST_VIEW_ROOT: &[u8] = b"TSPP/view_root/x25519/v1";
const INFO_TX_VIEWING: &[u8] = b"TSPP/tx_viewing/x25519/v1";
const HPKE_PREFIX: &[u8] = b"TSPP/hpke/";
const ENC_INFO_TRANSFER: &[u8] = b"TSPP/tx";
/// The first byte of an X25519 public key `0x04 || u` (`X25519_KEY_TAG`).
const X25519_KEY_TAG: u8 = 4;

/// The first byte of the borsh `OutputDataEncoding::Encrypted` (`proofless.rs:97-99`).
const ENCRYPTED_TAG: u8 = 1;
/// The scheme byte of a confidential slot (`EncryptedScheme::Confidential`).
const CONFIDENTIAL_SCHEME: u8 = 3;

/// A confidential slot: the 50 bytes of `ConfidentialOutputPlaintext` with no data record.
pub const PLAINTEXT_LEN: usize = 8 + 8 + 32 + 1 + 1;
/// The bytes of one output `data` field: tag, `u32` length, scheme, recipient key, ciphertext.
pub const BLOB_LEN: usize = 1 + 4 + 1 + 33 + PLAINTEXT_LEN;

/// An X25519 secret key, clamped as `ViewingKey::from_secret_key` clamps it. It has no `Debug` and
/// no `Clone`: nothing prints it.
pub struct ViewingKey {
    secret: Key,
}

/// The RFC 7748 clamp: clear the low 3 bits, clear bit 255 and set bit 254.
pub fn clamp(mut secret: Key) -> Key {
    secret[0] &= 248;
    secret[31] = (secret[31] & 127) | 64;
    secret
}

fn hkdf_fill(
    salt: Option<&[u8]>,
    ikm: &[u8],
    info: &[&[u8]],
    out: &mut [u8],
) -> Result<(), String> {
    Hkdf::<Sha256>::new(salt, ikm)
        .expand_multi_info(info, out)
        .map_err(|_| "hkdf: output length".to_string())
}

/// The `u` coordinate of a peer key `0x04 || u`. A key with another tag, or a `u` that is not
/// canonical, is refused (`X25519Pubkey::from_bytes`).
fn peer_u(bytes: &[u8; 33]) -> Result<Key, String> {
    let (tag, u) = bytes.split_first().ok_or("an X25519 key is empty")?;
    let u: Key = u.try_into().map_err(|_| "an X25519 key is not 33 bytes")?;
    if *tag != X25519_KEY_TAG || !is_canonical_x25519_public_key(&u) {
        return Err("the viewing key is not an X25519 key".to_string());
    }
    Ok(u)
}

impl ViewingKey {
    /// A secret of 32 bytes. The key keeps the clamped bytes.
    pub fn from_bytes(bytes: &Key) -> Self {
        Self {
            secret: clamp(*bytes),
        }
    }

    /// The public key `0x04 || u` (33 bytes).
    pub fn public(&self) -> [u8; 33] {
        let u = X25519_BASEPOINT.mul_clamped(self.secret);
        let mut out = [X25519_KEY_TAG; 33];
        out[1..].copy_from_slice(&u.0);
        out
    }

    /// The shared secret `X25519(self, peer)`. A low-order peer gives zero, which does not depend
    /// on this key: it is refused (`NonContributoryKey`).
    fn ecdh(&self, peer: &[u8; 33]) -> Result<Key, String> {
        let shared = MontgomeryPoint(peer_u(peer)?).mul_clamped(self.secret).0;
        if shared == [0; 32] {
            return Err("the viewing key of the peer is a low-order point".to_string());
        }
        Ok(shared)
    }

    /// `tx_viewing_secret := HKDF-Expand(view_root, "TSPP/tx_viewing/x25519/v1", 32)`, where
    /// `view_root := HKDF-Extract(salt = "TSPP/view_root/x25519/v1", IKM = the clamped secret)`.
    pub fn tx_viewing_secret(&self) -> Result<Key, String> {
        let (_, view_root) = Hkdf::<Sha256>::extract(Some(DST_VIEW_ROOT), &self.secret);
        let mut out = [0; 32];
        view_root
            .expand(INFO_TX_VIEWING, &mut out)
            .map_err(|_| "hkdf: tx viewing secret".to_string())?;
        Ok(out)
    }

    /// The transaction viewing key: `HKDF-SHA256(salt = first_nullifier, IKM =
    /// tx_viewing_secret, info = "TSPP/tx_viewing/x25519/v1", 32 bytes)`, clamped.
    pub fn tx_key(&self, first_nullifier: &Key) -> Result<Self, String> {
        let mut okm = [0; 32];
        let secret = self.tx_viewing_secret()?;
        hkdf_fill(Some(first_nullifier), &secret, &[INFO_TX_VIEWING], &mut okm)?;
        Ok(Self::from_bytes(&okm))
    }

    /// The key and the CTR nonce of one slot: `okm = HKDF-SHA256(salt = none, IKM =
    /// ECDH || tx_viewing_pk || recipient_viewing_pk, info = "TSPP/hpke/" || "TSPP/tx" ||
    /// salt || u32_be(slot), 44 bytes)`.
    fn slot_key(
        &self,
        recipient: &[u8; 33],
        salt: &[u8; 16],
        slot: u32,
    ) -> Result<([u8; 32], [u8; 12]), String> {
        let mut ikm = Vec::with_capacity(32 + 33 + 33);
        ikm.extend_from_slice(&self.ecdh(recipient)?);
        ikm.extend_from_slice(&self.public());
        ikm.extend_from_slice(recipient);
        let mut okm = [0; 44];
        let info: [&[u8]; 4] = [HPKE_PREFIX, ENC_INFO_TRANSFER, salt, &slot.to_be_bytes()];
        hkdf_fill(None, &ikm, &info, &mut okm)?;
        let (key, nonce) = okm.split_at(32);
        Ok((
            key.try_into().map_err(|_| "slot key length")?,
            nonce.try_into().map_err(|_| "slot nonce length")?,
        ))
    }

    /// AES-256-CTR of `plaintext` for the slot at output position `slot`, with the key and nonce
    /// of `slot_key`. Encryption and decryption are the same operation.
    pub fn slot_cipher(
        &self,
        recipient: &[u8; 33],
        plaintext: &[u8],
        salt: &[u8; 16],
        slot: u32,
    ) -> Result<Vec<u8>, String> {
        let (key, nonce) = self.slot_key(recipient, salt, slot)?;
        // J0 = nonce || 00000001, and the counter moves once before the first block.
        let mut iv = [0; 16];
        let (head, tail) = iv.split_at_mut(12);
        head.copy_from_slice(&nonce);
        tail.copy_from_slice(&[0, 0, 0, 2]);
        let mut body = plaintext.to_vec();
        Ctr32BE::<Aes256>::new(&key.into(), &iv.into()).apply_keystream(&mut body);
        Ok(body)
    }

    /// The `data` field of one output encrypted to `recipient` at output position `slot`: the
    /// borsh `OutputDataEncoding::Encrypted(blob)` with `blob = scheme || recipient || body`.
    pub fn slot_data(
        &self,
        recipient: &[u8; 33],
        plaintext: &[u8],
        salt: &[u8; 16],
        slot: u32,
    ) -> Result<Vec<u8>, String> {
        let body = self.slot_cipher(recipient, plaintext, salt, slot)?;
        let mut blob = vec![CONFIDENTIAL_SCHEME];
        blob.extend_from_slice(recipient);
        blob.extend_from_slice(&body);
        let len = u32::try_from(blob.len()).map_err(|_| "the blob is too long")?;
        let mut data = vec![ENCRYPTED_TAG];
        data.extend_from_slice(&len.to_le_bytes());
        data.extend_from_slice(&blob);
        Ok(data)
    }
}

/// `ConfidentialOutputPlaintext` with no ring program and an empty `data` field:
/// `asset_id u64 || amount u64 || blinding || 0 || 0` (all little endian).
pub fn plaintext(asset_id: u64, amount: u64, blinding: &Key) -> Vec<u8> {
    let mut out = Vec::with_capacity(PLAINTEXT_LEN);
    out.extend_from_slice(&asset_id.to_le_bytes());
    out.extend_from_slice(&amount.to_le_bytes());
    out.extend_from_slice(blinding);
    out.extend_from_slice(&[0, 0]);
    out
}
