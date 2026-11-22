// prestamos.service.mjs · Préstamo y devolución como transacciones.
// No recibe req ni res y no conoce códigos HTTP: lanza errores con "codigo"
// y la capa HTTP (app.mjs) decide la respuesta.

function fallo(codigo) { return Object.assign(new Error(codigo), { codigo }); }

export function crearServicioPrestamos(pool) {
  // Un único cliente del pool para toda la operación: BEGIN ... COMMIT/ROLLBACK.
  async function transaccion(trabajo) {
    const cliente = await pool.connect();
    let descartar = false;
    try {
      await cliente.query('BEGIN');
      const resultado = await trabajo(cliente);
      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      try { await cliente.query('ROLLBACK'); }
      catch { descartar = true; }
      throw error;
    } finally {
      // Siempre se libera; si el ROLLBACK falló, se descarta la conexión.
      cliente.release(descartar);
    }
  }

  return {
    async prestar(equipoId, usuarioId) {
      return transaccion(async cliente => {
        // 1. Actualización condicional: solo si ahora está disponible.
        const cambio = await cliente.query(
          `UPDATE practica_prestamos.equipos
           SET disponible = false
           WHERE id = $1 AND disponible = true
           RETURNING id`,
          [equipoId]
        );

        // 2. Si no cambió ninguna fila, no se crea el préstamo.
        //    Se distingue "no existe" (404) de "ocupado" (409).
        if (cambio.rowCount === 0) {
          const existe = await cliente.query(
            'SELECT id FROM practica_prestamos.equipos WHERE id = $1',
            [equipoId]
          );
          if (existe.rowCount === 0) throw fallo('EQUIPO_INEXISTENTE');
          throw fallo('EQUIPO_NO_DISPONIBLE');
        }

        // 3. INSERT después del UPDATE: si el usuario no existe, la clave
        //    foránea falla (23503) y el ROLLBACK devuelve disponible=true.
        const r = await cliente.query(
          `INSERT INTO practica_prestamos.prestamos(equipo_id, usuario_id)
           VALUES ($1, $2)
           RETURNING id, equipo_id, usuario_id, fecha_prestamo`,
          [equipoId, usuarioId]
        );
        return r.rows[0];
      });
    },

    async devolver(prestamoId) {
      return transaccion(async cliente => {
        // 1. Modificación condicional: solo un préstamo todavía activo.
        const r = await cliente.query(
          `UPDATE practica_prestamos.prestamos
           SET fecha_devolucion = now()
           WHERE id = $1 AND fecha_devolucion IS NULL
           RETURNING id, equipo_id, usuario_id,
                     fecha_prestamo, fecha_devolucion`,
          [prestamoId]
        );

        // 3. Si no existe o ya está devuelto, no se toca ningún equipo.
        if (r.rowCount === 0) {
          const existe = await cliente.query(
            'SELECT id FROM practica_prestamos.prestamos WHERE id = $1',
            [prestamoId]
          );
          if (existe.rowCount === 0) throw fallo('PRESTAMO_INEXISTENTE');
          throw fallo('PRESTAMO_YA_DEVUELTO');
        }

        // 2. En la misma transacción, el equipo vuelve a estar disponible.
        await cliente.query(
          `UPDATE practica_prestamos.equipos SET disponible = true
           WHERE id = $1`,
          [r.rows[0].equipo_id]
        );
        return r.rows[0];
      });
    }
  };
}
