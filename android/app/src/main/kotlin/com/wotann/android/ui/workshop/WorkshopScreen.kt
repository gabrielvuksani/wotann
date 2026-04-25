/*
 * WorkshopScreen.kt — V9 FT.3.3 Workshop tab.
 *
 * WHAT: The Workshop tab — agent task management, file browser,
 *   creation history, and quick-launch actions for "Build / Edit /
 *   Compare / Review / Schedule" workflows.
 *
 * WHY: V9 spec WORKSHOP feature is the centerpiece of the Android
 *   experience for power users — it's the surface where you see
 *   what the agent built and start new agent tasks.
 *
 * WHERE: Reachable from the bottom nav as the "Work" tab.
 *
 * HOW: Currently a placeholder. The 12-week implementation will:
 *     - Show a list of in-flight agent tasks (Workers)
 *     - Show recent Creations (files / commits / PRs the agent made)
 *     - Quick-action FAB for "New build" / "New edit"
 *     - File browser to inspect what the agent has access to
 *     - Switch into the Editor surface on file tap
 *
 * Honest stub: placeholder. Surface is stable.
 *
 * Reference: ios/WOTANN/Views/WorkshopView.swift
 */
package com.wotann.android.ui.workshop

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
 * Workshop tab. Empty body for the scaffold.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Inject WorkshopViewModel
 *   - List active workers (Flow<List<WorkerStatus>>)
 *   - List recent creations
 *   - Quick-launch FAB → new build / new edit / new review
 *   - File browser routing into EditorScreen
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkshopScreen() {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Workshop") },
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
            Text("Workshop surface — V9 FT.3.3 scaffold")
            Text(
                "TODO: list active workers, recent creations, " +
                    "quick-launch FAB, file browser, route into EditorScreen.",
            )
        }
    }
}
