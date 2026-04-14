import { execFileSync } from "node:child_process";
import { platform } from "node:os";
import { discoverOllamaModels } from "../providers/ollama-adapter.js";

export interface LocalStatusReport {
  readonly ollamaInstalled: boolean;
  readonly ollamaReachable: boolean;
  readonly ollamaUrl: string;
  readonly installedModels: readonly string[];
  readonly runningModels: readonly string[];
  readonly kvCacheType: string;
  readonly platform: string;
}

export async function getLocalStatusReport(): Promise<LocalStatusReport> {
  const ollamaUrl = process.env["OLLAMA_URL"] ?? process.env["OLLAMA_HOST"] ?? "http://localhost:11434";
  const ollamaInstalled = isCommandAvailable("ollama");
  const installedModels = (await discoverOllamaModels(ollamaUrl)).map((model) => model.name);
  const runningModels = ollamaInstalled ? getRunningOllamaModels() : [];

  return {
    ollamaInstalled,
    ollamaReachable: installedModels.length > 0,
    ollamaUrl,
    installedModels,
    runningModels,
    kvCacheType: process.env["OLLAMA_KV_CACHE_TYPE"] ?? "q8_0",
    platform: platform(),
  };
}

function getRunningOllamaModels(): readonly string[] {
  try {
    const output = execFileSync("ollama", ["ps"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: "pipe",
    });
    const lines = output.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length <= 1) return [];

    return lines.slice(1).map((line) => line.split(/\s{2,}/)[0] ?? line).filter(Boolean);
  } catch {
    return [];
  }
}

function isCommandAvailable(command: string): boolean {
  try {
    const whichCommand = platform() === "win32" ? "where" : "which";
    execFileSync(whichCommand, [command], {
      encoding: "utf-8",
      timeout: 3000,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}
