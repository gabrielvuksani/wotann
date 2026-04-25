/*
 * ProviderLadder.kt — V9 FT.3.3 provider ladder model.
 *
 * WHAT: The data model + decision rules for the WOTANN provider
 *   ladder. Mirrors the desktop `src/providers/ladder.ts` ladder
 *   types so the UI can render rung selectors and the
 *   Chat/Workshop surfaces can show "running on Sonnet, costing $0.02".
 *
 * WHY: V9 spec specifies that every cross-provider feature on
 *   Android matches the desktop ladder. Rather than re-building the
 *   ladder logic on Android, we render the desktop's authoritative
 *   ladder via this UI-only model.
 *
 * WHERE: Used by domain/agents/AgentRepository (rung passed in /
 *   out of tasks), and by Settings to render the per-feature
 *   default-rung pickers.
 *
 * HOW: Only a data model. The actual decision logic lives on the
 *   desktop and is pushed to the phone via the bridge.
 *
 * Honest stub: data classes only. No business logic on this side.
 */
package com.wotann.android.domain.providers

import com.wotann.android.domain.agents.ProviderRung

/**
 * A single provider model — e.g. Anthropic's claude-sonnet-4 or
 * OpenAI's gpt-4o. Pulled from the desktop's catalog over the
 * bridge, NOT hardcoded here.
 */
data class ProviderModel(
    val provider: String,           // "anthropic", "openai", "google", …
    val modelId: String,            // "claude-sonnet-4", "gpt-4o-mini", …
    val displayName: String,        // "Claude Sonnet 4"
    val rung: ProviderRung,         // Bargain / Workhorse / Frontier / …
    val contextWindowTokens: Long,  // 200_000, 1_000_000, …
    val inputCostPerMillionTokens: Double,
    val outputCostPerMillionTokens: Double,
    val supportsStreaming: Boolean,
    val supportsTools: Boolean,
    val supportsVision: Boolean,
    val supportsThinking: Boolean,
)

/**
 * The full ladder snapshot. Refreshed on connection to the desktop
 * and cached locally for offline rendering.
 */
data class ProviderLadder(
    val models: List<ProviderModel>,
    val refreshedAtMillis: Long,
)

/**
 * Default rung choice for a feature. The user can override per
 * feature in Settings.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Sync this model with desktop on connection
 *   - Cache the last-known ladder in Room
 *   - Render a picker in Settings
 *   - Pass the chosen rung into AgentRepository.startTask
 */
data class FeatureRungChoice(
    val feature: String,            // "chat", "workshop", "review", …
    val defaultRung: ProviderRung,
    val userOverride: ProviderRung?,
)
