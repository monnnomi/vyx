#!/bin/sh
# Runs on the Mac from deploy.sh; safe to repeat. Sets up:
#  - a read-only GitHub deploy key for the server (registered with the gh CLI
#    that is already signed in on this Mac),
#  - /opt/vyx/source.git and vyx-autodeploy.timer (deploys GitHub main after tests),
#  - vyx-token-seasons.timer (freezes closed jVYX seasons, activates funded batches),
#  - /opt/vyx/deployed-commit = the commit this Mac just released.
set -eu
config=$1
target=$2
repo=monnnomi/vyx
sha=$(git rev-parse HEAD)
scp -F "$config" deploy/zomro/autodeploy.sh deploy/zomro/vyx-autodeploy.service deploy/zomro/vyx-autodeploy.timer \
 deploy/zomro/vyx-token-seasons.service deploy/zomro/vyx-token-seasons.timer "$target:/root/"
pub=$(ssh -F "$config" "$target" sh -s <<'REMOTE'
set -eu
install -d -m 700 /root/.ssh
[ -f /root/.ssh/vyx_github ] || ssh-keygen -q -t ed25519 -N '' -C vyx-zomro-autodeploy -f /root/.ssh/vyx_github
cat /root/.ssh/vyx_github.pub
REMOTE
)
if ! gh repo deploy-key list -R "$repo" | grep -q vyx-zomro-autodeploy; then
 key=$(mktemp /tmp/vyx-deploy-key.XXXXXX)
 printf '%s\n' "$pub" > "$key"
 gh repo deploy-key add "$key" -R "$repo" -t vyx-zomro-autodeploy
 rm -f "$key"
fi
ssh -F "$config" "$target" sh -s -- "$sha" "$repo" <<'REMOTE'
set -eu
sha=$1
repo=$2
command -v git >/dev/null || apt-get install -y -q git
# GitHub's published ed25519 host key fingerprint.
keys=$(mktemp)
ssh-keyscan -t ed25519 github.com > "$keys"
ssh-keygen -lf "$keys" | grep -q 'SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU' || { echo 'GitHub host key mismatch'; exit 1; }
install -m 600 "$keys" /root/.ssh/vyx_github_known_hosts
rm -f "$keys"
export GIT_SSH_COMMAND="ssh -i /root/.ssh/vyx_github -o IdentitiesOnly=yes -o UserKnownHostsFile=/root/.ssh/vyx_github_known_hosts -o StrictHostKeyChecking=yes -o BatchMode=yes"
[ -d /opt/vyx/source.git ] || git clone -q --bare "git@github.com:$repo.git" /opt/vyx/source.git
git --git-dir=/opt/vyx/source.git fetch -q origin +refs/heads/main:refs/remotes/origin/main
echo "$sha" > /opt/vyx/deployed-commit
rm -f /opt/vyx/failed-commit
install -m 755 /root/autodeploy.sh /usr/local/sbin/vyx-autodeploy
for unit in vyx-autodeploy.service vyx-autodeploy.timer vyx-token-seasons.service vyx-token-seasons.timer; do
 install -m 644 "/root/$unit" "/etc/systemd/system/$unit"; rm -f "/root/$unit"
done
rm -f /root/autodeploy.sh
systemctl daemon-reload
systemctl enable --now vyx-autodeploy.timer vyx-token-seasons.timer >/dev/null
echo "Automation ready: GitHub main deploys after tests; live commit $sha"
REMOTE
