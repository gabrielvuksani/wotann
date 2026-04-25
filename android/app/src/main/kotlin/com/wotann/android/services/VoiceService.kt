/*
 * VoiceService.kt — V9 FT.3.3 push-to-talk voice service.
 *
 * WHAT: Foreground service that hosts the microphone capture for
 *   the `wotann voice` push-to-talk feature. Routes audio to the
 *   bridge's STT pipeline and plays back TTS responses through the
 *   speaker.
 *
 * WHY: V9 §FT.3.3 specifies voice support per platform. Voice MUST
 *   run as a foreground service (not just a background task)
 *   because Android requires the MEDIA_PLAYBACK foreground type
 *   for sustained microphone access.
 *
 * WHERE: Started by ChatScreen when the user taps the mic button.
 *   Stopped when the user taps mic again or after 60 seconds of
 *   silence.
 *
 * HOW: Skeleton.
 *
 * Honest stub: scaffold body only.
 */
package com.wotann.android.services

import android.app.Service
import android.content.Intent
import android.os.IBinder
import dagger.hilt.android.AndroidEntryPoint

/**
 * Voice mode foreground service.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - AudioRecord at 16kHz / mono / PCM-16
 *   - Stream chunks to the bridge's STT pipeline (Whisper, etc.)
 *   - Receive TTS audio (or text → on-device TTS)
 *   - AudioTrack playback
 *   - Handle Bluetooth headset / car-audio routing
 *   - Handle phone-call interrupts (audio focus)
 *   - 60s silence timeout → auto-stop
 */
@AndroidEntryPoint
class VoiceService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // V9 FT.3.3 scaffold:
        //   - Build foreground notification (MEDIA_PLAYBACK type)
        //   - Start AudioRecord coroutine
        //   - return START_NOT_STICKY (voice should stop if killed)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        // V9 FT.3.3 scaffold: release AudioRecord + AudioTrack
    }
}
