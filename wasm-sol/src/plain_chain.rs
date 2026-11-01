//! What the page read from the chain for a plain proposal, and the parse of the raw account data.
//! The page passes each account whole (lamports, owner, executable flag and data) and the wasm
//! parses the data, so no field comes from the page as a verdict. A read that the page found
//! absent is `None`, which is not a zero-lamport account.
//!
//! Wire form: the genesis hash that the page read from its RPC (32), the rent minimums of 0, 80
//! and 165 bytes (3 x u64), a count (u8), then for each read: role (u8), the address the page
//! read (32), present (u8: 0 or 1) and, if present, lamports (u64), owner (32), executable (u8: 0
//! or 1), data length (u32) and the data.

use crate::bytes::Reader;
use crate::consts::Key;
use crate::plain::{PlainIntent, PlainPins};
use crate::plain_template::Addresses;

/// An account as `getAccountInfo` returns it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Account {
    pub lamports: u64,
    pub owner: Key,
    pub executable: bool,
    pub data: Vec<u8>,
}

/// One read: the address that the page asked for and what it found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Seen {
    pub key: Key,
    pub account: Option<Account>,
}

/// The rent-exempt minimum of 0, 80 and 165 bytes, from `getMinimumBalanceForRentExemption`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Rents {
    pub zero: u64,
    pub nonce: u64,
    pub token: u64,
}

/// The role of an account in a plain proposal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Payer = 1,
    Group = 2,
    Nonce = 3,
    Recipient = 4,
    Source = 5,
    Dest = 6,
}

impl Role {
    pub fn name(self) -> &'static str {
        match self {
            Role::Payer => "payer",
            Role::Group => "group",
            Role::Nonce => "nonce",
            Role::Recipient => "recipient",
            Role::Source => "source",
            Role::Dest => "dest",
        }
    }

    fn from_byte(byte: u8) -> Result<Self, String> {
        [
            Role::Payer,
            Role::Group,
            Role::Nonce,
            Role::Recipient,
            Role::Source,
            Role::Dest,
        ]
        .into_iter()
        .find(|role| *role as u8 == byte)
        .ok_or_else(|| format!("chain: {byte} is not the role of a read"))
    }
}

/// Every read of one proposal.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PlainChain {
    /// The genesis hash that the page read from its RPC.
    pub genesis: Key,
    pub rents: Rents,
    pub reads: Vec<(Role, Seen)>,
}

impl PlainChain {
    pub fn get(&self, role: Role) -> Option<&Seen> {
        self.reads
            .iter()
            .find(|(have, _)| *have == role)
            .map(|(_, seen)| seen)
    }

    /// The read of a role, or an error that names the role: the page must give every read that
    /// `required` lists.
    pub fn need(&self, role: Role) -> Result<&Seen, String> {
        self.get(role)
            .ok_or_else(|| format!("chain: the read of the {} is missing", role.name()))
    }

    /// The wire form.
    pub fn encode(&self) -> Vec<u8> {
        let mut out = self.genesis.to_vec();
        for rent in [self.rents.zero, self.rents.nonce, self.rents.token] {
            out.extend_from_slice(&rent.to_le_bytes());
        }
        out.push(u8::try_from(self.reads.len()).unwrap_or(u8::MAX));
        for (role, seen) in &self.reads {
            out.push(*role as u8);
            out.extend_from_slice(&seen.key);
            let Some(account) = &seen.account else {
                out.push(0);
                continue;
            };
            out.push(1);
            out.extend_from_slice(&account.lamports.to_le_bytes());
            out.extend_from_slice(&account.owner);
            out.push(u8::from(account.executable));
            out.extend_from_slice(&u32::try_from(account.data.len()).unwrap_or(0).to_le_bytes());
            out.extend_from_slice(&account.data);
        }
        out
    }

    /// Reads the wire form. The whole input must be used, and a role appears once.
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        let short = |_| "chain: the input ends inside a field".to_string();
        let mut r = Reader::new(bytes);
        let genesis = r.array().map_err(short)?;
        let rents = Rents {
            zero: r.u64().map_err(short)?,
            nonce: r.u64().map_err(short)?,
            token: r.u64().map_err(short)?,
        };
        let mut chain = Self {
            genesis,
            rents,
            reads: Vec::new(),
        };
        for _ in 0..r.u8().map_err(short)? {
            let role = Role::from_byte(r.u8().map_err(short)?)?;
            if chain.get(role).is_some() {
                return Err(format!(
                    "chain: the read of the {} is given twice",
                    role.name()
                ));
            }
            chain.reads.push((role, read_seen(&mut r)?));
        }
        if !r.is_empty() {
            return Err("chain: bytes follow the last read".to_string());
        }
        Ok(chain)
    }
}

