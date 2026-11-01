//! The template compiler of the plain wallet: from an intent and the pins to the one message that
//! the checker accepts (`plain_check.rs` compares byte for byte). No chain read changes a byte
//! of the message: the lifetime is in the intent, the rent is pinned, and the compute units follow
//! from the addresses.
//!
//! - S1 create nonce: `CreateAccountWithSeed` (the payer is the base, so the group key is no
//!   account) and `InitializeNonceAccount` (authority: the group key). One signature.
//! - S2 send SOL: `AdvanceNonceAccount`, System `Transfer` from the group key.
//! - S3 send a token: `AdvanceNonceAccount`, ATA `CreateIdempotent` (the payer funds the
//!   account), `TransferChecked` from the group token account with the pinned decimals.
//! - S4 enable a token: one `CreateIdempotent` for the group wallet. One signature.
//! - S5 cancel: `AdvanceNonceAccount` alone.
//!
//! The payer is the fee key of the proposing seat. Only `encode` and `message_bytes` know the
//! message format (v1 now), so a switch to legacy messages changes those two.
//!
//! ponytail: no priority fee in P1 (the mask has no fee bits). The upgrade path is the fee bits
//! of `template_config` with a pinned cap, as the pool template has.

use crate::consts::{
    Key, Mint, ATA_CREATE_IDEMPOTENT, ATA_PROGRAM, NONCE_SEED_PREFIX, RECENT_BLOCKHASHES,
    RENT_NONCE, RENT_SYSVAR, SYSTEM_PROGRAM, SYS_ADVANCE_NONCE, SYS_CREATE_WITH_SEED,
    SYS_INIT_NONCE, SYS_TRANSFER, TOKEN_PROGRAM, TOKEN_TRANSFER_CHECKED,
};
use crate::pda::{create_with_seed, find_program_address};
use crate::plain::{Mode, PlainIntent, PlainPins};
use crate::template::{
    build, template_config, Acct, Data, Expected, ExpectedIx, Limits, LOADED_MAX,
};
use crate::v1::{self, Message};

/// Compute units. The sources are read-only simulations on the public mainnet RPC on 1 November
/// 2026 (solana-core 4.3.2, `simulateTransaction` with `sigVerify` false): one System
/// instruction costs 150; `CreateIdempotent` and `TransferChecked` to a new recipient cost 13,623
/// with no failed bump try, 15,123 with one and 16,623 with two (1,500 for each failed try of the
/// address that the program derives); `TransferChecked` alone costs 105.
pub const CU_SYSTEM: u32 = 150;
pub const CU_CREATE_IDEMPOTENT: u32 = 13_623 - CU_TRANSFER_CHECKED;
pub const CU_TRANSFER_CHECKED: u32 = 105;
pub const CU_BUMP_TRY: u32 = 1_500;
/// The margin on the sum: about 15 percent of the cost of a token send. A change of the Token or
/// ATA program must stay under it. With no priority fee the limit costs nothing.
pub const CU_MARGIN: u32 = 2_000;

/// An associated token account address and the bump that the ATA program finds for it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Ata {
    pub address: Key,
    pub bump: u8,
}

impl Ata {
    /// The bump values from 255 down that were on the curve before this one.
    fn failed_tries(&self) -> u32 {
        u32::from(u8::MAX - self.bump)
    }
}

/// The addresses that an intent uses and the page must read from the chain.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Addresses {
    /// The nonce account of the seat: `create_with_seed(payer, "zigs-n-<k>", System)`.
    pub nonce: Option<Key>,
    pub mint: Option<Mint>,
    /// The token account of the group at the mint.
    pub source: Option<Ata>,
    /// The token account of the recipient wallet at the mint.
    pub dest: Option<Ata>,
}

/// The expected message of an intent, with the numbers that it was built from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Compiled {
    pub addr: Addresses,
    pub units: u32,
    pub ixs: Vec<ExpectedIx>,
    pub message: Message,
}

/// The address of the nonce account `k` of the seat whose fee key is `payer`.
pub fn nonce_account(payer: &Key, k: u32) -> Key {
    create_with_seed(payer, nonce_seed(k).as_bytes(), &SYSTEM_PROGRAM)
}

fn nonce_seed(k: u32) -> String {
    format!("{NONCE_SEED_PREFIX}{k}")
}

fn ata_of(wallet: &Key, mint: &Key) -> Result<Ata, String> {
    let seeds: [&[u8]; 3] = [wallet, &TOKEN_PROGRAM, mint];
    find_program_address(&seeds, &ATA_PROGRAM)
        .map(|(address, bump)| Ata { address, bump })
        .ok_or_else(|| "no associated token account address".to_string())
}

