// Metro must be told about the npm-workspaces layout, otherwise it only
// watches mobile/ and fails to resolve @hireorbitai/shared (which is hoisted
// to the repo-root node_modules as a symlink into ../shared).
//
//   watchFolders          → live-reload picks up edits in shared/dist
//   nodeModulesPaths      → resolution falls back to the hoisted root
//   disableHierarchicalLookup → stops Metro walking ABOVE the repo root and
//                               accidentally resolving a stray global install
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

// @hireorbitai/shared is dual-published (CJS + ESM). Metro reads "main"
// (CJS) by default, which is correct — the ESM build targets Vite only.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
