// iOS 27 stops an app at launch unless it adopts the scene-based life cycle,
// once the app is built with the iOS 27 SDK (Xcode 27). Expo SDK 57 ships the
// scene delegate (ExpoAppSceneDelegate) but its prebuild template still
// creates the window in the app delegate. This does what SDK 58's template
// does: a SceneDelegate, the scene manifest in Info.plist, and an app delegate
// that hands its React Native factory to the scene. Drop it on SDK 58.
const fs = require('fs');
const path = require('path');
const { withAppDelegate, withDangerousMod, withInfoPlist, withXcodeProject, IOSConfig } = require('expo/config-plugins');

const SCENE_DELEGATE = `internal import Expo

@objc(SceneDelegate)
class SceneDelegate: ExpoAppSceneDelegate {
  // Extension point for config plugins.
}
`;

const WINDOW_BLOCK = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

function withSceneManifest(config) {
  return withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{
          UISceneConfigurationName: 'Default Configuration',
          UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate'
        }]
      }
    };
    return c;
  });
}

function withSceneAppDelegate(config) {
  return withAppDelegate(config, (c) => {
    if (c.modResults.language !== 'swift') throw new Error('withSceneLifecycle expects a Swift AppDelegate');
    let src = c.modResults.contents;
    if (!src.includes('ExpoReactNativeFactoryProvider')) {
      src = src.replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    }
    if (WINDOW_BLOCK.test(src)) {
      src = src.replace(WINDOW_BLOCK, '\n    // SceneDelegate creates the window and starts React Native (scene life cycle).\n');
    }
    if (!src.includes('ExpoReactNativeFactoryProvider') || src.includes('UIWindow(frame: UIScreen.main.bounds)')) {
      throw new Error('withSceneLifecycle: the AppDelegate template changed; check it against Expo SDK 58\'s');
    }
    c.modResults.contents = src;
    return c;
  });
}

function withSceneDelegateFile(config) {
  config = withDangerousMod(config, ['ios', (c) => {
    const dir = path.join(c.modRequest.platformProjectRoot, c.modRequest.projectName);
    fs.writeFileSync(path.join(dir, 'SceneDelegate.swift'), SCENE_DELEGATE);
    return c;
  }]);
  return withXcodeProject(config, (c) => {
    const name = c.modRequest.projectName;
    const file = `${name}/SceneDelegate.swift`;
    if (!c.modResults.hasFile(file)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: file, groupName: name, project: c.modResults });
    }
    return c;
  });
}

module.exports = (config) => withSceneDelegateFile(withSceneAppDelegate(withSceneManifest(config)));
