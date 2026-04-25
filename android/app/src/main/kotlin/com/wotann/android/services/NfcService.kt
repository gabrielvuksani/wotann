/*
 * NfcService.kt — V9 FT.3.3 tap-to-pair via NFC.
 *
 * WHAT: Optional NFC integration. On phones with NFC, tapping the
 *   phone against an NFC sticker on the desktop machine triggers
 *   a pairing flow.
 *
 * WHY: V9 §FT.3.3 lists tap-to-pair as a delight feature for new
 *   users. Saves them from the QR-or-PIN pairing flow.
 *
 * WHERE: Wired into MainActivity's intent filter (new intent in
 *   onNewIntent) and routed to PairingScreen.
 *
 * HOW: Skeleton. The 12-week impl:
 *     - Read NDEF record from the tag
 *     - Validate the format (wotann:// URL with pairing payload)
 *     - Hand off to PairingScreen with the parsed payload
 *
 * Honest stub: returns null on read.
 */
package com.wotann.android.services

import android.content.Intent

/**
 * NFC facade.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Manifest: <intent-filter> for NDEF_DISCOVERED
 *   - Reader-mode API (NfcAdapter.enableReaderMode) for active scan
 *   - NDEF record parser
 *   - Sanity-check: only accept `wotann://pair?…` URIs
 */
interface NfcService {
    /**
     * Parse a pairing payload out of an incoming NFC intent. Returns
     * null if the intent doesn't carry a valid WOTANN payload.
     */
    fun extractPairingPayload(intent: Intent): String?
}

/**
 * Stub — returns null until the impl lands.
 */
class StubNfcService : NfcService {
    override fun extractPairingPayload(intent: Intent): String? = null
}
