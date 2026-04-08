#!/bin/bash
set -euo pipefail

WIKI_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.wiki.git"

if git clone "$WIKI_URL" wiki 2>/dev/null; then
  echo "Cloned existing wiki."
else
  echo "Wiki not initialized — creating it."
  mkdir wiki
  cd wiki
  git init
  git config user.name "github-actions[bot]"
  git config user.email "github-actions[bot]@users.noreply.github.com"
  git remote add origin "$WIKI_URL"
  cd ..
fi

cp docs/wiki/*.md wiki/

cd wiki
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add -A

if git diff --cached --quiet; then
  echo "No wiki changes to push."
else
  git commit -m "docs: sync wiki from main [skip ci]"
  git push origin HEAD:master --force
fi
