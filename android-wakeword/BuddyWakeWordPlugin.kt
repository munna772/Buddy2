package com.buddyai.privateassistant

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(
    name = "BuddyWakeWord",
    permissions = [
        Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO])
    ]
)
class BuddyWakeWordPlugin : Plugin() {
    @PluginMethod
    fun start(call: PluginCall) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback")
            return
        }
        startService(call)
    }

    @PermissionCallback
    private fun microphonePermissionCallback(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            startService(call)
        } else {
            call.reject("Microphone permission is required for Hey Buddy background listening.")
        }
    }

    private fun startService(call: PluginCall) {
        try {
            val prefs = context.getSharedPreferences(BuddyWakeWordService.PREFS, 0)
            prefs.edit().putBoolean("wake_enabled", true).putString("wake_error", "").apply()
            val intent = Intent(context, BuddyWakeWordService::class.java)
            ContextCompat.startForegroundService(context, intent)
            val result = JSObject()
            result.put("enabled", true)
            call.resolve(result)
        } catch (error: Exception) {
            call.reject("Could not start Hey Buddy listening: ${error.message}", error)
        }
    }

    @PluginMethod
    fun pause(call: PluginCall) {
        context.stopService(Intent(context, BuddyWakeWordService::class.java))
        val result = JSObject()
        result.put("paused", true)
        call.resolve(result)
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        context.getSharedPreferences(BuddyWakeWordService.PREFS, 0)
            .edit().putBoolean("wake_enabled", false).apply()
        context.stopService(Intent(context, BuddyWakeWordService::class.java))
        val result = JSObject()
        result.put("enabled", false)
        call.resolve(result)
    }

    @PluginMethod
    fun status(call: PluginCall) {
        val prefs = context.getSharedPreferences(BuddyWakeWordService.PREFS, 0)
        val result = JSObject()
        result.put("enabled", prefs.getBoolean("wake_enabled", false))
        result.put("listening", prefs.getBoolean("wake_listening", false))
        result.put("error", prefs.getString("wake_error", "") ?: "")
        call.resolve(result)
    }

    @PluginMethod
    fun consumeWake(call: PluginCall) {
        val prefs = context.getSharedPreferences(BuddyWakeWordService.PREFS, 0)
        val detected = prefs.getBoolean("wake_pending", false)
        prefs.edit().putBoolean("wake_pending", false).apply()
        val result = JSObject()
        result.put("wakeDetected", detected)
        call.resolve(result)
    }
}
