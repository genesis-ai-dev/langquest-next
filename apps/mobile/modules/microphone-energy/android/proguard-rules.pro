# What R8 must keep in a release build of an app with this module (decisions.md 245).
#
# ONNX Runtime's native library finds its Java classes by name over JNI, and
# 1.22.0, the version decision 135 holds, ships no keep rules of its own (1.29.0
# does, with the telemetry). Renamed or removed, the speech model fails to load,
# and the recorder falls back to decision 125's rules without saying so.
-keep class ai.onnxruntime.** { *; }
