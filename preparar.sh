#!/usr/bin/env bash
# preparar.sh · Deja la práctica lista para `npm start` con un solo comando:
#   1. Crea los .env que falten (Node y Docker Compose).
#   2. Instala las dependencias de Node.
#   3. Arranca PostgreSQL 18 con Docker Compose y espera a que esté "healthy".
#   4. Crea (o actualiza) el usuario dwes_app con la clave de .env.
#   5. Carga init.sql como dwes_app (esquema, restricciones y datos iniciales).
# Se puede repetir cuando se quiera: vuelve a dejar los datos en el estado
# inicial (útil antes de `npm run comprobar`).
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Comprobando Docker"
if ! docker info >/dev/null 2>&1; then
  echo "Docker no está en marcha. Abre Docker Desktop, espera a que arranque y repite." >&2
  exit 1
fi

echo "==> Archivos de configuración"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    Creado .env a partir de .env.example"
fi
if [ ! -f infra-postgres/.env ]; then
  echo "DB_ADMIN_PASSWORD=Admin$(openssl rand -hex 8)" > infra-postgres/.env
  echo "    Creado infra-postgres/.env con una clave de administrador aleatoria"
fi
CLAVE_APP=$(grep '^PGPASSWORD=' .env | cut -d= -f2-)
if [ -z "$CLAVE_APP" ]; then
  echo "Falta PGPASSWORD en .env" >&2
  exit 1
fi

echo "==> Dependencias de Node (npm install)"
npm install --no-audit --no-fund

cd infra-postgres

echo "==> Arrancando PostgreSQL (docker compose up -d)"
docker compose up -d

echo "==> Esperando a que PostgreSQL esté listo"
estado=""
for _ in $(seq 1 60); do
  estado=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q db)" 2>/dev/null || true)
  [ "$estado" = "healthy" ] && break
  sleep 2
done
if [ "$estado" != "healthy" ]; then
  echo "PostgreSQL no ha arrancado. Revisa: docker compose logs db" >&2
  exit 1
fi

echo "==> Usuario de la aplicación dwes_app"
docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -v clave="$CLAVE_APP" \
  -U postgres -d dwes <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dwes_app') THEN
    CREATE ROLE dwes_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
ALTER ROLE dwes_app PASSWORD :'clave';
GRANT CONNECT, CREATE ON DATABASE dwes TO dwes_app;
SQL

echo "==> Cargando init.sql (esquema y datos iniciales)"
docker compose exec -T -e PGPASSWORD="$CLAVE_APP" db \
  psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U dwes_app -d dwes < ../init.sql

echo
echo "Todo listo. Ahora arranca la aplicación con:  npm start"
echo "y abre http://127.0.0.1:3000/equipos"
