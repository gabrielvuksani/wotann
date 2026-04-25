/*
 * PairingScreen.kt — V9 FT.3.3 device pairing wizard.
 *
 * WHAT: The pairing wizard — QR camera capture, manual PIN fallback,
 *   NSD discovery of nearby desktop instances, and biometric
 *   confirmation of the cached token.
 *
 * WHY: V9 §FT.3.3 specifies that mobile clients can only run agents
 *   AFTER pairing with a desktop engine. The pairing flow must:
 *     a) be safe (no token leaks, mutual auth)
 *     b) be fast (under 30 seconds wall time)
 *     c) gracefully degrade (manual PIN if camera blocked / mDNS
 *        blocked)
 *
 * WHERE: Reachable from SettingsScreen → "Pair a device" or from a
 *   first-run intro flow (handled in MainActivity once routing is
 *   in).
 *
 * HOW: 4-step wizard:
 *     1. Discover desktops on the LAN via NSD
 *     2. Tap one to start pairing → desktop shows a 6-digit PIN +
 *        QR code
 *     3. Phone scans the QR (or enters the PIN)
 *     4. ECDH handshake → store the derived key in Android Keychain
 *        with biometric protection
 *
 *   For non-LAN pairing (Cloudflare Tunnel, Tailscale), step 1 falls
 *   through to a manual URL entry.
 *
 * Honest stub: placeholder Text.
 *
 * Reference: ios/WOTANN/Views/PairingView.swift
 */
package com.wotann.android.ui.pairing

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
 * Pairing wizard.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - NsdDiscovery composable that lists desktops on the LAN
 *   - CameraX QR scanner with ML Kit barcode-scanning
 *   - Manual PIN entry fallback
 *   - ECDH handshake via security-crypto MasterKey
 *   - Biometric confirmation via androidx.biometric.BiometricPrompt
 *   - Store derived key in Android Keychain (EncryptedSharedPreferences)
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PairingScreen() {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Pair a device") },
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
            Text("Pairing wizard — V9 FT.3.3 scaffold")
            Text(
                "TODO: NSD discovery, QR scanner (CameraX + ML Kit), " +
                    "manual PIN, ECDH handshake, biometric, Keychain store.",
            )
        }
    }
}
