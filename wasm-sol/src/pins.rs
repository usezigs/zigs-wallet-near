//! The pinned constants of one wallet on one cluster: program ids, trees, the nonce account,
//! the registry record, the asset table and the three public values of the group: its key,
//! `nullifier_pk` and `viewing_pk` (the `soldone` document, ZOLANA.md 4.1). Derived addresses
//! and the group `owner_hash` are computed here from those pins, never taken from the device.
//! The fourth pin is the payer of the proposal: the fee key that the proposing seat published
//! (ZOLANA.md 5). The page matches it to that document before it calls the checker. The fifth is
//! the `nullifier_pk` of the PDA identity that owns the funds of the program design (7.2): the
//! PDA is derived here from the group key, never taken from the device.
//!
//! The wire names the deployment (`program::DEPLOYMENTS`) and the genesis hash that the page read
//! from its RPC. `decode` refuses a genesis that is not the genesis of the deployment, so every
//! entry that reads pins refuses an RPC of the other cluster.

use crate::assets::AssetTable;
use crate::bytes::{short_hex, Reader};
use crate::consts::{
    Key, COMPUTE_BUDGET_PROGRAM, DEVNET_GENESIS, ED25519_PROGRAM, INSTRUCTIONS_SYSVAR, NONCE_SEED,
    POOL_DEVNET, RECENT_BLOCKHASHES, REGISTRY_DEVNET, RENT_SYSVAR, SEED_CPI_AUTHORITY,
    SEED_NULLIFIER, SEED_SOL_INTERFACE, SEED_SOL_INTERFACE_INDEX, SEED_TREE, SEED_USER_RECORD,
    SYSTEM_PROGRAM,
};
use crate::hashes::owner_hash;
use crate::pda::{create_with_seed, find_program_address};
use crate::program::{deployment_of_wire, owner_pda, Deployment, DEVNET};

/// Rent of the nonce account on Devnet (P2 result, ZOLANA.md 6.3).
pub const NONCE_RENT_DEVNET: u64 = 1_056_640;

/// The wire form of the pins at the wasm entry: the cluster byte of the deployment, group key,
/// `nullifier_pk`, `viewing_pk`, payer, the `nullifier_pk` of the PDA identity, and the genesis
/// hash that the page read from its RPC.
pub const WIRE_LEN: usize = 1 + 32 + 32 + 33 + 32 + 32 + 32;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pins {
    /// The pool deployment of the wallet: its cluster, approvals program and cap.
    pub deployment: &'static Deployment,
    /// The genesis hash that the page read from its RPC. `decode` refuses one that is not the
    /// genesis of the deployment.
    pub rpc_genesis: Key,
    /// The owner key of the identity that the rules check: the group key, or the PDA after
    /// `for_pda`. Its `owner_hash` is `group_owner_hash`.
    pub group: Key,
    /// The FROST group key: the key of the approval digest, which never owns a UTXO of the
    /// program design. `for_pda` keeps it.
    pub multisig: Key,
    /// The PDA of the approvals program that owns the funds of the program design.
    pub pda: Key,
    pub pda_nullifier_pk: Key,
    /// The approvals program.
    pub program: Key,
    pub nullifier_pk: Key,
    pub viewing_pk: [u8; 33],
    /// The fee payer of the message: the fee key of the proposing seat. It is never the group
    /// key (`Rule::PayerIsGroup`).
    pub payer: Key,
    /// The `owner_hash` of the group: Poseidon over the group key and the pinned `nullifier_pk`.
    /// `devnet` computes it. `approve` computes it again from the two pins and refuses a pin that
    /// differs, so the value never comes from the device snapshot.
    pub group_owner_hash: Key,
    pub pool: Key,
    pub registry: Key,
    pub input_tree: Key,
    pub output_tree: Key,
    pub sol_interface: Key,
    pub nonce_account: Key,
    pub user_record: Key,
    pub nonce_rent: u64,
    /// The compact asset id of every SPL mint that the wasm knows.
    pub assets: AssetTable,
}

fn derive(seeds: &[&[u8]], program: &Key, what: &str) -> Result<Key, String> {
    find_program_address(seeds, program)
        .map(|(address, _)| address)
        .ok_or_else(|| format!("no program address for {what}"))
}

impl Pins {
    /// The Devnet pins of a wallet and a payer. Tree 0 is the only tree that the spike uses.
    pub fn devnet(
        group: Key,
        nullifier_pk: Key,
        viewing_pk: [u8; 33],
        payer: Key,
        pda_nullifier_pk: Key,
    ) -> Result<Self, String> {
        let tree = derive(&[SEED_TREE, &0u16.to_le_bytes()], &POOL_DEVNET, "tree 0")?;
        let sol_interface = derive(
            &[SEED_SOL_INTERFACE, SEED_SOL_INTERFACE_INDEX],
            &POOL_DEVNET,
            "the SOL interface",
        )?;
        Ok(Self {
            deployment: &DEVNET,
            rpc_genesis: DEVNET_GENESIS,
            group,
            multisig: group,
            pda: owner_pda(&DEVNET, &group)?,
            pda_nullifier_pk,
            program: DEVNET.program,
            nullifier_pk,
            viewing_pk,
            payer,
            group_owner_hash: owner_hash(&group, &nullifier_pk)?,
            pool: POOL_DEVNET,
            registry: REGISTRY_DEVNET,
            input_tree: tree,
            output_tree: tree,
            sol_interface,
            nonce_account: create_with_seed(&group, NONCE_SEED, &SYSTEM_PROGRAM),
            user_record: derive(&[SEED_USER_RECORD, &group], &REGISTRY_DEVNET, "the record")?,
            nonce_rent: NONCE_RENT_DEVNET,
            assets: AssetTable::devnet()?,
        })
    }

