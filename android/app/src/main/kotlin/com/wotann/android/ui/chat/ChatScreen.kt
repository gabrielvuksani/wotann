/*
 * ChatScreen.kt — V9 FT.3.3 Chat tab.
 *
 * WHAT: The Chat tab — primary conversation surface. Renders the
 *   messages list, input bar, attachment options, and (when
 *   enabled) the live-update streaming UI for tool calls and
 *   intermediate reasoning.
 *
 * WHY: V9 §FT.3.3 declares Chat as the single most-used surface in
 *   the WOTANN Android app. The iOS app's `ChatView.swift` is the
 *   reference implementation; this Kotlin port mirrors its surface
 *   1:1.
 *
 * WHERE: Composed by MainShell when the user selects the Home or
 *   Chat tab. Detail navigation (open a specific conversation)
 *   happens inside this screen's NavHost (not yet implemented).
 *
 * HOW: Scaffold + LazyColumn for the message list, with a sticky
 *   input bar at the bottom. The 12-week implementation will:
 *     - hoist a ChatViewModel from Hilt
 *     - subscribe to a Flow<ChatUiState> for messages + streaming
 *     - wire send/stop/retry buttons through the WebSocket bridge
 *     - render Markdown via a Compose markdown library
 *     - support voice input (microphone button hands off to
 *       VoiceService)
 *
 * Honest stub: this scaffold renders a placeholder Text and a
 * disabled input bar. The 12-week build replaces this body with the
 * real message list + input; the surface (Scaffold + signature) is
 * stable.
 *
 * Reference: ios/WOTANN/Views/ChatView.swift
 */
package com.wotann.android.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
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
 * Chat tab top-level Composable. Empty body — placeholders only —
 * until the 12-week impl wires up the ChatViewModel.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Inject ChatViewModel via hiltViewModel()
 *   - Render LazyColumn over viewModel.messages (collectAsStateWithLifecycle)
 *   - ChatInputBar at the bottom (mic + attach + send)
 *   - Streaming indicator while a response is in-flight
 *   - Error toast on bridge disconnect
 *   - Long-press → copy / regenerate / share message
 *   - Markdown rendering via dev.snipme:highlights or compose-markdown
 *   - Code-block syntax highlighting (use Highlights or a Tree-sitter
 *     bridge — the iOS app uses Splash, Android equivalent is TBD)
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen() {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Chat") },
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
            Text("Chat surface — V9 FT.3.3 scaffold")
            Spacer(Modifier.height(8.dp))
            Text(
                "TODO: wire ChatViewModel, message list, input bar, " +
                    "streaming response renderer, voice input, " +
                    "Markdown rendering, code syntax highlighting.",
            )
        }
    }
}
