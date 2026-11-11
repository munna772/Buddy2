#!/usr/bin/env python3
"""Patch the generated Capacitor Android project with Buddy's native wake-word plugin."""
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
android = root / "android"
app = android / "app"
package_dir = app / "src/main/java/com/buddyai/privateassistant"
package_dir.mkdir(parents=True, exist_ok=True)

# Add Kotlin support to the generated Android project.
root_gradle = android / "build.gradle"
text = root_gradle.read_text()
if "kotlin-gradle-plugin" not in text:
    marker = "dependencies {"
    if marker not in text:
        raise SystemExit("Could not find root Gradle dependencies block.")
    text = text.replace(marker, marker + "\n        classpath 'org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.22'", 1)
    root_gradle.write_text(text)

app_gradle = app / "build.gradle"
text = app_gradle.read_text()
if "apply plugin: 'kotlin-android'" not in text:
    if "\nandroid {" not in text:
        raise SystemExit("Could not find Android app configuration block.")
    text = text.replace("\nandroid {", "\napply plugin: 'kotlin-android'\n\nandroid {", 1)
if "sherpa-onnx-2.0.1.aar" not in text:
    text = text.replace(
        "dependencies {",
        "dependencies {\n    implementation files('libs/sherpa-onnx-2.0.1.aar')",
        1
    )
if "abiFilters" not in text:
    text = text.replace("defaultConfig {", "defaultConfig {\n        ndk { abiFilters 'arm64-v8a', 'armeabi-v7a' }", 1)
app_gradle.write_text(text)

# Register the native Capacitor plugin before the bridge is initialized.
main_activity = package_dir / "MainActivity.java"
main_activity.write_text("""package com.buddyai.privateassistant;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BuddyWakeWordPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
""")

# Copy the Kotlin service and Capacitor plugin into the generated app.
for filename in ("BuddyWakeWordPlugin.kt", "BuddyWakeWordService.kt"):
    source = root / "android-wakeword" / filename
    shutil.copy2(source, package_dir / filename)

# Add the runtime microphone and foreground-service permissions and service entry.
manifest = app / "src/main/AndroidManifest.xml"
text = manifest.read_text()
permissions = [
    '    <uses-permission android:name="android.permission.RECORD_AUDIO" />',
    '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
    '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />',
    '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
]
for permission in permissions:
    name = permission.split('"')[1]
    if name not in text:
        text = text.replace("<application", permission + "\n\n    <application", 1)
service = '''        <service
            android:name=".BuddyWakeWordService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="microphone" />
'''
if "BuddyWakeWordService" not in text:
    text = text.replace("</application>", service + "    </application>")
manifest.write_text(text)

print("Prepared Buddy Android project with the native wake-word plugin.")
