// app.mjs · Rutas HTTP, validación de entradas y traducción de errores.
// crearApp recibe el pool y devuelve la aplicación sin escuchar en un puerto.
import express from 'express';
import { fileURLToPath } from 'node:url';
import { crearRepositorioEquipos } from './equipos.repo.mjs';
import { crearServicioPrestamos } from './prestamos.service.mjs';

// Categorías admitidas: valor guardado -> texto que se muestra.
const CATEGORIAS = {
  portatil: 'Portátil',
  tableta: 'Tableta',
  proyector: 'Proyector',
  camara: 'Cámara',
  otro: 'Otro'
};
const ORDENES = ['codigo', 'nombre'];
const ESTADOS = ['', 'disponible', 'prestado'];

// ---------- Validación ----------

// Identificador que llega como texto en la URL (/equipos/:id).
// Comprueba la forma, el entero seguro de JavaScript y el rango de integer.
function idDeTexto(texto) {
  const id = Number(texto);
  if (!/^[1-9]\d*$/.test(texto) || !Number.isSafeInteger(id) ||
      id > 2147483647) return null;
  return id;
}

// Identificador que llega como número dentro de un JSON.
const idValido = x => Number.isInteger(x) && x > 0 && x <= 2147483647;

// Devuelve los datos normalizados del equipo o null si no son válidos.
function datosEquipo(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  if (typeof b.codigo !== 'string' || typeof b.nombre !== 'string' ||
      typeof b.categoria !== 'string') return null;
  const nombre = b.nombre.trim();
  if (!/^[A-Z0-9-]{1,20}$/.test(b.codigo)) return null;
  if (nombre.length < 1 || nombre.length > 80) return null;
  if (!Object.keys(CATEGORIAS).includes(b.categoria)) return null;
  return { codigo: b.codigo, nombre, categoria: b.categoria };
}

// ---------- Modelos de vista ----------

// Decisión explícita de zona horaria para mostrar las fechas.
const textoFecha = fecha =>
  fecha.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });

const aVistaEquipo = fila => ({
  id: fila.id,
  codigo: fila.codigo,
  nombre: fila.nombre,
  categoriaTexto: CATEGORIAS[fila.categoria] ?? fila.categoria,
  estadoTexto: fila.disponible ? 'Disponible' : 'Prestado'
});

const aVistaPrestamo = fila => ({
  id: fila.id,
  usuario: fila.usuario,
  inicioTexto: textoFecha(fila.fecha_prestamo),
  devolucionTexto: fila.fecha_devolucion === null
    ? 'Pendiente (activo)'
    : textoFecha(fila.fecha_devolucion)
});

