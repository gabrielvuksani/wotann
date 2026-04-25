/*
 * ECDHManager.kt — V9 FT.3.3 elliptic-curve key exchange.
 *
 * WHAT: Wraps `java.security.KeyPairGenerator` (P-256 / X25519) and
 *   the matching `KeyAgreement` API to derive a shared secret
 *   between the phone and the desktop during pairing.
 *
 * WHY: V9 §FT.3.3 specifies ECDH-derived per-pair keys, NOT a
 *   pre-shared secret. The shared secret is then used as the AEAD
 *   key for every message over the bridge.
 *
 * WHERE: Used by PairingScreen and the bridge handshake. The
 *   resulting secret is handed to KeychainManager for biometric-
 *   protected storage.
 *
 * HOW: Skeleton. The 12-week implementation:
 *     - Prefer X25519 (Android 31+); fall back to P-256 on older
 *     - Generate an ephemeral keypair on pair-start
 *     - Send the public key to the desktop (via QR or PIN-displayed
 *       channel)
 *     - Receive the desktop's public key
 *     - Run KeyAgreement → derive a 32-byte shared secret
 *     - HKDF-expand to two 32-byte keys (one per direction) for
 *       AEAD
 *
 * Honest stub: methods throw NotImplementedError.
 */
package com.wotann.android.data.security

/**
 * Output of a successful ECDH exchange. Both sides should derive
 * the same key pair (one for sending, one for receiving) via
 * HKDF over the shared secret.
 */
data class DerivedKeys(
    val sendKey: ByteArray,        // 32 bytes (XChaCha20-Poly1305)
    val receiveKey: ByteArray,     // 32 bytes (XChaCha20-Poly1305)
    val pairingId: String,         // ULID-shaped, used to identify this pair
) {
    /**
     * Override `equals` because ByteArray uses reference equality —
     * two derivations yielding the same bytes should compare equal
     * for testing.
     */
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is DerivedKeys) return false
        if (!sendKey.contentEquals(other.sendKey)) return false
        if (!receiveKey.contentEquals(other.receiveKey)) return false
        return pairingId == other.pairingId
    }

    override fun hashCode(): Int {
        var result = sendKey.contentHashCode()
        result = 31 * result + receiveKey.contentHashCode()
        result = 31 * result + pairingId.hashCode()
        return result
    }
}

/**
 * ECDH facade.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - X25519 (Android 31+) preference, P-256 fallback
 *   - Ephemeral keypair per pairing session
 *   - HKDF expansion to two AEAD keys
 *   - StrongBox-backed key generation where available
 */
interface ECDHManager {
    /**
     * Generate an ephemeral keypair. Returns the public-key bytes
     * (raw / X.509 DER, depending on impl) so the caller can encode
     * them into the QR / PIN payload.
     */
    suspend fun generateEphemeralKeypair(): ByteArray

    /**
     * Complete the handshake against a peer's public key. Returns
     * the derived AEAD keys.
     *
     * @throws SecurityException if the peer's key is malformed,
     *   the curve doesn't match, or the resulting shared secret is
     *   weak.
     */
    suspend fun deriveKeys(peerPublicKey: ByteArray): DerivedKeys
}

/**
 * Stub implementation. Throws until the real impl lands.
 */
class StubECDHManager : ECDHManager {
    override suspend fun generateEphemeralKeypair(): ByteArray {
        throw NotImplementedError(
            "ECDHManager.generateEphemeralKeypair — V9 FT.3.3 scaffold; impl pending.",
        )
    }

    override suspend fun deriveKeys(peerPublicKey: ByteArray): DerivedKeys {
        throw NotImplementedError(
            "ECDHManager.deriveKeys — V9 FT.3.3 scaffold; impl pending.",
        )
    }
}
