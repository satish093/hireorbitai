// Metro must be told about the npm-workspaces layout, otherwise it only watches
// mobile/ and fails to resolve @hireorbitai/shared, which npm links from the
// repo-root node_modules into ../shared.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Live-reload picks up edits in shared/dist.
config.watchFolders = [workspaceRoot];

// Resolution falls back to the hoisted root after mobile's own node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Hierarchical lookup is deliberately LEFT ON.
//
// The usual monorepo advice is `disableHierarchicalLookup = true` so Metro can't
// wander above the repo. That breaks this install: npm hoists some packages to
// the repo root (expo) while leaving their dependencies under
// mobile/node_modules (expo-modules-core). With hierarchical lookup off, a
// root-hoisted package can only search the root, never mobile/, and resolution
// fails with "could not be found within the project".

// Package exports are deliberately LEFT ENABLED (the SDK 57 default).
//
// An earlier version of this file set `unstable_enablePackageExports = false`
// to force @hireorbitai/shared down its CJS "main". That is unnecessary — Metro
// picks a working entry for shared either way — and it actively breaks any
// dependency that publishes an exports MAP rather than a plain file tree.
// Concretely: expo-router@57 depends on @radix-ui, whose internals import
// '@radix-ui/primitive/is-development' — an exports subpath with no
// corresponding file on disk. With exports disabled Metro cannot resolve it and
// the whole bundle fails.
//
// Do not re-disable this. If shared ever resolves to the wrong build, fix it in
// shared/package.json's exports map instead.

module.exports = config;
