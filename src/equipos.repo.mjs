// equipos.repo.mjs · Consultas SQL de equipos.
// Recibe el pool: no conoce Express, req, res ni EJS.
// Todos los valores que llegan del cliente viajan como parámetros $1, $2...

const TAMANO_PAGINA = 5;

// Opciones de orden permitidas -> fragmentos SQL fijos escritos aquí.
// Nunca se concatena un nombre de columna recibido en la petición.
const ORDENES = {
  codigo: 'codigo, id',
  nombre: 'nombre, id'
};

export function crearRepositorioEquipos(pool) {
  return {
    // filtros = { q, categoria, estado, orden, pagina } ya validados
    async listar(filtros) {
      const condiciones = ['nombre ILIKE $1'];
      const valores = [`%${filtros.q}%`];

      if (filtros.categoria !== '') {
        valores.push(filtros.categoria);
        condiciones.push(`categoria = $${valores.length}`);
      }
      if (filtros.estado !== '') {
        valores.push(filtros.estado === 'disponible');
        condiciones.push(`disponible = $${valores.length}`);
      }

      const ordenSQL = ORDENES[filtros.orden];

      // Se pide una fila más del tamaño de página para saber si hay siguiente.
      valores.push(TAMANO_PAGINA + 1);
      const posLimite = valores.length;
      valores.push((filtros.pagina - 1) * TAMANO_PAGINA);
      const posOffset = valores.length;

      const r = await pool.query(
        `SELECT id, codigo, nombre, categoria, disponible
         FROM practica_prestamos.equipos
         WHERE ${condiciones.join(' AND ')}
         ORDER BY ${ordenSQL}
         LIMIT $${posLimite} OFFSET $${posOffset}`,
        valores
      );

      return {
        equipos: r.rows.slice(0, TAMANO_PAGINA),
        haySiguiente: r.rows.length > TAMANO_PAGINA
      };
    },

    // Datos del equipo y usuario que lo tiene ahora (si lo tiene).
    // La condición fecha_devolucion IS NULL va en el ON y no en el WHERE:
    // así el LEFT JOIN conserva los equipos sin préstamo activo.
    async buscarDetalle(id) {
      const r = await pool.query(
        `SELECT e.id, e.codigo, e.nombre, e.categoria, e.disponible,
                u.nombre AS usuario_actual
         FROM practica_prestamos.equipos AS e
         LEFT JOIN practica_prestamos.prestamos AS p
           ON p.equipo_id = e.id AND p.fecha_devolucion IS NULL
         LEFT JOIN practica_prestamos.usuarios AS u
           ON u.id = p.usuario_id
         WHERE e.id = $1`,
        [id]
      );
      return r.rows[0] ?? null;
    },

    // Relación de préstamos del equipo con usuario y fechas.
    async historial(id) {
      const r = await pool.query(
        `SELECT p.id, u.nombre AS usuario,
                p.fecha_prestamo, p.fecha_devolucion
         FROM practica_prestamos.prestamos AS p
         INNER JOIN practica_prestamos.usuarios AS u ON u.id = p.usuario_id
         WHERE p.equipo_id = $1
         ORDER BY p.fecha_prestamo DESC, p.id DESC`,
        [id]
      );
      return r.rows;
    },

    // INSERT ... RETURNING: el equipo creado sin una segunda consulta.
    // disponible toma su valor por defecto (true).
    async crear(datos) {
      const r = await pool.query(
        `INSERT INTO practica_prestamos.equipos(codigo, nombre, categoria)
         VALUES ($1, $2, $3)
         RETURNING id, codigo, nombre, categoria, disponible`,
        [datos.codigo, datos.nombre, datos.categoria]
      );
      return r.rows[0];
    },

    // PUT no modifica disponible: solo cambia al prestar o devolver.
    async actualizar(id, datos) {
      const r = await pool.query(
        `UPDATE practica_prestamos.equipos
         SET codigo = $1, nombre = $2, categoria = $3
         WHERE id = $4
         RETURNING id, codigo, nombre, categoria, disponible`,
        [datos.codigo, datos.nombre, datos.categoria, id]
      );
      if (r.rowCount === 0) return null;
      return r.rows[0];
    },

    // Devuelve true si borró una fila y false si el id no existía.
    // Si el equipo tiene préstamos, la clave foránea lanza SQLSTATE 23503.
    async eliminar(id) {
      const r = await pool.query(
        'DELETE FROM practica_prestamos.equipos WHERE id = $1',
        [id]
      );
      return r.rowCount > 0;
    }
  };
}
