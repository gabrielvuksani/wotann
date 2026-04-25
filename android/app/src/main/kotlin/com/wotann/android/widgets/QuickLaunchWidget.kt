/*
 * QuickLaunchWidget.kt — V9 FT.3.3 quick-launch Glance widget.
 *
 * WHAT: Homescreen widget with three big tap targets: New Chat,
 *   New Workshop Task, Open Cost dashboard.
 *
 * WHY: V9 §FT.3.3 — the third widget. Saves 1-2 taps over opening
 *   the app and navigating to the right tab.
 *
 * WHERE: Registered as QuickLaunchWidgetReceiver in the manifest.
 *
 * HOW: Same pattern as the other widgets. Tap-targets are
 *   PendingIntents into MainActivity with extras that the activity
 *   decodes into nav-graph routes.
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
 *   - 3 tap targets in a Row: New Chat / New Task / Cost
 *   - Each is a Box with an Icon + Text label
 *   - PendingIntent per target → MainActivity with route extra
 *   - Style with M3 colors via glance-material3 helpers
 */
class QuickLaunchWidget : GlanceAppWidget() {
    @Composable
    override fun Content() {
        // V9 FT.3.3 scaffold: empty body.
    }

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        super.provideGlance(context, id)
    }
}

class QuickLaunchWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = QuickLaunchWidget()
}
