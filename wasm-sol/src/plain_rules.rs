//! The rules of a plain proposal that read the intent and the chain: the recipient, the amount,
//! the accounts that the page read and the rent-state of the accounts that the message changes.
//! A failed nonce transaction burns every approval, so each rule here stops a message that the
//! runtime would refuse after the nonce advanced.

use crate::consts::{
    Key, NOT_A_RECIPIENT, RENT_NONCE, RENT_TOKEN, RENT_ZERO, SYSTEM_PROGRAM, TOKEN_PROGRAM,
};
use crate::pda::is_on_curve;
use crate::plain::{PlainIntent, PlainPins};
use crate::plain_chain::{
    parse_nonce, parse_token, required, Account, PlainChain, Role, TokenState,
};
use crate::plain_display::base58;
use crate::plain_template::Compiled;
use crate::rule::{PlainRule, PlainViolation};

pub(crate) type Found = Vec<PlainViolation>;

fn fault(rule: PlainRule, detail: impl Into<String>) -> PlainViolation {
    PlainViolation::new(rule, detail)
}

/// Everything the rules read: the intent, the pins, what the page read, and the compiled message.
pub(crate) struct Ctx<'a> {
    pub intent: &'a PlainIntent,
    pub pins: &'a PlainPins,
    pub chain: &'a PlainChain,
    pub compiled: &'a Compiled,
}

