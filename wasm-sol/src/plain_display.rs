//! The lines of the approval screen of a plain proposal. Every value comes from the intent that
//! the checker compared with the message, from the pins and from the pinned tables, never from a
//! field that the proposer wrote: the full base58 address of the recipient (all 32 bytes), the
//! amount with its decimals, the symbol of the pinned mint, the fee in lamports and the cluster.

use crate::consts::{Key, Mint};
use crate::plain::{Cluster, PlainIntent, PlainPins};
use crate::plain_template::Compiled;

const ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/// The base58 text of bytes (the Bitcoin alphabet, as Solana writes an address).
pub fn base58(bytes: &[u8]) -> String {
    let zeros = bytes.iter().take_while(|byte| **byte == 0).count();
    let mut digits: Vec<u8> = Vec::new();
    for byte in bytes {
        let mut carry = u32::from(*byte);
        for digit in &mut digits {
            carry += u32::from(*digit) << 8;
            *digit = u8::try_from(carry % 58).unwrap_or(0);
            carry /= 58;
        }
        while carry > 0 {
            digits.push(u8::try_from(carry % 58).unwrap_or(0));
            carry /= 58;
        }
    }
    let letter = |digit: &u8| ALPHABET.get(usize::from(*digit)).map(|c| char::from(*c));
    let leading = std::iter::repeat_n('1', zeros);
    leading
        .chain(digits.iter().rev().filter_map(letter))
        .collect()
}

/// An amount in base units as a decimal text with exactly `decimals` digits after the point.
pub fn decimal(amount: u64, decimals: u8) -> String {
    let Some(scale) = 10u64
        .checked_pow(u32::from(decimals))
        .filter(|_| decimals > 0)
    else {
        return amount.to_string();
    };
    let width = usize::from(decimals);
    format!("{}.{:0width$}", amount / scale, amount % scale)
}

fn cluster_name(cluster: Cluster) -> &'static str {
    match cluster {
        Cluster::Devnet => "devnet",
        Cluster::Mainnet => "mainnet",
    }
}

/// The recipient, the amount in base units, the symbol and the decimals of a send.
fn payment(intent: &PlainIntent, mint: Option<Mint>) -> Option<(Key, u64, &'static str, u8)> {
    match (intent, mint) {
        (
            PlainIntent::SendSol {
                recipient,
                lamports,
                ..
            },
            _,
        ) => Some((*recipient, *lamports, "SOL", 9)),
        (
            PlainIntent::SendToken {
                recipient, amount, ..
            },
            Some(mint),
        ) => Some((*recipient, *amount, mint.symbol, mint.decimals)),
        _ => None,
    }
}

/// The lines after `accepted`, one `name value` pair for each. `rent` is what the payer funds
/// for a new account, in lamports.
pub fn lines(intent: &PlainIntent, pins: &PlainPins, compiled: &Compiled, rent: u64) -> String {
    let mut out = vec![
        format!("intent {}", intent.name()),
        format!("cluster {}", cluster_name(pins.wallet.cluster)),
    ];
    if let Some((recipient, amount, symbol, decimals)) = payment(intent, compiled.addr.mint) {
        out.push(format!("recipient {}", base58(&recipient)));
        out.push(format!("amount {}", decimal(amount, decimals)));
        out.push(format!("units {amount}"));
        out.push(format!("symbol {symbol}"));
    }
    if let Some(mint) = compiled.addr.mint {
        out.push(format!("mint {}", base58(&mint.key)));
    }
    out.push(format!("fee {}", intent.fee()));
    out.push(format!("rent {rent}"));
    out.push(format!("payer {}", base58(&pins.payer)));
    out.push(format!("group {}", base58(&pins.group)));
    out.join("\n")
}