/// The mint of a token position in the table of the cluster of the pins.
pub fn mint_of(pins: &PlainPins, token: u8) -> Result<Mint, String> {
    pins.wallet
        .mints()
        .get(usize::from(token))
        .copied()
        .ok_or_else(|| format!("token {token} is not in the table of the cluster"))
}

/// The addresses of an intent, all derived here and never taken from the proposal.
pub fn addresses(intent: &PlainIntent, pins: &PlainPins) -> Result<Addresses, String> {
    let nonce = intent.nonce_index().map(|k| nonce_account(&pins.payer, k));
    let (token, recipient) = match intent {
        PlainIntent::SendToken {
            token, recipient, ..
        } => (Some(*token), Some(recipient)),
        PlainIntent::EnableToken { token, .. } => (Some(*token), None),
        _ => (None, None),
    };
    let mint = token.map(|token| mint_of(pins, token)).transpose()?;
    let source = mint.map(|m| ata_of(&pins.group, &m.key)).transpose()?;
    let dest = mint
        .zip(recipient)
        .map(|(m, wallet)| ata_of(wallet, &m.key))
        .transpose()?;
    Ok(Addresses {
        nonce,
        mint,
        source,
        dest,
    })
}

fn acct(key: Key, signer: bool, writable: bool) -> Acct {
    Acct {
        key,
        signer,
        writable,
    }
}

fn ix(program: Key, accounts: Vec<Acct>, data: Vec<u8>) -> ExpectedIx {
    ExpectedIx {
        program,
        accounts,
        data: Data::Exact(data),
    }
}

fn system_data(tag: u32, rest: &[&[u8]]) -> Vec<u8> {
    let mut data = tag.to_le_bytes().to_vec();
    rest.iter().for_each(|part| data.extend_from_slice(part));
    data
}

fn advance(nonce: &Key, group: &Key) -> ExpectedIx {
    let accounts = vec![
        acct(*nonce, false, true),
        acct(RECENT_BLOCKHASHES, false, false),
        acct(*group, true, false),
    ];
    ix(
        SYSTEM_PROGRAM,
        accounts,
        system_data(SYS_ADVANCE_NONCE, &[]),
    )
}

/// S1. The payer funds the account and is the base of its seed, so the group key is no account.
fn create_nonce(pins: &PlainPins, nonce: &Key, k: u32) -> Vec<ExpectedIx> {
    let seed = nonce_seed(k);
    let seed_len = (seed.len() as u64).to_le_bytes();
    let create = system_data(
        SYS_CREATE_WITH_SEED,
        &[
            &pins.payer,
            &seed_len,
            seed.as_bytes(),
            &RENT_NONCE.to_le_bytes(),
            &crate::consts::NONCE_SPACE.to_le_bytes(),
            &SYSTEM_PROGRAM,
        ],
    );
    let init = system_data(SYS_INIT_NONCE, &[&pins.group]);
    let funds = vec![acct(pins.payer, true, true), acct(*nonce, false, true)];
    let sysvars = vec![
        acct(*nonce, false, true),
        acct(RECENT_BLOCKHASHES, false, false),
        acct(RENT_SYSVAR, false, false),
    ];
    vec![
        ix(SYSTEM_PROGRAM, funds, create),
        ix(SYSTEM_PROGRAM, sysvars, init),
    ]
}

fn transfer_sol(group: &Key, to: &Key, lamports: u64) -> ExpectedIx {
    let accounts = vec![acct(*group, true, true), acct(*to, false, true)];
    let data = system_data(SYS_TRANSFER, &[&lamports.to_le_bytes()]);
    ix(SYSTEM_PROGRAM, accounts, data)
}

/// `CreateIdempotent`: the payer funds the token account of `wallet` at `mint` if it is missing.
fn create_ata(payer: &Key, ata: &Key, wallet: &Key, mint: &Key) -> ExpectedIx {
    let accounts = vec![
        acct(*payer, true, true),
        acct(*ata, false, true),
        acct(*wallet, false, false),
        acct(*mint, false, false),
        acct(SYSTEM_PROGRAM, false, false),
        acct(TOKEN_PROGRAM, false, false),
    ];
    ix(ATA_PROGRAM, accounts, vec![ATA_CREATE_IDEMPOTENT])
}

/// `TransferChecked` from the group token account to the recipient token account.
fn transfer_checked(
    pins: &PlainPins,
    mint: &Mint,
    accounts: (&Key, &Key),
    amount: u64,
) -> ExpectedIx {
    let (source, dest) = accounts;
    let list = vec![
        acct(*source, false, true),
        acct(mint.key, false, false),
        acct(*dest, false, true),
        acct(pins.group, true, false),
    ];
    let mut data = vec![TOKEN_TRANSFER_CHECKED];
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(mint.decimals);
    ix(TOKEN_PROGRAM, list, data)
}

