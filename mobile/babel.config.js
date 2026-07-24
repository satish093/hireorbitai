module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    plugins: [
      // Reanimated 4 moved the worklet transform OUT of react-native-reanimated
      // and into react-native-worklets. The old 'react-native-reanimated/plugin'
      // no longer exists in v4 and referencing it fails the build outright.
      //
      // Must stay LAST: the transform rewrites function bodies and expects to
      // run after every other plugin. expo-router's layout animations depend on
      // it being present.
      'react-native-worklets/plugin',
    ],
  };
};
