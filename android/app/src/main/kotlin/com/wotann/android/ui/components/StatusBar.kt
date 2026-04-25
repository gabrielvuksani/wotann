/*
 * StatusBar.kt — V9 FT.3.3 in-app status indicator.
 *
 * WHAT: A persistent status row composable shown above content in
 *   surfaces that need it (Chat, Workshop) — indicates pairing
 *   status, network connectivity, current model, cost-cap state.
 *
 * WHY: V9 §FT.3.3 specifies a thin status indicator so the user
 *   always knows whether the bridge is healthy, what model is
 *   active, and whether they're near a cost cap. iOS uses an
 *   equivalent SwiftUI component.
 *
 * WHERE: Composed inside ChatScreen and WorkshopScreen as the
 *   first child of the screen content. NOT shown in Settings or
 *   Cost (those screens render their own status info inline).
 *
 * HOW: Currently a placeholder. The 12-week impl wires this to a
 *   StatusViewModel that subscribes to the bridge connection state
 *   and the cost-cap flow.
 *
 * Honest stub: placeholder Text.
 */
package com.wotann.android.ui.components

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/**
 * Status indicator row.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Inject StatusViewModel
 *   - Show pairing status (connected / reconnecting / offline)
 *   - Show current model (e.g. "claude-sonnet-4")
 *   - Show cost progress (small bar; red at 90%+)
 *   - Tap → open Cost dashboard
 */
@Composable
fun StatusBar(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp),
    ) {
        Text("Status: scaffold")
    }
}
