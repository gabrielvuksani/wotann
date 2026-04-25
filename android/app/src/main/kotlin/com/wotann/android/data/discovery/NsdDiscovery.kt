/*
 * NsdDiscovery.kt — V9 FT.3.3 LAN discovery via NSD / Bonjour.
 *
 * WHAT: Wraps Android's `NsdManager` to discover desktop WOTANN
 *   instances on the same Wi-Fi network. Used by the pairing
 *   wizard to give the user a list of "Pair with Mike's MacBook"
 *   instead of forcing them to type a hostname.
 *
 * WHY: V9 §FT.3.3 mandates a 3-step pairing UX. Step 1 is
 *   "discover desktops on the network". NSD (Network Service
 *   Discovery) is the right Android primitive — it speaks
 *   mDNS/DNS-SD, which is what the desktop already advertises.
 *
 * WHERE: Used by PairingScreen. NOT used by the steady-state bridge
 *   client (RpcClient connects to the configured URL directly).
 *
 * HOW: Skeleton with a Flow-based discovery API. The 12-week impl:
 *     - Acquire a multicast lock
 *     - Register an NsdManager.DiscoveryListener
 *     - Filter by service type "_wotann._tcp"
 *     - Resolve each service to an InetAddress + port
 *     - Emit a DesktopAdvert per resolved service
 *     - Stop discovery when the Flow is cancelled
 *
 * Honest stub: emits an empty Flow and logs a TODO.
 */
package com.wotann.android.data.discovery

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * One discovered desktop instance. The pairing wizard renders these
 * as a tappable list.
 */
data class DesktopAdvert(
    val displayName: String,    // "Mike's MacBook"
    val host: String,           // "192.168.1.42" or "fe80::…"
    val port: Int,              // The desktop's advertised pairing port
    val pairingId: String?,     // Optional ULID broadcast in TXT record
    val proto: String,          // "ws" or "wss"
)

/**
 * NSD facade.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - NsdManagerNsdDiscovery concrete class
 *   - Multicast lock acquisition / release
 *   - Service-type filter "_wotann._tcp"
 *   - Service resolution to InetAddress + port
 *   - TXT record parsing (pairingId, proto)
 *   - Stop discovery on Flow cancellation
 */
interface NsdDiscovery {
    /**
     * Stream of discovered desktops. Emits the current set on
     * collection and updates as services come and go. Cancelling
     * the Flow stops the underlying NSD discovery.
     */
    fun discover(): Flow<List<DesktopAdvert>>
}

/**
 * Stub implementation — emits an empty list once and completes.
 * The real impl lives behind an NsdManager.
 */
class StubNsdDiscovery : NsdDiscovery {
    override fun discover(): Flow<List<DesktopAdvert>> = flow {
        // V9 FT.3.3 scaffold: real NSD discovery pending.
        emit(emptyList())
    }
}
