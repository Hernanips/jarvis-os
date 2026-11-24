import { supabase } from '../config/clients.js';

const CAL_BASE = 'https://www.googleapis.com/calendar/v3';
const TASKS_BASE = 'https://www.googleapis.com/tasks/v1';

function normalizar(texto) {
  return (texto || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// Renueva el access_token de Google automáticamente usando el refresh_token guardado
async function renovarTokenGoogleSilencioso(userId, refreshTokenDirecto) {
  try {
    let refreshToken = refreshTokenDirecto;

    if (!refreshToken && userId) {
      const { data } = await supabase
        .from('user_google_tokens')
        .select('refresh_token')
        .eq('user_id', userId)
        .single();
      if (data?.refresh_token) refreshToken = data.refresh_token;
    }

    if (!refreshToken || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return null;
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID.trim(),
        client_secret: process.env.GOOGLE_CLIENT_SECRET.trim(),
        refresh_token: refreshToken.trim(),
        grant_type: 'refresh_token'
      })
    });

    const data = await res.json();
    if (res.ok && data.access_token) {
      console.log('🔄 Token de Google renovado automáticamente en segundo plano.');
      return data.access_token;
    }
    return null;
  } catch (e) {
    console.error('Error renovando token de Google:', e.message);
    return null;
  }
}

