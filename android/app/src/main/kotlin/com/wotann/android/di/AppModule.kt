/*
 * AppModule.kt — V9 FT.3.3 Hilt DI graph.
 *
 * WHAT: The single Hilt module that wires concrete implementations
 *   to their interfaces for the app process. Domain interfaces are
 *   declared in `domain/`, implementations in `data/` and
 *   `services/`, and this module @Binds them together.
 *
 * WHY: V9 §FT.3.3 mandates a clean DI layer. Centralising the
 *   wiring here means swapping a stub for a real impl is a one-line
 *   change.
 *
 * WHERE: Hilt-discovered via the @InstallIn annotation. Loaded
 *   once per app process via WotannApplication's @HiltAndroidApp.
 *
 * HOW: Currently binds the stub implementations of every interface.
 *   The 12-week impl swaps in the real ones one at a time as they
 *   land — no callers need to change.
 *
 * Honest stub: every binding currently points at a Stub* class
 *   that throws NotImplementedError on use. This is intentional —
 *   the scaffold compiles + boots, but any feature that requires a
 *   real bridge call surfaces a clear "not implemented" error.
 */
package com.wotann.android.di

import com.wotann.android.data.discovery.NsdDiscovery
import com.wotann.android.data.discovery.StubNsdDiscovery
import com.wotann.android.data.network.RpcClient
import com.wotann.android.data.network.StubRpcClient
import com.wotann.android.data.security.ECDHManager
import com.wotann.android.data.security.KeychainManager
import com.wotann.android.data.security.StubECDHManager
import com.wotann.android.data.security.StubKeychainManager
import com.wotann.android.services.HealthConnectService
import com.wotann.android.services.NfcService
import com.wotann.android.services.StubHealthConnectService
import com.wotann.android.services.StubNfcService
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Application-wide Hilt module. All bindings here have
 * @Singleton scope — one instance per app process.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Replace each Stub* with the real impl as it lands
 *   - Add @Binds for AgentRepository, ConversationRepository,
 *     OfflineQueue once their concrete classes exist
 *   - Provide WotannDatabase via Room.databaseBuilder
 *   - Provide OkHttpClient with cert pinning + logging interceptor
 *   - Provide WorkManager with HiltWorkerFactory
 */
@Module
@InstallIn(SingletonComponent::class)
object AppModule {

    @Provides
    @Singleton
    fun provideRpcClient(): RpcClient = StubRpcClient()

    @Provides
    @Singleton
    fun provideKeychainManager(): KeychainManager = StubKeychainManager()

    @Provides
    @Singleton
    fun provideECDHManager(): ECDHManager = StubECDHManager()

    @Provides
    @Singleton
    fun provideNsdDiscovery(): NsdDiscovery = StubNsdDiscovery()

    @Provides
    @Singleton
    fun provideHealthConnectService(): HealthConnectService = StubHealthConnectService()

    @Provides
    @Singleton
    fun provideNfcService(): NfcService = StubNfcService()
}
