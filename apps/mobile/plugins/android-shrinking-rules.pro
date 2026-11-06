# R8 keep rules for release builds (LAN-111, decisions.md 205). R8 removes and
# renames what it cannot see being used; these classes are reached by name.

# ONNX Runtime (the speech model): its native library calls Java classes and
# fields by name.
-keep class ai.onnxruntime.** { *; }
-dontwarn ai.onnxruntime.**

# Our own audio module (speech detection, noise clean-up): Expo finds it by
# the class name in expo-module.config.json.
-keep class expo.modules.microphoneenergy.** { *; }

# Expo modules and their records are found and filled through reflection
# (expo-audio, expo-camera, expo-sqlite and the rest).
-keep class * extends expo.modules.kotlin.modules.Module { *; }
-keep class * extends expo.modules.kotlin.records.Record { *; }
-keepclassmembers class * { @expo.modules.kotlin.records.Field <fields>; }
