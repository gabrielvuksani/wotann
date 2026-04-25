/*
 * SettingsScreen.kt — V9 FT.3.3 You/Settings tab.
 *
 * WHAT: The "You" tab — settings, account, pairing status, cost
 *   dashboard entry-point, theme toggle, and privacy controls.
 *
 * WHY: V9 §FT.3.3 puts user settings under a "You" identity surface
 *   rather than a buried Settings icon. This is consistent with iOS
 *   and the desktop-app's "You" panel.
 *
 * WHERE: Reachable from the bottom nav.
 *
 * HOW: Eventually a Compose-based preferences list backed by
 *   DataStore. The 12-week implementation will surface:
 *     - Pairing status + "Re-pair" button
 *     - Default model selection (per provider)
 *     - Cost cap (daily / monthly hard cap)
 *     - Theme toggle (light / dark / dynamic-color on/off)
 *     - Voice on/off + voice provider
 *     - Privacy controls (telemetry opt-in, data retention)
 *     - "About WOTANN" → version, build, license, attributions
 *
 * Honest stub: placeholder.
 *
 * Reference: ios/WOTANN/Views/SettingsView.swift
 */
package com.wotann.android.ui.settings

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
 * Settings tab. Empty body for the scaffold.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Inject SettingsViewModel + DataStore
 *   - Pairing status row → triggers PairingScreen
 *   - Cost cap rows → number entry
 *   - Theme toggle
 *   - Voice on/off
 *   - Privacy controls (telemetry toggle, data retention slider)
 *   - About row → version / build / license / open-source attributions
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen() {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("You") },
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
            Text("Settings surface — V9 FT.3.3 scaffold")
            Text(
                "TODO: pairing status, cost cap, theme toggle, " +
                    "voice settings, privacy controls, about screen.",
            )
        }
    }
}
