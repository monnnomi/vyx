#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
config=${VYX_SSH_CONFIG:-.data/zomro/ssh_config}
target=vyx-zomro
release=$(date -u +%Y%m%dT%H%M%SZ)
archive=$(mktemp /tmp/vyx-release.XXXXXX)
trap 'rm -f "$archive"' EXIT
NODE_ENV=production VYX_RUNTIME=node node scripts/build-analytics.mjs
node scripts/build-media.mjs
node scripts/build-drop-audio.mjs
COPYFILE_DISABLE=1 tar -czf "$archive" public api server scripts package.json package-lock.json analytics-settings.json vercel.json
scp -F "$config" "$archive" "$target:/root/vyx-release-$release.tar.gz"
ssh -F "$config" "$target" sh -s -- "$release" <<'REMOTE'
set -eu
release=$1
old=$(readlink -f /opt/vyx/current)
new=/opt/vyx/releases/$release
mkdir -p "$new"
tar -xzf "/root/vyx-release-$release.tar.gz" -C "$new"
cd "$new"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
ln -s "$new" /opt/vyx/current.next
mv -Tf /opt/vyx/current.next /opt/vyx/current
systemctl restart vyx
for attempt in 1 2 3 4 5 6 7 8 9 10; do
 if curl -fsS http://127.0.0.1:4173/healthz >/dev/null; then echo 'VYX release is healthy'; exit 0; fi
 sleep 1
done
ln -s "$old" /opt/vyx/current.rollback
mv -Tf /opt/vyx/current.rollback /opt/vyx/current
systemctl restart vyx
printf '%s\n' 'Health check failed; previous release restored' >&2
exit 1
REMOTE
