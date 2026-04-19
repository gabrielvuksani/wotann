# WOTANN Homebrew formula.
#
# Usage (once tap repo exists):
#   brew tap gabrielvuksani/wotann
#   brew install wotann
#
# Until the tap repo is set up, users can install directly from this repo:
#   brew install --build-from-source gabrielvuksani/wotann/wotann
#
# SHA placeholders get replaced by the release workflow once a versioned
# tarball is published. Do NOT commit real SHA values — they change
# every release. The workflow at .github/workflows/release.yml will
# regenerate this formula on each tag push.
class Wotann < Formula
  desc "Unified AI agent harness — multi-provider, portable, benchmark-first"
  homepage "https://wotann.com"
  license "MIT"
  version "0.4.0"

  # Platform-specific binaries. Homebrew resolves the right bottle per
  # OS + arch at install time.
  on_macos do
    on_arm do
      url "https://github.com/gabrielvuksani/wotann/releases/download/v#{version}/wotann-#{version}-macos-arm64.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA_FROM_RELEASE"
    end
    on_intel do
      url "https://github.com/gabrielvuksani/wotann/releases/download/v#{version}/wotann-#{version}-macos-x64.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA_FROM_RELEASE"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/gabrielvuksani/wotann/releases/download/v#{version}/wotann-#{version}-linux-arm64.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA_FROM_RELEASE"
    end
    on_intel do
      url "https://github.com/gabrielvuksani/wotann/releases/download/v#{version}/wotann-#{version}-linux-x64.tar.gz"
      sha256 "REPLACE_WITH_ACTUAL_SHA_FROM_RELEASE"
    end
  end

  # WOTANN ships as a single executable — no extra deps required at
  # runtime (Node is statically bundled via node --experimental-sea).
  # The test path below verifies the binary is functional post-install.

  def install
    bin.install "wotann"
  end

  test do
    # Smoke test: verify the CLI responds
    assert_match(/wotann/i, shell_output("#{bin}/wotann --version"))
  end
end
