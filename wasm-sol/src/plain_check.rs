//! The checker of the plain wallet. It compiles the expected message from the intent and the pins
//! (`plain_template.rs`) and requires that the proposed message equals it byte for byte. The
//! rules around that compare name the reason when it does not: the wallet and the genesis hash,
//! the key that signs, the recipient, the accounts that the page read, the rent-state of the
//! accounts that the message changes (`plain_rules.rs`), and each part of the message.
//!
//! `Ok` with no violation is the only answer that a signature may follow. It does not run
//! `check_all`, `approve` or `beta.rs`: those are the rules of the pool.

use crate::check::{prefix_violation, verify_rewrite};
use crate::consts::Key;
use crate::plain::{Mode, PlainIntent, PlainPins};
use crate::plain_chain::PlainChain;
use crate::plain_display::{base58, lines};
use crate::plain_rules::{Ctx, Found};
use crate::plain_template::{compile, message_bytes, mint_of};
use crate::rule::{PlainRule, PlainViolation};
use crate::v1::{self, Message};

/// The key that would sign the message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlainSigner {
    /// The fee key of the proposing seat signs the payer part of every plain message.
    Fee,
    /// The group key signs a send or a cancel.
    Group,
}

/// The inputs of a check, as the wasm entry takes them: the wire forms. The chain bundle holds
/// the genesis hash that the page read from its RPC.
pub struct PlainCheck<'a> {
    pub intent: &'a [u8],
    pub pins: &'a [u8],
    pub chain: &'a [u8],
}

/// The decoded inputs.
pub struct Inputs<'a> {
    pub intent: &'a PlainIntent,
    pub pins: &'a PlainPins,
    pub chain: &'a PlainChain,
}

/// Every failed rule, or the lines of the approval screen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Report {
    pub violations: Vec<PlainViolation>,
    pub screen: Option<String>,
}

fn refuse(violations: Found) -> Result<Report, String> {
    Ok(Report {
        violations,
        screen: None,
    })
}

fn fault(rule: PlainRule, detail: impl Into<String>) -> PlainViolation {
    PlainViolation::new(rule, detail)
}

/// The rules that need nothing but the pins and the intent. A violation here stops the check.
fn wallet_rules(inp: &Inputs, signer: PlainSigner) -> Found {
    let (pins, mut out) = (inp.pins, Vec::new());
    if pins.wallet.mode != Mode::Plain {
        out.push(fault(PlainRule::PlainMode, "this is a pool wallet"));
    }
    if inp.chain.genesis != pins.wallet.genesis() {
        let detail = format!("the RPC answers genesis {}", base58(&inp.chain.genesis));
        out.push(fault(PlainRule::PlainGenesis, detail));
    }
    if signer == PlainSigner::Group && !inp.intent.uses_nonce() {
        let detail = format!("the group key signs no {}", inp.intent.name());
        out.push(fault(PlainRule::PlainSigner, detail));
    }
    if pins.payer == pins.group {
        out.push(fault(PlainRule::PlainPayer, "the payer is the group key"));
    }
    out
}

fn parse(bytes: &[u8]) -> Result<Message, PlainViolation> {
    let parse_fault = |detail: String| fault(PlainRule::PlainParse, detail);
    if let Some(violation) = prefix_violation(bytes) {
        return Err(parse_fault(violation.detail));
    }
    let msg = v1::parse(bytes).map_err(|error| parse_fault(error.detail))?;
    verify_rewrite(&msg, bytes).map_err(|violation| parse_fault(violation.detail))?;
    v1::validate(&msg, bytes.len()).map_err(parse_fault)?;
    Ok(msg)
}

/// The token of a send, which must be in the table of the cluster before anything compiles.
fn token_fault(inp: &Inputs) -> Option<PlainViolation> {
    let (PlainIntent::SendToken { token, .. } | PlainIntent::EnableToken { token, .. }) =
        inp.intent
    else {
        return None;
    };
    mint_of(inp.pins, *token)
        .err()
        .map(|why| fault(PlainRule::PlainToken, why))
}

fn differs<T: PartialEq>(rule: PlainRule, have: T, want: T, what: &str) -> Option<PlainViolation> {
    (have != want).then(|| fault(rule, format!("{what} differs from the compiled message")))
}

