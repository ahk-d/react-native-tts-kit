// Lightweight Jest config for the package's pure-TS unit tests.
//
// We don't need the full jest-expo multi-project runner — none of our tests
// touch the native module, RN, or expo-asset. They're pure functions over
// Uint8Array, regex, and arrays. A vanilla babel-jest transform is enough.
//
// Note: expo-module-scripts' default `jest-preset.js` runs four sub-projects
// (ios, android, web, node) which is heavy and doesn't transform our TS files
// out of the box for unit-testing pure logic.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
};
