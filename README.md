# Práctica DWES UD4 · Gestión de préstamos de material informático

Aplicación Express que mantiene el inventario de equipos de un centro y registra
préstamos y devoluciones en PostgreSQL usando SQL directo con `pg`, consultas
parametrizadas, restricciones y transacciones.

## 1. Requisitos

- Node.js 24 (`node --version`) y npm.
- Docker Desktop o Docker Engine con Docker Compose (`docker compose version`).
- PostgreSQL 18 (imagen `postgres:18`, se descarga sola con Compose).
- Dependencias del proyecto: Express 5, pg 8 y EJS 3.

## 2. Estructura

```
practica-prestamos/
  infra-postgres/
    compose.yaml          Servicio PostgreSQL 18 con volumen persistente
    .env.example          Plantilla de la clave del administrador (postgres)
  init.sql                Esquema practica_prestamos, restricciones y datos
  .env.example            Plantilla de la configuración de Node (sin claves reales)
  .gitignore
  package.json
  package-lock.json       (lo genera npm install)
  comprobar.mjs           Comprobaciones del apartado 7 con fetch y pg
  src/
    server.mjs            Arranque de Express, comprobación inicial y cierre
    db.mjs                Validación de variables PG y creación del pool
    app.mjs               Rutas, validación de entradas y traducción de errores
    equipos.repo.mjs      SQL de equipos: listado, detalle, alta, cambio, borrado
    prestamos.service.mjs Transacciones de préstamo y devolución
  views/
    equipos.ejs           GET /equipos
    equipo.ejs            GET /equipos/:id
```

## 3. Instalación de dependencias

Desde la carpeta `practica-prestamos`:

```
npm install
```

Si `package-lock.json` no existe, npm lo crea. No se entrega `node_modules`.

## 4. Arranque de Docker

```
cd infra-postgres
```

Copia `.env.example` como `.env` y escribe una clave de administrador propia
(sin espacios, `#` ni `$`). Este `.env` solo lo usa Compose.

```
docker compose up -d
docker compose ps
```

Espera a que el servicio `db` aparezca como `healthy`. El puerto `15432` del
equipo se dirige al `5432` del contenedor y solo se publica en `127.0.0.1`.

Ciclo de vida: `docker compose stop` / `start` conservan los datos;
`docker compose down` elimina el contenedor pero mantiene el volumen `datos_pg`;
`docker compose down -v` **borra también los datos**.

## 5. Inicialización de la base

### 5.1 Usuario de aplicación (solo una vez)

Si ya creaste `dwes_app` en las sesiones de clase, salta este paso.

```
docker compose exec db psql -U postgres -d dwes
```

```
CREATE ROLE dwes_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
\password dwes_app
GRANT CONNECT, CREATE ON DATABASE dwes TO dwes_app;
\q
```

La aplicación nunca usa el usuario `postgres`.

### 5.2 Esquema y datos

Entra como `dwes_app` (desde `infra-postgres`) y pega el contenido completo de
`init.sql`:

```
docker compose exec db psql -h 127.0.0.1 -U dwes_app -d dwes -W
```

`init.sql` crea el esquema `practica_prestamos` desde una base vacía y, si ya
existía, **reinicia sus datos** (`TRUNCATE ... RESTART IDENTITY`). Repítelo antes
de cada ejecución de `comprobar.mjs` para partir de un estado conocido.

Comprobación rápida:

```
SELECT codigo, disponible FROM practica_prestamos.equipos ORDER BY codigo;
```

### 5.3 Restricciones del modelo

| Tabla | Restricciones |
|---|---|
| equipos | `id` identidad `PRIMARY KEY`; `codigo` `NOT NULL UNIQUE` y `CHECK` de 1 a 20 caracteres; `nombre` `NOT NULL` y `CHECK` de 1 a 80 (no admite vacío); `categoria` `NOT NULL`; `disponible boolean NOT NULL DEFAULT true` |
| usuarios | `id` identidad `PRIMARY KEY`; `nombre NOT NULL` y `CHECK` de longitud |
| prestamos | `equipo_id` y `usuario_id` `NOT NULL` con `FOREIGN KEY` **sin** `ON DELETE CASCADE`; `fecha_prestamo DEFAULT now()`; `fecha_devolucion` NULL mientras está activo; `CHECK` devolución ≥ préstamo |
| índice | `un_prestamo_activo_por_equipo`: `UNIQUE (equipo_id) WHERE fecha_devolucion IS NULL` |

## 6. Arranque de Node.js

En la carpeta `practica-prestamos`, copia `.env.example` como `.env` y pon la
contraseña real de `dwes_app`. Después:

```
npm start
```

equivale a `node --env-file=.env src/server.mjs`. Debe aparecer
`Conexión comprobada: 1` antes de abrir el servidor. Abre
<http://127.0.0.1:3000/equipos>. Se detiene con Ctrl+C (cierra el pool).

## 7. Rutas disponibles

### Vistas HTML (EJS)

