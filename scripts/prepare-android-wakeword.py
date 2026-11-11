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
if "com.github.k2-fsa:sherpa-onnx:2.0.1" not in text:
    text = text.replace(
        "dependencies {",
        "dependencies {\n    implementation('com.github.k2-fsa:sherpa-onnx:2.0.1') {\n        exclude group: 'com.github.k2-fsa.sherpa-onnx', module: 'sherpa-onnx-jvm'\n    }",
        1
    )
if "abiFilters" not in text:
    text = text.replace("defaultConfig {", "defaultConfig {\n        ndk { abiFilters 'arm64-v8a', 'armeabi-v7a' }", 1)
app_gradle.write_text(text)

# Add JitPack to the root project's dependency repositories.
root_text = root_gradle.read_text()
if "https://jitpack.io" not in root_text:
    marker = "allprojects {"
    index = root_text.find(marker)
    if index >= 0:
        before, projects = root_text[:index], root_text[index:]
        if "repositories {" in projects:
            projects = projects.replace(
                "repositories {",
                "repositories {\n        maven { url 'https://jitpack.io' }",
                1
            )
            root_text = before + projects
        else:
            root_text += "\nallprojects { repositories { maven { url 'https://jitpack.io' } } }\n"
    else:
        root_text += "\nallprojects { repositories { google(); mavenCentral(); maven { url 'https://jitpack.io' } } }\n"
    root_gradle.write_text(root_text)

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
