/**
 * Platform detection and capability mapping.
 */

import { platform, arch, release } from "node:os";
import { execFileSync } from "node:child_process";

export type OSType = "darwin" | "linux" | "win32" | "unknown";

export interface PlatformInfo {
  readonly os: OSType;
  readonly arch: string;
  readonly release: string;
  readonly sandbox: "seatbelt" | "landlock" | "docker" | "none";
  readonly screenshot: string | null;
  readonly a11y: string | null;
  readonly inputControl: string | null;
}

export function detectPlatform(): PlatformInfo {
  const os = platform() as OSType;

  switch (os) {
    case "darwin":
      return {
        os: "darwin",
        arch: arch(),
        release: release(),
        sandbox: "seatbelt",
        screenshot: "screencapture",
        a11y: "AXUIElement",
        inputControl: hasBinary("cliclick") ? "cliclick" : null,
      };
    case "linux":
      return {
        os: "linux",
        arch: arch(),
        release: release(),
        sandbox: "landlock",
        screenshot: hasBinary("maim") ? "maim" : hasBinary("scrot") ? "scrot" : null,
        a11y: hasBinary("gdbus") ? "AT-SPI2" : null,
        inputControl: hasBinary("xdotool") ? "xdotool" : null,
      };
    case "win32":
      return {
        os: "win32",
        arch: arch(),
        release: release(),
        sandbox: "none",
        screenshot: "powershell",
        a11y: "UIAutomation",
        inputControl: "powershell",
      };
    default:
      return {
        os: "unknown",
        arch: arch(),
        release: release(),
        sandbox: "none",
        screenshot: null,
        a11y: null,
        inputControl: null,
      };
  }
}

function hasBinary(name: string): boolean {
  try {
    execFileSync("which", [name], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function getNodeVersion(): string {
  return process.version;
}

export function isNodeVersionSupported(): boolean {
  const major = parseInt(process.version.slice(1), 10);
  return major >= 20;
}
