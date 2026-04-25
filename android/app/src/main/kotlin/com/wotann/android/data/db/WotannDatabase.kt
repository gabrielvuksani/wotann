/*
 * WotannDatabase.kt — V9 FT.3.3 Room database.
 *
 * WHAT: The Room database scaffold for the WOTANN Android app.
 *   Holds tables for: conversation summaries, messages, queued
 *   offline commands, cached provider ladder, cached cost rollups,
 *   and pairing token metadata.
 *
 * WHY: V9 §FT.3.3 mandates an offline-first experience. Room is the
 *   official Android SQLite ORM and integrates cleanly with Hilt
 *   and Compose Flow.
 *
 * WHERE: Provided by Hilt via di/AppModule.kt. Consumed by Room-backed
 *   repository implementations.
 *
 * HOW: Empty schema for the scaffold — concrete entities and DAOs
 *   land in the 12-week implementation. The class is annotated with
 *   the basic Room metadata so a Gradle build will at least
 *   recognise it as a database.
 *
 * Honest stub: no entities yet. Once we add entities, bump the
 * version number and add a Migration.
 */
package com.wotann.android.data.db

import androidx.room.Database
import androidx.room.RoomDatabase

/**
 * The single Room database for the WOTANN app. Future tables:
 *   - ConversationSummaryEntity
 *   - MessageEntity
 *   - QueuedCommandEntity
 *   - ProviderLadderEntity
 *   - CostRollupEntity
 *   - PairingMetadataEntity
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Add entities listed above
 *   - Add corresponding DAOs as abstract methods
 *   - Add migrations as the schema evolves
 *   - Configure database name in Hilt: "wotann.db"
 *   - Set journal mode WAL for better concurrent reads
 */
@Database(
    entities = [],
    version = 1,
    exportSchema = true,
)
abstract class WotannDatabase : RoomDatabase()
