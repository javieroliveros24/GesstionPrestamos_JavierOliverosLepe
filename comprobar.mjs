// comprobar.mjs · Comprobaciones mínimas del apartado 7.
// Envía las peticiones con fetch y consulta las tablas con pg para verificar
// el estado real (una respuesta HTTP correcta no demuestra el rollback).
//
// Uso (con el servidor arrancado en otra terminal y los datos recién
// reiniciados con init.sql):
//   node --env-file=.env comprobar.mjs
import pg from 'pg';

const base = `http://127.0.0.1:${process.env.PORT ?? 3000}`;
const pool = new pg.Pool({ max: 2, connectionTimeoutMillis: 3000 });
let fallos = 0;

function comprobar(caso, esperado, obtenido) {
  const ok = String(esperado) === String(obtenido);
  if (!ok) fallos += 1;
  console.log(`${ok ? 'OK   ' : 'FALLO'} | ${caso} | esperado: ${esperado}` +
              ` | obtenido: ${obtenido}`);
}

async function enviar(method, ruta, datos) {
  const opciones = { method };
  if (datos !== undefined) {
    opciones.headers = { 'Content-Type': 'application/json' };
    opciones.body = typeof datos === 'string' ? datos : JSON.stringify(datos);
  }
  const r = await fetch(base + ruta, opciones);
  // 204 no tiene cuerpo: no se intenta leer JSON.
  const cuerpo = r.status === 204 ? null : await r.json();
  return { estado: r.status, cuerpo, location: r.headers.get('Location') };
}

async function html(ruta) {
  const r = await fetch(base + ruta);
  return { estado: r.status, texto: await r.text() };
}

// Estado de un equipo en la base de datos.
async function estadoEquipo(equipoId) {
  const e = await pool.query(
    'SELECT disponible FROM practica_prestamos.equipos WHERE id = $1',
    [equipoId]);
  const p = await pool.query(
    `SELECT id FROM practica_prestamos.prestamos
     WHERE equipo_id = $1 AND fecha_devolucion IS NULL`, [equipoId]);
  const t = await pool.query(
    'SELECT id FROM practica_prestamos.prestamos WHERE equipo_id = $1',
    [equipoId]);
  return `disponible=${e.rows[0]?.disponible} activos=${p.rowCount}` +
         ` total=${t.rowCount}`;
}

