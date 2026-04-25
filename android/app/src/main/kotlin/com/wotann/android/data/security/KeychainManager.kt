/*
 * KeychainManager.kt — V9 FT.3.3 secure storage for the pairing token.
 *
 * WHAT: Wraps `androidx.security.crypto.EncryptedSharedPreferences`
 *   to store the ECDH-derived pairing key behind biometric
 *   protection. The key is the only secret on the device; losing it
 *   means re-pairing.
 *
 * WHY: V9 §FT.3.3 mandates biometric-protected storage of the pairing
 *   token. Android Keychain (via security-crypto) is the right
 *   primitive — backed by Android Keystore on the hardware-backed
 *   side.
 *
 * WHERE: Used by PairingScreen (write) and RpcClient (read). The
 *   read path is gated by BiometricPrompt.
 *
 * HOW: Skeleton. The 12-week implementation will:
 *     - Generate a MasterKey via `MasterKey.Builder` with
 *       AES256_GCM and the StrongBox-backed keystore where available
 *     - Open EncryptedSharedPreferences pointing at "pairing.prefs"
 *     - Read/write the derived-key bytes as Base64
 *     - Wrap reads in BiometricPrompt
 *
 * Honest stub: methods throw NotImplementedError until impl lands.
 */
package com.wotann.android.data.security

import com.wotann.android.data.network.BridgeConfig

/**
 * Secure-storage facade for the pairing token. The interface is
 * intentionally narrow — there is exactly one secret, and its
 * lifecycle is "store on pair, read on unlock, clear on unpair".
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - EncryptedSharedPreferences wiring
 *   - StrongBox key generation
 *   - BiometricPrompt integration on the read path
 *   - Auto-clear on tampering detection (re-pair required)
 */
interface KeychainManager {
    /**
     * Persist a fresh pairing token. Overwrites any existing token.
     * Throws on Keystore failure (out of slots, hardware error).
     */
    suspend fun storeBridgeConfig(config: BridgeConfig)

    /**
     * Read the pairing token. Returns null if no token has been
     * stored. Throws if biometric prompt was cancelled or denied.
     */
    suspend fun readBridgeConfig(): BridgeConfig?

    /**
     * Wipe the stored token. Used on user-initiated unpair, or on
     * detected tampering.
     */
    suspend fun clearBridgeConfig()
}

/**
 * Stub implementation. The 12-week impl replaces this with a real
 * EncryptedSharedPreferences wrapper.
 */
class StubKeychainManager : KeychainManager {
    override suspend fun storeBridgeConfig(config: BridgeConfig) {
        throw NotImplementedError(
            "KeychainManager.storeBridgeConfig — V9 FT.3.3 scaffold; impl pending.",
        )
    }

    override suspend fun readBridgeConfig(): BridgeConfig? {
        // Returning null means "no pairing yet" — the UI routes to
        // PairingScreen. That's the right cold-start behaviour.
        return null
    }

    override suspend fun clearBridgeConfig() {
        // No-op on the stub.
    }
}
