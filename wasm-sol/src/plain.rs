//! The plain Solana wallet: the 32-byte FROST group key is an ordinary System account. SOL sits on
//! it and USDC sits in its associated token account, so no Zigs program and no pool is involved
//! and the wallet has no privacy. This file holds what the other `plain_*` files share: the
//! wallet (cluster and mode), the pins and the intents.
//!
//! - `plain_template.rs` compiles an intent into the one message that the checker accepts.
//! - `plain_chain.rs` reads the accounts that the page fetched from the chain.
//! - `plain_check.rs` compares a proposed message with the compiled one and lists the refused
//!   rules (`PlainRule`). `plain_display.rs` writes the approval screen lines.
//! - `plain_sign.rs` and `fee.rs` sign only after the plain checker accepted the exact bytes.
//!
//! The pool path (`check.rs`, `template.rs`, `beta.rs`, `Pins`, `Intent`) is not used here and is
//! not changed. The wire form of the plain pins has 66 bytes and the pool pins have 161, and the
//! plain intent tags start at 13, which `Intent::decode` refuses, so one kind of input is never
//! read as the other.

use crate::bytes::Reader;
use crate::consts::{
    Key, Mint, DEVNET_GENESIS, LAMPORTS_PER_SIGNATURE, MAINNET_GENESIS, MINTS_DEVNET, MINTS_MAINNET,
};
use crate::frost::PROGRAM_LABEL;

/// The Solana cluster of a wallet.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cluster {
    Devnet,
    Mainnet,
}

/// What the wallet does with its funds: `Plain` is the wallet of this file, `Pool` is the private
/// Zolana pool beta, which runs on Devnet only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Plain,
    Pool,
}

/// One row of the wallet table: the pair, the label that the ceremony and the digest hash, and
/// the program label that a `soldone` document carries.
type Row = (Cluster, Mode, &'static str, &'static str);

/// The version label of the plain program ids on Devnet: the genesis hash, the System, Token and
/// ATA programs and the mint table (symbol, mint, decimals). `tests/plain_wallet.rs` ties the
/// text to `consts.rs`.
const PLAIN_DEVNET_LABEL: &str = "zigs-plain-devnet:EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG:\
11111111111111111111111111111111:TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA:\
ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL:USDC=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU/6";

/// The same for mainnet.
const PLAIN_MAINNET_LABEL: &str =
    "zigs-plain-mainnet:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:\
11111111111111111111111111111111:TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA:\
ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL:USDC=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/6";

/// The allowed pairs. Mainnet has plain mode only. The pool label is `frost::CLUSTER` and
/// `frost::PROGRAM_LABEL`, as before, so the digest and the ceremony of a pool wallet keep their
/// bytes.
const WALLETS: [Row; 3] = [
    (Cluster::Devnet, Mode::Pool, "devnet", PROGRAM_LABEL),
    (
        Cluster::Devnet,
        Mode::Plain,
        "devnet-plain",
        PLAIN_DEVNET_LABEL,
    ),
    (
        Cluster::Mainnet,
        Mode::Plain,
        "mainnet-plain",
        PLAIN_MAINNET_LABEL,
    ),
];

/// The cluster and the mode of a wallet. `new` refuses the pair that has no wallet.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Wallet {
    pub cluster: Cluster,
    pub mode: Mode,
}

impl Wallet {
    /// A pool wallet exists on Devnet only.
    pub fn new(cluster: Cluster, mode: Mode) -> Result<Self, String> {
        if cluster == Cluster::Mainnet && mode == Mode::Pool {
            return Err("pool mode runs on Devnet only".to_string());
        }
        Ok(Self { cluster, mode })
    }

    /// The wallet of the names that the page keeps: `devnet` or `mainnet`, `plain` or `pool`.
    pub fn from_names(cluster: &str, mode: &str) -> Result<Self, String> {
        let cluster = match cluster {
            "devnet" => Cluster::Devnet,
            "mainnet" => Cluster::Mainnet,
            other => return Err(format!("unknown cluster {other:?}")),
        };
        let mode = match mode {
            "plain" => Mode::Plain,
            "pool" => Mode::Pool,
            other => return Err(format!("unknown mode {other:?}")),
        };
        Self::new(cluster, mode)
    }

