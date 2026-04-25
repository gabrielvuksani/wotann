/*
 * CostScreen.kt — V9 FT.3.3 cost dashboard.
 *
 * WHAT: The cost dashboard — daily/weekly/monthly spend by provider
 *   and model, projection to month-end, alert thresholds, and a
 *   per-conversation breakdown.
 *
 * WHY: V9 spec § Cost Preview makes cost-awareness a first-class
 *   feature. Mobile users especially want to see "how much did I
 *   just spend" without context-switching to a desktop.
 *
 * WHERE: Reachable from Settings → Cost dashboard, or from the Cost
 *   Glance widget tap-through.
 *
 * HOW: Pulls cost data from the bridge (the desktop engine
 *   maintains the source of truth) via a CostRepository. Renders
 *   with Compose Canvas for the chart.
 *
 * Honest stub: placeholder.
 *
 * Reference: ios/WOTANN/Views/CostView.swift, src/telemetry/cost-tracker.ts
 */
package com.wotann.android.ui.cost

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Cost dashboard.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Inject CostViewModel
 *   - Subscribe to a Flow of cost rollups (today/week/month)
 *   - Render a Compose Canvas line chart
 *   - Per-provider breakdown (Anthropic / OpenAI / Bedrock / Vertex / etc.)
 *   - Per-conversation drill-down
 *   - "Set cap" CTA → opens a dialog
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CostScreen() {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Cost") },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Cost dashboard — V9 FT.3.3 scaffold")
            Text(
                "TODO: line chart of daily spend, per-provider breakdown, " +
                    "month-end projection, cap CTA, conversation drill-down.",
            )
        }
    }
}