/// The compute units of a `CreateIdempotent` at `ata`: the program derives the address again.
fn create_units(ata: &Ata) -> u32 {
    CU_CREATE_IDEMPOTENT + CU_BUMP_TRY * ata.failed_tries()
}

type Parts = (Vec<ExpectedIx>, u32);

fn missing(what: &str) -> String {
    format!("compile: no {what} for this intent")
}

fn send_sol(pins: &PlainPins, addr: &Addresses, to: &Key, lamports: u64) -> Result<Parts, String> {
    let nonce = addr.nonce.ok_or_else(|| missing("nonce account"))?;
    let ixs = vec![
        advance(&nonce, &pins.group),
        transfer_sol(&pins.group, to, lamports),
    ];
    Ok((ixs, 2 * CU_SYSTEM))
}

fn send_token(pins: &PlainPins, addr: &Addresses, to: &Key, amount: u64) -> Result<Parts, String> {
    let nonce = addr.nonce.ok_or_else(|| missing("nonce account"))?;
    let mint = addr.mint.ok_or_else(|| missing("mint"))?;
    let source = addr.source.ok_or_else(|| missing("source account"))?;
    let dest = addr.dest.ok_or_else(|| missing("destination account"))?;
    let ixs = vec![
        advance(&nonce, &pins.group),
        create_ata(&pins.payer, &dest.address, to, &mint.key),
        transfer_checked(pins, &mint, (&source.address, &dest.address), amount),
    ];
    let units = CU_SYSTEM + create_units(&dest) + CU_TRANSFER_CHECKED;
    Ok((ixs, units))
}

fn enable_token(pins: &PlainPins, addr: &Addresses) -> Result<Parts, String> {
    let mint = addr.mint.ok_or_else(|| missing("mint"))?;
    let source = addr.source.ok_or_else(|| missing("group token account"))?;
    let ixs = vec![create_ata(
        &pins.payer,
        &source.address,
        &pins.group,
        &mint.key,
    )];
    Ok((ixs, create_units(&source)))
}

/// The instructions of an intent and the compute units of the instructions (without the margin).
fn parts(intent: &PlainIntent, pins: &PlainPins, addr: &Addresses) -> Result<Parts, String> {
    match intent {
        PlainIntent::CreateNonce { k, .. } => {
            let nonce = addr.nonce.ok_or_else(|| missing("nonce account"))?;
            Ok((create_nonce(pins, &nonce, *k), 2 * CU_SYSTEM))
        }
        PlainIntent::SendSol {
            recipient,
            lamports,
            ..
        } => send_sol(pins, addr, recipient, *lamports),
        PlainIntent::SendToken {
            recipient, amount, ..
        } => send_token(pins, addr, recipient, *amount),
        PlainIntent::EnableToken { .. } => enable_token(pins, addr),
        PlainIntent::Cancel { .. } => {
            let nonce = addr.nonce.ok_or_else(|| missing("nonce account"))?;
            Ok((vec![advance(&nonce, &pins.group)], CU_SYSTEM))
        }
    }
}

/// Compiles instructions into a message. The compute units and the loaded accounts limit are one
/// exact value each, and the priority fee is absent.
fn encode(ixs: Vec<ExpectedIx>, payer: &Key, lifetime: Key, units: u32) -> Result<Message, String> {
    let limits = Limits {
        cu_cap: units,
        cu_floor: units,
        loaded_min: LOADED_MAX,
        priority_max: 0,
    };
    let exp = Expected { ixs, limits };
    build(&exp, payer, lifetime, template_config(&exp.limits), None)
}

/// The bytes of a message in the wire format. The checker compares these bytes.
pub fn message_bytes(message: &Message) -> Result<Vec<u8>, String> {
    v1::write(message)
}

/// Compiles the message of an intent. The group key never pays, and only a plain wallet compiles.
pub fn compile(intent: &PlainIntent, pins: &PlainPins) -> Result<Compiled, String> {
    if pins.wallet.mode != Mode::Plain {
        return Err("compile: this wallet is not a plain wallet".to_string());
    }
    if pins.payer == pins.group {
        return Err("compile: the fee payer is the group key".to_string());
    }
    let addr = addresses(intent, pins)?;
    let (ixs, body) = parts(intent, pins, &addr)?;
    let units = body + CU_MARGIN;
    let message = encode(ixs.clone(), &pins.payer, intent.lifetime(), units)?;
    Ok(Compiled {
        addr,
        units,
        ixs,
        message,
    })
}
