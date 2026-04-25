/*
 * CostWidget.kt — V9 FT.3.3 cost-spend Glance widget.
 *
 * WHAT: A homescreen widget showing today's WOTANN spend and the
 *   month-to-date total. Tapping it deep-links into the Cost
 *   dashboard.
 *
 * WHY: V9 §FT.3.3 lists three Glance widgets — Cost, Agent Status,
 *   Quick Launch. Cost is the most-requested mobile feature: users
 *   want to see "how much did I spend today?" at a glance.
 *
 * WHERE: Registered in AndroidManifest.xml under the
 *   CostWidgetReceiver receiver. The widget metadata
 *   (initial layout, min/max sizes) lives in
 *   app/src/main/res/xml/widget_cost_info.xml — deferred to the impl
 *   phase since it requires a real layout to ship.
 *
 * HOW: Skeleton — empty Compose body. The 12-week impl:
 *     - Read cost from a DataStore-cached rollup
 *     - Render two big numbers + a sparkline
 *     - PendingIntent to open MainActivity → CostScreen
 *     - Update via PeriodicWorkRequest every 30 minutes
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
 *   - Read CostState from DataStore
 *   - Render today + month-to-date as Glance Text
 *   - Render mini sparkline as Image
 *   - PendingIntent to open CostScreen
 *   - Provide WidgetState updater via WorkManager
 */
class CostWidget : GlanceAppWidget() {
    @Composable
    override fun Content() {
        // V9 FT.3.3 scaffold: empty body. Real impl renders cost
        // numbers + a tap-target into CostScreen.
    }

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        // V9 FT.3.3 scaffold: leave default. Real impl loads CostState
        // and provides it to a CompositionLocal that Content() reads.
        super.provideGlance(context, id)
    }
}

/**
 * AppWidget receiver — wires the widget into the system.
 */
class CostWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = CostWidget()
}
