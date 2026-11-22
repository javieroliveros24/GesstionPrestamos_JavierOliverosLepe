-- init.sql · Práctica: gestión de préstamos de material informático
-- Ejecutar como dwes_app en la base dwes (pegar el contenido completo en psql).
-- Reinicia SOLO las tablas del esquema practica_prestamos: al repetirlo se
-- pierden los datos de la práctica y se vuelve al estado inicial conocido.

CREATE SCHEMA IF NOT EXISTS practica_prestamos;

CREATE TABLE IF NOT EXISTS practica_prestamos.equipos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo text NOT NULL UNIQUE CHECK (char_length(codigo) BETWEEN 1 AND 20),
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 80),
  categoria text NOT NULL CHECK (char_length(categoria) BETWEEN 1 AND 30),
  disponible boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS practica_prestamos.usuarios (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 80)
);

-- Las claves foráneas no llevan ON DELETE CASCADE: así no se puede borrar
-- un equipo (o un usuario) que tenga préstamos, aunque ya estén devueltos.
CREATE TABLE IF NOT EXISTS practica_prestamos.prestamos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  equipo_id integer NOT NULL
    REFERENCES practica_prestamos.equipos(id),
  usuario_id integer NOT NULL
    REFERENCES practica_prestamos.usuarios(id),
  fecha_prestamo timestamptz NOT NULL DEFAULT now(),
  fecha_devolucion timestamptz,
  CHECK (fecha_devolucion IS NULL OR fecha_devolucion >= fecha_prestamo)
);

-- Índice único parcial: como máximo un préstamo activo por equipo,
-- pero se conservan todos los préstamos históricos ya devueltos.
CREATE UNIQUE INDEX IF NOT EXISTS un_prestamo_activo_por_equipo
ON practica_prestamos.prestamos(equipo_id)
WHERE fecha_devolucion IS NULL;

TRUNCATE practica_prestamos.prestamos,
  practica_prestamos.equipos, practica_prestamos.usuarios
RESTART IDENTITY;

INSERT INTO practica_prestamos.usuarios(nombre)
VALUES ('Ana García'), ('Luis Pérez'), ('Marta Ruiz');

-- 12 equipos de 5 categorías. El equipo 3 (TAB-01) está prestado ahora mismo,
-- por eso se inserta con disponible=false.
INSERT INTO practica_prestamos.equipos(codigo, nombre, categoria, disponible)
VALUES
  ('POR-01', 'Portátil Lenovo ThinkPad', 'portatil', true),
  ('POR-02', 'Portátil HP ProBook', 'portatil', true),
  ('TAB-01', 'Tableta Samsung Galaxy Tab', 'tableta', false),
  ('TAB-02', 'Tableta iPad 10', 'tableta', true),
  ('PRO-01', 'Proyector Epson EB', 'proyector', true),
  ('PRO-02', 'Proyector BenQ portátil', 'proyector', true),
  ('CAM-01', 'Cámara web Logitech', 'camara', true),
  ('CAM-02', 'Cámara de fotos Canon', 'camara', true),
  ('OTR-01', 'Altavoz Bluetooth JBL', 'otro', true),
  ('OTR-02', 'Disco duro externo 1 TB', 'otro', true),
  ('POR-03', 'Portátil Dell Latitude', 'portatil', true),
  ('TAB-03', 'Tableta Lenovo Tab', 'tableta', true);

-- Historial de ejemplo:
--  · préstamo 1: POR-02 ya devuelto (impide borrar POR-02 aunque esté libre).
--  · préstamo 2: TAB-01 activo, lo tiene Luis.
INSERT INTO practica_prestamos.prestamos
  (equipo_id, usuario_id, fecha_prestamo, fecha_devolucion)
VALUES
  (2, 1, '2026-11-02 09:00:00+01', '2026-11-06 13:30:00+01'),
  (3, 2, '2026-11-18 10:15:00+01', NULL);
