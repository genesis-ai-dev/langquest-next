# ONNX Runtime 1.22.0 for iPhone builds

The microphone module runs the speech model and Clean up with ONNX Runtime
1.22.0 (decisions.md 135 and 179). On 2026-11-21 Microsoft's download host
for its CocoaPods (`download.onnxruntime.ai`) began to answer with a
`*.azureedge.net` certificate and 404, and the GitHub repositories
`microsoft/onnxruntime` and `microsoft/onnxruntime-swift-package-manager`
answer 404 too. `pod install` failed, so no iPhone build could run. The
Podfile now names both pods itself (`plugins/withOnnxRuntimePods.js`), and
CocoaPods never reads their trunk specs
(decision `2026-11-21-onnxruntime-pods-from-nuget-and-the-repo`).

## onnxruntime-c

`onnxruntime-c.podspec.json` is the trunk spec with a new `source`: the
NuGet package Microsoft.ML.OnnxRuntime 1.22.0 from nuget.org, pinned by
SHA-256. CocoaPods refuses any other file. Its `prepare_command` opens the
package's `runtimes/ios/native/onnxruntime.xcframework.zip` and copies the
headers from the framework to `Headers/`, the layout of the old pod.

Checked on 2026-11-21:

- SHA-256 `d571e63a2329baacb713f441e65ad75284de354db6e1ac435fe4bebbb417986a`.
  Its SHA-512 is the `packageHash` in nuget.org's catalog entry
  (`catalog0/data/2025.05.09.19.19.21/microsoft.ml.onnxruntime.1.22.0.json`,
  published 2025-05-09).
- Its author signature (`.signature.p7s`) is Microsoft Corporation's, through
  DigiCert's code signing CA.
- The framework is a static library for `ios-arm64`, the simulator and Mac
  Catalyst, `CFBundleVersion` 1.22.0. It has no macOS slice, so the spec is
  for iOS only.
- Its headers have the same git blob ids as `include/` at the `v1.22.0` tag
  in Software Heritage's copy of `microsoft/onnxruntime`.

## onnxruntime-objc

`onnxruntime-objc/` holds the 24 Objective-C files that the trunk spec
builds, and `LICENSE` (MIT), from the `v1.22.0` tag. They come from
Software Heritage, which archived `github.com/microsoft/onnxruntime` up to
2026-11-21 (snapshot `bea36a732c53b6db6202038b923f749417703b93`; `objectivec`
is directory `29d9e4108a7683071d691bd410179dbc2bb0ecb9`). Each file's git
blob id is the one in that directory, so `git ls-tree -r HEAD` checks them
again. `onnxruntime-objc.podspec.json` is the trunk spec without its tests,
built from this folder.

## When Microsoft's hosts come back

Remove `plugins/withOnnxRuntimePods.js` from `app.json`, then delete this
folder. A newer ONNX Runtime carries Microsoft's telemetry from 1.29.0
(decision 135), so this pin stays at 1.22.0.
