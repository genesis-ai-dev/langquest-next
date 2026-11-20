Pod::Spec.new do |s|
  s.name           = 'NearbyLink'
  s.version        = '1.0.0'
  s.summary        = "Nearby sync's link on an iPhone"
  s.description    = "Bluetooth LE, an Android's network joined as a plain client, awdl and TCP, with native framing and AES-GCM (docs/nearby-sync-plan.md 5.9, 5.12, section 7's phase 5)"
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.0'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreBluetooth', 'Network', 'NetworkExtension', 'CryptoKit'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  # The module's own sources only: ios/Package.swift and ios/Tests are the XCTest package that runs
  # the pure parts against test-vectors.json, and ios/.build is where it builds.
  s.source_files = 'ios/*.swift', 'ios/Pure/*.swift'
  s.exclude_files = 'ios/Package.swift', 'ios/Tests/**/*', 'ios/.build/**/*'
end
