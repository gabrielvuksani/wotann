/*
 * AgentStatusWidget.kt — V9 FT.3.3 agent status Glance widget.
 *
 * WHAT: Homescreen widget showing whether an agent is currently
 *   running, what step it's on, and a "Stop" action.
 *
 * WHY: V9 §FT.3.3 wants the user to monitor long-running agent
 *   tasks without unlocking the phone. The widget lives next to the
 *   Cost widget on the homescreen.
 *
 * WHERE: Registered as AgentStatusWidgetReceiver in the manifest.
 *
 * HOW: Same skeleton pattern as CostWidget.
 *
 * Honest stub: empty body.
 */
package com.wotann.android.widgets

import androidx.compose.runtime.Composable
import androidx.glance.GlanceId
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import android.content.Context

/**
 * Glance widget body.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Read AgentStatus snapshot via DataStore
 *   - Render running/idle indicator + active task title
 *   - Stop button → PendingIntent into AgentForegroundService
 *   - Tap-anywhere-else → MainActivity → Workshop tab
 *   - Update on event push (rather than polling)
 */
class AgentStatusWidget : GlanceAppWidget() {
    @Composable
    override fun Content() {
        // V9 FT.3.3 scaffold: empty body.
    }

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        super.provideGlance(context, id)
    }
}

class AgentStatusWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = AgentStatusWidget()
}
