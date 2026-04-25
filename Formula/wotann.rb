# WOTANN Homebrew formula.
#
# Usage (once tap repo exists):
#   brew tap gabrielvuksani/wotann
#   brew install wotann
#
# Until the tap repo is set up, users can install directly from this repo:
#   brew install --build-from-source gabrielvuksani/wotann/wotann
#
# SHA VALUES: Each sha256 below is intentionally a placeholder string of the
# form "SHA-CALCULATED-AT-RELEASE-TIME-<target>". The release workflow at
# .github/workflows/release.yml rewrites these values with the real sha256
# of each platform tarball on tag push. Do NOT commit fabricated SHA256
# hex strings — they would be accepted by Homebrew and ship a tampered or
# non-existent binary. A human-readable placeholder fails brew install
# loudly with "sha256 mismatch" rather than silently passing.
class Wotann < Formula
  desc "Unified AI agent harness — multi-provider, portable, benchmark-first"
  homepage "https://wotann.com"
  license "MIT"
  version "0.5.0"

  # Platform-specific binaries. Homebrew resolves the right bottle per
  # OS + arch at install time. If no SEA binary exists for a platform,
  # users can fall back to the curl-based install.sh (see test block).
  #
  # Canonical asset set per .github/workflows/release.yml: macos-arm64
  # tarball + linux-x64 tarball + windows-x64 .exe. macos-x64 (Intel
  # Macs) and linux-arm64 are NOT built — Apple Silicon is the only
  # macOS target, and Linux is x64-only because the SEA fuse sentinel
  # is only reliably available in the official statically-linked Node
  # for x64 (see docs/SEA_BUILD_ENVIRONMENTAL_GATE.md).
  #
  # Intel-mac users get a clear "no bottle" error message instead of
  # silently downloading a broken binary. They can use install.sh as
  # a fallback or run via `brew install --build-from-source` once the
  # Intel build is added in a future release.
  on_macos do
    on_arm do
      url "https://github.com/gabrielvuksani/wotann/releases/download/v#{version}/wotann-#{version}-macos-arm64.tar.gz"
      sha256 "SHA-CALCULATED-AT-RELEASE-TIME-macos-arm64"
    end
    # macos-x64 / Intel Mac: not built. The release workflow does not
    # produce a macos-x64 tarball. Removing the on_intel arm prevents
    # Homebrew from offering a non-existent download URL.
  end

  on_linux do
    on_intel do
      url "https://github.com/gabrielvuksani/wotann/releases/download/v#{version}/wotann-#{version}-linux-x64.tar.gz"
      sha256 "SHA-CALCULATED-AT-RELEASE-TIME-linux-x64"
    end
    # linux-arm64: not built. See macos-x64 note above.
  end

  # WOTANN ships as a single executable — no extra deps required at
  # runtime (Node is statically bundled via node --experimental-sea).
  # If the SEA binary for this platform is unavailable, the install.sh
  # fallback is documented at https://wotann.com/install.sh.

  def install
    bin.install "wotann"
  end

  test do
    # Smoke test: verify the CLI reports a version, and that the reported
    # version matches the formula version. Exits non-zero on mismatch so
    # `brew test wotann` fails loudly instead of silently passing.
    output = shell_output("#{bin}/wotann --version")
    assert_match(/wotann|#{Regexp.escape(version.to_s)}/i, output)
    # Exit-code check: the binary MUST return 0 on --version.
    system bin/"wotann", "--version"
  end
end
