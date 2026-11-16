#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/nathielly/Dev/PITT-AI"
export PATH="$PROJECT_DIR/.runtime/node/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$PROJECT_DIR/.runtime/browsers"

cd "$PROJECT_DIR"
echo "1. Compilando TypeScript (npm run build)..."
npm run build

echo "2. Sincronizando banco isolado de testes (prisma/test.db)..."
DATABASE_URL="file:./test.db" npx prisma db push --skip-generate >/dev/null

echo "3. Executando suíte de testes automatizados em test.db (vitest run)..."
DATABASE_URL="file:./test.db" npx vitest run
