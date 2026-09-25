Pod::Spec.new do |s|
  s.name = 'PrivacyIcon'
  s.version = '1.0.0'
  s.summary = 'Native alternate launcher icon for LangQuest'
  s.description = s.summary
  s.author = 'LangQuest'
  s.homepage = 'https://langquest.org'
  s.platforms = { :ios => '16.4' }
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
