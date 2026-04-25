/*
 * EditorScreen.kt — V9 FT.3.3 Editor surface.
 *
 * WHAT: The Editor surface — Monaco-style code editor with side-by-
 *   side diff view, inline LSP diagnostics, and agent edit
 *   highlights.
 *
 * WHY: V9 §FT.3.3 specifies parity with the desktop Editor (which
 *   uses Monaco) and the iOS Editor (which uses Runestone). The
 *   Android port currently has no native Monaco equivalent — we'll
 *   ship a WebView-backed editor for the first release and consider
 *   a native CodeMirror port if WebView IME issues bite (same
 *   pivot risk as Tier 2 Tauri).
 *
 * WHERE: Reachable from the Workshop tab's "open file" action, NOT
 *   as a top-level tab. The Compose nav inside Workshop will route
 *   here.
 *
 * HOW: Currently a placeholder. The 12-week implementation will
 *   either:
 *     A) Embed a WebView with Monaco bundled into assets/ and a
 *        JS↔Kotlin bridge for cursor sync, file-load, save, diff.
 *     B) Use the open-source CodeView Compose library for a
 *        native textfield + simple highlighting.
 *
 *   Decision is gated on WebView IME stability on Samsung — see
 *   ANDROID_TAURI.md "Pivot decision criteria" #2.
 *
 * Honest stub: placeholder Text. The Composable signature is stable
 * (no params today, will accept a `filePath: String` once routing
 * lands).
 *
 * Reference: desktop-app/src/Editor/* and ios/WOTANN/Views/EditorView.swift
 */
package com.wotann.android.ui.editor

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
 * Editor surface. Not directly reachable from the bottom nav; opened
 * via Workshop → file → tap.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Decide WebView (Monaco) vs native (CodeView) based on
 *     Samsung WebView IME testing
 *   - Inject EditorViewModel via hiltViewModel()
 *   - File-open / save through the bridge
 *   - Diff overlay (agent suggested edits)
 *   - LSP diagnostics rendering
 *   - Side-by-side mode for tablets (use NavigationSuiteScaffold's
 *     adaptive layout)
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen() {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Editor") },
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
            Text("Editor surface — V9 FT.3.3 scaffold")
            Text(
                "TODO: choose Monaco WebView vs native CodeView, " +
                    "wire EditorViewModel, file load/save through bridge, " +
                    "LSP diagnostics overlay, agent diff rendering.",
            )
        }
    }
}
