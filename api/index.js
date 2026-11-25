import { supabase, ai } from '../src/config/clients.js';
import { assistantTools } from '../src/tools/declarations.js';
import { ejecutarHerramienta } from '../src/services/executor.js';
import { intercambiarCodigoStrava } from '../src/services/stravaApi.js';

const MODELO_CHAT = 'gemini-3.5-flash';      // Mejor razonamiento para planificar (comprueba en AI Studio el ID exacto sin -lite que tengas activo)
const MODELO_VOZ = 'gemini-3.5-flash-lite';  // Rápido y ligero para transcripción de audio

async function llamarGeminiConReintento(params, maxIntentos = 3) {
  let ultimoError = null;
  for (let intento = 1; intento <= maxIntentos; intento++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      ultimoError = err;
      const msg = String(err?.message || err || '');
      const esTemporal = /503|429|overloaded|unavailable|resource exhausted|high demand|muy solicitado/i.test(msg);
      if (!esTemporal || intento === maxIntentos) {
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, intento * 1400));
    }
  }
  throw ultimoError;
}

// Construye recibos verificados únicamente cuando la herramienta devolvió éxito real
function extraerRecibos(nombre, args, res) {
  if (!res || res.ok === false || res.error) return [];

  if (nombre === 'crear_evento') {
    return [{ type: 'CALENDAR', label: `${args.title} · ${args.start_time}` }];
  }
  if (nombre === 'editar_evento') {
    return [{ type: 'CALENDAR', label: `Editado: ${args.new_title || args.search_title}` }];
  }
  if (nombre === 'borrar_evento') {
    return [{ type: 'CALENDAR', label: `Borrado: ${args.title}` }];
  }
  if (nombre === 'crear_tarea') {
    const lista = res.lista ? `[${res.lista}] ` : '';
    const f = res.fecha ? ` · ${res.fecha}` : (args.due_date ? ` · ${args.due_date}` : '');
    return [{ type: 'TASKS', label: `${lista}${res.tarea || args.title}${f}` }];
  }
  if (nombre === 'crear_tareas_lote' && Array.isArray(res.tareas_creadas)) {
    return res.tareas_creadas
      .filter(t => t.ok)
      .map(t => ({
        type: 'TASKS',
        label: `[${t.lista}] ${t.tarea}${t.fecha ? ' · ' + t.fecha : ''}`
      }));
  }
  if (nombre === 'editar_tarea') {
    const extra = args.completed ? ' (Hecha)' : (args.due_date ? ` → ${args.due_date}` : '');
    return [{ type: 'TASKS', label: `${args.new_title || args.search_title}${extra}` }];
  }
  if (nombre === 'reorganizar_tareas_lote' && Array.isArray(res.tareas_reorganizadas)) {
    return res.tareas_reorganizadas
      .filter(t => t.ok)
      .map(t => ({ type: 'TASKS', label: `${t.tarea} → ${t.nueva_fecha}` }));
  }
  if ((nombre === 'borrar_tarea' || nombre === 'borrar_tareas_lote') && Array.isArray(res.tareas_borradas)) {
    return res.tareas_borradas
      .filter(t => t.ok)
      .map(t => ({
        type: 'TASKS',
        label: `Borrada: [${t.lista}] ${t.tarea}${t.fecha ? ' · ' + t.fecha : ''}`
    }));
  }
  if (nombre === 'actualizar_bloque_memoria') {
    return [{ type: 'MEMORIA', label: args.title || args.topic || 'Actualizada' }];
  }
  if (nombre === 'registrar_comida') {
    return [{ type: 'NUTRICIÓN', label: `${args.description} (${args.calories} kcal)` }];
  }
  if (nombre === 'registrar_peso') {
    return [{ type: 'PESO', label: `${args.weight_kg} kg` }];
  }
  return [];
}