try {
  // ---------- Alta y modificación ----------
  console.log('\n== Alta y modificación ==');
  const alta = await enviar('POST', '/api/equipos',
    { codigo: 'POR-04', nombre: '  Portátil Asus  ', categoria: 'portatil' });
  comprobar('POST /api/equipos', 201, alta.estado);
  comprobar('Cabecera Location', `/equipos/${alta.cuerpo.id}`, alta.location);
  comprobar('Nombre recortado y disponible=true',
    'Portátil Asus true', `${alta.cuerpo.nombre} ${alta.cuerpo.disponible}`);
  const nuevoId = alta.cuerpo.id;

  const cambio = await enviar('PUT', `/api/equipos/${nuevoId}`,
    { codigo: 'POR-04', nombre: 'Portátil Asus VivoBook', categoria: 'portatil' });
  comprobar('PUT /api/equipos/:id', 200, cambio.estado);
  comprobar('Nombre modificado', 'Portátil Asus VivoBook', cambio.cuerpo.nombre);

  const repetido = await enviar('POST', '/api/equipos',
    { codigo: 'POR-01', nombre: 'Otro', categoria: 'otro' });
  comprobar('POST con código repetido', 409, repetido.estado);
  const repetidoPut = await enviar('PUT', `/api/equipos/${nuevoId}`,
    { codigo: 'POR-01', nombre: 'Otro', categoria: 'otro' });
  comprobar('PUT con código de otro equipo', 409, repetidoPut.estado);

  const putInexistente = await enviar('PUT', '/api/equipos/999',
    { codigo: 'X-1', nombre: 'X', categoria: 'otro' });
  comprobar('PUT id inexistente', 404, putInexistente.estado);
  const invalido = await enviar('POST', '/api/equipos',
    { codigo: 'minúsculas', nombre: '   ', categoria: 'nevera' });
  comprobar('POST con datos inválidos', 400, invalido.estado);
  const malFormado = await enviar('POST', '/api/equipos', '{"codigo": ');
  comprobar('POST con JSON mal formado', 400, malFormado.estado);
  const putDisponible = await enviar('PUT', '/api/equipos/1',
    { codigo: 'POR-01', nombre: 'Portátil Lenovo ThinkPad',
      categoria: 'portatil', disponible: false });
  comprobar('PUT no cambia disponible', true, putDisponible.cuerpo.disponible);

  // ---------- Consulta y filtros ----------
  console.log('\n== Consulta y filtros (HTML) ==');
  const busqueda = await html('/equipos?q=PORT');
  comprobar('ILIKE "PORT" encuentra Portátil y BenQ portátil', 'true true',
    `${busqueda.texto.includes('POR-01')} ${busqueda.texto.includes('PRO-02')}`);
  const categoria = await html('/equipos?categoria=tableta');
  comprobar('Categoría tableta no incluye portátiles', 'true false',
    `${categoria.texto.includes('TAB-02')} ${categoria.texto.includes('POR-01')}`);
  const prestados = await html('/equipos?estado=prestado');
  comprobar('Solo prestados: TAB-01 y no POR-01', 'true false',
    `${prestados.texto.includes('TAB-01')} ${prestados.texto.includes('POR-01')}`);
  const combinado = await html('/equipos?categoria=tableta&estado=disponible');
  comprobar('Tableta + disponible excluye TAB-01', 'true false',
    `${combinado.texto.includes('TAB-02')} ${combinado.texto.includes('TAB-01')}`);
  const pagina2 = await html('/equipos?orden=codigo&pagina=2');
  comprobar('Página 2 por código: POR-02 sí, POR-01 no', 'true false',
    `${pagina2.texto.includes('POR-02')} ${pagina2.texto.includes('POR-01')}`);
  comprobar('Página 2 conserva filtros en enlace Anterior', true,
    pagina2.texto.includes('orden=codigo&amp;pagina=1'));
  const porNombre = await html('/equipos?orden=nombre');
  comprobar('Orden por nombre: Altavoz antes que Cámara', true,
    porNombre.texto.indexOf('OTR-01') < porNombre.texto.indexOf('CAM-01'));
  const vacio = await html('/equipos?q=zzzz');
  comprobar('Sin resultados: 200 y mensaje', '200 true',
    `${vacio.estado} ${vacio.texto.includes('No hay equipos')}`);
  comprobar('Orden no permitido', 400, (await html('/equipos?orden=id')).estado);
  comprobar('Página 0', 400, (await html('/equipos?pagina=0')).estado);
  const detalle = await html('/equipos/3');
  comprobar('Detalle /equipos/3 muestra a Luis', '200 true',
    `${detalle.estado} ${detalle.texto.includes('Luis')}`);
  comprobar('Detalle id mal formado', 400, (await html('/equipos/abc')).estado);
  comprobar('Detalle id inexistente', 404, (await html('/equipos/999')).estado);

  // ---------- Borrado ----------
  console.log('\n== Borrado ==');
  comprobar('DELETE sin historial', 204,
    (await enviar('DELETE', `/api/equipos/${nuevoId}`)).estado);
  comprobar('DELETE id inexistente', 404,
    (await enviar('DELETE', '/api/equipos/999')).estado);
  comprobar('DELETE POR-02 con préstamo devuelto', 409,
    (await enviar('DELETE', '/api/equipos/2')).estado);
  comprobar('POR-02 sigue existiendo', 'disponible=true activos=0 total=1',
    await estadoEquipo(2));

  // ---------- Préstamo correcto y duplicado ----------
  console.log('\n== Préstamo correcto y duplicado ==');
  const prestamo = await enviar('POST', '/api/prestamos',
    { equipoId: 1, usuarioId: 1 });
  comprobar('POST /api/prestamos', 201, prestamo.estado);
  comprobar('Estado tras préstamo', 'disponible=false activos=1 total=1',
    await estadoEquipo(1));
  const duplicado = await enviar('POST', '/api/prestamos',
    { equipoId: 1, usuarioId: 2 });
  comprobar('Segundo préstamo del mismo equipo', 409, duplicado.estado);
  comprobar('No se duplican filas', 'disponible=false activos=1 total=1',
    await estadoEquipo(1));
  comprobar('Préstamo de equipo inexistente', 404,
    (await enviar('POST', '/api/prestamos', { equipoId: 999, usuarioId: 1 })).estado);
  comprobar('Préstamo con id de texto', 400,
    (await enviar('POST', '/api/prestamos', { equipoId: '1', usuarioId: 1 })).estado);

  // ---------- Rollback ----------
  console.log('\n== Rollback ==');
  const antes = await estadoEquipo(4);
  const rollback = await enviar('POST', '/api/prestamos',
    { equipoId: 4, usuarioId: 999 });
  comprobar('Préstamo a usuario inexistente', 400, rollback.estado);
  comprobar('El equipo conserva su estado', antes, await estadoEquipo(4));

  // ---------- Devolución ----------
  console.log('\n== Devolución ==');
  const devolucion = await enviar('POST',
    `/api/prestamos/${prestamo.cuerpo.id}/devolucion`);
  comprobar('Primera devolución', 200, devolucion.estado);
  comprobar('fecha_devolucion registrada', true,
    devolucion.cuerpo.fecha_devolucion !== null);
  comprobar('Estado tras devolución', 'disponible=true activos=0 total=1',
    await estadoEquipo(1));
  const segunda = await enviar('POST',
    `/api/prestamos/${prestamo.cuerpo.id}/devolucion`);
  comprobar('Segunda devolución', 409, segunda.estado);
  comprobar('La segunda no modifica nada', 'disponible=true activos=0 total=1',
    await estadoEquipo(1));
  comprobar('Devolución de préstamo inexistente', 404,
    (await enviar('POST', '/api/prestamos/999/devolucion')).estado);

  // ---------- Simultaneidad ----------
  console.log('\n== Simultaneidad ==');
  // Promise.all inicia las dos peticiones sin esperar a que termine la primera.
  const respuestas = await Promise.all([
    enviar('POST', '/api/prestamos', { equipoId: 5, usuarioId: 1 }),
    enviar('POST', '/api/prestamos', { equipoId: 5, usuarioId: 2 })
  ]);
  comprobar('Dos préstamos a la vez', '201,409',
    respuestas.map(r => r.estado).sort());
  comprobar('Solo se confirma uno', 'disponible=false activos=1 total=1',
    await estadoEquipo(5));

  console.log(fallos === 0
    ? '\nTodas las comprobaciones son correctas.'
    : `\nComprobaciones fallidas: ${fallos}`);
} finally {
  await pool.end();
}
