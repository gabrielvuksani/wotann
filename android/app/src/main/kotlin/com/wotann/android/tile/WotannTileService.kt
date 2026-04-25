/*
 * WotannTileService.kt — V9 FT.3.3 Quick Settings Tile.
 *
 * WHAT: A Quick Settings tile (the icons that appear when the user
 *   pulls down the notification shade twice). Tapping the WOTANN
 *   tile opens the app at the Workshop tab.
 *
 * WHY: V9 §FT.3.3 lists the QS Tile as a delight feature — power
 *   users can launch WOTANN without ever leaving the lockscreen.
 *
 * WHERE: Registered as WotannTileService in the manifest under the
 *   `android.service.quicksettings.action.QS_TILE` intent filter.
 *
 * HOW: Skeleton. The 12-week impl:
 *     - Override onClick: build a PendingIntent into MainActivity
 *       with extra `route=workshop`
 *     - Override onTileAdded: log that the user added the tile
 *     - Override onTileRemoved: cleanup
 *     - Override onStartListening / onStopListening: refresh the
 *       tile state (label / icon) when the QS panel is opened
 *
 * Honest stub: empty TileService skeleton.
 */
package com.wotann.android.tile

import android.service.quicksettings.TileService

/**
 * Quick Settings tile that opens the app to the Workshop tab.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - onClick → start MainActivity with route extra
 *   - onStartListening → update tile label with "active task count"
 *   - onTileAdded → telemetry event "tile_added" (opt-in)
 */
class WotannTileService : TileService() {

    override fun onClick() {
        super.onClick()
        // V9 FT.3.3 scaffold:
        //   - Build PendingIntent into MainActivity (Workshop tab)
        //   - startActivityAndCollapse(pendingIntent)
    }

    override fun onStartListening() {
        super.onStartListening()
        // V9 FT.3.3 scaffold: real impl updates tile state from
        // AgentRepository.observeTasks() current count.
    }

    override fun onStopListening() {
        super.onStopListening()
        // V9 FT.3.3 scaffold: cleanup.
    }
}
