#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/home/nathielly/Dev/PITT-AI"
RUNTIME_DIR="$PROJECT_DIR/.runtime"
NODE_VERSION="v20.18.0"
NODE_DIST="node-${NODE_VERSION}-linux-x64"

mkdir -p "$RUNTIME_DIR/browsers"
cd "$PROJECT_DIR"

if [ ! -x "$RUNTIME_DIR/node/bin/node" ]; then
  echo "Baixando Node.js ${NODE_VERSION}..."
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/${NODE_DIST}.tar.xz" -o "$RUNTIME_DIR/${NODE_DIST}.tar.xz"
  tar -xJf "$RUNTIME_DIR/${NODE_DIST}.tar.xz" -C "$RUNTIME_DIR"
  rm -rf "$RUNTIME_DIR/node"
  mv "$RUNTIME_DIR/${NODE_DIST}" "$RUNTIME_DIR/node"
  rm -f "$RUNTIME_DIR/${NODE_DIST}.tar.xz"
fi

export PATH="$RUNTIME_DIR/node/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$RUNTIME_DIR/browsers"

echo "Node: $(node -v) | NPM: $(npm -v)"

echo "Instalando dependências npm..."
npm install --no-audit --no-fund

echo "Gerando Prisma Client e sincronizando banco SQLite..."
npx prisma generate
npx prisma db push --accept-data-loss

echo "Instalando navegador Chromium do Playwright em .runtime/browsers..."
npx playwright install chromium

echo "Setup concluído com sucesso!"
