#!/usr/bin/env bash
# Cut a new HireOrbit AI release.
#
#   bash scripts/release.sh patch          # 0.1.0 → 0.1.1
#   bash scripts/release.sh minor          # 0.1.0 → 0.2.0
#   bash scripts/release.sh major          # 0.1.0 → 1.0.0
#   bash scripts/release.sh v0.3.0         # explicit
#
# What it does (local-only — pushes are explicit):
#   1. Verify the working tree is clean and we're on `main`.
#   2. Compute the next version.
#   3. Bump version in package.json, backend/package.json, frontend/package.json.
#   4. Prepend a placeholder entry to CHANGELOG.md if the version isn't there yet.
#   5. Open $EDITOR so the operator fills in the changelog body.
#   6. Commit, tag, and print the push command.
#
# The actual `git push --tags` is left to the operator so a wrong release
# doesn't go out without one more chance to abort.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BUMP="${1:-}"
if [[ -z "$BUMP" ]]; then
  echo "usage: $0 <patch|minor|major|vX.Y.Z>" >&2
  exit 1
fi

# --- 1. preconditions --------------------------------------------------------
if [[ -n "$(git status --porcelain)" ]]; then
  echo "✗ working tree is dirty — commit or stash first" >&2
  exit 1
fi
branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" ]]; then
  echo "✗ release must be cut from main (you're on $branch)" >&2
  exit 1
fi
git fetch --tags --quiet

# --- 2. compute next version -------------------------------------------------
current="$(node -p "require('./package.json').version")"
case "$BUMP" in
  patch|minor|major)
    next="$(node -e "
      const [maj,min,pat] = require('./package.json').version.split('.').map(Number);
      const bump = process.argv[1];
      let v;
      if (bump === 'patch') v = [maj, min, pat + 1];
      else if (bump === 'minor') v = [maj, min + 1, 0];
      else if (bump === 'major') v = [maj + 1, 0, 0];
      console.log(v.join('.'));
    " "$BUMP")"
    ;;
  v*)
    next="${BUMP#v}"
    if ! [[ "$next" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "✗ explicit version must be vX.Y.Z (got $BUMP)" >&2
      exit 1
    fi
    ;;
  *)
    echo "✗ unknown bump: $BUMP (expected patch|minor|major|vX.Y.Z)" >&2
    exit 1
    ;;
esac

tag="v$next"
if git rev-parse "refs/tags/$tag" >/dev/null 2>&1; then
  echo "✗ tag $tag already exists" >&2
  exit 1
fi

echo "→ bumping $current → $next"

# --- 3. bump package.json files ---------------------------------------------
node -e "
  const fs = require('fs');
  for (const p of ['package.json', 'backend/package.json', 'frontend/package.json']) {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.version = '$next';
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  }
"

# --- 4. seed changelog entry if missing --------------------------------------
today="$(date -u +%Y-%m-%d)"
if ! grep -q "^## \[$next\]" CHANGELOG.md 2>/dev/null; then
  tmp="$(mktemp)"
  {
    # Keep the file header (everything up to the first "## [" heading).
    awk '/^## \[/ { exit } { print }' CHANGELOG.md 2>/dev/null
    echo
    echo "## [$next] - $today"
    echo
    echo "### Added"
    echo "- _list new features_"
    echo
    echo "### Changed"
    echo "- _list non-breaking changes_"
    echo
    echo "### Fixed"
    echo "- _list bug fixes_"
    echo
    # Everything that was already in CHANGELOG.md from the first "## [" onwards.
    awk '/^## \[/ { found=1 } found { print }' CHANGELOG.md 2>/dev/null
  } > "$tmp"
  mv "$tmp" CHANGELOG.md
fi

# --- 5. let the operator fill in the body ------------------------------------
echo
echo "→ opening CHANGELOG.md so you can fill in the $next section"
echo "  (close the editor when done; the script will commit + tag)"
${EDITOR:-nano} CHANGELOG.md

# --- 6. commit + tag ---------------------------------------------------------
git add package.json backend/package.json frontend/package.json CHANGELOG.md
git commit -m "release: $tag" -m "See CHANGELOG.md for the full changelist."
git tag -a "$tag" -m "Release $tag"

echo
echo "✓ tagged $tag locally."
echo "  Push when you're ready:"
echo
echo "    git push origin main && git push origin $tag"
echo
echo "  GitHub Actions will pick up the tag and publish the Release."
