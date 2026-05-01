#!/usr/bin/env bash
# Run on a dedicated Ubuntu execution host. Does not set Docker's default runtime.
set -euo pipefail
if ! command -v bzip2 >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends bzip2
fi
runsc_release="${RUNSC_RELEASE:-20260907.0}"
runsc_arch="$(uname -m)"
case "$runsc_arch" in aarch64|x86_64) ;; *) echo 'Unsupported gVisor architecture' >&2; exit 1;; esac
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
cd "$work_dir"
base_url="https://storage.googleapis.com/gvisor/releases/release/${runsc_release}/${runsc_arch}"
curl -fsSLO "${base_url}/gvisor.tar.bz2"
curl -fsSLO "${base_url}/gvisor.tar.bz2.sha512"
sha512sum -c gvisor.tar.bz2.sha512
sudo tar -xjf gvisor.tar.bz2 -C /usr/local/bin
sudo /usr/local/bin/runsc install
sudo systemctl reload docker
/usr/local/bin/runsc --version
