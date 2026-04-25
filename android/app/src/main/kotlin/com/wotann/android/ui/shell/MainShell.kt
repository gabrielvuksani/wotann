/*
 * MainShell.kt — V9 FT.3.3 4-tab navigation shell.
 *
 * WHAT: The top-level Composable that draws the 4-tab Material 3
 *   NavigationSuiteScaffold (Home / Chat / Work / You) and dispatches
 *   to the per-tab screens.
 *
 * WHY: V9 §FT.3.3 specifies a 4-tab Android UX that mirrors the iOS
 *   layout. NavigationSuiteScaffold (M3 adaptive) is the canonical
 *   pattern — it auto-switches between bottom nav (phone), nav rail
 *   (tablet), and nav drawer (large tablet / foldable) without any
 *   per-form-factor code.
 *
 * WHERE: Called once from MainActivity inside the WotannTheme block.
 *
 * HOW:
 *   - rememberSaveable currentTab so the tab survives rotation
 *   - 4 destinations, each maps to a top-level screen composable
 *   - Each screen is its own composable; navigation INTO a tab
 *     (e.g. Chat → conversation detail) happens with NavHost inside
 *     the tab, not at the shell level
 *
 * Honest stub: the tab-internal NavHosts are deferred to the 12-week
 * implementation. This scaffold renders the placeholder screens
 * directly — clicking a tab swaps the screen, that's it.
 */
package com.wotann.android.ui.shell

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.vector.ImageVector
import com.wotann.android.ui.chat.ChatScreen
import com.wotann.android.ui.editor.EditorScreen
import com.wotann.android.ui.settings.SettingsScreen
import com.wotann.android.ui.workshop.WorkshopScreen

/**
 * The four top-level destinations. Order matches the iOS spec: Home
 * (Chat) → Editor → Workshop → You (Settings).
 *
 * Why "Chat" is at the Home tab: the iOS app uses Home as the
 * default entry point and Chat is the most-used surface, so we
 * wire Home → ChatScreen and reserve a future "Home dashboard" for
 * a later phase.
 */
private enum class MainTab(
    val label: String,
    val icon: ImageVector,
) {
    Home("Home", Icons.Filled.Home),
    Chat("Chat", Icons.Filled.ChatBubble),
    Work("Work", Icons.Filled.Build),
    You("You", Icons.Filled.Person),
}

/**
 * Render the 4-tab navigation shell. Selected tab is preserved
 * across rotation via rememberSaveable.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Replace the inline screens with per-tab NavHosts
 *   - Wire the system back-press to pop the inner stack first,
 *     then fall through to tab-switch, then to app exit
 *   - Add a top app bar that's tab-aware (Chat shows "New chat",
 *     Editor shows file path, etc.)
 */
@Composable
fun MainShell() {
    var currentTab by rememberSaveable { mutableStateOf(MainTab.Home) }

    NavigationSuiteScaffold(
        navigationSuiteItems = {
            MainTab.entries.forEach { tab ->
                item(
                    selected = tab == currentTab,
                    onClick = { currentTab = tab },
                    icon = { Icon(tab.icon, contentDescription = tab.label) },
                    label = { Text(tab.label) },
                )
            }
        },
    ) {
        when (currentTab) {
            MainTab.Home -> ChatScreen()
            MainTab.Chat -> ChatScreen()  // duplicate until Home gets its own dashboard
            MainTab.Work -> WorkshopScreen()
            MainTab.You -> SettingsScreen()
        }
        // Editor is nested inside the Work tab in the V9 spec — it's
        // reachable from Workshop, not as a top-level tab. Importing
        // EditorScreen here so the symbol is visible in the file.
        @Suppress("UNUSED_EXPRESSION")
        EditorScreen
    }
}
