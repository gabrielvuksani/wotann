/*
 * MainActivity — V9 FT.3.3 scaffold.
 *
 * WHAT: The single ComponentActivity that hosts the entire Compose
 *   UI. Sets up the splash screen, applies the WOTANN theme, and
 *   inflates the 4-tab MainShell.
 *
 * WHY: V9 §FT.3.3 mandates a single-activity Compose app. Multiple
 *   activities fragment the back-stack and break Material 3
 *   shared-element transitions. One activity + Compose Navigation is
 *   the modern pattern.
 *
 * WHERE: Declared in AndroidManifest.xml as the launcher activity.
 *   Receives standard launcher intents AND the share-text intent
 *   AND wotann:// deep links.
 *
 * HOW:
 *   - installSplashScreen() before super.onCreate(), per Android 12+
 *     splash-screen API rules
 *   - enableEdgeToEdge() so the M3 navigation bar can render glass
 *     under the system bars
 *   - setContent { } with the WotannTheme wrapper and MainShell
 *
 * Honest stub: intent routing for share-text and wotann:// deep
 * links is a TODO marker — the 12-week implementation wires this
 * into the Chat tab's ViewModel.
 */
package com.wotann.android

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.wotann.android.ui.shell.MainShell
import com.wotann.android.ui.theme.WotannTheme
import dagger.hilt.android.AndroidEntryPoint

/**
 * Single activity. Hilt's @AndroidEntryPoint lets the activity
 * inject ViewModels via the Hilt navigation-compose helper.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Handle Intent.ACTION_SEND for share-text
 *   - Handle wotann:// deep-link routing
 *   - Restore state on configuration change (process death is
 *     handled by Compose + ViewModel automatically)
 *   - Predictive back-gesture (Android 14+) when navigating tabs
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        // Splash screen MUST be installed before super.onCreate.
        installSplashScreen()

        super.onCreate(savedInstanceState)

        // Edge-to-edge so the M3 nav surface can extend under the
        // system bars. The status-bar / nav-bar tinting is handled by
        // the Compose theme.
        enableEdgeToEdge()

        setContent {
            WotannTheme {
                MainShell()
            }
        }
    }

    /**
     * Hook for incoming intents that arrive while the activity is
     * already alive (singleTop launchMode if we ever add it). For
     * now, we just route to the parent — a real implementation
     * dispatches to the ViewModel layer.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // TODO: route share-text / wotann:// to ChatViewModel.handleIntent(intent)
    }
}
