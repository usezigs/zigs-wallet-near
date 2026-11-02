//! Prints the hex of `PlainChain::encode` for the edge chain that `web/test/sol-plain-review.mjs`
//! pins ("encodeChain equals the Rust encoder on the edges of an account"): a recipient with
//! lamports above 2^53, an executable flag and 300 bytes of data, an absent account, and rents
//! above 2^53. Byte i of `fill(seed, n)` is (seed + 7 i) mod 256, so the test can rebuild the
//! values. `cargo run --release --example plain_chain_dump` prints the 549 bytes as one line of
//! hex. Run it again, and paste the lines into the test, after a change of the chain format.

use p3_check::consts::Key;
use p3_check::plain_chain::{Account, PlainChain, Rents, Role, Seen};

fn fill(seed: u8, len: usize) -> Vec<u8> {
    (0..len).map(|i| (seed as usize + 7 * i) as u8).collect()
}

fn key(seed: u8) -> Key {
    let mut k = [0u8; 32];
    k.copy_from_slice(&fill(seed, 32));
    k
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn main() {
    let chain = PlainChain {
        genesis: key(9),
        rents: Rents {
            zero: 0x0102_0304_0506_0708,
            nonce: (1 << 53) + 1,
            token: 0,
        },
        reads: vec![
            (
                Role::Recipient,
                Seen {
                    key: key(1),
                    account: Some(Account {
                        lamports: u64::MAX,
                        owner: key(40),
                        executable: true,
                        data: fill(5, 300),
                    }),
                },
            ),
            (
                Role::Dest,
                Seen {
                    key: key(2),
                    account: None,
                },
            ),
            (
                Role::Payer,
                Seen {
                    key: key(3),
                    account: Some(Account {
                        lamports: (1 << 53) + 1,
                        owner: key(41),
                        executable: false,
                        data: vec![],
                    }),
                },
            ),
        ],
    };
    println!("{}", hex(&chain.encode()));
}
