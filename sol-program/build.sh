#!/bin/sh
# Builds the Zigs approvals program (ZOLANA.md 7.2) for SBF and checks the SHA-256 of the ELF.
#   sh sol-program/build.sh       builds target/deploy/zigs_min_multisig.so and checks its hash
#   sh sol-program/build.sh test  then checks the cluster builds and runs the unit tests and the
#                                 LiteSVM tests (svm-tests/), with a stub pool and with the pool of
#                                 the pinned privacy-rings commit
#   sh sol-program/build.sh proofs  runs svm-tests/tests/replay.rs (SOL-41): the pool of the pinned
#                                 commit with real proofs. It does not build the ELFs: run
#                                 `build.sh test` first. CI does not run it.
#
# The proofs mode needs a prover of the pinned privacy-rings commit that serves
# transfer_confidential_1_2 at ZOLANA_PROVER_URL. To make one, build prover/server of the
# privacy-rings checkout with `go build` into an empty folder (its go.mod can name a newer Go than
# the one installed), download transfer_confidential_1_2.key (about 9 MB) into another empty
# folder, check its SHA-256 against prover/server/prover/provingkeys/proving-keys.lock, and start
# the prover on 127.0.0.1:
#   prover start --prover-address 127.0.0.1:PORT --metrics-address 127.0.0.1:PORT2 \
#     --keys-dir KEYS --serve transfer_confidential_1_2
# The key URL is the base URL and the prefix of that lock file, then the file name.
#
# Toolchain: cargo-build-sbf of Agave v4.3.0 (solana-release-aarch64-apple-darwin.tar.bz2 of the
# GitHub release, SHA-256 0bfbd769a55e32f0a1fe1b92f76f360f01ee19475facf8c31cb90f99dcca7fe0)
# with platform-tools v1.54. Put it on PATH or set CARGO_BUILD_SBF. cargo-build-sbf removes the
# working folder from the source paths, so the ELF holds no path of this machine; this script
# checks that.
#
# EXPECTED is version 6: version 5 (ZOLANA.md 7.2) on the spr crates of privacy-rings 3c018b82, for
# the Zolana v1 pool ring1G (docs/zolana-v1.md). Devnet runs it since slot 520862900 (ZOLANA.md 6).
# The Linux hash comes from CI (run 42873582824). The macOS hash comes from a build with Agave 4.3.0
# and platform-tools v1.54; fncmp.py found no function that differs from the unstripped ELF of CI
# run 42890568132.
set -eu
cd "$(dirname "$0")"
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS

# The ELF holds the paths of the standard library inside platform-tools, which differ between its
# macOS and its Linux build. So each host has its own hash; CI builds on Linux. The two ELFs have
# the same code (fncmp.py on the unstripped CI artifact). The MAINNET pins are the same for the
# mainnet deploy ELF; the Linux one stays empty until CI gives the hash.
EXPECTED_DARWIN=9ab95e1f1f7d2e9e7dd7b33df7c630fed662edd9ae95a2e116331e94176fbfb7
EXPECTED_LINUX=4cdcfb63b7078617ffe717a39864237041a616f761886e3b0d7f622cce159416
EXPECTED_MAINNET_DARWIN=30f5dcd164f63661ed7347ccaae647a54418a062044afa6c02f8ded56d216478
EXPECTED_MAINNET_LINUX=
SBF=${CARGO_BUILD_SBF:-cargo-build-sbf}
SO=target/deploy/zigs_min_multisig.so

fail() {
  echo "build.sh: $*" >&2
  exit 1
}

sha() {
  shasum -a 256 "$1" | cut -d' ' -f1
}

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) EXPECTED=$EXPECTED_DARWIN EXPECTED_MAINNET=$EXPECTED_MAINNET_DARWIN ;;
  Linux-x86_64) EXPECTED=$EXPECTED_LINUX EXPECTED_MAINNET=$EXPECTED_MAINNET_LINUX ;;
  *) fail "no pinned hash for the host $(uname -s) $(uname -m)" ;;
esac
[ -n "$EXPECTED" ] || fail "no pinned hash for $(uname -s) $(uname -m) yet; pin it from a build"

# The proofs mode runs on the outputs of `build.sh test`, so it needs no SBF toolchain.
if [ "${1:-}" = proofs ]; then
  [ -f "$SO" ] && [ "$(sha "$SO")" = "$EXPECTED" ] \
    || fail "$SO is missing or differs from EXPECTED; run build.sh test first"
  [ -f svm-tests/target/deploy/shielded_pool_program.so ] \
    || fail "the pool ELF is missing; run build.sh test first"
  [ -n "${ZOLANA_PROVER_URL:-}" ] \
    || fail "ZOLANA_PROVER_URL is not set; start a prover (see the header of this script)"
  exec cargo test --manifest-path svm-tests/Cargo.toml --locked -j 4 --features proofs \
    --test replay -- --test-threads 1
fi

