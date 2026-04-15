#!/usr/bin/env bash
# WOTANN — one-command install
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/gabrielvuksani/wotann/main/install.sh | bash
#   ./install.sh              # install from npm (when published)
#   ./install.sh --local      # install from current working directory
#
# Idempotent: safe to re-run.

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m'

INSTALL_MODE="npm"
for arg in "$@"; do
  case "$arg" in
    --local) INSTALL_MODE="local" ;;
    --help|-h)
      echo "Usage: $0 [--local]"
      echo "  --local  Install from the current directory (use when developing)."
      exit 0
      ;;
  esac
done

OS_NAME="$(uname -s)"
case "$OS_NAME" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  *) echo -e "${RED}Unsupported OS: $OS_NAME${NC}"; exit 1 ;;
esac

# Ensure we can find npm-global bin dirs on both platforms. S4-7: Linux +
# nvm'd Node was missing — when `curl … | bash` runs as a subshell, the
# nvm init isn't sourced, so Node ends up off PATH. Cover both platforms.
case "$PLATFORM" in
  macos)
    for p in "/opt/homebrew/bin" "/usr/local/bin" "$HOME/.nvm/versions/node/$(command -v node >/dev/null && node -v | sed 's/v//' || echo NONE)/bin"; do
      case ":$PATH:" in *":$p:"*) ;; *) PATH="$p:$PATH" ;; esac
    done
    ;;
  linux)
    # Source nvm if it's installed so the nvm'd Node becomes available.
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
      # shellcheck disable=SC1091
      . "$HOME/.nvm/nvm.sh"
    fi
    for p in "/usr/local/bin" "$HOME/.local/bin" "$HOME/.npm-global/bin"; do
      case ":$PATH:" in *":$p:"*) ;; *) PATH="$p:$PATH" ;; esac
    done
    ;;
esac
export PATH

echo ""
echo -e "${CYAN}${BOLD} __        _____  _____  _    _   _ _   _ ${NC}"
echo -e "${CYAN}${BOLD} \\ \\      / / _ \\|_   _|/ \\  | \\ | | \\ | |${NC}"
echo -e "${CYAN}${BOLD}  \\ \\ /\\ / / | | | | | / _ \\ |  \\| |  \\| |${NC}"
echo -e "${CYAN}${BOLD}   \\ V  V /| |_| | | |/ ___ \\| |\\  | |\\  |${NC}"
echo -e "${CYAN}${BOLD}    \\_/\\_/  \\___/  |_/_/   \\_\\_| \\_|_| \\_|${NC}"
echo ""
echo -e "${DIM}The All-Father of AI Agent Harnesses${NC}"
echo ""

# ---------------------------------------------------------------- Node check
require_node_version=20

if ! command -v node >/dev/null 2>&1; then
  echo -e "${YELLOW}Node.js not found. Installing Node 22 via nvm...${NC}"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
  nvm install 22
  nvm use 22
  echo -e "${GREEN}OK: Node.js installed${NC}"
  echo -e "${DIM}  Re-open your terminal for Node to be on PATH in new shells.${NC}"
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt "$require_node_version" ]; then
  echo -e "${RED}Node ${NODE_MAJOR} detected. WOTANN requires Node >= ${require_node_version}.${NC}"
  echo -e "${DIM}  Upgrade via: nvm install ${require_node_version} && nvm use ${require_node_version}${NC}"
  exit 1
fi
echo -e "${GREEN}OK: Node $(node -v)${NC}"

if ! command -v npm >/dev/null 2>&1; then
  echo -e "${RED}npm not found. Install Node with npm bundled.${NC}"
  exit 1
fi

# ---------------------------------------------------------------- Idempotency
if command -v wotann >/dev/null 2>&1; then
  CURRENT="$(wotann --version 2>/dev/null || echo unknown)"
  echo -e "${DIM}Existing install detected: ${CURRENT}. Reinstalling...${NC}"
fi

# ---------------------------------------------------------------- Install
if [ "$INSTALL_MODE" = "local" ]; then
  if [ ! -f "package.json" ]; then
    echo -e "${RED}--local specified but no package.json in current dir.${NC}"
    exit 1
  fi
  echo -e "${CYAN}Installing WOTANN from local source...${NC}"
  npm install
  npm run build
  npm install -g .
else
  echo -e "${CYAN}Installing WOTANN from npm...${NC}"
  if ! npm install -g wotann 2>/dev/null; then
    if [ -f "package.json" ]; then
      echo -e "${DIM}npm registry install failed — falling back to local build.${NC}"
      npm install
      npm run build
      npm install -g .
    else
      echo -e "${YELLOW}wotann not on npm yet. Re-run with --local from the repo root.${NC}"
      exit 1
    fi
  fi
