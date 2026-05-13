// Metro config for the example app.
//
// The example consumes the local `react-native-speechkit` package via a
// symlink (`example/node_modules/react-native-speechkit` -> `../..`).
//
// Metro needs to be told to:
//   1. Watch the parent so edits to ../src/* hot-reload.
//   2. Resolve react/react-native/expo-modules-core out of the example's tree
//      ONLY, so we don't get duplicate copies (which crash with
//      "Cannot find native module ExpoAsset").
//   3. NOT pull the parent's node_modules into bundling — that's where the
//      duplicates come from.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const packageRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch the package source so Metro hot-reloads on edits to the package.
// Watching the whole packageRoot is necessary for the symlink to resolve;
// we deal with duplicate node_modules via blockList + extraNodeModules below.
config.watchFolders = [packageRoot];

// Resolve from the example tree first.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
];

// Force a single copy of the runtime-deduped packages — even when the parent
// has its own copy in `../node_modules`, the example's copy wins.
config.resolver.extraNodeModules = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  'expo-modules-core': path.resolve(projectRoot, 'node_modules/expo-modules-core'),
  expo: path.resolve(projectRoot, 'node_modules/expo'),
};

// Block the parent package's `node_modules` — but NOT
// `example/node_modules/react-native-speechkit/` (which is the symlink we want).
config.resolver.blockList = [
  // Match `<packageRoot>/node_modules/...` literally, not the symlink target.
  new RegExp(`^${packageRoot.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}/node_modules/.*$`),
];

module.exports = config;
