#!/usr/bin/env bash
#
# start.sh — EdgeMarket dev startup (Phase 6: 2-service architecture)
#
# As of Phase 6, the Node.js proxy (server/, port 3001) has been merged
# into the Spring Boot backend. Only two services are needed now:
#
#   1. Spring Boot API   (spring-server/, port 8080)
#   2. Expo frontend     (root, port 8081)
#
# Usage:
#   ./start.sh
#
# Secrets are loaded from .env in the project root (never committed to git).
# Copy .env.example to .env and fill in your values on first setup.
#
# Keep this terminal open — closing it stops both services.
# Requires: JAVA_HOME set to a Java 21 JDK, Maven wrapper (./mvnw), Node.js.

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== EdgeMarket dev startup ==="

# ── Load .env if it exists ─────────────────────────────────────────────────
ENV_FILE="$ROOT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  echo "[env] Loading secrets from .env ..."
  # Export each non-comment, non-blank line as an env variable
  set -o allexport
  # shellcheck source=.env
  source "$ENV_FILE"
  set +o allexport
else
  echo "WARNING: .env file not found. Copy .env.example to .env and fill in your secrets."
  echo "  cp .env.example .env"
fi

if [ -z "$JAVA_HOME" ]; then
  echo "WARNING: JAVA_HOME is not set. Spring Boot needs Java 21."
  echo "  Add: JAVA_HOME=C:/Program Files/Java/jdk-21.0.10  to your .env"
fi

if [ -z "$DB_PASSWORD" ]; then
  echo "WARNING: DB_PASSWORD is not set. Spring Boot cannot connect to Neon Postgres."
fi

if [ -z "$JWT_SECRET" ]; then
  echo "WARNING: JWT_SECRET is not set. Spring Boot will refuse to start."
fi

# 1. Spring Boot API (port 8080)
echo "[1/2] Starting Spring Boot API on :8080 ..."
(
  cd "$ROOT_DIR/spring-server"
  ./mvnw spring-boot:run
) &
SPRING_PID=$!

# 2. Expo frontend (port 8081)
# --localhost ensures Metro binds to 127.0.0.1, which the Android emulator
# reaches via the built-in 10.0.2.2 alias — no adb reverse needed.
echo "[2/2] Starting Expo frontend on :8081 ..."
(
  cd "$ROOT_DIR"
  npx expo start --localhost --android
) &
EXPO_PID=$!

trap "echo 'Stopping services...'; kill $SPRING_PID $EXPO_PID 2>/dev/null" EXIT INT TERM

wait
