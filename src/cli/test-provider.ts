/**
 * Test a provider end-to-end with a real API call.
 * Usage: npx tsx src/cli/test-provider.ts [provider]
 */

import chalk from "chalk";
import { discoverProviders, formatFullStatus } from "../providers/discovery.js";
import { createProviderInfrastructure } from "../providers/registry.js";
import type { ProviderName } from "../core/types.js";

async function main(): Promise<void> {
  const targetProvider = (process.argv[2] as ProviderName) ?? undefined;

  console.log(chalk.bold("\nWOTANN Provider Test\n"));

  // 1. Discover all providers
  const providers = await discoverProviders();
  const statuses = formatFullStatus(providers);

  console.log(chalk.bold("Detected providers:"));
  for (const s of statuses) {
    const icon = s.available ? chalk.green("●") : chalk.red("○");
    console.log(`  ${icon} ${s.label} (${s.billing}) — ${s.models.slice(0, 3).join(", ") || "none"}`);
  }
  console.log();

  const active = providers.filter((p) => p.provider !== "free" || p.models.length > 0);
  if (active.length === 0) {
    console.log(chalk.red("No providers available. Set up auth first:"));
    console.log(chalk.dim("  Anthropic: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN"));
    console.log(chalk.dim("  OpenAI: OPENAI_API_KEY"));
    console.log(chalk.dim("  Codex: npx @openai/codex (auto-creates ~/.codex/auth.json)"));
    console.log(chalk.dim("  Ollama: ollama serve && ollama pull qwen3.5"));
    process.exit(1);
  }

  // 2. Create infrastructure
  const infra = createProviderInfrastructure(providers);
  console.log(chalk.bold(`Adapters created: ${infra.adapters.size}`));
  for (const [name] of infra.adapters) {
    console.log(`  ✓ ${name}`);
  }
  console.log();

  // 3. Pick the target provider
  const providerToTest = targetProvider
    ?? (infra.adapters.has("codex") ? "codex"
      : infra.adapters.has("anthropic") ? "anthropic"
      : infra.adapters.has("openai") ? "openai"
      : infra.adapters.has("ollama") ? "ollama"
      : [...infra.adapters.keys()][0]);

  if (!providerToTest) {
    console.log(chalk.red("No testable provider found."));
    process.exit(1);
  }

  console.log(chalk.bold(`Testing: ${providerToTest}`));
  console.log(chalk.dim("Prompt: 'What is 2+2? Reply with just the number.'\n"));

  // 4. Make the actual API call
  const startTime = Date.now();
  let fullResponse = "";
  let responseModel = "";
  let responseProvider = "";
  let tokensUsed = 0;

  try {
    for await (const chunk of infra.bridge.query({
      prompt: "What is 2+2? Reply with just the number.",
      provider: providerToTest,
    })) {
      if (chunk.type === "text") {
        process.stdout.write(chunk.content);
        fullResponse += chunk.content;
      } else if (chunk.type === "error") {
        console.log(chalk.red(`\nError: ${chunk.content}`));
      } else if (chunk.type === "done") {
        tokensUsed = chunk.tokensUsed ?? 0;
      }
      if (chunk.model) responseModel = chunk.model;
      if (chunk.provider) responseProvider = chunk.provider;
    }

    const elapsed = Date.now() - startTime;
    console.log(chalk.dim(`\n\n--- Response from ${responseProvider}/${responseModel} in ${elapsed}ms (${tokensUsed} tokens) ---`));

    if (fullResponse.includes("4")) {
      console.log(chalk.green("\n✓ Provider test PASSED — got correct response."));
    } else if (fullResponse.length > 0) {
      console.log(chalk.yellow(`\n⚠ Provider responded but answer unclear: "${fullResponse.trim()}"`));
    } else {
      console.log(chalk.red("\n✗ No response received."));
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`\n✗ Provider test FAILED: ${msg}`));
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
