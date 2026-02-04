const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

config.transformer.getTransformOptions = async () => ({
  transform: { inlineRequires: true },
})
config.resolver.unstable_enablePackageExports = true

module.exports = config
