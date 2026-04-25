/*
 * WotannApplication — V9 FT.3.3 scaffold.
 *
 * WHAT: The Application class that boots the WOTANN Android app.
 *   Annotated @HiltAndroidApp so Hilt can generate the per-app
 *   dependency graph.
 *
 * WHY: §FT.3.3 of V9 specifies a Hilt-DI architecture. The graph is
 *   anchored on the Application class — without @HiltAndroidApp, no
 *   @Inject annotation will resolve.
 *
 * WHERE: Referenced from AndroidManifest.xml's `android:name` on the
 *   <application> element. Loaded once per process by the OS.
 *
 * HOW: Empty body for now. Future hooks (StrictMode in debug, crash
 *   reporting init, SQLDelight migrations, WorkManager init) go in
 *   onCreate() but are deferred to the 12-week implementation.
 *
 * Compose entry happens in MainActivity, not here — keeping the
 * Application class small and side-effect-free makes cold start
 * faster and unit tests cleaner.
 */
package com.wotann.android

import android.app.Application
import dagger.hilt.android.HiltAndroidApp

/**
 * Boot class. Hilt rewrites this at compile time to inject the DI
 * graph. The class itself stays minimal — heavy init goes in lazy
 * Hilt providers, not in onCreate().
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Initialize WorkManager with HiltWorkerFactory
 *   - Enable StrictMode in debug builds
 *   - Initialize crash reporting (opt-in only, per V9 privacy bar)
 *   - Run a Room migration check at cold-start
 */
@HiltAndroidApp
class WotannApplication : Application()
