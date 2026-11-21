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
node scripts/build-interface-ru.mjs
COPYFILE_DISABLE=1 tar -czf "$archive" public api server scripts locales db/manual-news.sql package.json package-lock.json analytics-settings.json vercel.json
scp -F "$config" "$archive" "$target:/root/vyx-release-$release.tar.gz"
scp -F "$config" deploy/zomro/release.sh "$target:/root/vyx-release-$release.sh"
ssh -F "$config" "$target" sh "/root/vyx-release-$release.sh" "$release" "/root/vyx-release-$release.tar.gz"
# One-time and idempotent: server-side autodeploy from GitHub and jVYX season timers.
sh deploy/zomro/setup-automation.sh "$config" "$target" || echo "Automation setup did not finish. The release itself is live; run deploy again to retry."
