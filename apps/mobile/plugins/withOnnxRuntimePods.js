// Where an iPhone build gets ONNX Runtime 1.22.0, the speech model's and
// Clean up's runtime (decisions.md 135 and 179; decision
// 2026-11-21-onnxruntime-pods-from-nuget-and-the-repo).
//
// The CocoaPods trunk specs of onnxruntime-c and onnxruntime-objc download
// from download.onnxruntime.ai, which has answered with a wrong certificate
// and 404 since 2026-11-21, and Microsoft took down the GitHub repositories
// too. So the Podfile names both pods itself, and CocoaPods never asks trunk:
//   - onnxruntime-c: Microsoft's signed NuGet package Microsoft.ML.OnnxRuntime
//     1.22.0 from nuget.org, pinned by its SHA-256, which holds the same
//     iPhone build of the runtime (vendor/onnxruntime-c.podspec.json);
//   - onnxruntime-objc: its Objective-C sources, kept in the repository at
//     the v1.22.0 tag (vendor/onnxruntime-objc).
// vendor/README.md says how each one was checked.
const { withPodfile } = require('expo/config-plugins');

const VENDOR = '../modules/microphone-energy/vendor';
const MARK = '# onnxruntime pods (plugins/withOnnxRuntimePods.js)';
const LINES = [
  `  ${MARK}`,
  `  pod 'onnxruntime-c', :podspec => '${VENDOR}/onnxruntime-c.podspec.json'`,
  `  pod 'onnxruntime-objc', :path => '${VENDOR}/onnxruntime-objc'`,
];

/** The Podfile with the two pods after `use_expo_modules!`; unchanged when they are there. */
function addPods(podfile) {
  if (podfile.includes(MARK)) return podfile;
  const at = podfile.match(/^\s*use_expo_modules!.*$/m);
  if (!at) throw new Error('withOnnxRuntimePods: the Podfile has no use_expo_modules! line');
  const end = at.index + at[0].length;
  return `${podfile.slice(0, end)}\n${LINES.join('\n')}${podfile.slice(end)}`;
}

const withOnnxRuntimePods = (config) =>
  withPodfile(config, (c) => {
    c.modResults.contents = addPods(c.modResults.contents);
    return c;
  });

module.exports = withOnnxRuntimePods;
module.exports.addPods = addPods;
