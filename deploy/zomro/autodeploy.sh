#!/bin/sh
# Server-side continuous deployment for VYX. Runs every minute from
# vyx-autodeploy.timer. When GitHub main moves forward from the live commit,
# it builds that commit, runs the full test suite, and only then releases it
# through release.sh (migrations, health checks, automatic rollback).
set -eu
exec 9>/run/vyx-autodeploy.lock
flock -n 9 || exit 0
src=/opt/vyx/source.git
state=/opt/vyx
export GIT_SSH_COMMAND="ssh -i /root/.ssh/vyx_github -o IdentitiesOnly=yes -o UserKnownHostsFile=/root/.ssh/vyx_github_known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes"
git --git-dir="$src" fetch -q origin +refs/heads/main:refs/remotes/origin/main
head=$(git --git-dir="$src" rev-parse refs/remotes/origin/main)
live=$(cat "$state/deployed-commit" 2>/dev/null || true)
[ "$head" = "$live" ] && exit 0
[ "$head" = "$(cat "$state/failed-commit" 2>/dev/null || true)" ] && exit 0
# Only move forward. A Mac deploy of work that is not on GitHub yet is left alone.
if [ -n "$live" ] && ! git --git-dir="$src" merge-base --is-ancestor "$live" "$head" 2>/dev/null; then
 echo "Live commit $live is not behind GitHub main $head; nothing to do."
 exit 0
fi
echo "Building $head"
release=$(date -u +%Y%m%dT%H%M%SZ)
build=$(mktemp -d /var/tmp/vyx-build.XXXXXX)
archive=/root/vyx-release-$release.tar.gz
trap 'rm -rf "$build" "$build.log"' EXIT
git --git-dir="$src" archive "$head" | tar -x -C "$build"
cd "$build"
npm ci --ignore-scripts --no-audit --no-fund >"$build.log" 2>&1 || { tail -30 "$build.log"; echo "$head" > "$state/failed-commit"; exit 1; }
if ! npm test >"$build.log" 2>&1; then
 grep -E '^not ok|^# (pass|fail)' "$build.log" | tail -30
 echo "Tests failed for $head; the live release is unchanged."
 echo "$head" > "$state/failed-commit"
 exit 1
fi
grep -E '^# (pass|fail)' "$build.log"
NODE_ENV=production VYX_RUNTIME=node node scripts/build-analytics.mjs
node scripts/build-media.mjs
node scripts/build-drop-audio.mjs
node scripts/build-interface-ru.mjs
tar -czf "$archive" public api server scripts locales db/manual-news.sql package.json package-lock.json analytics-settings.json vercel.json
if sh deploy/zomro/release.sh "$release" "$archive"; then
 echo "$head" > "$state/deployed-commit"
 rm -f "$state/failed-commit"
 echo "Deployed $head as $release"
else
 echo "$head" > "$state/failed-commit"
 exit 1
fi
