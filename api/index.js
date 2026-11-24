import { supabase, ai } from '../src/config/clients.js';
import { assistantTools } from '../src/tools/declarations.js';
import { ejecutarHerramienta } from '../src/services/executor.js';
import { intercambiarCodigoStrava } from '../src/services/stravaApi.js';

const MODELO_GEMINI = 'gemini-3.5-flash-lite';

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
    const f = args.due_date ? ` · ${args.due_date}` : '';
    return [{ type: 'TASKS', label: `${args.title}${f}` }];
  }
  if (nombre === 'crear_tareas_lote' && Array.isArray(res.tareas_creadas)) {
    return res.tareas_creadas
      .filter(t => t.ok)
      .map(t => ({ type: 'TASKS', label: `${t.tarea}${t.fecha ? ' · ' + t.fecha : ''}` }));
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
  if (nombre === 'borrar_tarea') {
    return [{ type: 'TASKS', label: `Borrada: ${args.title}` }];
  }
  if (nombre === 'actualizar_bloque_memoria') {
    return [{ type: 'MEMORIA', label: args.topic || 'Actualizada' }];
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

      // 2. Gestión directa del panel visual de Memorias
      if (body.mode === 'list_memories') {
        const { data: mems } = await supabase
          .from('user_memories')
          .select('id, category, fact, updated_at')
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

      // 3. Transcripción de voz con reintento automático
      if (body.mode === 'transcribe' && body.audioBase64) {
        const cleanMime = (body.mimeType || 'audio/webm').split(';')[0];
        const transResponse = await llamarGeminiConReintento({
          model: MODELO_GEMINI,
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
          .select('category, fact, updated_at')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false })
          .limit(20),
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
        ? memoriasUsuario.map(m => `### [${m.category}]\n${m.fact}`).join('\n\n')
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

        MEMORIA VIVA POR BLOQUES:
        - Al llamar a 'actualizar_bloque_memoria', pasa el RESUMEN COMPLETO CONSOLIDADO del tema, integrando lo nuevo y eliminando planes pasados que ya caducaron (hoy es ${fechaLegible}).

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
        model: MODELO_GEMINI,
        contents,
        config: { systemInstruction, tools: assistantTools }
      });

      let refreshedGoogleToken = null;
      const actionsExecuted = [];

      async function procesarBucleHerramientas() {
        while (response.functionCalls && response.functionCalls.length > 0) {
          contents.push(response.candidates[0].content);

          // Ejecutamos las herramientas de este turno en paralelo para máxima velocidad
          const resultados = await Promise.all(
            response.functionCalls.map(async (call) => {
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

              return {
                functionResponse: {
                  name: call.name,
                  response: { result: resultadoBD }
                }
              };
            })
          );

          contents.push({ role: 'user', parts: resultados });

          response = await llamarGeminiConReintento({
            model: MODELO_GEMINI,
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
          model: MODELO_GEMINI,
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