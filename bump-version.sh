#!/bin/sh
# Bust the module cache before a deploy: ./bump-version.sh 8
N=${1:?usage: ./bump-version.sh <new-version-number>}
cd "$(dirname "$0")"
sed -i '' -E "s/\?v=[0-9]+/?v=$N/g" index.html js/*.js js/interior/*.js
echo "bumped to ?v=$N:"
grep -c "?v=$N" index.html js/*.js js/interior/*.js
