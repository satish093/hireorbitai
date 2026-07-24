module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    plugins: [
      // Must stay LAST in the plugin list — react-native-reanimated's worklet
      // transform rewrites function bodies and expects to run after everything
      // else. expo-router's layout animations depend on it.
      'react-native-reanimated/plugin',
    ],
  };
};