// Asegura alternancia estricta user -> model exigida por Gemini
function sanitizarHistorial(mensajes) {
  const limpio = [];
  for (const m of mensajes) {
    if (!m.content || !m.content.trim()) continue;
    if (limpio.length === 0 && m.role !== 'user') continue;
    if (limpio.length > 0 && limpio[limpio.length - 1].role === m.role) {
      limpio[limpio.length - 1].parts[0].text += `\n${m.content}`;
    } else {
      limpio.push({ role: m.role, parts: [{ text: m.content }] });
    }
  }
  // Si el último guardado era 'user' (por un corte previo), lo descartamos para evitar doble 'user'
  if (limpio.length > 0 && limpio[limpio.length - 1].role === 'user') {
    limpio.pop();
  }
  return limpio;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      supabaseUrl: (process.env.SUPABASE_URL || '').trim(),
      supabaseAnonKey: (process.env.SUPABASE_KEY || '').trim(),
      stravaClientId: (process.env.STRAVA_CLIENT_ID || '').trim()
    });
  }

  if (req.method === 'POST') {
    try {
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '🔒 No autorizado. Inicia sesión.' });
      }

      const token = authHeader.split(' ')[1];
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);

      if (authError || !user) {
        return res.status(401).json({ error: '🔒 Sesión inválida o caducada.' });
      }

      const userId = user.id;
      const googleToken = req.headers['x-google-token'] || null;
      const googleRefreshToken = req.headers['x-google-refresh-token'] || null;

      if (googleRefreshToken) {
        await supabase
          .from('user_google_tokens')
          .upsert(
            {
              user_id: userId,
              refresh_token: googleRefreshToken,
              updated_at: new Date().toISOString()
            },
            { onConflict: 'user_id' }
          );
      }

      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

      // 1. Ping exclusivo para sincronizar refresh_token y estado de Strava
      if (body.syncTokenOnly) {
        const { data: st } = await supabase
          .from('user_strava_tokens')
          .select('user_id')
          .eq('user_id', userId)
          .single();
        return res.status(200).json({ ok: true, stravaConnected: Boolean(st) });
      }

      // 1b. Canjear código OAuth de Strava
      if (body.mode === 'strava_exchange' && body.code) {
        await intercambiarCodigoStrava(userId, body.code);
        return res.status(200).json({ ok: true, stravaConnected: true });
      }

      // 2. Gestión directa del panel visual de Memorias estilo Claude
      if (body.mode === 'list_memories') {
        const { data: mems } = await supabase
          .from('user_memories')
          .select('id, category, kind, title, summary, details, fact, updated_at')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false });
        return res.status(200).json({ memories: mems || [] });
      }

      if (body.mode === 'delete_memory' && body.memoryId) {
        await supabase
          .from('user_memories')
          .delete()
          .eq('id', body.memoryId)
          .eq('user_id', userId);
        return res.status(200).json({ ok: true });
      }

      if (body.mode === 'edit_memory_prompt' && body.instruction) {
        const { data: actuales } = await supabase
          .from('user_memories')
          .select('id, category, kind, title, summary, details, fact, updated_at')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false });

        const contextoMems = (actuales || []).map(m => {
          const det = Array.isArray(m.details) && m.details.length > 0
            ? m.details.map(d => `  - ${d}`).join('\n')
            : `  - ${m.fact || ''}`;
          return `[${(m.kind || 'tema').toUpperCase()}] slug="${m.category}" | título="${m.title || m.category}"\nResumen: ${m.summary || ''}\nDetalles:\n${det}`;
        }).join('\n\n');

        const enfoque = body.activeTopic
          ? `El usuario está viendo ahora mismo el bloque con slug "${body.activeTopic}". Aplica el cambio sobre ese bloque salvo que pida explícitamente crear, mover o borrar otro.`
          : 'El usuario está en la vista general de memoria. Crea, consolida, actualiza o elimina los bloques necesarios (puedes borrar slugs antiguos redundantes con olvidar_bloque_memoria tras consolidarlos).';

        const memoryToolsOnly = [{
          functionDeclarations: assistantTools[0].functionDeclarations.filter(
            f => f.name === 'actualizar_bloque_memoria' || f.name === 'olvidar_bloque_memoria'
          )
        }];

        const ahoraMem = new Date().toLocaleDateString('es-ES', {
          timeZone: 'Europe/Madrid', year: 'numeric', month: 'long', day: 'numeric'
        });

        const promptSistemaMem = `
          Eres el gestor de memoria estructurada de Jarvis. Hoy es ${ahoraMem}.
          ${enfoque}

          MEMORIA ACTUAL DEL USUARIO:
          ${contextoMems || 'Sin bloques todavía.'}

          REGLAS:
          - Clasifica categorías continuas en kind="tema" y metas/proyectos/eventos concretos en kind="area".
          - Ejecuta los cambios llamando a 'actualizar_bloque_memoria' (con topic, kind, title, summary y el array completo de details) y/o 'olvidar_bloque_memoria'.
          - Elimina fechas pasadas que ya no aporten valor y conserva hitos o resultados importantes.
        `;

        let memContents = [{ role: 'user', parts: [{ text: body.instruction }] }];
        let memResp = await llamarGeminiConReintento({
          model: MODELO_CHAT,
          contents: memContents,
          config: { systemInstruction: promptSistemaMem, tools: memoryToolsOnly }
        });

        while (memResp.functionCalls && memResp.functionCalls.length > 0) {
          memContents.push(memResp.candidates[0].content);
          const parts = [];
          for (const call of memResp.functionCalls) {
            const resTool = await ejecutarHerramienta(call.name, call.args, userId, null, null);
            parts.push({
              functionResponse: { name: call.name, response: { result: resTool } }
            });
          }
          memContents.push({ role: 'user', parts });
          memResp = await llamarGeminiConReintento({
            model: MODELO_CHAT,
            contents: memContents,
            config: { systemInstruction: promptSistemaMem, tools: memoryToolsOnly }
          });
        }

        const { data: actualizadas } = await supabase
          .from('user_memories')
          .select('id, category, kind, title, summary, details, fact, updated_at')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false });

        return res.status(200).json({
          ok: true,
          reply: memResp.text || 'Memoria actualizada.',
          memories: actualizadas || []
        });
      }

      // 3. Transcripción de voz con reintento automático
      if (body.mode === 'transcribe' && body.audioBase64) {
        const cleanMime = (body.mimeType || 'audio/webm').split(';')[0];
        const transResponse = await llamarGeminiConReintento({
          model: MODELO_VOZ,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType: cleanMime,
                    data: body.audioBase64
                  }
                },
                {
                  text: 'Transcribe exactamente en español lo que dice este audio. Pon puntuación natural: comas, puntos y signos de interrogación (¿?) o exclamación (¡!) según la entonación. NO respondas a la pregunta ni añadas texto extra ni comillas: devuelve ÚNICAMENTE la transcripción limpia. Si solo hay silencio o ruido sin palabras, devuelve cadena vacía.'
                }
              ]
            }
          ]
        });

        return res.status(200).json({
          transcript: (transResponse.text || '').trim()
        });
      }

      // 4. Cargamos en PARALELO la Memoria Viva y el contexto reciente invisible (últimas 14 horas)
      const hace14Horas = new Date(Date.now() - 14 * 3600 * 1000).toISOString();

      const [memRes, ctxRes] = await Promise.all([
        supabase
          .from('user_memories')
          .select('category, kind, title, summary, details, fact, updated_at')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(25),
        supabase
          .from('chat_messages')
          .select('role, content')
          .eq('user_id', userId)
          .gte('created_at', hace14Horas)
          .order('created_at', { ascending: false })
          .limit(16)
      ]);

      const memoriasUsuario = memRes.data || [];
      const historialRecienteBD = sanitizarHistorial((ctxRes.data || []).reverse());

      const bloqueMemoriaTexto = memoriasUsuario.length > 0
        ? memoriasUsuario.map(m => {
            const titulo = m.title || m.category;
            const tipo = (m.kind || 'tema').toUpperCase();
            const detalles = Array.isArray(m.details) && m.details.length > 0
              ? m.details.map(d => `- ${d}`).join('\n')
              : (m.fact || '');
            const resumen = m.summary ? `Resumen: ${m.summary}\n` : '';
            return `### [${tipo}] ${titulo} (slug: ${m.category})\n${resumen}${detalles}`;
          }).join('\n\n')
        : 'Todavía no hay bloques de memoria guardados para este usuario.';

      const { message } = body;

      const ahora = new Date();
      const fechaLegible = ahora.toLocaleDateString('es-ES', {
        timeZone: 'Europe/Madrid',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const horaLegible = ahora.toLocaleTimeString('es-ES', {
        timeZone: 'Europe/Madrid',
        hour: '2-digit',
        minute: '2-digit'
      });

      const systemInstruction = `
        Eres Jarvis, un asistente personal inteligente, adaptable y multiusuario.
        Hoy es ${fechaLegible} y son las ${horaLegible}.

        === MEMORIA VIVA DEL USUARIO (POR TEMAS) ===
        ${bloqueMemoriaTexto}
        ============================================

        PERSONALIDAD Y TONO (DEFAULT):
        - Comunícate de forma natural, clara, cercana y resolutiva. Cero tono autoritario o sermones.
        - Breve y directo en acciones rápidas; detallado y bien estructurado en planificaciones o análisis.

        REGLAS DETERMINISTAS DE EJECUCIÓN (COHESIÓN TOTAL):
        1. EVENTO O HITO CON FECHA CONCRETA (ej: "me he apuntado a una carrera el 25 de octubre", "tengo examen el martes", "cita médica el jueves"):
           -> Guárdalo en Google Calendar con 'crear_evento' (se añaden recordatorios automáticos de 24h y 1h) Y actualiza su bloque en memoria con 'actualizar_bloque_memoria' si es relevante a medio/largo plazo. No hace falta que el usuario pida explícitamente "añádelo al calendario".
        2. TRABAJO ACCIONABLE, ENTREGAS O REORGANIZACIÓN (ej: "me quedan 40 páginas para el 16 de diciembre, organízame", "reorganiza lo pendiente", "esto no me ha dado tiempo hoy"):
           -> Llama primero a 'consultar_estado_dia' para ver listas, tareas actuales y huecos reales del calendario.
           -> Decide el reparto óptimo y ejecuta los cambios REALES en Google Tasks usando 'crear_tareas_lote' o 'reorganizar_tareas_lote' SIN pedir confirmación previa.
           -> Si es un proyecto o entrega grande, actualiza también el bloque de memoria correspondiente para no perder el hilo en días posteriores.
        3. DATO PERSONAL SIN FECHA (ej: "me he comprado unas zapatillas nuevas", "me duele la rodilla", preferencias):
           -> Solo actualiza la memoria viva con 'actualizar_bloque_memoria'. NO crees tareas ni eventos innecesarios.
        4. CONTINUIDAD: Tienes el historial de las últimas horas arriba. Si el usuario vuelve más tarde diciendo "he acabado esto, lo otro no me dio tiempo", retoma el plan inmediatamente y mueve las tareas pendientes en Google Tasks.
        5. VERIFICACIÓN ESTRICTA: Nunca confirmes al usuario que has creado o movido tareas si la herramienta devolvió 'ok: false' o un número distinto de tareas al que planeas mencionar. Si una herramienta devuelve error de formato o lista no encontrada, corrige los argumentos y vuelve a llamarla antes de contestar.
        6. FIDELIDAD LITERAL CON LOS RESULTADOS: Cuando expliques al usuario las tareas o eventos que acabas de crear o mover, copia LITERALMENTE los títulos y fechas que devolvió la herramienta en su JSON ('tareas_creadas', 'tareas_reorganizadas'). Jamás recalcules ni redactes un reparto distinto al que realmente se guardó.
        7. REPARTO EQUILIBRADO EN TODO EL RANGO: Si el usuario pide repartir un volumen de trabajo "desde hoy hasta el día X", distribuye la carga de forma uniforme a lo largo de TODOS los días disponibles de ese rango (empezando hoy mismo si lo pide), en lugar de amontonar todo en la primera semana dejando muchos días vacíos al final.
        8. PLANIFICACIÓN CON RESTRICCIONES REALES:
           - Antes de llamar a 'crear_tareas_lote', verifica mentalmente que la SUMA exacta de unidades/páginas coincide con el total pedido por el usuario (no pierdas ni añadas elementos).
           - Respeta TODAS las restricciones acumuladas en turnos anteriores de la conversación (ej. no dejar tareas sueltas, empezar hoy, mayor dificultad en ciertos bloques) salvo que el usuario las revoque.
           - Cruza siempre el calendario: en días con exámenes, entregas o eventos pesados, reduce la carga al mínimo o déjalos libres de tareas extra; y si el usuario tiene clases/trabajo en una franja (ej. mañanas), ajusta la carga diaria a las horas reales disponibles repartiendo hasta el día previo a la fecha límite.

        MEMORIA VIVA POR BLOQUES (ESTILO CLAUDE):
        - Al llamar a 'actualizar_bloque_memoria', pasa siempre topic (slug), kind ("tema" para categorías continuas o "area" para metas/proyectos concretos), title, summary (1 frase) y details (array completo consolidado con fechas absolutas, borrando planes pasados irrelevantes según hoy ${fechaLegible}).

        OTRAS REGLAS:
        - Si 'consultar_estado_dia' devuelve 'google_conectado: false', muestra exactamente 'error_google'.
        - Si el usuario incluye detalles/notas para una tarea o evento, pásalos siempre en 'description'.
        - STRAVA: Llama a 'consultar_entrenos_strava' solo cuando pregunte por entrenos, carreras, bici, gimnasio, pulsaciones o rendimiento.
        - NUTRICIÓN/PESO: Usa las herramientas de comidas y peso cuando el usuario los mencione.
      `;

      let contents = [
        ...historialRecienteBD,
        { role: 'user', parts: [{ text: message }] }
      ];

      let response = await llamarGeminiConReintento({
        model: MODELO_CHAT,
        contents,
        config: { systemInstruction, tools: assistantTools }
      });

      let refreshedGoogleToken = null;
      const actionsExecuted = [];

      async function procesarBucleHerramientas() {
        let iteraciones = 0;

        while (response.functionCalls && response.functionCalls.length > 0 && iteraciones < 5) {
          iteraciones++;
          contents.push(response.candidates[0].content);

          const resultados = [];
          for (const call of response.functionCalls) {
            const resultadoBD = await ejecutarHerramienta(
              call.name,
              call.args,
              userId,
              refreshedGoogleToken || googleToken,
              googleRefreshToken
            );

            if (resultadoBD && resultadoBD._newGoogleAccessToken) {
              refreshedGoogleToken = resultadoBD._newGoogleAccessToken;
            }

            actionsExecuted.push(...extraerRecibos(call.name, call.args, resultadoBD));

            resultados.push({
              functionResponse: {
                name: call.name,
                response: { result: resultadoBD }
              }
            });
          }

          contents.push({ role: 'user', parts: resultados });

          response = await llamarGeminiConReintento({
            model: MODELO_CHAT,
            contents,
            config: { systemInstruction, tools: assistantTools }
          });
        }
      }

      await procesarBucleHerramientas();

      // Seguro anti-preguntas si pidió reorganizar/planificar pero no ejecutó ninguna acción en Tasks/Calendar
      const pidioOrganizar = /reorgani|repart|distribuy|muev|pospon|cambi.*fecha|organ[ií]zame|no me ha dado tiempo/i.test(message);
      const terminoPreguntando = /\?|quieres que|prefieres|especifica|dime qué|cómo quieres/i.test(response.text || '');
      const ejecutoEnGoogle = actionsExecuted.some(a => a.type === 'TASKS' || a.type === 'CALENDAR');

      if (pidioOrganizar && terminoPreguntando && !ejecutoEnGoogle) {
        contents.push(response.candidates[0].content);
        contents.push({
          role: 'user',
          parts: [{
            text: 'SISTEMA INTERNO: No pidas confirmación. Decide tú mismo el reparto más lógico según el calendario y llama inmediatamente a reorganizar_tareas_lote, crear_tareas_lote o crear_evento para aplicar los cambios reales ahora.'
          }]
        });

        response = await llamarGeminiConReintento({
          model: MODELO_CHAT,
          contents,
          config: { systemInstruction, tools: assistantTools }
        });

        await procesarBucleHerramientas();
      }

      const replyText = response.text || 'Hecho.';

      // Guardamos el turno en chat_messages para mantener la continuidad invisible entre sesiones y dispositivos
      await supabase
        .from('chat_messages')
        .insert([
          { user_id: userId, role: 'user', content: message },
          { user_id: userId, role: 'model', content: replyText }
        ]);

      return res.status(200).json({
        reply: replyText,
        newGoogleToken: refreshedGoogleToken || null,
        actions: actionsExecuted,
        memoryUpdated: actionsExecuted.some(a => a.type === 'MEMORIA')
      });
    } catch (error) {
      console.error("❌ Error crítico en el servidor:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}