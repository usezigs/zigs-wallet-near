//! Fixtures of the plain wallet tests: pins, intents, a valid chain read for each intent, and the
//! helpers that change one part of a message. Shared by `plain.rs`, `plain_rules.rs` and
//! `plain_sign.rs`. Nothing here prints a secret.
#![allow(dead_code)]

use ed25519_dalek::SigningKey;
use p3_check::consts::*;
use p3_check::pda::find_program_address;
use p3_check::plain::{Cluster, Mode, PlainIntent, PlainPins, Wallet};
use p3_check::plain_chain::{required, Account, PlainChain, Rents, Role, Seen};
use p3_check::plain_check::{check, Inputs, PlainSigner, Report};
use p3_check::plain_template::{addresses, compile, message_bytes, Compiled};
use p3_check::rule::PlainRule;
use p3_check::v1::{self, Message};

pub const PAYER: Key = [0x22; 32];
pub const NONCE_VALUE: Key = [0x33; 32];
pub const BLOCKHASH: Key = [0x44; 32];
/// The amounts that the tests send: 1.5 SOL, 2.5 USDC.
pub const LAMPORTS: u64 = 1_500_000_000;
pub const UNITS: u64 = 2_500_000;

/// A public key on the curve, other than any pinned address.
pub fn on_curve(seed: u8) -> Key {
    SigningKey::from_bytes(&[seed; 32])
        .verifying_key()
        .to_bytes()
}

pub fn group() -> Key {
    on_curve(1)
}

pub fn recipient() -> Key {
    on_curve(9)
}

/// An address off the curve (a program address).
pub fn off_curve() -> Key {
    find_program_address(&[b"off-curve"], &SYSTEM_PROGRAM)
        .expect("a program address")
        .0
}

pub fn pins(cluster: Cluster) -> PlainPins {
    PlainPins {
        wallet: Wallet::new(cluster, Mode::Plain).expect("wallet"),
        group: group(),
        payer: PAYER,
    }
}

pub const CLUSTERS: [Cluster; 2] = [Cluster::Devnet, Cluster::Mainnet];

pub fn create_nonce() -> PlainIntent {
    PlainIntent::CreateNonce {
        k: 0,
        blockhash: BLOCKHASH,
    }
}

pub fn send_sol(to: Key, lamports: u64) -> PlainIntent {
    PlainIntent::SendSol {
        k: 3,
        nonce: NONCE_VALUE,
        recipient: to,
        lamports,
    }
}

pub fn send_token(to: Key, amount: u64) -> PlainIntent {
    PlainIntent::SendToken {
        k: 3,
        nonce: NONCE_VALUE,
        token: 0,
        recipient: to,
        amount,
    }
}

pub fn enable_token() -> PlainIntent {
    PlainIntent::EnableToken {
        token: 0,
        blockhash: BLOCKHASH,
    }
}

pub fn cancel() -> PlainIntent {
    PlainIntent::Cancel {
        k: 3,
        nonce: NONCE_VALUE,
    }
}

/// The five shapes S1 to S5 with their names.
pub fn shapes() -> Vec<(&'static str, PlainIntent)> {
    vec![
        ("S1 create nonce", create_nonce()),
        ("S2 send SOL", send_sol(recipient(), LAMPORTS)),
        ("S3 send USDC", send_token(recipient(), UNITS)),
        ("S4 enable USDC", enable_token()),
        ("S5 cancel", cancel()),
    ]
}

pub fn system_account(lamports: u64) -> Account {
    Account {
        lamports,
        owner: SYSTEM_PROGRAM,
        executable: false,
        data: Vec::new(),
    }
}

/// The 80 bytes of an initialised nonce account (version 1, state 1).
pub fn nonce_data(authority: &Key, value: &Key) -> Vec<u8> {
    let mut data = [1u32.to_le_bytes(), 1u32.to_le_bytes()].concat();
    data.extend_from_slice(authority);
    data.extend_from_slice(value);
    data.extend_from_slice(&5_000u64.to_le_bytes());
    data
}

/// The 165 bytes of a token account in the given state (1 initialised, 2 frozen).
pub fn token_data(mint: &Key, owner: &Key, amount: u64, state: u8) -> Vec<u8> {
    let mut data = [&mint[..], &owner[..], &amount.to_le_bytes()[..]].concat();
    data.extend_from_slice(&[0; 36]);
    data.push(state);
    data.extend_from_slice(&[0; 12 + 8 + 36]);
    data
}

pub fn token_account(mint: &Key, owner: &Key, amount: u64) -> Account {
    Account {
        lamports: RENT_TOKEN,
        owner: TOKEN_PROGRAM,
        executable: false,
        data: token_data(mint, owner, amount, 1),
    }
}

/// An intent, the pins, and the chain read that a healthy wallet would give for it.
#[derive(Clone)]
pub struct Case {
    pub intent: PlainIntent,
    pub pins: PlainPins,
    pub chain: PlainChain,
}