| Ruta | Descripción |
|---|---|
| `GET /equipos` | Tabla con código, nombre, categoría y estado. Parámetros GET: `q` (búsqueda parcial por nombre con `ILIKE`), `categoria` (`portatil`, `tableta`, `proyector`, `camara`, `otro`), `estado` (`disponible` o `prestado`), `orden` (`codigo` o `nombre`) y `pagina` (5 por página). Los enlaces Anterior/Siguiente conservan los filtros. Filtros no válidos → 400. |
| `GET /equipos/:id` | Datos del equipo, usuario que lo tiene ahora (`LEFT JOIN`) y relación de préstamos con usuario y fechas (`JOIN`). Id mal formado → 400; inexistente → 404. |

### API JSON

| Método y ruta | Cuerpo | Respuestas |
|---|---|---|
| `POST /api/equipos` | `{ "codigo", "nombre", "categoria" }` | 201 + `Location: /equipos/:id`; 400 datos o JSON inválidos; 409 código repetido |
| `PUT /api/equipos/:id` | `{ "codigo", "nombre", "categoria" }` | 200; 400; 404 si no existe; 409 código repetido. No modifica `disponible` |
| `DELETE /api/equipos/:id` | — | 204 sin cuerpo; 404 si no existe; 409 si tiene préstamos (aunque estén devueltos) |
| `POST /api/prestamos` | `{ "equipoId", "usuarioId" }` (números) | 201 con el préstamo; 400 datos inválidos o usuario inexistente; 404 equipo inexistente; 409 equipo ocupado |
| `POST /api/prestamos/:id/devolucion` | — | 200 con el préstamo devuelto; 404 si no existe; 409 si ya estaba devuelto |

Reglas de validación: `codigo` con mayúsculas, números o guiones (1–20);
`nombre` no vacío tras recortar espacios (1–80); `categoria` de la lista;
identificadores enteros positivos dentro del rango de `integer`.

Los errores se devuelven como `{ "error": "CODIGO" }`, sin mensajes SQL. Las
infracciones de restricciones se tratan por su SQLSTATE: `23505` (UNIQUE) → 409,
`23503` (FOREIGN KEY) → 409 en el borrado y 400 en el préstamo,
`23502`/`23514` → 400. Cualquier otro fallo → 500 genérico.

Ejemplos con curl:

```
curl -i -X POST http://127.0.0.1:3000/api/equipos -H "Content-Type: application/json" -d "{\"codigo\":\"POR-04\",\"nombre\":\"Portátil Asus\",\"categoria\":\"portatil\"}"
curl -i -X POST http://127.0.0.1:3000/api/prestamos -H "Content-Type: application/json" -d "{\"equipoId\":1,\"usuarioId\":1}"
curl -i -X POST http://127.0.0.1:3000/api/prestamos/3/devolucion
curl -i -X DELETE http://127.0.0.1:3000/api/equipos/2
```

## 8. Datos iniciales

Usuarios: 1 Ana García, 2 Luis Pérez, 3 Marta Ruiz.

| id | código | nombre | categoría | estado inicial |
|---|---|---|---|---|
| 1 | POR-01 | Portátil Lenovo ThinkPad | portatil | disponible |
| 2 | POR-02 | Portátil HP ProBook | portatil | disponible (tiene un préstamo **devuelto**) |
| 3 | TAB-01 | Tableta Samsung Galaxy Tab | tableta | **prestado** a Luis (préstamo 2 activo) |
| 4 | TAB-02 | Tableta iPad 10 | tableta | disponible |
| 5 | PRO-01 | Proyector Epson EB | proyector | disponible |
| 6 | PRO-02 | Proyector BenQ portátil | proyector | disponible |
| 7 | CAM-01 | Cámara web Logitech | camara | disponible |
| 8 | CAM-02 | Cámara de fotos Canon | camara | disponible |
| 9 | OTR-01 | Altavoz Bluetooth JBL | otro | disponible |
| 10 | OTR-02 | Disco duro externo 1 TB | otro | disponible |
| 11 | POR-03 | Portátil Dell Latitude | portatil | disponible |
| 12 | TAB-03 | Tableta Lenovo Tab | tableta | disponible |

## 9. Pruebas realizadas

Con el servidor arrancado en una terminal y los datos recién reiniciados con
`init.sql`, en otra terminal:

```
npm run comprobar
```

(`node --env-file=.env comprobar.mjs`). El script envía las peticiones con
`fetch`, consulta las tablas con `pg` para comprobar el estado real y escribe
`OK` o `FALLO` en cada línea. Modifica datos, así que hay que volver a pegar
`init.sql` antes de repetirlo.

Resultado de la ejecución del 21/11/2026 (macOS, Docker Desktop, PostgreSQL 18):
**todas las comprobaciones correctas** (44 OK, 0 FALLO).