export async function ejecutarAccionGoogle(accion, args, googleTokenInicial, userId = null, googleRefreshToken = null) {
  let activeToken = googleTokenInicial;
  let tokenRenovadoEnEstaLlamada = null;

  if (!activeToken) {
    activeToken = await renovarTokenGoogleSilencioso(userId, googleRefreshToken);
    tokenRenovadoEnEstaLlamada = activeToken;
  }

  if (!activeToken) {
    return {
      ok: false,
      error: 'Falta vincular el token de Google. Pulsa el botón de Cerrar sesión (arriba a la derecha) y vuelve a entrar con Google.'
    };
  }

  async function gFetch(url, options = {}) {
    let res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${activeToken}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    // Si el token de 1 hora ha caducado (401), lo renovamos al vuelo con el refresh_token y repetimos
    if (res.status === 401) {
      const nuevo = await renovarTokenGoogleSilencioso(userId, googleRefreshToken);
      if (nuevo) {
        activeToken = nuevo;
        tokenRenovadoEnEstaLlamada = nuevo;
        res = await fetch(url, {
          ...options,
          headers: {
            'Authorization': `Bearer ${activeToken}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
          }
        });
      } else {
        throw new Error('GOOGLE_TOKEN_EXPIRED');
      }
    }

    if (res.status === 204) return {};
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error?.message || `Error Google API (${res.status})`);
    }
    return data;
  }

  try {
    const [listasRes, calsRes] = await Promise.all([
      gFetch(`${TASKS_BASE}/users/@me/lists?maxResults=100`),
      gFetch(`${CAL_BASE}/users/me/calendarList`)
    ]);

    const todasLasListas = listasRes.items || [];
    const misCalendarios = (calsRes.items || []).filter(
      c => c.accessRole === 'owner' || c.accessRole === 'writer' || c.primary
    );

    function buscarCalendarioPorNombre(nombreCal) {
      if (!nombreCal) return misCalendarios.find(c => c.primary) || misCalendarios[0];
      const q = normalizar(nombreCal);
      if (['personal', 'principal', 'general', 'default', 'mio'].includes(q)) {
        return misCalendarios.find(c => c.primary) || misCalendarios[0];
      }
      for (const cal of misCalendarios) {
        const nombreActual = normalizar(cal.summaryOverride || cal.summary);
        if (nombreActual.includes(q) || q.includes(nombreActual)) {
          return cal;
        }
      }
      return misCalendarios.find(c => c.primary) || misCalendarios[0];
    }

    function buscarListaPorNombre(nombreCategoria) {
      const cat = normalizar(nombreCategoria);
      if (!cat || ['general', 'mis tareas', 'principal', 'default', 'my tasks'].includes(cat)) {
        return todasLasListas[0];
      }
      for (const lista of todasLasListas) {
        const tituloLista = normalizar(lista.title);
        if (tituloLista.includes(cat) || cat.includes(tituloLista)) {
          return lista;
        }
      }
      return null;
    }

    async function buscarTareaPorNombre(nombreBuscado) {
      const query = normalizar(nombreBuscado);
      let respaldoCompletada = null;

      for (const lista of todasLasListas) {
        const resT = await gFetch(
          `${TASKS_BASE}/lists/${encodeURIComponent(lista.id)}/tasks?showCompleted=true&showHidden=true&maxResults=100`
        );
        const tareas = resT.items || [];
        for (const t of tareas) {
          if (normalizar(t.title).includes(query)) {
            if (t.status !== 'completed') {
              return { tarea: t, listaId: lista.id, listaNombre: lista.title };
            }
            if (!respaldoCompletada) {
              respaldoCompletada = { tarea: t, listaId: lista.id, listaNombre: lista.title };
            }
          }
        }
      }
      return respaldoCompletada;
    }

    async function buscarEventoEnTodos(nombreBuscado) {
      const query = normalizar(nombreBuscado);
      const timeMin = new Date(Date.now() - 365 * 86400000).toISOString();
      const timeMax = new Date(Date.now() + 365 * 86400000).toISOString();

      for (const cal of misCalendarios) {
        const url = `${CAL_BASE}/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true`;
        const resEv = await gFetch(url);
        const eventos = resEv.items || [];
        for (const ev of eventos) {
          if (normalizar(ev.summary).includes(query)) {
            return { evento: ev, calendario: cal };
          }
        }
      }
      return null;
    }

    function construirRRULE(tipo, intervalo, diasSemanaStr) {
      const t = (tipo || '').toUpperCase().trim();
      if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(t)) return null;
      const intVal = Number(intervalo) || 1;
      let rrule = `RRULE:FREQ=${t};INTERVAL=${intVal}`;
      if (t === 'WEEKLY' && diasSemanaStr) {
        const mapa = {
          MONDAY: 'MO', TUESDAY: 'TU', WEDNESDAY: 'WE',
          THURSDAY: 'TH', FRIDAY: 'FR', SATURDAY: 'SA', SUNDAY: 'SU'
        };
        const dias = String(diasSemanaStr)
          .split(',')
          .map(d => mapa[d.trim().toUpperCase()])
          .filter(Boolean);
        if (dias.length > 0) rrule += `;BYDAY=${dias.join(',')}`;
      }
      return [rrule];
    }

    function formatearFechaHoraEvento(str, sumarUnaHora = false, refInicio = null) {
      if (!str && refInicio) {
        const d = new Date(new Date(refInicio).getTime() + 3600000);
        return { dateTime: d.toISOString(), timeZone: 'Europe/Madrid' };
      }
      const limpio = String(str).trim();
      if (!limpio.includes('T')) {
        if (sumarUnaHora) {
          const [y, m, d] = limpio.split('-').map(Number);
          const nextDay = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().substring(0, 10);
          return { date: nextDay };
        }
        return { date: limpio.substring(0, 10) };
      }
      const isoLocal = limpio.length === 16 ? `${limpio}:00` : limpio.replace('Z', '');
      return { dateTime: isoLocal, timeZone: 'Europe/Madrid' };
    }

    async function obtenerEventosTodosLosCalendarios(startStr, endStr) {
      // Por defecto leemos desde hace 1 día hasta dentro de 14 días para que vea hoy, mañana y la semana
      let inicio = startStr
        ? new Date(`${startStr.substring(0, 10)}T00:00:00`)
        : new Date(Date.now() - 1 * 86400000);
      let limite = endStr
        ? new Date(`${endStr.substring(0, 10)}T23:59:59`)
        : new Date(inicio.getTime() + (startStr ? 7 : 15) * 86400000);

      const resumenCalendarios = {};

      await Promise.all(
        misCalendarios.map(async (cal) => {
          const etiquetaCal = cal.primary ? `Personal (${cal.summary})` : (cal.summaryOverride || cal.summary);
          const url = `${CAL_BASE}/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${encodeURIComponent(inicio.toISOString())}&timeMax=${encodeURIComponent(limite.toISOString())}&singleEvents=true&orderBy=startTime`;
          const resEv = await gFetch(url);
          const eventos = resEv.items || [];

          resumenCalendarios[etiquetaCal] = eventos.map(ev => {
            const esTodoElDia = Boolean(ev.start?.date);
            let horario = '';
            if (esTodoElDia) {
              horario = `${ev.start.date} (Todo el día)`;
            } else {
              const ini = new Date(ev.start.dateTime);
              const fin = new Date(ev.end.dateTime);
              const fIni = ini.toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).substring(0, 16);
              const fFin = fin.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
              horario = `${fIni} a ${fFin}`;
            }
            const recTag = ev.recurringEventId ? ' 🔄(Recurrente)' : '';
            const desc = ev.description ? ` [Notas: ${ev.description}]` : '';
            return `${ev.summary || 'Sin título'}${recTag} -> ${horario}${desc}`;
          });
        })
      );

      return resumenCalendarios;
    }

    // 1. GESTIÓN DE CALENDARIOS
    if (accion === 'crear_calendario') {
      const nuevo = await gFetch(`${CAL_BASE}/calendars`, {
        method: 'POST',
        body: JSON.stringify({
          summary: (args.title || '').trim(),
          description: args.description || '',
          timeZone: 'Europe/Madrid'
        })
      });
      return { ok: true, _newGoogleAccessToken: tokenRenovadoEnEstaLlamada, mensaje: `Calendario "${nuevo.summary}" creado` };
    }

    if (accion === 'editar_calendario') {
      const cal = buscarCalendarioPorNombre(args.search_title);
      if (!cal) return { ok: false, error: 'Calendario no encontrado' };
      const body = {};
      if (args.new_title) body.summary = args.new_title;
      if (args.description !== undefined) body.description = args.description;
      await gFetch(`${CAL_BASE}/calendars/${encodeURIComponent(cal.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      return { ok: true, _newGoogleAccessToken: tokenRenovadoEnEstaLlamada, mensaje: 'Calendario actualizado' };
    }

    if (accion === 'borrar_calendario') {
      const cal = buscarCalendarioPorNombre(args.title);
      if (!cal || cal.primary) return { ok: false, error: 'No se encontró o es el calendario principal' };
      await gFetch(`${CAL_BASE}/calendars/${encodeURIComponent(cal.id)}`, {
        method: 'DELETE'
      });
      return { ok: true, _newGoogleAccessToken: tokenRenovadoEnEstaLlamada, mensaje: 'Calendario eliminado' };
    }

    // 2. EVENTOS DE CALENDARIO
    if (accion === 'crear_evento') {
      const calDestino = buscarCalendarioPorNombre(args.calendar_name);
      const esTodoElDia = args.start_time && !String(args.start_time).includes('T');

      const startObj = formatearFechaHoraEvento(args.start_time, false);
      let endObj;
      if (esTodoElDia) {
        endObj = formatearFechaHoraEvento(args.start_time, true);
      } else if (args.end_time) {
        endObj = formatearFechaHoraEvento(args.end_time, false);
      } else {
        const [fechaP, horaP] = String(args.start_time).split('T');
        const [hh, mm] = (horaP || '09:00').split(':').map(Number);
        const hFin = String((hh + 1) % 24).padStart(2, '0');
        endObj = formatearFechaHoraEvento(`${fechaP}T${hFin}:${String(mm || 0).padStart(2, '0')}`, false);
      }

      const payload = {
        summary: args.title || 'Nuevo evento',
        description: args.description || '',
        location: args.location || '',
        start: startObj,
        end: endObj
      };

      const rrule = construirRRULE(args.recurrence_type, args.recurrence_interval, args.days_of_week);
      if (rrule) payload.recurrence = rrule;

      if (args.reminders && String(args.reminders).toLowerCase() !== 'none') {
        const mins = String(args.reminders)
          .split(',')
          .map(m => Number(m.trim()))
          .filter(m => !isNaN(m) && m > 0);
        if (mins.length > 0) {
          payload.reminders = {
            useDefault: false,
            overrides: mins.map(m => ({ method: 'popup', minutes: m }))
          };
        }
      } else if (String(args.reminders).toLowerCase() !== 'none') {
        // Recordatorios automáticos por defecto: 1 hora antes y 24 horas antes
        payload.reminders = {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 60 },
            { method: 'popup', minutes: 1440 }
          ]
        };
      }

      await gFetch(`${CAL_BASE}/calendars/${encodeURIComponent(calDestino.id)}/events`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      return {
        ok: true,
        _newGoogleAccessToken: tokenRenovadoEnEstaLlamada,
        mensaje: `Evento "${payload.summary}" creado en el calendario "${calDestino.summaryOverride || calDestino.summary}"`
      };
    }

    if (accion === 'editar_evento') {
      const encontrado = await buscarEventoEnTodos(args.search_title);
      if (!encontrado) return { ok: false, error: 'Evento no encontrado' };

      let { evento: ev, calendario: calActual } = encontrado;
      const patch = {};

      if (args.new_title) patch.summary = args.new_title;
      if (args.description !== undefined) patch.description = args.description;
      if (args.location !== undefined) patch.location = args.location;

      if (args.start_time) {
        const esTodoElDia = !String(args.start_time).includes('T');
        patch.start = formatearFechaHoraEvento(args.start_time, false);
        if (esTodoElDia) {
          patch.end = formatearFechaHoraEvento(args.start_time, true);
        } else if (args.end_time) {
          patch.end = formatearFechaHoraEvento(args.end_time, false);
        } else {
          const [fechaP, horaP] = String(args.start_time).split('T');
          const [hh, mm] = (horaP || '09:00').split(':').map(Number);
          const hFin = String((hh + 1) % 24).padStart(2, '0');
          patch.end = formatearFechaHoraEvento(`${fechaP}T${hFin}:${String(mm || 0).padStart(2, '0')}`, false);
        }
      }

      if (args.reminder_minutes !== undefined) {
        const min = Number(args.reminder_minutes);
        if (!isNaN(min) && min > 0) {
          patch.reminders = {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: min }]
          };
        }
      }

      const actualizado = await gFetch(
        `${CAL_BASE}/calendars/${encodeURIComponent(calActual.id)}/events/${encodeURIComponent(ev.id)}`,
        { method: 'PATCH', body: JSON.stringify(patch) }
      );

      if (args.calendar_name) {
        const nuevoCal = buscarCalendarioPorNombre(args.calendar_name);
        if (nuevoCal && nuevoCal.id !== calActual.id) {
          await gFetch(
            `${CAL_BASE}/calendars/${encodeURIComponent(calActual.id)}/events/${encodeURIComponent(ev.id)}/move?destination=${encodeURIComponent(nuevoCal.id)}`,
            { method: 'POST' }
          );
          calActual = nuevoCal;
        }
      }

      return {
        ok: true,
        _newGoogleAccessToken: tokenRenovadoEnEstaLlamada,
        mensaje: `Evento "${actualizado.summary}" actualizado en "${calActual.summaryOverride || calActual.summary}"`
      };
    }

    if (accion === 'borrar_evento') {
      const encontrado = await buscarEventoEnTodos(args.title);
      if (!encontrado) return { ok: false, error: 'Evento no encontrado' };
      const { evento: ev, calendario: cal } = encontrado;
      const targetId = args.delete_series && ev.recurringEventId ? ev.recurringEventId : ev.id;

      await gFetch(
        `${CAL_BASE}/calendars/${encodeURIComponent(cal.id)}/events/${encodeURIComponent(targetId)}`,
        { method: 'DELETE' }
      );
      return { ok: true, _newGoogleAccessToken: tokenRenovadoEnEstaLlamada, mensaje: `Evento "${ev.summary}" eliminado` };
    }

    if (accion === 'consultar_calendario') {
      return {
        ok: true,
        _newGoogleAccessToken: tokenRenovadoEnEstaLlamada,
        calendarios_disponibles: misCalendarios.map(c => c.primary ? `Personal (${c.summary})` : (c.summaryOverride || c.summary)),
        eventos_por_calendario: await obtenerEventosTodosLosCalendarios(args.start_date, args.end_date)
      };
    }

    // 3. GOOGLE TASKS
    if (accion === 'crear_lista') {
      const nueva = await gFetch(`${TASKS_BASE}/users/@me/lists`, {
        method: 'POST',
        body: JSON.stringify({ title: (args.title || '').trim() })
      });
      return { ok: true, _newGoogleAccessToken: tokenRenovadoEnEstaLlamada, mensaje: `Lista "${nueva.title}" creada` };
    }

    if (accion === 'editar_lista') {
      const lista = buscarListaPorNombre(args.search_title);
      if (!lista) return { ok: false, error: 'Lista no encontrada' };
      await gFetch(`${TASKS_BASE}/users/@me/lists/${encodeURIComponent(lista.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: (args.new_title || '').trim() })
      });
      return { ok: true, _newGoogleAccessToken: tokenRenovadoEnEstaLlamada, mensaje: 'Lista actualizada' };
    }

    if (accion === 'borrar_lista') {
      const lista = buscarListaPorNombre(args.title);
      if (!lista) return { ok: false, error: 'Lista no encontrada' };
      await gFetch(`${TASKS_BASE}/users/@me/lists/${encodeURIComponent(lista.id)}`, {
        method: 'DELETE'
      });
      return { ok: true, _newGoogleAccessToken: tokenRenovadoEnEstaLlamada, mensaje: 'Lista eliminada' };
    }

    if (accion === 'limpiar_completadas') {
      const lista = buscarListaPorNombre(args.category) || todasLasListas[0];
      await gFetch(`${TASKS_BASE}/lists/${encodeURIComponent(lista.id)}/clear`, {
        method: 'POST'
      });
      return { ok: true, _newGoogleAccessToken: tokenRenovadoEnEstaLlamada, mensaje: 'Tareas completadas limpiadas' };
    }

    if (accion === 'crear_tarea') {
      const tituloLimpio = (args.title || args.titulo || '').toString().trim();
      if (!tituloLimpio) {
        return {
          ok: false,
          error: 'Falta el campo obligatorio "title". No se ha creado la tarea; vuelve a llamar con "title", "category" y "due_date".'
        };
      }

      let listaDestino = todasLasListas[0];
      let parentId = null;

      if (args.parent_title) {
        const padre = await buscarTareaPorNombre(args.parent_title);
        if (padre) {
          listaDestino = { id: padre.listaId, title: padre.listaNombre };
          parentId = padre.tarea.id;
        }
      } else if (args.category || args.lista) {
        const encontrada = buscarListaPorNombre(args.category || args.lista);
        if (!encontrada) {
          return {
            ok: false,
            error: `No existe la lista "${args.category || args.lista}". Listas disponibles exactas: ${todasLasListas.map(l => l.title).join(', ')}. Vuelve a llamar con el nombre exacto.`
          };
        }
        listaDestino = encontrada;
      }

      const fechaRaw = (args.due_date || args.fecha || '').toString().trim();
      const body = {
        title: tituloLimpio,
        notes: (args.description || args.descripcion || '').toString().trim()
      };
      if (fechaRaw && /^\d{4}-\d{2}-\d{2}/.test(fechaRaw)) {
        body.due = `${fechaRaw.substring(0, 10)}T09:00:00.000Z`;
      }

      const queryParams = parentId ? `?parent=${encodeURIComponent(parentId)}` : '';
      const creada = await gFetch(
        `${TASKS_BASE}/lists/${encodeURIComponent(listaDestino.id)}/tasks${queryParams}`,
        { method: 'POST', body: JSON.stringify(body) }
      );

      return {
        ok: true,
        _newGoogleAccessToken: tokenRenovadoEnEstaLlamada,
        mensaje: `Tarea "${creada.title}" creada en la lista "${listaDestino.title}"`,
        tarea: creada.title,
        lista: listaDestino.title,
        fecha: fechaRaw ? fechaRaw.substring(0, 10) : null,
        detalles_guardados: body.notes,
        id: creada.id
      };
    }

    if (accion === 'crear_tareas_lote') {
      let listaNuevas = args.tareas;
      if (typeof listaNuevas === 'string') {
        try { listaNuevas = JSON.parse(listaNuevas); } catch (e) { listaNuevas = []; }
      }

      const nombresListas = todasLasListas.map(l => l.title).join(', ');

      if (!Array.isArray(listaNuevas) || listaNuevas.length === 0) {
        return {
          ok: false,
          error: `El parámetro "tareas" debe ser un array con al menos 1 objeto { title, category, due_date }. Listas disponibles: ${nombresListas}.`
        };
      }

      // Validamos TODAS las tareas antes de tocar Google Tasks
      const tareasValidadas = [];
      for (const item of listaNuevas) {
        const title = (item?.title || item?.titulo || item?.name || '').toString().trim();
        const category = (item?.category || item?.lista || item?.list || '').toString().trim();
        const dueDate = (item?.due_date || item?.fecha || item?.date || '').toString().trim();
        const description = (item?.description || item?.descripcion || item?.notes || '').toString().trim();

        if (!title) {
          return {
            ok: false,
            error: `Hay un elemento en "tareas" sin "title" válido (recibido: ${JSON.stringify(item)}). No se ha creado ninguna tarea. Vuelve a llamar pasando objetos completos con { "title": "...", "category": "...", "due_date": "YYYY-MM-DD" }.`
          };
        }

        const listaDestino = category ? buscarListaPorNombre(category) : todasLasListas[0];
        if (!listaDestino) {
          return {
            ok: false,
            error: `La lista "${category}" no existe. Listas disponibles exactas: ${nombresListas}. Vuelve a llamar usando uno de esos nombres exactos.`
          };
        }

        tareasValidadas.push({ title, listaDestino, dueDate, description });
      }

      // Ahora sí, creamos todas en paralelo sabiendo que los datos son 100% válidos
      const resultados = await Promise.all(
        tareasValidadas.map(async (t) => {
          try {
            const body = {
              title: t.title,
              notes: t.description
            };
            if (t.dueDate && /^\d{4}-\d{2}-\d{2}/.test(t.dueDate)) {
              body.due = `${t.dueDate.substring(0, 10)}T09:00:00.000Z`;
            }

            const creada = await gFetch(
              `${TASKS_BASE}/lists/${encodeURIComponent(t.listaDestino.id)}/tasks`,
              { method: 'POST', body: JSON.stringify(body) }
            );

            return {
              ok: true,
              tarea: creada.title,
              lista: t.listaDestino.title,
              fecha: t.dueDate ? t.dueDate.substring(0, 10) : null
            };
          } catch (e) {
            return { ok: false, tarea: t.title, error: e.message };
          }
        })
      );

      return {
        ok: true,
        _newGoogleAccessToken: tokenRenovadoEnEstaLlamada,
        tareas_creadas: resultados
      };
    }

    if (accion === 'editar_tarea') {
      const encontrada = await buscarTareaPorNombre(args.search_title);
      if (!encontrada) return { ok: false, error: 'No se encontró la tarea' };

      const { tarea: t, listaId, listaNombre } = encontrada;
      const nuevoTitulo = (args.new_title || t.title).replace(/^\[.*?\]\s*/, '');
      const nuevasNotas = args.description !== undefined ? args.description : (t.notes || '');
      const nuevaFecha = (args.due_date && /^\d{4}-\d{2}-\d{2}/.test(args.due_date))
        ? `${args.due_date.substring(0, 10)}T09:00:00.000Z`
        : t.due;

      let nuevoEstado = t.status || 'needsAction';
      if (args.completed === true || args.completed === 'true') nuevoEstado = 'completed';
      if (args.completed === false || args.completed === 'false') nuevoEstado = 'needsAction';

      if (args.new_category) {
        const nuevaLista = buscarListaPorNombre(args.new_category);
        if (!nuevaLista) return { ok: false, error: `No existe la lista "${args.new_category}"` };

        if (nuevaLista.id !== listaId) {
          const payload = { title: nuevoTitulo, notes: nuevasNotas, status: nuevoEstado };
          if (nuevaFecha) payload.due = nuevaFecha;
          await gFetch(`${TASKS_BASE}/lists/${encodeURIComponent(nuevaLista.id)}/tasks`, {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          await gFetch(`${TASKS_BASE}/lists/${encodeURIComponent(listaId)}/tasks/${encodeURIComponent(t.id)}`, {
            method: 'DELETE'
          });
          return {
            ok: true,
            _newGoogleAccessToken: tokenRenovadoEnEstaLlamada,
            mensaje: `Tarea "${nuevoTitulo}" movida de "${listaNombre}" a "${nuevaLista.title}"`
          };
        }
      }

      const patch = {
        title: nuevoTitulo,
        notes: nuevasNotas,
        status: nuevoEstado,
        completed: nuevoEstado === 'needsAction' ? null : t.completed
      };
      if (nuevaFecha) patch.due = nuevaFecha;

      await gFetch(`${TASKS_BASE}/lists/${encodeURIComponent(listaId)}/tasks/${encodeURIComponent(t.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch)
      });

      return { ok: true, _newGoogleAccessToken: tokenRenovadoEnEstaLlamada, mensaje: `Tarea "${nuevoTitulo}" actualizada en "${listaNombre}"` };
    }

    if (accion === 'crear_tareas_lote') {
      const listaNuevas = Array.isArray(args.tareas) ? args.tareas : [];

      const resultados = await Promise.all(
        listaNuevas.map(async (item) => {
          try {
            const listaDestino = buscarListaPorNombre(item.category) || todasLasListas[0];
            const body = {
              title: item.title || 'Nueva tarea',
              notes: item.description || ''
            };
            if (item.due_date && /^\d{4}-\d{2}-\d{2}/.test(item.due_date)) {
              body.due = `${item.due_date.substring(0, 10)}T09:00:00.000Z`;
            }

            const creada = await gFetch(
              `${TASKS_BASE}/lists/${encodeURIComponent(listaDestino.id)}/tasks`,
              { method: 'POST', body: JSON.stringify(body) }
            );

            return {
              ok: true,
              tarea: creada.title,
              lista: listaDestino.title,
              fecha: item.due_date ? item.due_date.substring(0, 10) : null
            };
          } catch (e) {
            return { ok: false, tarea: item.title, error: e.message };
          }
        })
      );

      return {
        ok: true,
        _newGoogleAccessToken: tokenRenovadoEnEstaLlamada,
        tareas_creadas: resultados
      };
    }

    if (accion === 'reorganizar_tareas_lote') {
      const listaCambios = Array.isArray(args.cambios) ? args.cambios : [];

      // 1. Descargamos todas las tareas de todas las listas UNA sola vez en paralelo
      const cargasListas = await Promise.all(
        todasLasListas.map(async (lista) => {
          const resT = await gFetch(
            `${TASKS_BASE}/lists/${encodeURIComponent(lista.id)}/tasks?showCompleted=false&maxResults=100`
          );
          return (resT.items || []).map(t => ({
            tarea: t,
            listaId: lista.id,
            listaNombre: lista.title,
            norm: normalizar(t.title)
          }));
        })
      );
      const catalogo = cargasListas.flat();

      // 2. Aplicamos todos los cambios de fecha en paralelo
      const resultados = await Promise.all(
        listaCambios.map(async (item) => {
          try {
            const q = normalizar(item.search_title);
            const match = catalogo.find(c => c.norm.includes(q) || q.includes(c.norm));
            if (!match) {
              return { tarea: item.search_title, ok: false, error: 'No encontrada' };
            }

            const nuevaFecha = `${item.due_date.substring(0, 10)}T09:00:00.000Z`;
            await gFetch(
              `${TASKS_BASE}/lists/${encodeURIComponent(match.listaId)}/tasks/${encodeURIComponent(match.tarea.id)}`,
              {
                method: 'PATCH',
                body: JSON.stringify({
                  title: match.tarea.title,
                  notes: match.tarea.notes || '',
                  status: match.tarea.status || 'needsAction',
                  due: nuevaFecha
                })
              }
            );

            return {
              ok: true,
              tarea: match.tarea.title,
              lista: match.listaNombre,
              nueva_fecha: item.due_date.substring(0, 10)
            };
          } catch (e) {
            return { tarea: item.search_title, ok: false, error: e.message };
          }
        })
      );

      return {
        ok: true,
        _newGoogleAccessToken: tokenRenovadoEnEstaLlamada,
        tareas_reorganizadas: resultados
      };
    }

    if (accion === 'borrar_tarea' || accion === 'borrar_tareas_lote') {
      const cargasListas = await Promise.all(
        todasLasListas.map(async (lista) => {
          const resT = await gFetch(
            `${TASKS_BASE}/lists/${encodeURIComponent(lista.id)}/tasks?showCompleted=false&maxResults=100`
          );
          return (resT.items || []).map(t => ({
            tarea: t,
            listaId: lista.id,
            listaNombre: lista.title,
            norm: normalizar(t.title),
            fecha: t.due ? t.due.substring(0, 10) : null
          }));
        })
      );
      const catalogo = cargasListas.flat();

      const elegirCoincidenciaUnica = (tituloBuscado, fechaBuscada, usados) => {
        const q = normalizar(tituloBuscado);
        if (!q) return null;
        const f = fechaBuscada ? String(fechaBuscada).substring(0, 10) : null;
        const disponibles = catalogo.filter(c => !usados.has(c.tarea.id));

        // 1. Título exacto + fecha exacta
        if (f) {
          const exactoFecha = disponibles.find(c => c.norm === q && c.fecha === f);
          if (exactoFecha) return exactoFecha;
          const parcialFecha = disponibles.find(c => (c.norm.includes(q) || q.includes(c.norm)) && c.fecha === f);
          if (parcialFecha) return parcialFecha;
        }
        // 2. Título exacto sin fecha
        const exacto = disponibles.find(c => c.norm === q);
        if (exacto) return exacto;
        // 3. Coincidencia parcial
        return disponibles.find(c => c.norm.includes(q) || (c.norm.length >= 4 && q.includes(c.norm))) || null;
      };

      const objetivos = [];
      const usados = new Set();

      if (accion === 'borrar_tarea') {
        const q = normalizar(args.title);
        const f = args.due_date ? String(args.due_date).substring(0, 10) : null;

        if (args.delete_all_matches) {
          const coincidencias = catalogo.filter(c =>
            c.norm.includes(q) && (!f || c.fecha === f)
          );
          for (const c of coincidencias) {
            usados.add(c.tarea.id);
            objetivos.push(c);
          }
        } else {
          const match = elegirCoincidenciaUnica(args.title, args.due_date, usados);
          if (match) {
            usados.add(match.tarea.id);
            objetivos.push(match);
          }
        }
      } else {
        const listaPedida = Array.isArray(args.tareas) ? args.tareas : [];
        for (const item of listaPedida) {
          const match = elegirCoincidenciaUnica(item?.title || item?.titulo, item?.due_date || item?.fecha, usados);
          if (match) {
            usados.add(match.tarea.id);
            objetivos.push(match);
          }
        }
      }

      if (objetivos.length === 0) {
        return {
          ok: false,
          error: `No se encontró ninguna tarea pendiente que coincida para borrar.`
        };
      }

      const resultados = await Promise.all(
        objetivos.map(async (obj) => {
          try {
            await gFetch(
              `${TASKS_BASE}/lists/${encodeURIComponent(obj.listaId)}/tasks/${encodeURIComponent(obj.tarea.id)}`,
              { method: 'DELETE' }
            );
            return {
              ok: true,
              tarea: obj.tarea.title,
              lista: obj.listaNombre,
              fecha: obj.fecha
            };
          } catch (e) {
            return { ok: false, tarea: obj.tarea.title, error: e.message };
          }
        })
      );

      return {
        ok: true,
        _newGoogleAccessToken: tokenRenovadoEnEstaLlamada,
        tareas_borradas: resultados
      };
    }

    if (accion === 'leer_tareas') {
      const resumenPorCajon = {};
      await Promise.all(
        todasLasListas.map(async (lista) => {
          const resT = await gFetch(
            `${TASKS_BASE}/lists/${encodeURIComponent(lista.id)}/tasks?showCompleted=true&showHidden=true&maxResults=100`
          );
          const tareasLista = (resT.items || []).filter(t => t.title && t.title.trim());
          resumenPorCajon[lista.title] = tareasLista.map(t => {
            const estado = t.status === 'completed' ? '[HECHA]' : '[PENDIENTE]';
            const esSubtarea = t.parent ? '  ↳ (Subtarea) ' : '';
            const fecha = t.due ? ` (Fecha: ${t.due.substring(0, 10)})` : '';
            const notas = t.notes ? ` [Detalles: ${t.notes}]` : '';
            return `${esSubtarea}${estado} ${t.title}${fecha}${notas}`;
          });
        })
      );

      const eventosCalendario = await obtenerEventosTodosLosCalendarios();

      return {
        ok: true,
        _newGoogleAccessToken: tokenRenovadoEnEstaLlamada,
        listas_disponibles: todasLasListas.map(l => l.title),
        calendarios_disponibles: misCalendarios.map(c => c.primary ? `Personal (${c.summary})` : (c.summaryOverride || c.summary)),
        tareas: resumenPorCajon,
        eventos: eventosCalendario
      };
    }

    return { ok: false, error: 'Acción no reconocida' };
  } catch (err) {
    console.error(`❌ Error Google API (${accion}):`, err.message);
    return {
      ok: false,
      error: `Error de conexión con Google (${err.message}). Cierra sesión y vuelve a entrar con Google.`
    };
  }
}