impl Ctx<'_> {
    /// Every read that the intent needs is there. A missing read is an error, not a refusal.
    pub fn check_reads(&self) -> Result<(), String> {
        for (role, _) in required(self.intent, self.pins, &self.compiled.addr) {
            self.chain.need(role)?;
        }
        Ok(())
    }

    fn recipient(&self) -> Option<&Key> {
        match self.intent {
            PlainIntent::SendSol { recipient, .. } | PlainIntent::SendToken { recipient, .. } => {
                Some(recipient)
            }
            _ => None,
        }
    }

    fn account(&self, role: Role) -> Option<&Account> {
        self.chain.get(role).and_then(|seen| seen.account.as_ref())
    }

    fn lamports(&self, role: Role) -> u64 {
        self.account(role).map_or(0, |account| account.lamports)
    }

    /// The group token account as the page read it, if it is valid.
    fn source_state(&self) -> Option<TokenState> {
        let account = self.account(Role::Source)?;
        (account.owner == TOKEN_PROGRAM)
            .then(|| parse_token(&account.data).ok())
            .flatten()
    }

    /// The rent that the payer funds for a new account.
    pub fn rent_paid(&self) -> u64 {
        match self.intent {
            PlainIntent::CreateNonce { .. } => RENT_NONCE,
            PlainIntent::SendToken { .. } if self.account(Role::Dest).is_none() => RENT_TOKEN,
            PlainIntent::EnableToken { .. } if self.account(Role::Source).is_none() => RENT_TOKEN,
            _ => 0,
        }
    }

    // ---- the recipient ---------------------------------------------------------------------

    pub fn recipient_rules(&self) -> Found {
        let Some(to) = self.recipient() else {
            return Vec::new();
        };
        let mut out = Vec::new();
        if !is_on_curve(to) {
            let detail = format!("{} is not an Ed25519 key", base58(to));
            out.push(fault(PlainRule::PlainRecipientCurve, detail));
        }
        if let Some(why) = self.reserved(to) {
            let detail = format!("{} is {why}", base58(to));
            out.push(fault(PlainRule::PlainRecipientReserved, detail));
        }
        if let Some(why) = self.owner_fault() {
            out.push(fault(PlainRule::PlainRecipientOwner, why));
        }
        out
    }

    fn reserved(&self, to: &Key) -> Option<&'static str> {
        let mut named = vec![
            (self.pins.group, "the group key"),
            (self.pins.payer, "the payer"),
        ];
        named.extend(
            self.compiled
                .addr
                .nonce
                .map(|key| (key, "the nonce account")),
        );
        let named = named.iter().find(|(key, _)| key == to).map(|(_, why)| *why);
        named.or_else(|| {
            NOT_A_RECIPIENT
                .contains(to)
                .then_some("a program, a sysvar or a mint")
        })
    }

    /// The recipient wallet is absent, or a System account with no data that is not executable.
    fn owner_fault(&self) -> Option<String> {
        let account = self.account(Role::Recipient)?;
        if account.owner != SYSTEM_PROGRAM {
            return Some(format!(
                "the recipient is owned by {}",
                base58(&account.owner)
            ));
        }
        if account.executable || !account.data.is_empty() {
            return Some("the recipient is executable or holds data".to_string());
        }
        None
    }

    // ---- the amount ------------------------------------------------------------------------

    pub fn amount_rules(&self) -> Found {
        let (amount, balance) = match self.intent {
            PlainIntent::SendSol { lamports, .. } => (*lamports, Some(self.lamports(Role::Group))),
            PlainIntent::SendToken { amount, .. } => {
                (*amount, self.source_state().map(|state| state.amount))
            }
            _ => return Vec::new(),
        };
        let mut out = Vec::new();
        if amount == 0 {
            out.push(fault(PlainRule::PlainAmount, "the amount is 0"));
        }
        if let Some(have) = balance.filter(|have| amount > *have) {
            let detail = format!("the amount {amount} is over the balance {have}");
            out.push(fault(PlainRule::PlainAmount, detail));
        }
        out
    }

    // ---- the reads -------------------------------------------------------------------------

    pub fn chain_rules(&self) -> Found {
        let mut out = Vec::new();
        out.extend(self.rent_pin_rule());
        out.extend(self.key_rules());
        out.extend(self.nonce_rule());
        out.extend(self.source_rule());
        out.extend(self.dest_rule());
        out
    }

    fn rent_pin_rule(&self) -> Option<PlainViolation> {
        let rents = self.chain.rents;
        let want = (RENT_ZERO, RENT_NONCE, RENT_TOKEN);
        let have = (rents.zero, rents.nonce, rents.token);
        (have != want).then(|| {
            let detail = format!("rent {have:?}, pinned {want:?}: the network changed its rent");
            fault(PlainRule::PlainRentPin, detail)
        })
    }

    fn key_rules(&self) -> Found {
        let mut out = Vec::new();
        for (role, key) in required(self.intent, self.pins, &self.compiled.addr) {
            let seen = self.chain.get(role).map(|seen| seen.key);
            if seen != Some(key) {
                let detail = format!(
                    "the {} read is not the address {}",
                    role.name(),
                    base58(&key)
                );
                out.push(fault(PlainRule::PlainChainKey, detail));
            }
        }
        out
    }

    /// A new nonce account is absent. Every other nonce message needs an initialised account of
    /// the group whose stored value is the lifetime.
    fn nonce_rule(&self) -> Option<PlainViolation> {
        let account = self.account(Role::Nonce);
        let why = if matches!(self.intent, PlainIntent::CreateNonce { .. }) {
            account.map(|_| "the nonce account exists already".to_string())
        } else if self.intent.uses_nonce() {
            account.map_or_else(
                || Some("the nonce account does not exist".to_string()),
                |account| self.nonce_fault(account),
            )
        } else {
            None
        };
        why.map(|why| fault(PlainRule::PlainNonceAccount, why))
    }

    fn nonce_fault(&self, account: &Account) -> Option<String> {
        if account.owner != SYSTEM_PROGRAM {
            return Some(format!(
                "owned by {}, not the System program",
                base58(&account.owner)
            ));
        }
        match parse_nonce(&account.data) {
            Err(why) => Some(why),
            Ok(state) if state.authority != self.pins.group => {
                Some("the authority is not the group key".to_string())
            }
            Ok(state) if state.value != self.intent.lifetime() => {
                Some("the stored nonce value is not the lifetime of the intent".to_string())
            }
            Ok(_) => None,
        }
    }

    /// The token account of the group: a send needs it, and Enable accepts it if it exists.
    fn source_rule(&self) -> Option<PlainViolation> {
        let account = self.account(Role::Source);
        let why = match (self.intent, account) {
            (PlainIntent::SendToken { .. }, None) => {
                Some("the token account of the group does not exist".to_string())
            }
            (PlainIntent::SendToken { .. } | PlainIntent::EnableToken { .. }, Some(account)) => {
                self.token_fault(account, &self.pins.group)
            }
            _ => None,
        };
        why.map(|why| fault(PlainRule::PlainSourceAccount, why))
    }

    /// The token account of the recipient, if it exists already.
    fn dest_rule(&self) -> Option<PlainViolation> {
        let (account, to) = (self.account(Role::Dest)?, self.recipient()?);
        let why = self.token_fault(account, to)?;
        Some(fault(PlainRule::PlainDestAccount, why))
    }

    /// Why a token account is not the account of `owner` at the pinned mint.
    fn token_fault(&self, account: &Account, owner: &Key) -> Option<String> {
        if account.owner != TOKEN_PROGRAM {
            return Some(format!(
                "owned by {}, not the Token program",
                base58(&account.owner)
            ));
        }
        let mint = self.compiled.addr.mint?;
        match parse_token(&account.data) {
            Err(why) => Some(why),
            Ok(state) if state.mint != mint.key => Some("it holds another mint".to_string()),
            Ok(state) if state.owner != *owner => Some("it names another owner".to_string()),
            Ok(_) => None,
        }
    }

    // ---- the rent-state of the accounts that the message changes ----------------------------

    pub fn rent_rules(&self) -> Found {
        let mut out = Vec::new();
        out.extend(self.payer_rent());
        out.extend(self.group_rent());
        out.extend(self.recipient_rent());
        out
    }

    /// After the fee and the rent of a new account the payer holds 0 or the 0-byte minimum.
    fn payer_rent(&self) -> Option<PlainViolation> {
        let have = self.lamports(Role::Payer);
        let cost = self.intent.fee() + self.rent_paid();
        let why = match have.checked_sub(cost) {
            None => format!("the payer holds {have}, the fee and the rent are {cost}"),
            Some(end) if under_minimum(end) => format!("the payer would hold {end}"),
            Some(_) => return None,
        };
        Some(fault(PlainRule::PlainRentPayer, why))
    }

    /// After a SOL send the group holds 0 or the 0-byte minimum. A send over the balance is
    /// refused by the amount rule.
    fn group_rent(&self) -> Option<PlainViolation> {
        let PlainIntent::SendSol { lamports, .. } = self.intent else {
            return None;
        };
        let end = self.lamports(Role::Group).checked_sub(*lamports)?;
        under_minimum(end).then(|| {
            let detail = format!("the group would hold {end}");
            fault(PlainRule::PlainRentGroup, detail)
        })
    }

    /// After a SOL send the recipient holds the 0-byte minimum, whether it is new or not.
    fn recipient_rent(&self) -> Option<PlainViolation> {
        let PlainIntent::SendSol { lamports, .. } = self.intent else {
            return None;
        };
        let end = self.lamports(Role::Recipient).saturating_add(*lamports);
        (end < RENT_ZERO).then(|| {
            let detail = format!("the recipient would hold {end}, under {RENT_ZERO}");
            fault(PlainRule::PlainRentRecipient, detail)
        })
    }
}

/// True if a balance is neither 0 nor the 0-byte rent minimum or more.
fn under_minimum(balance: u64) -> bool {
    balance != 0 && balance < RENT_ZERO
}
