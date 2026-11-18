const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

/**
 * SmartSpectra declares enableOnBackInvokedCallback=true in its library
 * manifest, while Expo currently generates false for the app. The app value
 * is intentional, so make that precedence explicit for Android's merger.
 */
module.exports = function withPresageManifest(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    manifest.$ = manifest.$ || {};
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      androidConfig.modResults,
    );
    application.$ = application.$ || {};

    const replacements = new Set(
      String(application.$['tools:replace'] || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
    replacements.add('android:enableOnBackInvokedCallback');
    application.$['tools:replace'] = [...replacements].join(',');

    return androidConfig;
  });
};
