import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Where an iPhone build gets ONNX Runtime 1.22.0 (decision
 * 2026-11-21-onnxruntime-pods-from-nuget-and-the-repo, vendor/README.md):
 * the Podfile names both pods, onnxruntime-c comes from Microsoft's NuGet
 * package pinned by SHA-256, and onnxruntime-objc's sources are the v1.22.0
 * files. Nothing runs `pod install` on a developer's Linux machine, so these
 * text checks hold the parts that must not drift.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { addPods } = require('../plugins/withOnnxRuntimePods.js') as { addPods: (podfile: string) => string };

const vendor = join(__dirname, '../modules/microphone-energy/vendor');
const json = (file: string) => JSON.parse(readFileSync(join(vendor, file), 'utf8'));

const PODFILE = "target 'LangQuestNext' do\n  use_expo_modules!\n\n  post_install do |installer|\n  end\nend\n";

describe('the ONNX Runtime pods', () => {
  it('the Podfile names both pods after use_expo_modules!, once', () => {
    const once = addPods(PODFILE);
    expect(once).toContain(
      "  use_expo_modules!\n  # onnxruntime pods (plugins/withOnnxRuntimePods.js)\n" +
        "  pod 'onnxruntime-c', :podspec => '../modules/microphone-energy/vendor/onnxruntime-c.podspec.json'\n" +
        "  pod 'onnxruntime-objc', :path => '../modules/microphone-energy/vendor/onnxruntime-objc'\n",
    );
    expect(addPods(once)).toBe(once);
    expect(() => addPods("target 'X' do\nend\n")).toThrow(/use_expo_modules!/);
  });

  it('app.json runs the plugin', () => {
    const app = JSON.parse(readFileSync(join(__dirname, '../app.json'), 'utf8'));
    expect(app.expo.plugins).toContain('./plugins/withOnnxRuntimePods');
  });

  it('both pods and the module stay at 1.22.0, the version without telemetry (decision 135)', () => {
    expect(json('onnxruntime-c.podspec.json').version).toBe('1.22.0');
    const objc = json('onnxruntime-objc/onnxruntime-objc.podspec.json');
    expect(objc.version).toBe('1.22.0');
    expect(objc.subspecs[0].dependencies).toEqual({ 'onnxruntime-c': ['1.22.0'] });
    const podspec = readFileSync(join(vendor, '../MicrophoneEnergy.podspec'), 'utf8');
    expect(podspec).toContain("s.dependency 'onnxruntime-objc', '1.22.0'");
  });

  it('onnxruntime-c is Microsoft\'s NuGet package, pinned by its SHA-256', () => {
    expect(json('onnxruntime-c.podspec.json').source).toEqual({
      http: 'https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/1.22.0/microsoft.ml.onnxruntime.1.22.0.nupkg',
      type: 'zip',
      sha256: 'd571e63a2329baacb713f441e65ad75284de354db6e1ac435fe4bebbb417986a',
    });
  });

  it('onnxruntime-objc builds only files that are in its folder, with their v1.22.0 blob ids', () => {
    const objc = json('onnxruntime-objc/onnxruntime-objc.podspec.json');
    const files: string[] = objc.subspecs[0].source_files;
    const ids = Object.fromEntries(
      execFileSync('git', ['hash-object', ...files], { cwd: join(vendor, 'onnxruntime-objc'), encoding: 'utf8' })
        .trim()
        .split('\n')
        .map((id, i) => [files[i], id]),
    );
    expect(files).toHaveLength(24);
    // Two of the 24, from Software Heritage's v1.22.0 directory
    // 29d9e4108a7683071d691bd410179dbc2bb0ecb9 (vendor/README.md).
    expect(ids['objectivec/cxx_api.h']).toBe('b57c865a92bc5dae49da8720fb5f9a8450146f37');
    expect(ids['objectivec/assert_arc_enabled.mm']).toBe('9aa0badb985180900490314fc894bad44f88be5e');
  });
});
