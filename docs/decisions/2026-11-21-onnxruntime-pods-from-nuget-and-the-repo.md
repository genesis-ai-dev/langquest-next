# iPhone builds get ONNX Runtime from Microsoft's NuGet package and the repository

Date: 2026-11-21 · By: Caleb Koster · Status: accepted

Reason: since about 02:50Z on 2026-11-21, `download.onnxruntime.ai`, the only
source in the trunk specs of `onnxruntime-c` and `onnxruntime-objc` 1.22.0,
answers with a `*.azureedge.net` certificate and 404. Microsoft's GitHub
repositories for ONNX Runtime answer 404 too, so no Microsoft URL has the
pod archives or their checksums. Every `pod install` failed: the nightly
iPhone flows and every iPhone store build. Caleb asked for iPhone builds and
the nightly iPhone job to pass again.
Reverse if: Microsoft serves the 1.22.0 pod archives again, or the app moves
off ONNX Runtime 1.22.0.

- **No trunk spec.** `apps/mobile/plugins/withOnnxRuntimePods.js` puts both
  pods in the Podfile after `use_expo_modules!`, so CocoaPods takes them from
  `apps/mobile/modules/microphone-energy/vendor` and never from trunk.
- **onnxruntime-c from NuGet.** Its source is the package
  Microsoft.ML.OnnxRuntime 1.22.0 on nuget.org, pinned by SHA-256. It holds
  Microsoft's own iPhone build of the same version, signed by Microsoft, and
  nuget.org's catalog states its hash. A `prepare_command` unpacks the
  framework. It is a download of 121 MB, not 45 MB, and costs no hosting.
- **onnxruntime-objc in the repository.** Its 24 source files (92 KB, MIT)
  are kept in `vendor/onnxruntime-objc`, from the `v1.22.0` tag as Software
  Heritage archived it. Their git blob ids prove which files they are.
- **Rejected: a copy of the old zips as a release asset.** Others did this,
  but no trusted checksum of the old zips is left to check a copy against,
  and the only copies are third parties' or a Mac's CocoaPods cache. The two
  sources above are each checked against Microsoft.
- `vendor/README.md` has the checks and the steps to remove this.
