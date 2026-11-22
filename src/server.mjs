// server.mjs · Arranque de Express y cierre ordenado del pool.
import { pool } from './db.mjs';
import { crearApp } from './app.mjs';

try {
  // Comprobación antes de admitir peticiones.
  const r = await pool.query('SELECT 1 AS comprobacion');
  console.log('Conexión comprobada:', r.rows[0].comprobacion);
  const puerto = Number(process.env.PORT ?? 3000);
  const servidor = crearApp(pool).listen(puerto, '127.0.0.1', () => {
    console.log(`Servidor disponible en http://127.0.0.1:${puerto}/equipos`);
  });
  const cerrar = () => servidor.close(async () => { await pool.end(); });
  process.once('SIGINT', cerrar);
  process.once('SIGTERM', cerrar);
} catch {
  console.error('No se pudo conectar con PostgreSQL');
  await pool.end();
  process.exitCode = 1;
}
