#!/bin/sh
# Installs one packaged VYX release on the Zomro server, runs migrations,
# switches /opt/vyx/current and rolls back if the health checks fail.
# Used by deploy.sh (from the Mac) and autodeploy.sh (on the server).
# Usage: release.sh <release-id> <archive.tar.gz>
set -eu
release=$1
archive=$2
old=$(readlink -f /opt/vyx/current)
new=/opt/vyx/releases/$release
mkdir -p "$new"
tar --no-same-owner -xzf "$archive" -C "$new"
cd "$new"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
# Mac-created assets can have mode 0600. The app needs read access to every
# packaged file, while deployment code remains owned and writable by root.
# Runtime secrets and private uploads are outside this release directory.
chown -R root:vyx "$new"
chmod -R g-w "$new"
chmod -R g+rX "$new"
node --env-file=/etc/vyx/vyx.env scripts/check-x-config.mjs
node --env-file=/etc/vyx/vyx.env scripts/migrate-notifications.mjs
node --env-file=/etc/vyx/vyx.env scripts/migrate-x-task-refresh.mjs
node --env-file=/etc/vyx/vyx.env scripts/migrate-owner-locale.mjs
node --env-file=/etc/vyx/vyx.env scripts/migrate-manual-news.mjs
node --env-file=/etc/vyx/vyx.env scripts/migrate-wallets.mjs
node --env-file=/etc/vyx/vyx.env scripts/migrate-tokens.mjs
ln -s "$new" /opt/vyx/current.next
mv -Tf /opt/vyx/current.next /opt/vyx/current
systemctl restart vyx
for attempt in 1 2 3 4 5 6 7 8 9 10; do
 if curl -fsS http://127.0.0.1:4173/healthz >/dev/null &&
    curl -fsS -o /dev/null http://127.0.0.1:4173/api/news &&
    curl -fsS -o /dev/null http://127.0.0.1:4173/softpop.css &&
    curl -fsS -o /dev/null http://127.0.0.1:4173/softpop.js &&
    curl -fsS -o /dev/null 'http://127.0.0.1:4173/api/vyx?action=tasks' &&
    curl -fsS -o /dev/null 'http://127.0.0.1:4173/api/vyx?action=state'; then
  echo 'VYX release and design assets are healthy'; exit 0
 fi
 sleep 1
done
ln -s "$old" /opt/vyx/current.rollback
mv -Tf /opt/vyx/current.rollback /opt/vyx/current
systemctl restart vyx
printf '%s\n' 'Health check failed; previous release restored' >&2
exit 1
