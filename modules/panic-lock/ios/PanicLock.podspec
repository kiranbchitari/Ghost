Pod::Spec.new do |s|
  s.name           = 'PanicLock'
  s.version        = '1.0.0'
  s.summary        = 'Terminates the app process immediately.'
  s.description    = 'Terminates the app process immediately.'
  s.license        = 'MIT'
  s.author         = 'Ghost'
  s.homepage       = 'https://github.com/kiran/ghost'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
