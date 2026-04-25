/*
 * RpcClient.kt — V9 FT.3.3 desktop bridge client.
 *
 * WHAT: The transport-layer client that talks to the desktop WOTANN
 *   engine over WebSocket. Wraps OkHttp's WebSocket API with a
 *   structured request/response + subscription model.
 *
 * WHY: V9 §FT.3.3 mandates that the Android app talks to the
 *   desktop bridge over a stable, encrypted WebSocket. OkHttp's
 *   WebSocket is the canonical Android implementation —
 *   battle-tested, fast, and shipped with TLS / cert pinning.
 *
 * WHERE: Constructed by Hilt's AppModule. Consumed by all repository
 *   implementations. Should NEVER be referenced directly from a
 *   Composable.
 *
 * HOW: Currently a skeleton with connect/disconnect/send/subscribe
 *   stubs. The 12-week implementation will:
 *     - Wire up OkHttp WebSocketListener
 *     - Implement an RPC envelope (id, method, params, result, error)
 *     - Multiplex multiple in-flight calls over the single socket
 *     - Handle reconnection with exponential backoff
 *     - Push events into per-subscription Flow<…>s
 *     - Support cert pinning for the desktop's self-signed cert
 *
 * Honest stub: every method throws NotImplementedError. The signature
 *   is stable; the body will be filled in by the impl phase.
 */
package com.wotann.android.data.network

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * Connection state for the bridge.
 */
enum class BridgeConnectionState {
    Disconnected,   // Not connected; not trying
    Connecting,     // Handshake in progress
    Connected,      // Healthy
    Reconnecting,   // Lost connection, trying to recover
    Failed,         // Permanent failure; user action required
}

/**
 * Configuration for the bridge connection. Loaded from the pairing
 * token at app start.
 */
data class BridgeConfig(
    val websocketUrl: String,        // wss://desktop:port/bridge
    val derivedKeyBase64: String,    // ECDH-derived per-pair key
    val pairingId: String,           // Identifies this phone↔desktop pair
    val pinnedCertSha256: String?,   // Optional cert pin
)

/**
 * Generic RPC error surfaced to callers.
 */
data class RpcError(
    val code: Int,
    val message: String,
    val data: String?,
)

/**
 * RPC client interface. Implementation lives in the same package
 * as a private class (OkHttpRpcClient) to keep the public surface
 * tight.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - OkHttpRpcClient concrete class
 *   - WebSocketListener that decodes the RPC envelope
 *   - Reconnect logic with exp backoff (start 1s, cap 60s)
 *   - Cert pinning hook
 *   - Per-call timeout
 *   - Backpressure on subscriptions
 */
interface RpcClient {

    /** Stream of connection states for the UI status bar. */
    fun observeConnectionState(): Flow<BridgeConnectionState>

    /** Open the connection. Returns once Connected, throws on Failed. */
    suspend fun connect(config: BridgeConfig)

    /**
     * Send a one-shot request and await the response. Throws on
     * timeout or RPC error.
     */
    suspend fun call(method: String, paramsJson: String): String

    /**
     * Subscribe to a server-pushed stream. The Flow completes when
     * the subscription ends (either side).
     */
    fun subscribe(method: String, paramsJson: String): Flow<String>

    /** Close the connection and clean up. Idempotent. */
    suspend fun disconnect()
}

/**
 * Skeleton implementation. Every method throws NotImplementedError
 * so callers see a clean error rather than a silent hang.
 */
class StubRpcClient : RpcClient {
    override fun observeConnectionState(): Flow<BridgeConnectionState> = flow {
        emit(BridgeConnectionState.Disconnected)
    }

    override suspend fun connect(config: BridgeConfig) {
        throw NotImplementedError(
            "RpcClient.connect — V9 FT.3.3 scaffold; implementation pending in 12-week build.",
        )
    }

    override suspend fun call(method: String, paramsJson: String): String {
        throw NotImplementedError(
            "RpcClient.call($method) — V9 FT.3.3 scaffold; implementation pending.",
        )
    }

    override fun subscribe(method: String, paramsJson: String): Flow<String> = flow {
        throw NotImplementedError(
            "RpcClient.subscribe($method) — V9 FT.3.3 scaffold; implementation pending.",
        )
    }

    override suspend fun disconnect() {
        // No-op on the stub.
    }
}
