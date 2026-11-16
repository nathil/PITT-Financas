#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/nathielly/Dev/PITT-AI"
export PATH="$PROJECT_DIR/.runtime/node/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$PROJECT_DIR/.runtime/browsers"

cd "$PROJECT_DIR"
npm run dev