fi

# ---------------------------------------------------------------- Verify
if ! command -v wotann >/dev/null 2>&1; then
  # Account for user-scoped npm prefixes that may not be on PATH.
  NPM_BIN="$(npm bin -g 2>/dev/null || npm prefix -g)/bin"
  case ":$PATH:" in *":$NPM_BIN:"*) ;; *) PATH="$NPM_BIN:$PATH" ;; esac
fi
if command -v wotann >/dev/null 2>&1; then
  echo -e "${GREEN}OK: WOTANN $(wotann --version) installed${NC}"
else
  echo -e "${RED}wotann command still not on PATH. Add npm global bin to PATH:${NC}"
  echo -e "${DIM}  export PATH=\"\$(npm bin -g):\$PATH\"${NC}"
  exit 1
fi

# ---------------------------------------------------------------- Detect providers
echo ""
echo -e "${CYAN}Detecting providers...${NC}"
PROVIDERS_FOUND=0

if [ -n "${ANTHROPIC_API_KEY:-}" ] || [ -f "$HOME/.claude/credentials.json" ]; then
  echo -e "${GREEN}  - Anthropic (Claude)${NC}"
  PROVIDERS_FOUND=$((PROVIDERS_FOUND + 1))
fi
if [ -n "${OPENAI_API_KEY:-}" ]; then
  echo -e "${GREEN}  - OpenAI${NC}"
  PROVIDERS_FOUND=$((PROVIDERS_FOUND + 1))
fi
if [ -f "$HOME/.codex/auth.json" ]; then
  echo -e "${GREEN}  - ChatGPT Codex${NC}"
  PROVIDERS_FOUND=$((PROVIDERS_FOUND + 1))
fi
if [ -n "${GH_TOKEN:-}" ] || [ -n "${GITHUB_TOKEN:-}" ]; then
  echo -e "${GREEN}  - GitHub Copilot${NC}"
  PROVIDERS_FOUND=$((PROVIDERS_FOUND + 1))
fi
if command -v ollama >/dev/null 2>&1; then
  echo -e "${GREEN}  - Ollama (local, free)${NC}"
  PROVIDERS_FOUND=$((PROVIDERS_FOUND + 1))
fi

# S4-7 — offer to install Ollama when no providers are detected. Gated behind
# WOTANN_INSTALL_OLLAMA=1 by default so we don't silently pull 700 MB over a
# curl-pipe install; flag discovery gives the user an explicit opt-in.
if [ "$PROVIDERS_FOUND" -eq 0 ]; then
  echo -e "${YELLOW}  No providers detected.${NC}"

  if [ "${WOTANN_INSTALL_OLLAMA:-0}" = "1" ] && ! command -v ollama >/dev/null 2>&1; then
    echo -e "${CYAN}  Installing Ollama (WOTANN_INSTALL_OLLAMA=1)...${NC}"
    if [ "$PLATFORM" = "macos" ]; then
      # The official installer respects sudo prompts; we don't
      # swallow them — the user must opt into elevation.
      curl -fsSL https://ollama.ai/install.sh | sh
    elif [ "$PLATFORM" = "linux" ]; then
      curl -fsSL https://ollama.ai/install.sh | sh
    fi
    if command -v ollama >/dev/null 2>&1; then
      echo -e "${GREEN}  OK: Ollama installed. Start with: ollama serve${NC}"
      echo -e "${DIM}  Pull a model: ollama pull gemma3${NC}"
    else
      echo -e "${YELLOW}  Ollama install failed. Install manually: https://ollama.ai${NC}"
    fi
  else
    echo -e "${DIM}  Run: wotann init --free  (Ollama + free APIs)${NC}"
    echo -e "${DIM}  Or:  wotann init         (guided setup)${NC}"
    if ! command -v ollama >/dev/null 2>&1; then
      echo -e "${DIM}  Install Ollama: WOTANN_INSTALL_OLLAMA=1 re-run this script${NC}"
      echo -e "${DIM}                   or visit https://ollama.ai${NC}"
    fi
  fi
fi

echo ""
echo -e "${GREEN}${BOLD}Next steps:${NC}"
echo -e "  ${CYAN}wotann${NC}              Start the interactive TUI"
echo -e "  ${CYAN}wotann init${NC}         Configure a workspace"
echo -e "  ${CYAN}wotann init --free${NC}  Free-tier setup (Ollama)"
echo -e "  ${CYAN}wotann --help${NC}       See all commands"
echo ""
