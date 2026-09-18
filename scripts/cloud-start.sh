#!/bin/bash
[ "$CLAUDE_CODE_REMOTE" = "true" ] || exit 0
service postgresql start || true
[ -f package.json ] && npm install --no-audit --no-fund
exit 0
