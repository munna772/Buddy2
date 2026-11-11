package com.buddyai.privateassistant

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.KeywordSpotter
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig

class BuddyWakeWordService : Service() {
    companion object {
        const val PREFS = "buddy_wake_word"
        private const val TAG = "BuddyWakeWord"
        private const val CHANNEL_ID = "buddy_wake_word_channel"
        private const val NOTIFICATION_ID = 7721
        private const val SAMPLE_RATE = 16000
        private const val MODEL_DIR = "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
        const val ACTION_STOP = "com.buddyai.privateassistant.STOP_WAKE_WORD"
    }

    @Volatile private var running = false
    @Volatile private var recorder: AudioRecord? = null
    private var worker: Thread? = null
    private var spotter: KeywordSpotter? = null
    private var stream: com.k2fsa.sherpa.onnx.OnlineStream? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            getSharedPreferences(PREFS, 0).edit().putBoolean("wake_enabled", false).apply()
            stopSelf()
            return START_NOT_STICKY
        }

        startForeground(NOTIFICATION_ID, buildNotification())
        if (!running) {
            running = true
            getSharedPreferences(PREFS, 0).edit()
                .putBoolean("wake_listening", true)
                .putString("wake_error", "")
                .apply()
            worker = Thread({ listenForWakeWord() }, "BuddyWakeWordAudio").apply { start() }
        }
        return START_STICKY
    }

    private fun listenForWakeWord() {
        var localSpotter: KeywordSpotter? = null
        var localStream: com.k2fsa.sherpa.onnx.OnlineStream? = null
        var localRecorder: AudioRecord? = null

        try {
            val modelConfig = OnlineModelConfig(
                transducer = OnlineTransducerModelConfig(
                    encoder = "$MODEL_DIR/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
                    decoder = "$MODEL_DIR/decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
                    joiner = "$MODEL_DIR/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx"
                ),
                tokens = "$MODEL_DIR/tokens.txt",
                numThreads = 1,
                provider = "cpu",
                modelType = "zipformer2"
            )
            val config = KeywordSpotterConfig(
                featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
                modelConfig = modelConfig,
                keywordsFile = "$MODEL_DIR/keywords.txt",
                keywordsScore = 1.5f,
                keywordsThreshold = 0.35f
            )
            val createdSpotter = KeywordSpotter(assetManager = assets, config = config)
            localSpotter = createdSpotter
            spotter = createdSpotter
            val createdStream = createdSpotter.createStream()
            localStream = createdStream
            stream = createdStream

            val minBuffer = AudioRecord.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            )
            if (minBuffer <= 0) throw IllegalStateException("This device could not create a 16 kHz microphone buffer.")

            val createdRecorder = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                maxOf(minBuffer * 2, SAMPLE_RATE * 2)
            )
            localRecorder = createdRecorder
            if (createdRecorder.state != AudioRecord.STATE_INITIALIZED) {
                throw IllegalStateException("Android could not initialize the microphone.")
            }
            recorder = createdRecorder
            createdRecorder.startRecording()

            val pcm = ShortArray(1600)
            while (running) {
                val count = createdRecorder.read(pcm, 0, pcm.size)
                if (count <= 0) continue
                val samples = FloatArray(count) { index -> pcm[index] / 32768.0f }
                createdStream.acceptWaveform(samples, sampleRate = SAMPLE_RATE)

                while (running && createdSpotter.isReady(createdStream)) {
                    createdSpotter.decode(createdStream)
                    val detected = createdSpotter.getResult(createdStream).keyword
                    if (detected.isNotBlank()) {
                        createdSpotter.reset(createdStream)
                        Log.i(TAG, "Keyword candidate detected: $detected")
                        if (detected.equals("HEY_BUDDY", ignoreCase = true) ||
                            detected.equals("HEY BUDDY", ignoreCase = true)) {
                            onWakeWordDetected()
                            return
                        }
                    }
                }
            }
        } catch (error: Exception) {
            Log.e(TAG, "Wake-word listener failed", error)
            getSharedPreferences(PREFS, 0).edit()
                .putString("wake_error", error.message ?: "Wake-word listener failed.")
                .putBoolean("wake_listening", false)
                .apply()
        } finally {
            running = false
            try { localRecorder?.stop() } catch (_: Exception) {}
            localRecorder?.release()
            if (recorder === localRecorder) recorder = null
            try { localStream?.release() } catch (_: Exception) {}
            try { localSpotter?.release() } catch (_: Exception) {}
            if (stream === localStream) stream = null
            if (spotter === localSpotter) spotter = null
            getSharedPreferences(PREFS, 0).edit().putBoolean("wake_listening", false).apply()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun onWakeWordDetected() {
        getSharedPreferences(PREFS, 0).edit()
            .putBoolean("wake_pending", true)
            .putBoolean("wake_listening", false)
            .apply()

        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        if (launchIntent != null) {
            launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            try {
                startActivity(launchIntent)
            } catch (error: Exception) {
                Log.w(TAG, "Could not bring Buddy to the foreground; the notification remains available.", error)
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Buddy wake word",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shown while Buddy listens for the Hey Buddy wake phrase."
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
        val openPendingIntent = launchIntent?.let {
            PendingIntent.getActivity(
                this, 1, it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
        val stopIntent = Intent(this, BuddyWakeWordService::class.java).setAction(ACTION_STOP)
        val stopPendingIntent = PendingIntent.getService(
            this, 2, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Buddy is listening")
            .setContentText("Say “Hey Buddy” to start talking. Tap Stop to disable.")
            .setContentIntent(openPendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopPendingIntent)
            .build()
    }

    override fun onDestroy() {
        running = false
        try { recorder?.stop() } catch (_: Exception) {}
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

}