    fn row(&self) -> Option<&'static Row> {
        WALLETS
            .iter()
            .find(|(cluster, mode, _, _)| *cluster == self.cluster && *mode == self.mode)
    }

    /// The text that the ceremony and the signing digest hash. For the pool wallet it is
    /// `devnet`, the value that the pool entry points have always taken.
    pub fn label(&self) -> &'static str {
        self.row().map_or("", |row| row.2)
    }

    /// The version label of the program ids of this wallet: one for each pair.
    pub fn program_label(&self) -> &'static str {
        self.row().map_or("", |row| row.3)
    }

    /// The genesis hash that the page must read from its RPC.
    pub fn genesis(&self) -> Key {
        match self.cluster {
            Cluster::Devnet => DEVNET_GENESIS,
            Cluster::Mainnet => MAINNET_GENESIS,
        }
    }

    /// The pinned tokens of the cluster.
    pub fn mints(&self) -> &'static [Mint] {
        match self.cluster {
            Cluster::Devnet => &MINTS_DEVNET,
            Cluster::Mainnet => &MINTS_MAINNET,
        }
    }

    /// The wallet of a label, or an error for any other text (bare `mainnet` among them).
    pub fn from_label(label: &str) -> Result<Self, String> {
        WALLETS
            .iter()
            .find(|row| row.2 == label)
            .map(|(cluster, mode, _, _)| Self {
                cluster: *cluster,
                mode: *mode,
            })
            .ok_or_else(|| format!("{label:?} is not the label of a wallet"))
    }

    fn wire(&self) -> [u8; 2] {
        let cluster = if self.cluster == Cluster::Devnet {
            1
        } else {
            2
        };
        let mode = if self.mode == Mode::Plain { 1 } else { 2 };
        [cluster, mode]
    }

    fn from_wire(cluster: u8, mode: u8) -> Result<Self, String> {
        let cluster = match cluster {
            1 => Cluster::Devnet,
            2 => Cluster::Mainnet,
            other => return Err(format!("pins: cluster byte {other} is not 1 or 2")),
        };
        let mode = match mode {
            1 => Mode::Plain,
            2 => Mode::Pool,
            other => return Err(format!("pins: mode byte {other} is not 1 or 2")),
        };
        Self::new(cluster, mode)
    }
}

/// The wire length of the plain pins: cluster, mode, group key, payer.
pub const PINS_LEN: usize = 2 + 32 + 32;

/// The pins of a plain wallet and one proposal: the group key and the fee key of the proposing
/// seat, which is the payer of the message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlainPins {
    pub wallet: Wallet,
    pub group: Key,
    pub payer: Key,
}

impl PlainPins {
    /// Reads the wire form. The whole input must be used.
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        let short = |_| format!("pins: need {PINS_LEN} bytes: cluster, mode, group key, payer");
        let mut r = Reader::new(bytes);
        let (cluster, mode) = (r.u8().map_err(short)?, r.u8().map_err(short)?);
        let (group, payer) = (r.array().map_err(short)?, r.array().map_err(short)?);
        if !r.is_empty() {
            return Err(format!("pins: {} bytes, need {PINS_LEN}", bytes.len()));
        }
        Ok(Self {
            wallet: Wallet::from_wire(cluster, mode)?,
            group,
            payer,
        })
    }

    pub fn wire(&self) -> Vec<u8> {
        [&self.wallet.wire()[..], &self.group[..], &self.payer[..]].concat()
    }
}

/// The wire tags of the plain intents. The tags 0 to 12 belong to `Intent`.
pub const TAG_CREATE_NONCE: u8 = 13;
pub const TAG_SEND_SOL: u8 = 14;
pub const TAG_SEND_TOKEN: u8 = 15;
pub const TAG_ENABLE_TOKEN: u8 = 16;
pub const TAG_CANCEL: u8 = 17;

/// What the group means to do. `k` counts the nonce accounts of the proposing seat: the account
/// is `create_with_seed(payer, "zigs-n-<k>", System)`. A `token` is a position in the pinned mint
/// table of the cluster, never a mint address.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PlainIntent {
    /// S1: the fee key alone creates nonce account `k`, with a recent blockhash.
    CreateNonce { k: u32, blockhash: Key },
    /// S2: the group sends SOL. `nonce` is the stored value of the nonce account.
    SendSol {
        k: u32,
        nonce: Key,
        recipient: Key,
        lamports: u64,
    },
    /// S3: the group sends a token to the associated token account of the recipient wallet.
    SendToken {
        k: u32,
        nonce: Key,
        token: u8,
        recipient: Key,
        amount: u64,
    },
    /// S4: the fee key alone creates the token account of the group, with a recent blockhash.
    EnableToken { token: u8, blockhash: Key },
    /// S5: advance the nonce, so that no earlier signature of it lands.
    Cancel { k: u32, nonce: Key },
}