case "$("$SBF" --version 2>/dev/null | head -1)" in
  "cargo-build-sbf 4.3.0") ;;
  *) fail "needs cargo-build-sbf 4.3.0 (Agave v4.3.0); put it on PATH or set CARGO_BUILD_SBF" ;;
esac

# The ELF holds no path of this machine. Its only absolute paths are the build paths of
# platform-tools itself (.../work/platform-tools/...), which on a CI runner start with its home.
no_local_path() {
  if LC_ALL=C perl -0777 -ne \
    'BEGIN { $h = shift } exit(m{\Q$h\E(?!/work/platform-tools/)} ? 0 : 1)' "$HOME" "$1"; then
    fail "$1 holds a path of this machine"
  fi
}

"$SBF" --tools-version v1.54 --jobs 4 -- --locked --features devnet
no_local_path "$SO"
echo "$(sha "$SO")  $SO ($(wc -c < "$SO" | tr -d ' ') bytes)"
[ "$(sha "$SO")" = "$EXPECTED" ] || fail "hash differs from EXPECTED (change it only with src/)"

# Sets ZOLANA to the pinned privacy-rings tree of cargo's git checkout, unchanged.
find_zolana() {
  ZOLANA=$(cargo metadata --format-version 1 --locked | python3 -I -c '
import json, os, sys
for p in json.load(sys.stdin)["packages"]:
    if p["name"] == "spr-interface":
        print(os.path.dirname(os.path.dirname(os.path.dirname(p["manifest_path"]))))')
  [ "$(git -C "$ZOLANA" rev-parse HEAD)" = 3c018b82fbc08322114990b88906872f4e72d65c ] \
    || fail "$ZOLANA is not at the pinned commit"
  [ -z "$(git -C "$ZOLANA" status --porcelain --untracked-files=no)" ] \
    || fail "$ZOLANA has local changes"
}

# Builds the shielded pool of the pinned commit for svm-tests/tests/real_pool.rs, in a copy
# without rust-toolchain.toml (it pins a host toolchain), kept under svm-tests/target so that the
# next build is incremental.
build_real_pool() {
  find_zolana
  POOL=svm-tests/target/spr-pool
  mkdir -p "$POOL"
  rsync -a --delete --exclude .git --exclude .cargo-ok --exclude target \
    --exclude rust-toolchain.toml "$ZOLANA"/ "$POOL"/
  "$SBF" --tools-version v1.54 --jobs 4 --manifest-path "$POOL/programs/shielded-pool/Cargo.toml" \
    -- --features bpf-entrypoint --locked
  cp "$POOL/target/deploy/shielded_pool_program.so" svm-tests/target/deploy/
}

# SOL-42: a build names one cluster, by its genesis hash. The pool id is the same on both. Each
# refused build must fail with its own message. The mainnet unit tests must pass, and the mainnet
# ELF goes to svm-tests.
check_clusters() {
  must_fail "choose the cluster" cargo check --locked -j 4
  must_fail "choose one cluster" cargo check --locked -j 4 --features devnet,mainnet
  cargo test --locked -j 4 --features mainnet -- --test-threads 2
  # The mainnet ELF, for svm-tests/tests/cluster.rs. Its own target folder keeps the Devnet build
  # in target/.
  CARGO_TARGET_DIR=target/mainnet "$SBF" --tools-version v1.54 --jobs 4 \
    --sbf-out-dir svm-tests/target/deploy/mainnet -- --locked --features mainnet
  MAINNET_SO=svm-tests/target/deploy/mainnet/zigs_min_multisig.so
  no_local_path "$MAINNET_SO"
  echo "$(sha "$MAINNET_SO")  $MAINNET_SO ($(wc -c < "$MAINNET_SO" | tr -d ' ') bytes)"
  [ -n "$EXPECTED_MAINNET" ] || fail "no pinned mainnet hash for $(uname -s) $(uname -m) yet;" \
    "pin $(sha "$MAINNET_SO") from this build"
  [ "$(sha "$MAINNET_SO")" = "$EXPECTED_MAINNET" ] \
    || fail "the mainnet hash differs from EXPECTED_MAINNET (change it only with src/)"
}

# must_fail TEXT COMMAND...: the command fails, and its output names TEXT.
must_fail() {
  TEXT=$1
  shift
  if OUT=$("$@" 2>&1); then
    fail "this build must fail: $*"
  fi
  echo "$OUT" | grep -q -F "$TEXT" || fail "this build failed without \"$TEXT\": $*"
}

case "${1:-}" in
  "") exit 0 ;;
  test)
    cargo test --locked -j 4 --features devnet -- --test-threads 2
    check_clusters
    "$SBF" --tools-version v1.54 --jobs 4 --manifest-path svm-tests/stub-pool/Cargo.toml -- --locked
    build_real_pool
    cargo test --manifest-path svm-tests/Cargo.toml --locked -j 4 -- --test-threads 2
    exit 0
    ;;
  *) fail "unknown mode $1" ;;
esac