impl Case {
    pub fn new(cluster: Cluster, intent: PlainIntent) -> Self {
        let pins = pins(cluster);
        let chain = healthy_chain(&intent, &pins);
        Self {
            intent,
            pins,
            chain,
        }
    }

    /// The case of a wallet with this group key and this fee key as the payer.
    pub fn with_keys(cluster: Cluster, intent: PlainIntent, group: Key, payer: Key) -> Self {
        let mut pins = pins(cluster);
        (pins.group, pins.payer) = (group, payer);
        let chain = healthy_chain(&intent, &pins);
        Self {
            intent,
            pins,
            chain,
        }
    }

    pub fn devnet(intent: PlainIntent) -> Self {
        Self::new(Cluster::Devnet, intent)
    }

    pub fn mainnet(intent: PlainIntent) -> Self {
        Self::new(Cluster::Mainnet, intent)
    }

    pub fn compiled(&self) -> Compiled {
        compile(&self.intent, &self.pins).expect("compile")
    }

    /// The compiled message bytes.
    pub fn bytes(&self) -> Vec<u8> {
        message_bytes(&self.compiled().message).expect("bytes")
    }

    /// Replaces the account of one read.
    pub fn read(mut self, role: Role, account: Option<Account>) -> Self {
        for (have, seen) in &mut self.chain.reads {
            if *have == role {
                seen.account = account.clone();
            }
        }
        self
    }

    /// Replaces the address of one read.
    pub fn read_key(mut self, role: Role, key: Key) -> Self {
        for (have, seen) in &mut self.chain.reads {
            if *have == role {
                seen.key = key;
            }
        }
        self
    }

    pub fn lamports(self, role: Role, lamports: u64) -> Self {
        self.read(role, Some(system_account(lamports)))
    }

    pub fn run(&self, message: &[u8], signer: PlainSigner) -> Result<Report, String> {
        let inputs = Inputs {
            intent: &self.intent,
            pins: &self.pins,
            chain: &self.chain,
        };
        check(message, &inputs, signer)
    }

    /// The rules that refuse the message for the fee key, or an error text.
    pub fn rules(&self, message: &[u8]) -> Vec<PlainRule> {
        let report = self.run(message, PlainSigner::Fee).expect("a verdict");
        report.violations.iter().map(|v| v.rule).collect()
    }

    /// True if the checker accepts the compiled message.
    pub fn accepts(&self) -> bool {
        self.rules(&self.bytes()).is_empty()
    }

    /// The rules that refuse the compiled message.
    pub fn refused_rules(&self) -> Vec<PlainRule> {
        self.rules(&self.bytes())
    }

    /// True if the compiled message is refused by this rule (among others).
    pub fn refuses(&self, rule: PlainRule) -> bool {
        self.refused_rules().contains(&rule)
    }
}

fn healthy_account(role: Role, intent: &PlainIntent, pins: &PlainPins) -> Option<Account> {
    match role {
        Role::Payer => Some(system_account(10_000_000_000)),
        Role::Group => Some(system_account(5_000_000_000)),
        Role::Nonce => healthy_nonce(intent, pins),
        Role::Source => healthy_source(intent, pins),
        Role::Recipient | Role::Dest => None,
    }
}

/// The nonce account exists for every message that uses it, and a new one is absent.
fn healthy_nonce(intent: &PlainIntent, pins: &PlainPins) -> Option<Account> {
    intent.uses_nonce().then(|| Account {
        lamports: RENT_NONCE,
        owner: SYSTEM_PROGRAM,
        executable: false,
        data: nonce_data(&pins.group, &intent.lifetime()),
    })
}

/// The group holds 10 USDC when it sends some, and has no token account to enable.
fn healthy_source(intent: &PlainIntent, pins: &PlainPins) -> Option<Account> {
    let mint = addresses(intent, pins).ok()?.mint?.key;
    matches!(intent, PlainIntent::SendToken { .. })
        .then(|| token_account(&mint, &pins.group, 10_000_000))
}

/// The accounts of a healthy wallet: the payer and the group hold plenty of SOL, the nonce account
/// is initialised for the group with the lifetime as value, the recipient is absent, and the
/// group holds 10 USDC.
pub fn healthy_chain(intent: &PlainIntent, pins: &PlainPins) -> PlainChain {
    let addr = addresses(intent, pins).expect("addresses");
    let reads = required(intent, pins, &addr)
        .into_iter()
        .map(|(role, key)| {
            let account = healthy_account(role, intent, pins);
            (role, Seen { key, account })
        })
        .collect();
    PlainChain {
        genesis: pins.wallet.genesis(),
        rents: Rents {
            zero: RENT_ZERO,
            nonce: RENT_NONCE,
            token: RENT_TOKEN,
        },
        reads,
    }
}

/// Parses a message, changes it, and writes it again.
pub fn edit(bytes: &[u8], change: impl FnOnce(&mut Message)) -> Vec<u8> {
    let mut msg = v1::parse(bytes).expect("parse");
    change(&mut msg);
    v1::write(&msg).expect("write")
}