export function crearApp(pool) {
  const app = express();
  const equipos = crearRepositorioEquipos(pool);
  const prestamos = crearServicioPrestamos(pool);

  app.set('view engine', 'ejs');
  app.set('views', fileURLToPath(new URL('../views/', import.meta.url)));
  app.use(express.json({ limit: '10kb' }));

  app.get('/', (req, res) => {
    res.redirect('/equipos');
  });

  // ---------- Vistas HTML ----------

  app.get('/equipos', async (req, res) => {
    const q = req.query.q ?? '';
    const categoria = req.query.categoria ?? '';
    const estado = req.query.estado ?? '';
    const orden = req.query.orden ?? 'codigo';
    const textoPagina = req.query.pagina ?? '1';

    // typeof rechaza parámetros repetidos que Express convertiría en arrays.
    if (typeof q !== 'string' || q.length > 80 ||
        typeof categoria !== 'string' ||
        (categoria !== '' && !Object.keys(CATEGORIAS).includes(categoria)) ||
        typeof estado !== 'string' || !ESTADOS.includes(estado) ||
        typeof orden !== 'string' || !ORDENES.includes(orden) ||
        typeof textoPagina !== 'string' ||
        !/^[1-9]\d{0,3}$/.test(textoPagina)) {
      return res.status(400).send('Filtros no válidos');
    }

    const pagina = Number(textoPagina);
    const filtros = { q: q.trim(), categoria, estado, orden, pagina };
    const resultado = await equipos.listar(filtros);

    // Los enlaces de paginación conservan todos los filtros.
    const enlace = n => '/equipos?' + new URLSearchParams({
      q: filtros.q, categoria, estado, orden, pagina: String(n)
    });

    res.render('equipos', {
      equipos: resultado.equipos.map(aVistaEquipo),
      filtros,
      categorias: CATEGORIAS,
      anterior: pagina > 1 ? enlace(pagina - 1) : null,
      siguiente: resultado.haySiguiente ? enlace(pagina + 1) : null
    });
  });

  app.get('/equipos/:id', async (req, res) => {
    const id = idDeTexto(req.params.id);
    if (id === null) return res.status(400).send('Id no válido');

    const equipo = await equipos.buscarDetalle(id);
    if (!equipo) return res.status(404).send('Equipo inexistente');

    const historial = await equipos.historial(id);
    res.render('equipo', {
      equipo: aVistaEquipo(equipo),
      usuarioActual: equipo.usuario_actual,
      prestamos: historial.map(aVistaPrestamo)
    });
  });

  // ---------- API JSON de escritura ----------

  app.post('/api/equipos', async (req, res) => {
    const datos = datosEquipo(req.body);
    if (!datos) return res.status(400).json({ error: 'DATOS_INVALIDOS' });
    const equipo = await equipos.crear(datos);
    res.status(201).location(`/equipos/${equipo.id}`).json(equipo);
  });

  app.put('/api/equipos/:id', async (req, res) => {
    const id = idDeTexto(req.params.id);
    if (id === null) return res.status(400).json({ error: 'ID_INVALIDO' });
    const datos = datosEquipo(req.body);
    if (!datos) return res.status(400).json({ error: 'DATOS_INVALIDOS' });
    const equipo = await equipos.actualizar(id, datos);
    if (!equipo) return res.status(404).json({ error: 'EQUIPO_INEXISTENTE' });
    res.json(equipo);
  });

  app.delete('/api/equipos/:id', async (req, res) => {
    const id = idDeTexto(req.params.id);
    if (id === null) return res.status(400).json({ error: 'ID_INVALIDO' });
    try {
      const borrado = await equipos.eliminar(id);
      if (!borrado) {
        return res.status(404).json({ error: 'EQUIPO_INEXISTENTE' });
      }
    } catch (error) {
      // 23503: la clave foránea de prestamos impide el borrado.
      if (error.code === '23503') {
        return res.status(409).json({ error: 'EQUIPO_CON_PRESTAMOS' });
      }
      throw error;
    }
    res.status(204).end();
  });

  app.post('/api/prestamos', async (req, res) => {
    const { equipoId, usuarioId } = req.body ?? {};
    if (!idValido(equipoId) || !idValido(usuarioId)) {
      return res.status(400).json({ error: 'DATOS_INVALIDOS' });
    }
    const prestamo = await prestamos.prestar(equipoId, usuarioId);
    res.status(201).json(prestamo);
  });

  app.post('/api/prestamos/:id/devolucion', async (req, res) => {
    const id = idDeTexto(req.params.id);
    if (id === null) return res.status(400).json({ error: 'ID_INVALIDO' });
    res.json(await prestamos.devolver(id));
  });

  // ---------- 404 y errores ----------

  app.use((req, res) => {
    res.status(404).json({ error: 'RUTA_INEXISTENTE' });
  });

  // Se inspecciona el código estructurado (SQLSTATE), nunca el texto del
  // mensaje, y no se envían detalles técnicos al cliente.
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'JSON_INVALIDO' });
    if (err.type === 'entity.too.large')
      return res.status(413).json({ error: 'CUERPO_EXCESIVO' });
    if (['EQUIPO_INEXISTENTE', 'PRESTAMO_INEXISTENTE'].includes(err.codigo))
      return res.status(404).json({ error: err.codigo });
    if (['EQUIPO_NO_DISPONIBLE', 'PRESTAMO_YA_DEVUELTO'].includes(err.codigo))
      return res.status(409).json({ error: err.codigo });
    if (err.code === '23505')
      return res.status(409).json({ error: 'DATO_DUPLICADO' });
    if (err.code === '23503')
      return res.status(400).json({ error: 'USUARIO_INEXISTENTE' });
    if (['23502', '23514'].includes(err.code))
      return res.status(400).json({ error: 'DATOS_NO_ADMITIDOS' });
    console.error('Error en la aplicación de préstamos');
    res.status(500).json({ error: 'ERROR_INTERNO' });
  });

  return app;
}
