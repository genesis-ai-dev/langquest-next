Pod::Spec.new do |s|
  s.name           = 'MicrophoneEnergy'
  s.version        = '1.0.0'
  s.summary        = 'A sample project summary'
  s.description    = 'A sample project description'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # Runs the speech model (Speech.swift, decision 135). Held at 1.22.0, as on Android: from 1.29.0 the
  # runtime carries Microsoft's telemetry (1DS); 1.22.0 has none.
  s.dependency 'onnxruntime-objc', '1.22.0'
  # The speech model itself (models/README.md; models links to the module's one copy).
  s.resource_bundles = { 'MicrophoneEnergyModels' => ['models/*.onnx'] }

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