| Caso | Petición | Resultado esperado | Resultado obtenido |
|---|---|---|---|
| Alta | `POST /api/equipos` POR-04 | 201, `Location: /equipos/13`, nombre recortado, `disponible=true` | 201; `Location: /equipos/13`; "Portátil Asus"; `disponible=true` ✔ |
| Modificación | `PUT /api/equipos/13` | 200 con el nombre nuevo | 200; "Portátil Asus VivoBook" ✔ |
| Código repetido | `POST` y `PUT` con `codigo` POR-01 | 409 | 409 en POST y 409 en PUT ✔ |
| Datos inválidos | `POST` con código en minúsculas / JSON roto | 400 | 400 y 400 ✔ |
| PUT inexistente | `PUT /api/equipos/999` | 404 | 404 ✔ |
| PUT no toca disponible | `PUT /api/equipos/1` con `disponible:false` | 200 y sigue `disponible=true` | `disponible=true` ✔ |
| Búsqueda ILIKE | `GET /equipos?q=PORT` | Los 3 portátiles, POR-04 y el proyector "BenQ portátil" | Aparecen POR-01 y PRO-02 (BenQ portátil) ✔ |
| Categoría | `GET /equipos?categoria=tableta` | Solo TAB-01, TAB-02, TAB-03 | Aparece TAB-02 y no POR-01 ✔ |
| Disponibilidad | `GET /equipos?estado=prestado` | Solo TAB-01 | Aparece TAB-01 y no POR-01 ✔ |
| Filtros combinados | `GET /equipos?categoria=tableta&estado=disponible` | TAB-02 y TAB-03 | Aparece TAB-02 y no TAB-01 ✔ |
| Ordenación | `GET /equipos?orden=nombre` | Empieza por "Altavoz Bluetooth JBL" | OTR-01 (Altavoz) antes que CAM-01 ✔ |
| Segunda página | `GET /equipos?orden=codigo&pagina=2` | POR-02 … PRO-02, enlace Anterior con los filtros | Aparece POR-02 y no POR-01; el enlace Anterior conserva los filtros ✔ |
| Sin resultados | `GET /equipos?q=zzzz` | 200 y mensaje "No hay equipos…" | 200 y mensaje ✔ |
| Filtro no permitido | `GET /equipos?orden=id` y `?pagina=0` | 400 | 400 y 400 ✔ |
| Detalle | `GET /equipos/3`, `/equipos/abc`, `/equipos/999` | 200 con Luis Pérez; 400; 404 | 200 con Luis Pérez; 400; 404 ✔ |
| Borrado sin historial | `DELETE /api/equipos/13` | 204 | 204 ✔ |
| Borrado inexistente | `DELETE /api/equipos/999` | 404 | 404 ✔ |
| Borrado con préstamos | `DELETE /api/equipos/2` | 409 y POR-02 sigue existiendo | 409; POR-02 sigue con 1 préstamo ✔ |
| Préstamo correcto | `POST /api/prestamos` `{1,1}` | 201; equipo 1 `disponible=false`, 1 préstamo activo | 201; `disponible=false`, 1 activo ✔ |
| Préstamo duplicado | `POST /api/prestamos` `{1,2}` | 409; sigue habiendo 1 solo préstamo | 409; 1 activo y 1 total ✔ |
| Equipo inexistente | `POST /api/prestamos` `{999,1}` | 404 | 404 ✔ |
| Id con tipo incorrecto | `POST /api/prestamos` `{"1",1}` | 400 | 400 ✔ |
| Rollback | `POST /api/prestamos` `{4,999}` | 400; equipo 4 `disponible=true` y 0 préstamos | 400; `disponible=true`, 0 préstamos ✔ |
| Devolución | `POST /api/prestamos/:id/devolucion` | 200; `fecha_devolucion` registrada y equipo disponible | 200; `fecha_devolucion` registrada; `disponible=true` ✔ |
| Segunda devolución | Misma petición otra vez | 409 y no cambia nada | 409; sigue `disponible=true`, 0 activos, 1 total ✔ |
| Devolución inexistente | `POST /api/prestamos/999/devolucion` | 404 | 404 ✔ |
| Simultaneidad | Dos `POST /api/prestamos` al equipo 5 con `Promise.all` | Un 201 y un 409; 1 solo préstamo | 201 y 409; 1 solo préstamo, `disponible=false` ✔ |

## 10. Limitaciones conocidas

- Demostración local: sin autenticación ni permisos. El `usuarioId` llega en
  el cuerpo solo para practicar con usuarios de prueba.
- Las categorías forman una lista fija definida en `app.mjs`.
- En la búsqueda, `%` y `_` escritos por el usuario actúan como comodines de
  `ILIKE` (no se escapan).
- Las fechas se muestran en la zona horaria `Europe/Madrid`.
- La paginación usa `OFFSET`: si se insertan o borran equipos entre peticiones,
  los elementos pueden desplazarse de página.
- En la prueba de simultaneidad no se presupone cuál de las dos peticiones gana.
- Los identificadores de préstamo pueden tener huecos tras un rollback; no son
  un contador.
- El campo `disponible` es redundante con los préstamos activos: solo lo
  modifican las transacciones de préstamo y devolución.
