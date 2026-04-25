/*
 * AgentForegroundService.kt — V9 FT.3.3 sustained agent runs.
 *
 * WHAT: A foreground Service that holds a wake-lock and a
 *   user-visible notification while the agent is actively running.
 *   Routes long-running agent tasks through the service so Android
 *   doesn't kill the process when the screen turns off.
 *
 * WHY: V9 §FT.3.3 mandates that autonomous agent runs survive
 *   screen-off. Without a foreground service, Android Doze + App
 *   Standby will kill the process within minutes.
 *
 * WHERE: Started by ChatViewModel / WorkshopViewModel when the
 *   user kicks off an agent task. Stopped when all tasks are
 *   complete (or cancelled).
 *
 * HOW: Skeleton. The 12-week impl:
 *     - Inject AgentRepository via Hilt @AndroidEntryPoint
 *     - Build a foreground notification with a "Stop" action
 *     - Start a coroutine that observes AgentRepository.observeTasks()
 *     - When task count drops to 0 → stop the service
 *     - Handle low-memory by pausing tasks (not killing them)
 *     - Re-acquire wake-lock on connectivity-restored events
 *
 * Honest stub: returns START_STICKY so Android restarts the service
 *   if it's killed, but the body is a no-op.
 */
package com.wotann.android.services

import android.app.Service
import android.content.Intent
import android.os.IBinder
import dagger.hilt.android.AndroidEntryPoint

/**
 * Foreground service that hosts long-running agent loops.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - Inject AgentRepository via @Inject
 *   - Override onCreate: build notification channel + foreground
 *     notification
 *   - Override onStartCommand: start observing tasks; stopSelf
 *     when no tasks remain
 *   - Add a "Stop all" PendingIntent in the notification
 *   - Acquire/release a partial WakeLock around active runs
 *   - Migrate to Foreground Service Type DATA_SYNC for Android 14
 *     (already declared in the manifest)
 */
@AndroidEntryPoint
class AgentForegroundService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // V9 FT.3.3 scaffold:
        //   - Build foreground notification
        //   - Start agent run observer
        //   - return START_STICKY so the service is restarted if killed
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        // V9 FT.3.3 scaffold: release wake-lock + stop coroutine scope
    }
}
