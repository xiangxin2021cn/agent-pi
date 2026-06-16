/**
 * electron-builder afterPack hook
 *
 * Optionally copies the pre-compiled macOS 26+ Liquid Glass icon (Assets.car)
 * into the app bundle. The committed Assets.car is not regenerated on Windows,
 * so it is skipped by default after the Agent π rebrand to avoid overriding the
 * refreshed icon.icns.
 *
 * To regenerate Assets.car after icon changes:
 *   cd apps/electron
 *   xcrun actool "resources/icon.icon" --compile "resources" \
 *     --app-icon AppIcon --minimum-deployment-target 26.0 \
 *     --platform macosx --output-partial-info-plist /dev/null
 *
 * Set AGENT_PI_COPY_PRECOMPILED_ASSETS=1 after regenerating Assets.car with
 * actool. Otherwise the app falls back to icon.icns, which is included
 * separately by electron-builder.
 */

const path = require('path');
const fs = require('fs');

module.exports = async function afterPack(context) {
  // Only process macOS builds
  if (context.electronPlatformName !== 'darwin') {
    console.log('Skipping Liquid Glass icon (not macOS)');
    return;
  }

  const precompiledAssets = path.join(context.packager.projectDir, 'resources', 'Assets.car');

  console.log(`afterPack: projectDir=${context.packager.projectDir}`);
  console.log(`afterPack: looking for Assets.car at ${precompiledAssets}`);

  if (process.env.AGENT_PI_COPY_PRECOMPILED_ASSETS !== '1') {
    console.log('Skipping pre-compiled Assets.car so the refreshed icon.icns remains authoritative.');
    console.log('Set AGENT_PI_COPY_PRECOMPILED_ASSETS=1 after regenerating Assets.car with actool.');
    return;
  }

  const appPath = context.appOutDir;
  const productFilename =
    context.packager.appInfo.productFilename ||
    context.packager.appInfo.productName ||
    'Agent π';
  const resourcesDir = path.join(appPath, `${productFilename}.app`, 'Contents', 'Resources');

  // Check if pre-compiled Assets.car exists
  if (!fs.existsSync(precompiledAssets)) {
    console.log('Warning: Pre-compiled Assets.car not found in resources/');
    console.log('The app will use the fallback icon.icns on all macOS versions');
    return;
  }

  // Copy pre-compiled Assets.car to the app bundle
  const destAssetsCar = path.join(resourcesDir, 'Assets.car');
  try {
    fs.copyFileSync(precompiledAssets, destAssetsCar);
    console.log(`Liquid Glass icon copied: ${destAssetsCar}`);
  } catch (err) {
    // Don't fail the build if Assets.car can't be copied - app will use fallback icon.icns
    console.log(`Warning: Could not copy Assets.car: ${err.message}`);
    console.log('The app will use the fallback icon.icns on all macOS versions');
  }
};
