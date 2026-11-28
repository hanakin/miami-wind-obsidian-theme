#!/bin/sh
# Updates the workbench on the server it runs on: pulls the branch, installs, restarts.
#   workbench/deploy/deploy.sh            update the branch that is checked out
#   workbench/deploy/deploy.sh <branch>   switch to another branch and update it
#
# One-time setup beside this (no root needed): ~/.config/miami-wind-workbench.env with PORT,
# WORKBENCH_ORIGIN and WORKBENCH_FRAME_ORIGIN, and the two tailnet addresses:
#   tailscale serve --bg --https=8443 http://127.0.0.1:$PORT
#   tailscale serve --bg --https=8444 http://127.0.0.1:$((PORT + 1))
set -eu
export PATH="$HOME/.local/share/mise/shims:$PATH"
cd "$(dirname "$0")/../.."
branch=${1:-$(git rev-parse --abbrev-ref HEAD)}
git fetch origin "$branch"
git checkout "$branch"
git merge --ff-only "origin/$branch"
bun install --frozen-lockfile
mkdir -p "$HOME/.config/systemd/user"
cp workbench/deploy/miami-wind-workbench.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable miami-wind-workbench.service
systemctl --user restart miami-wind-workbench.service
sleep 3
systemctl --user --no-pager --lines=5 status miami-wind-workbench.service
echo "Deployed $branch at $(git rev-parse --short HEAD)."
