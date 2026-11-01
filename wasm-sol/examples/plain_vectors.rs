//! Writes the vectors of the plain wallet smoke test to `vectors/plain/`: for each case the
//! message, the intent, the pins, the chain bundle and the answer of the native
//! `plain_check_message`. `tools/smoke.cjs` must get the same answers from the wasm build, and
//! `tests/plain_sign.rs` requires that the files equal the native answers of today.
//! `cargo run --release --example plain_vectors`. Run it again after a change of the rules, the
//! template or the constants. The keys are synthetic, so the files hold no key of a real wallet.

#[path = "../tests/support/plain.rs"]
mod support;

use std::path::Path;

use p3_check::consts::*;
use p3_check::plain::{Cluster, Mode};
use p3_check::plain_chain::{Account, Role};
use p3_check::wasm::plain_check_message;
use support::*;

struct Vector {
    name: String,
    message: Vec<u8>,
    case: Case,
}

fn named(name: &str, cluster: Cluster, case: Case, message: Vec<u8>) -> Vector {
    let tag = if cluster == Cluster::Mainnet {
        "mainnet"
    } else {
        "devnet"
    };
    Vector {
        name: format!("{tag}-{name}"),
        message,
        case,
    }
}

fn accepted() -> Vec<Vector> {
    let mut out = Vec::new();
    for cluster in CLUSTERS {
        for (name, intent) in shapes() {
            let case = Case::new(cluster, intent);
            let slug = name.to_lowercase().replace(' ', "-");
            out.push(named(&slug, cluster, case.clone(), case.bytes()));
        }
    }
    out
}

fn refused() -> Vec<Vector> {
    let mut out = Vec::new();
    let main = |intent| Case::mainnet(intent);
    let sol = main(send_sol(recipient(), LAMPORTS));
    let data = edit(&sol.bytes(), |m| m.ixs[1].data[8] ^= 1);
    out.push(named("changed-data", Cluster::Mainnet, sol.clone(), data));
    let units = edit(&sol.bytes(), |m| m.config.compute_units = Some(1_000));
    out.push(named("changed-units", Cluster::Mainnet, sol.clone(), units));
    let mut genesis = sol.clone();
    genesis.chain.genesis = DEVNET_GENESIS;
    out.push(named(
        "wrong-genesis",
        Cluster::Mainnet,
        genesis,
        sol.bytes(),
    ));
    let pda = main(send_token(off_curve(), UNITS));
    out.push(named(
        "pda-recipient",
        Cluster::Mainnet,
        pda.clone(),
        pda.bytes(),
    ));
    let mint = main(send_token(USDC_MAINNET, UNITS));
    out.push(named(
        "mint-recipient",
        Cluster::Mainnet,
        mint.clone(),
        mint.bytes(),
    ));
    let frozen = Account {
        data: token_data(&USDC_MAINNET, &group(), 10_000_000, 2),
        ..token_account(&USDC_MAINNET, &group(), 0)
    };
    let token = main(send_token(recipient(), UNITS)).read(Role::Source, Some(frozen));
    out.push(named(
        "frozen-source",
        Cluster::Mainnet,
        token.clone(),
        token.bytes(),
    ));
    let poor = sol.clone().lamports(Role::Payer, 10_000 + RENT_ZERO - 1);
    out.push(named(
        "payer-under-minimum",
        Cluster::Mainnet,
        poor.clone(),
        poor.bytes(),
    ));
    let mut pool = sol.clone();
    pool.pins.wallet.mode = Mode::Pool;
    pool.pins.wallet.cluster = Cluster::Devnet;
    out.push(named("pool-wallet", Cluster::Devnet, pool, sol.bytes()));
    let owner = main(send_sol(recipient(), LAMPORTS)).read(
        Role::Recipient,
        Some(Account {
            owner: TOKEN_PROGRAM,
            ..system_account(RENT_ZERO)
        }),
    );
    out.push(named(
        "recipient-owner",
        Cluster::Mainnet,
        owner.clone(),
        owner.bytes(),
    ));
    let mut cut = sol.clone();
    cut.chain.reads.pop();
    out.push(named("missing-read", Cluster::Mainnet, cut, sol.bytes()));
    out.push(named(
        "truncated",
        Cluster::Mainnet,
        sol.clone(),
        sol.bytes()[..60].to_vec(),
    ));
    out
}

fn main() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("vectors/plain");
    std::fs::create_dir_all(&dir).expect("vectors/plain");
    for vector in accepted().into_iter().chain(refused()) {
        let (case, message) = (&vector.case, &vector.message);
        let wire = |ext: &str, bytes: &[u8]| {
            std::fs::write(dir.join(format!("{}.{ext}", vector.name)), bytes).expect("write");
        };
        let (intent, pins, chain) = (case.intent.encode(), case.pins.wire(), case.chain.encode());
        let answer = plain_check_message(message, &intent, &pins, &chain);
        wire("msg", message);
        wire("intent", &intent);
        wire("pins", &pins);
        wire("chain", &chain);
        wire("answer", answer.as_bytes());
        println!("{}: {}", vector.name, answer.lines().next().unwrap_or(""));
    }
}