    /// The same pins on another deployment, with the genesis that the page read from its RPC.
    /// The PDA, the approvals program and the asset table follow the row. It does not compare the
    /// genesis: `decode` does.
    pub fn on_deployment(
        &self,
        row: &'static Deployment,
        rpc_genesis: Key,
    ) -> Result<Self, String> {
        Ok(Self {
            deployment: row,
            rpc_genesis,
            pda: owner_pda(row, &self.multisig)?,
            program: row.program,
            assets: row.assets()?,
            ..self.clone()
        })
    }

    /// The same pins on another pool and registry: the addresses under them are derived again.
    /// The tests read the landed vectors of the retired Devnet pool through it.
    pub fn on_programs(&self, pool: Key, registry: Key) -> Result<Self, String> {
        let tree = derive(&[SEED_TREE, &0u16.to_le_bytes()], &pool, "tree 0")?;
        let sol_interface = derive(
            &[SEED_SOL_INTERFACE, SEED_SOL_INTERFACE_INDEX],
            &pool,
            "the SOL interface",
        )?;
        Ok(Self {
            pool,
            registry,
            input_tree: tree,
            output_tree: tree,
            sol_interface,
            user_record: derive(&[SEED_USER_RECORD, &self.multisig], &registry, "the record")?,
            ..self.clone()
        })
    }

    /// Reads the wire form of the wasm entry. The whole input must be used, the cluster byte must
    /// name a deployment, and the genesis must be the genesis of that deployment.
    pub fn decode(bytes: &[u8]) -> Result<Self, String> {
        let short = |_| {
            format!(
                "pins: need {WIRE_LEN} bytes: cluster, group key, nullifier_pk, viewing_pk, \
                 payer, PDA nullifier_pk, genesis"
            )
        };
        let mut r = Reader::new(bytes);
        let cluster = r.u8().map_err(short)?;
        let row = deployment_of_wire(cluster)
            .ok_or_else(|| format!("pins: the cluster byte {cluster} names no deployment"))?;
        let (group, nullifier_pk, viewing_pk, payer, pda_nullifier_pk) = (
            r.array().map_err(short)?,
            r.array().map_err(short)?,
            r.array().map_err(short)?,
            r.array().map_err(short)?,
            r.array().map_err(short)?,
        );
        let rpc_genesis: Key = r.array().map_err(short)?;
        if !r.is_empty() {
            return Err(format!("pins: {} bytes, need {WIRE_LEN}", bytes.len()));
        }
        if rpc_genesis != row.genesis {
            return Err(format!(
                "pins: the RPC genesis is not the genesis of {}",
                row.label
            ));
        }
        Self::devnet(group, nullifier_pk, viewing_pk, payer, pda_nullifier_pk)?
            .on_deployment(row, rpc_genesis)
    }

    /// The pins of the PDA identity: the PDA is the owner, with its own `nullifier_pk` and
    /// `owner_hash`. The group key stays in `multisig`, and the payer stays.
    pub fn for_pda(&self) -> Result<Self, String> {
        Ok(Self {
            group: self.pda,
            nullifier_pk: self.pda_nullifier_pk,
            group_owner_hash: owner_hash(&self.pda, &self.pda_nullifier_pk)?,
            ..self.clone()
        })
    }

    /// The wire form of the wasm entry, of the pins that `devnet` or `on_deployment` made (not of
    /// `for_pda`).
    pub fn wire(&self) -> Vec<u8> {
        [
            &[self.deployment.wire][..],
            &self.multisig[..],
            &self.nullifier_pk[..],
            &self.viewing_pk[..],
            &self.payer[..],
            &self.pda_nullifier_pk[..],
            &self.rpc_genesis[..],
        ]
        .concat()
    }

    /// The CPI authority of the pool: `["cpi_authority"]` under the pool. It signs only SPL
    /// transfers, so SOL sent to it is out of reach.
    pub fn cpi_authority(&self) -> Result<Key, String> {
        derive(&[SEED_CPI_AUTHORITY], &self.pool, "the CPI authority")
    }

    /// The nullifier PDA of one input: `["nullifier", tree, nullifier]` under the pool.
    pub fn nullifier_pda(&self, tree: &Key, nullifier: &Key) -> Result<Key, String> {
        derive(
            &[SEED_NULLIFIER, tree, nullifier],
            &self.pool,
            "a nullifier",
        )
    }

    /// A short name of a key for messages: its role if it is pinned, else its first bytes.
    pub fn label(&self, key: &Key) -> String {
        let named = [
            (&self.multisig, "group key"),
            (&self.group, "group"),
            (&self.pda, "group PDA"),
            (&self.program, "approvals program"),
            (&ED25519_PROGRAM, "Ed25519 program"),
            (&INSTRUCTIONS_SYSVAR, "Instructions sysvar"),
            (&self.payer, "fee payer"),
            (&self.nonce_account, "nonce account"),
            (&self.pool, "pool program"),
            (&self.registry, "registry program"),
            (&self.input_tree, "tree"),
            (&self.sol_interface, "SOL interface"),
            (&self.user_record, "registry record"),
            (&SYSTEM_PROGRAM, "System program"),
            (&RECENT_BLOCKHASHES, "RecentBlockhashes sysvar"),
            (&RENT_SYSVAR, "Rent sysvar"),
            (&COMPUTE_BUDGET_PROGRAM, "ComputeBudget program"),
        ];
        match named.iter().find(|(known, _)| *known == key) {
            Some((_, name)) => (*name).to_string(),
            None => short_hex(key),
        }
    }
}