/// The config, the payer, the signers, the account table and the lifetime.
fn header_rules(msg: &Message, exp: &Message, payer: &Key) -> Found {
    let table = |m: &'_ Message| {
        (
            m.header.get(1..).map(<[u8]>::to_vec),
            m.keys.get(1..).map(<[Key]>::to_vec),
        )
    };
    [
        differs(
            PlainRule::PlainConfig,
            &msg.config,
            &exp.config,
            "the config",
        ),
        (msg.keys.first() != Some(payer))
            .then(|| fault(PlainRule::PlainPayer, "the first account is not the payer")),
        differs(
            PlainRule::PlainSigners,
            msg.header.first(),
            exp.header.first(),
            "the signers",
        ),
        differs(
            PlainRule::PlainKeyTable,
            table(msg),
            table(exp),
            "the account table",
        ),
        differs(
            PlainRule::PlainLifetime,
            msg.lifetime,
            exp.lifetime,
            "the lifetime",
        ),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// The accounts of an instruction as keys, so a different table order does not matter here.
fn keys_of<'a>(msg: &'a Message, ix: &crate::v1::Ix) -> Vec<Option<&'a Key>> {
    ix.accounts
        .iter()
        .map(|index| msg.keys.get(usize::from(*index)))
        .collect()
}

fn instruction_rules(msg: &Message, exp: &Message) -> Found {
    let mut out = Vec::new();
    if msg.ixs.len() != exp.ixs.len() {
        let detail = format!(
            "{} instructions, the template has {}",
            msg.ixs.len(),
            exp.ixs.len()
        );
        out.push(fault(PlainRule::PlainInstructionCount, detail));
    }
    for (at, (have, want)) in msg.ixs.iter().zip(&exp.ixs).enumerate() {
        let what = |part: &str| format!("instruction {at}: the {part}");
        let found = [
            differs(
                PlainRule::PlainProgram,
                msg.program_key(have),
                exp.program_key(want),
                &what("program"),
            ),
            differs(
                PlainRule::PlainAccounts,
                keys_of(msg, have),
                keys_of(exp, want),
                &what("accounts"),
            ),
            differs(PlainRule::PlainData, &have.data, &want.data, &what("data")),
        ];
        out.extend(found.into_iter().flatten());
    }
    out
}

/// Checks a message for the signer. The answer lists every violated rule. An error is an input
/// that does not parse or a read that is missing, and it signs nothing either.
pub fn check(message: &[u8], inp: &Inputs, signer: PlainSigner) -> Result<Report, String> {
    let early = wallet_rules(inp, signer);
    if !early.is_empty() {
        return refuse(early);
    }
    let msg = match parse(message) {
        Ok(msg) => msg,
        Err(violation) => return refuse(vec![violation]),
    };
    if let Some(violation) = token_fault(inp) {
        return refuse(vec![violation]);
    }
    let compiled = compile(inp.intent, inp.pins)?;
    let ctx = Ctx {
        intent: inp.intent,
        pins: inp.pins,
        chain: inp.chain,
        compiled: &compiled,
    };
    ctx.check_reads()?;
    let mut out = Vec::new();
    out.extend(ctx.recipient_rules());
    out.extend(ctx.amount_rules());
    out.extend(ctx.chain_rules());
    out.extend(ctx.rent_rules());
    out.extend(header_rules(&msg, &compiled.message, &inp.pins.payer));
    out.extend(instruction_rules(&msg, &compiled.message));
    if !out.is_empty() {
        return refuse(out);
    }
    if message != message_bytes(&compiled.message)? {
        return Err("the message differs from the compiled message in a way no rule names".into());
    }
    let screen = lines(inp.intent, inp.pins, &compiled, ctx.rent_paid());
    Ok(Report {
        violations: out,
        screen: Some(screen),
    })
}

/// The refusal as text: `refused`, then `id<TAB>detail` for each violated rule.
pub fn refused_text(violations: &[PlainViolation]) -> String {
    let rows: Vec<String> = violations
        .iter()
        .map(|v| format!("{}\t{}", v.rule.id(), v.detail))
        .collect();
    format!("refused\n{}", rows.join("\n"))
}

/// Decodes the wire inputs and runs `check`.
pub fn run(message: &[u8], input: &PlainCheck, signer: PlainSigner) -> Result<Report, String> {
    let intent = PlainIntent::decode(input.intent)?;
    let pins = PlainPins::decode(input.pins)?;
    let chain = PlainChain::decode(input.chain)?;
    let inputs = Inputs {
        intent: &intent,
        pins: &pins,
        chain: &chain,
    };
    check(message, &inputs, signer)
}

/// The answer of the checker for a signature: the pins if every rule holds, else the text of the
/// refusal. Nothing signs without this.
pub fn approved(
    message: &[u8],
    input: &PlainCheck,
    signer: PlainSigner,
) -> Result<PlainPins, String> {
    let report = run(message, input, signer)?;
    if !report.violations.is_empty() {
        return Err(refused_text(&report.violations));
    }
    PlainPins::decode(input.pins)
}