impl PlainIntent {
    /// The lifetime that the message must carry.
    pub fn lifetime(&self) -> Key {
        match self {
            Self::CreateNonce { blockhash, .. } | Self::EnableToken { blockhash, .. } => *blockhash,
            Self::SendSol { nonce, .. }
            | Self::SendToken { nonce, .. }
            | Self::Cancel { nonce, .. } => *nonce,
        }
    }

    /// True if the message starts with `AdvanceNonceAccount`.
    pub fn uses_nonce(&self) -> bool {
        !matches!(self, Self::CreateNonce { .. } | Self::EnableToken { .. })
    }

    /// The number of signatures: the payer, and the group key for a message with a nonce.
    pub fn signer_count(&self) -> u8 {
        if self.uses_nonce() {
            2
        } else {
            1
        }
    }

    /// The fee in lamports: one fee for each signature, and no priority fee.
    pub fn fee(&self) -> u64 {
        LAMPORTS_PER_SIGNATURE * u64::from(self.signer_count())
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::CreateNonce { .. } => "create-nonce",
            Self::SendSol { .. } => "send-sol",
            Self::SendToken { .. } => "send-token",
            Self::EnableToken { .. } => "enable-token",
            Self::Cancel { .. } => "cancel",
        }
    }

    /// The index of the nonce account of the seat, if the message has one.
    pub fn nonce_index(&self) -> Option<u32> {
        match self {
            Self::CreateNonce { k, .. }
            | Self::SendSol { k, .. }
            | Self::SendToken { k, .. }
            | Self::Cancel { k, .. } => Some(*k),
            Self::EnableToken { .. } => None,
        }
    }

    /// The wire form: a tag byte, then the fields in order.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = Vec::new();
        match self {
            Self::CreateNonce { k, blockhash } => {
                out.push(TAG_CREATE_NONCE);
                out.extend_from_slice(&k.to_le_bytes());
                out.extend_from_slice(blockhash);
            }
            Self::SendSol {
                k,
                nonce,
                recipient,
                lamports,
            } => {
                out.push(TAG_SEND_SOL);
                out.extend_from_slice(&k.to_le_bytes());
                out.extend_from_slice(nonce);
                out.extend_from_slice(recipient);
                out.extend_from_slice(&lamports.to_le_bytes());
            }
            Self::SendToken {
                k,
                nonce,
                token,
                recipient,
                amount,
            } => {
                out.push(TAG_SEND_TOKEN);
                out.extend_from_slice(&k.to_le_bytes());
                out.extend_from_slice(nonce);
                out.push(*token);
                out.extend_from_slice(recipient);
                out.extend_from_slice(&amount.to_le_bytes());
            }
            Self::EnableToken { token, blockhash } => {
                out.push(TAG_ENABLE_TOKEN);
                out.push(*token);
                out.extend_from_slice(blockhash);
            }
            Self::Cancel { k, nonce } => {
                out.push(TAG_CANCEL);
                out.extend_from_slice(&k.to_le_bytes());
                out.extend_from_slice(nonce);
            }
        }
        out
    }

    /// Reads the wire form. The whole input must be used. A pool tag (0 to 12) is an error.
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        let short = |_| "the plain intent ends inside a field".to_string();
        let mut r = Reader::new(bytes);
        let intent = match r.u8().map_err(short)? {
            TAG_CREATE_NONCE => Self::CreateNonce {
                k: r.u32().map_err(short)?,
                blockhash: r.array().map_err(short)?,
            },
            TAG_SEND_SOL => Self::SendSol {
                k: r.u32().map_err(short)?,
                nonce: r.array().map_err(short)?,
                recipient: r.array().map_err(short)?,
                lamports: r.u64().map_err(short)?,
            },
            TAG_SEND_TOKEN => Self::SendToken {
                k: r.u32().map_err(short)?,
                nonce: r.array().map_err(short)?,
                token: r.u8().map_err(short)?,
                recipient: r.array().map_err(short)?,
                amount: r.u64().map_err(short)?,
            },
            TAG_ENABLE_TOKEN => Self::EnableToken {
                token: r.u8().map_err(short)?,
                blockhash: r.array().map_err(short)?,
            },
            TAG_CANCEL => Self::Cancel {
                k: r.u32().map_err(short)?,
                nonce: r.array().map_err(short)?,
            },
            tag => return Err(format!("{tag} is not the tag of a plain intent")),
        };
        if !r.is_empty() {
            return Err("bytes follow the plain intent".to_string());
        }
        Ok(intent)
    }
}
