#!/bin/sh
# Deploys main to the staging copy of the app at staging.zigs.app (VEL-2), then checks it from
# outside. Run it after each merge:
#   sh scripts/deploy-staging.sh          deploys origin/main, after a fetch
#   sh scripts/deploy-staging.sh <ref>    deploys another commit, for example a branch to try
#
# - It deploys a clean export of the ref with `wrangler deploy --env staging`: never the working
#   tree, and never production. It refuses a ref whose cf/wrangler.jsonc has no staging
#   environment: wrangler would then deploy the top level, with the production domain.
# - Staging has its own Worker, Durable Object data and password (cf/wrangler.jsonc, env.staging).
#   The password is the secret APP_PASSWORD. It lives only in ~/.config/zigs/staging-password
#   (mode 600), which the first run makes, and it is never printed.
# - HELIUS_DEVNET_URL is the secret of production, read from ~/.config/zigs/helius-app.url. The
#   Helius key answers only the origins on its Allowed Domains list (SOL-48).
# - HELIUS_MAINNET_URL is the Helius mainnet URL of the plain Solana wallet, read from
#   ~/.config/zigs/helius-mainnet.url when that file exists (mode 600). Its key allows only
#   staging.zigs.app. The page gets it only when the var SOL_MAINNET is "1" (cf/wrangler.jsonc).
# - NEAR_API_KEY is the partner key (a JWT) of NEAR Intents, read from ~/.config/zigs/near-api-key
#   when that file exists (mode 600). The owner gets it at partners.near-intents.org. Without it
#   the swap routes still work, at the higher fee of NEAR Intents for calls with no key.
# - LWD_KEY is the secret that the app Worker sends to our testnet node (infra/lwd). Staging uses
#   the value of production, from ~/.config/zigs/lwd-key (mode 600, 64 hex characters). The script
#   never makes it: it must match the file .env.lwd-key on the node host.
# - It needs Node 22 or later, a wrangler login, and git access to devzigs/zigs.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
CONF=$HOME/.config/zigs
PASSWORD=$CONF/staging-password
HELIUS=$CONF/helius-app.url
LWD=$CONF/lwd-key
HELIUS_MAINNET=$CONF/helius-mainnet.url
NEAR_KEY=$CONF/near-api-key
URL=https://staging.zigs.app
REF=${1:-origin/main}

fail() {
  echo "deploy-staging: $*" >&2
  exit 1
}

# private FILE: the file exists, is not empty, and only its owner can read or write it.
private() {
  [ -s "$1" ] && [ -z "$(find "$1" ! -perm 600)" ]
}

private "$HELIUS" || fail "$HELIUS must hold the Helius Devnet URL, with mode 600"
private "$LWD" || fail "$LWD must hold the LWD_KEY of infra/lwd/.env.lwd-key, with mode 600"
[ ! -e "$HELIUS_MAINNET" ] || private "$HELIUS_MAINNET" \
  || fail "$HELIUS_MAINNET must hold the Helius mainnet URL, with mode 600"
[ ! -e "$NEAR_KEY" ] || private "$NEAR_KEY" \
  || fail "$NEAR_KEY must hold the partner key of NEAR Intents, with mode 600"
# The bytes that go to wrangler: the bare value, not the line LWD_KEY=<value> of .env.lwd-key.
tr -d '\n' < "$LWD" | grep -Eq '^[0-9a-f]{64}$' \
  || fail "$LWD must hold the bare 64 hex characters of LWD_KEY, not the line LWD_KEY=<value>"
if [ ! -s "$PASSWORD" ]; then
  mkdir -p "$CONF"
  rm -f "$PASSWORD"
  RANDOM_TEXT=$(openssl rand -base64 33)
  (umask 077 && printf '%s' "$RANDOM_TEXT" | tr -d '\n/+=' > "$PASSWORD")
  unset RANDOM_TEXT
fi
private "$PASSWORD" || fail "$PASSWORD must hold the password, with mode 600"

if [ "$REF" = origin/main ]; then
  GH_CONFIG_DIR=$HOME/.config/gh-zigs git -C "$ROOT" fetch --quiet origin main
fi
COMMIT=$(git -C "$ROOT" rev-parse --short "$REF^{commit}")
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git -C "$ROOT" archive "$COMMIT" cf web > "$WORK/export.tar"
tar -xf "$WORK/export.tar" -C "$WORK"
grep -q '"staging": {' "$WORK/cf/wrangler.jsonc" \
  && grep -q '"pattern": "staging.zigs.app"' "$WORK/cf/wrangler.jsonc" \
  || fail "$COMMIT has no staging environment in cf/wrangler.jsonc"

cd "$WORK/cf"
npm ci --no-audit --no-fund --loglevel=error
npx wrangler deploy --env staging --message "$COMMIT"
tr -d '\n' < "$PASSWORD" | npx wrangler secret put APP_PASSWORD --env staging
tr -d '\n' < "$HELIUS" | npx wrangler secret put HELIUS_DEVNET_URL --env staging
tr -d '\n' < "$LWD" | npx wrangler secret put LWD_KEY --env staging
if [ -e "$HELIUS_MAINNET" ]; then
  tr -d '\n' < "$HELIUS_MAINNET" | npx wrangler secret put HELIUS_MAINNET_URL --env staging
fi
if [ -e "$NEAR_KEY" ]; then
  tr -d '\n' < "$NEAR_KEY" | npx wrangler secret put NEAR_API_KEY --env staging
fi

# status PATH [with]: the HTTP status of PATH, with the password when the second argument is set.
# The password goes to curl on stdin, so it never shows in a process list.
status() {
  if [ -n "${2:-}" ]; then
    printf 'user = "staging:%s"\n' "$(cat "$PASSWORD")" \
      | curl -s -m 10 -o /dev/null -w '%{http_code}' -K - "$URL$1"
  else
    curl -s -m 10 -o /dev/null -w '%{http_code}' "$URL$1"
  fi
}

# expect CODE PATH [with]: waits for the answer CODE, at most 10 tries 3 seconds apart, because a
# new secret takes a few seconds to reach every Cloudflare location.
expect() {
  tries=10
  until [ "$(status "$2" "${3:-}")" = "$1" ]; do
    tries=$((tries - 1))
    [ "$tries" -gt 0 ] || fail "$URL$2 ${3:+with the password }must answer $1"
    sleep 3
  done
}

expect 401 /
expect 200 / with
expect 200 /sol/config.json with
echo "deploy-staging: $COMMIT ($REF) is live at $URL"

# The app part of the demo preflight (M8): the gate, the pages, /lwd, the group socket and the
# Helius Origin of staging. It only warns, because the deploy is live already. Its Helius check
# fails until staging.zigs.app is on the Allowed Domains of the key (owner decision D4).
printf '{"apps": [{"origin": "%s", "passwordFile": "%s"}]}\n' "$URL" "$PASSWORD" \
  > "$WORK/demo-check.json"
sh "$ROOT/solspike/demo-check.sh" --app-only --config "$WORK/demo-check.json" \
  || echo "deploy-staging: the preflight above did not pass; the deploy itself is live" >&2