fn flag(byte: u8, what: &str) -> Result<bool, String> {
    match byte {
        0 => Ok(false),
        1 => Ok(true),
        other => Err(format!("chain: the {what} flag is {other}, not 0 or 1")),
    }
}

fn read_seen(r: &mut Reader) -> Result<Seen, String> {
    let short = |_| "chain: the input ends inside a read".to_string();
    let key = r.array().map_err(short)?;
    if !flag(r.u8().map_err(short)?, "present")? {
        return Ok(Seen { key, account: None });
    }
    let lamports = r.u64().map_err(short)?;
    let owner = r.array().map_err(short)?;
    let executable = flag(r.u8().map_err(short)?, "executable")?;
    let len = usize::try_from(r.u32().map_err(short)?).map_err(|_| "chain: data too long")?;
    let data = r.take(len).map_err(short)?.to_vec();
    Ok(Seen {
        key,
        account: Some(Account {
            lamports,
            owner,
            executable,
            data,
        }),
    })
}

/// The reads that an intent needs and the address of each, all from the pins and the derived
/// addresses. The page reads these and no others.
pub fn required(intent: &PlainIntent, pins: &PlainPins, addr: &Addresses) -> Vec<(Role, Key)> {
    let mut out = vec![(Role::Payer, pins.payer)];
    if matches!(intent, PlainIntent::SendSol { .. }) {
        out.push((Role::Group, pins.group));
    }
    if let Some(nonce) = addr.nonce {
        out.push((Role::Nonce, nonce));
    }
    if let PlainIntent::SendSol { recipient, .. } | PlainIntent::SendToken { recipient, .. } =
        intent
    {
        out.push((Role::Recipient, *recipient));
    }
    if let Some(source) = addr.source {
        out.push((Role::Source, source.address));
    }
    if let Some(dest) = addr.dest {
        out.push((Role::Dest, dest.address));
    }
    out
}

/// The 80 bytes of a System nonce account (`Versions`, `State`, `Data`).
const NONCE_LEN: usize = 80;
/// The `Versions::Current` tag and the `State::Initialized` tag, as u32 little endian.
const NONCE_CURRENT: u32 = 1;
const NONCE_INITIALIZED: u32 = 1;

/// The fields of an initialised nonce account that the checker uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NonceState {
    pub authority: Key,
    pub value: Key,
}

/// Parses a nonce account: 4 bytes version, 4 bytes state, authority (32), stored nonce value
/// (32), lamports per signature (8). The error says what is wrong.
pub fn parse_nonce(data: &[u8]) -> Result<NonceState, String> {
    if data.len() != NONCE_LEN {
        return Err(format!(
            "{} bytes, a nonce account has {NONCE_LEN}",
            data.len()
        ));
    }
    let short = |_| "the nonce data ends inside a field".to_string();
    let mut r = Reader::new(data);
    let (version, state) = (r.u32().map_err(short)?, r.u32().map_err(short)?);
    if version != NONCE_CURRENT || state != NONCE_INITIALIZED {
        return Err(format!(
            "version {version} state {state}, need version 1 initialised"
        ));
    }
    Ok(NonceState {
        authority: r.array().map_err(short)?,
        value: r.array().map_err(short)?,
    })
}

/// The length of a legacy token account, the offsets of its fields and the state values.
const TOKEN_LEN: usize = 165;
const TOKEN_INITIALIZED: u8 = 1;
const TOKEN_FROZEN: u8 = 2;

/// The fields of a token account that the checker uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TokenState {
    pub mint: Key,
    pub owner: Key,
    pub amount: u64,
}

/// Parses a legacy token account: mint (32), owner (32), amount (8), delegate (36), state (1),
/// native (12), delegated amount (8), close authority (36). A frozen or uninitialised account is
/// an error.
pub fn parse_token(data: &[u8]) -> Result<TokenState, String> {
    if data.len() != TOKEN_LEN {
        return Err(format!(
            "{} bytes, a token account has {TOKEN_LEN}",
            data.len()
        ));
    }
    let short = |_| "the token data ends inside a field".to_string();
    let mut r = Reader::new(data);
    let (mint, owner, amount) = (
        r.array().map_err(short)?,
        r.array().map_err(short)?,
        r.u64().map_err(short)?,
    );
    r.take(36).map_err(short)?;
    match r.u8().map_err(short)? {
        TOKEN_INITIALIZED => Ok(TokenState {
            mint,
            owner,
            amount,
        }),
        TOKEN_FROZEN => Err("the token account is frozen".to_string()),
        state => Err(format!(
            "the token account has state {state}, not initialised"
        )),
    }
}
