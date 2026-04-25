/*
 * HealthConnectService.kt — V9 FT.3.3 Health Connect integration.
 *
 * WHAT: Optional integration with Android's Health Connect — feeds
 *   anonymised health metrics (sleep, heart rate, activity) into
 *   the agent context when the user opts in.
 *
 * WHY: V9 spec lists "context-aware agent" as a moat feature. On
 *   Android, Health Connect is the canonical aggregator for health
 *   data. Pulling sleep + activity context lets the agent say
 *   "you slept 4 hours; want me to tone down the urgency on this
 *   refactor?".
 *
 * WHERE: Wired in via di/AppModule. Subscribed-to by the
 *   conversation system prompt builder (server-side, but the data
 *   flow originates here).
 *
 * HOW: Skeleton. Health Connect is opt-in and requires a runtime
 *   permission grant per data type. The 12-week impl will:
 *     - Detect Health Connect availability
 *     - Request permissions (sleep, steps, heart rate)
 *     - Read recent values
 *     - Push to bridge as structured context
 *
 * Honest stub: opt-out by default. Returns null (no data).
 */
package com.wotann.android.services

/**
 * Health metrics snapshot. Optional fields — null means "not
 * granted" or "no data".
 */
data class HealthSnapshot(
    val sleepHoursLast24: Double?,
    val stepsLast24: Long?,
    val heartRateRestingBpm: Int?,
    val readAtMillis: Long,
)

/**
 * Health Connect facade.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - HealthConnectClient.getOrCreate() check
 *   - Permissions: Sleep, Steps, HeartRate (all OPTIONAL)
 *   - Read in background via Worker
 *   - Push to bridge with explicit user opt-in (off by default)
 */
interface HealthConnectService {
    /** Is Health Connect available on this device? */
    suspend fun isAvailable(): Boolean

    /** Get a fresh snapshot if permissions allow; null otherwise. */
    suspend fun snapshot(): HealthSnapshot?
}

/**
 * Stub — Health Connect is opt-in, so the default impl is "not
 * available".
 */
class StubHealthConnectService : HealthConnectService {
    override suspend fun isAvailable(): Boolean = false
    override suspend fun snapshot(): HealthSnapshot? = null
}
