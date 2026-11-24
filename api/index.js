import { supabase, ai } from '../src/config/clients.js';
import { assistantTools } from '../src/tools/declarations.js';
import { ejecutarHerramienta } from '../src/services/executor.js';
import { intercambiarCodigoStrava } from '../src/services/stravaApi.js';

const MODELO_GEMINI = 'gemini-3.5-flash-lite';

// Reintento automático ante picos de demanda (503 / 429 / overloaded)
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

      // 4. Cargamos los Bloques de Memoria Viva del usuario (Estilo Claude)
      const { data: memoriasUsuario } = await supabase
        .from('user_memories')
        .select('category, fact, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(20);

      const bloqueMemoriaTexto = (memoriasUsuario && memoriasUsuario.length > 0)
        ? memoriasUsuario.map(m => `### [${m.category}]\n${m.fact}`).join('\n\n')
        : 'Todavía no hay bloques de memoria guardados para este usuario.';

      const { message, history = [] } = body;

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
        - Comunícate de forma natural, clara, cercana y resolutiva, como un asistente de IA moderno por defecto.
        - Nunca uses un tono autoritario, militar ni sermones motivacionales.
        - Adapta la extensión a cada petición: breve y directo en acciones cotidianas; detallado, estructurado y analítico cuando el usuario pida planificar proyectos, resolver dudas complejas o analizar datos.
        - Puedes responder cualquier pregunta general (igual que un chat de IA normal), además de gestionar el ecosistema personal del usuario.

        MEMORIA VIVA POR BLOQUES (ESTILO CLAUDE):
        - Utiliza la memoria de arriba con naturalidad sin mencionar "mi base de datos".
        - Cuando el usuario aporte datos duraderos sobre su vida (trabajo, estudios, hogar, objetivos, salud, proyectos, preferencias o resultados importantes), llama de forma proactiva a 'actualizar_bloque_memoria' creando o actualizando el tema correspondiente con el RESUMEN COMPLETO CONSOLIDADO.
        - Al actualizar un bloque, conserva lo vigente, integra lo nuevo con fechas absolutas y ELIMINA planes o eventos que ya hayan pasado (hoy es ${fechaLegible}).

        PLANIFICACIÓN UNIVERSAL Y EJECUCIÓN EN GOOGLE TASKS / CALENDAR:
        - AUTONOMÍA REAL: Cuando el usuario pida organizar un objetivo o entrega con fecha límite (laboral, académico, doméstico o personal) o reorganizar tareas pendientes entre varios días:
          1. Llama primero a 'consultar_estado_dia' (si aún no lo has hecho en este turno) para conocer sus listas exactas de Tasks, sus calendarios y sus huecos disponibles.
          2. Calcula el reparto de carga de forma realista teniendo en cuenta sus eventos y fechas límite.
          3. Aplica directamente los cambios en Google Tasks y/o Calendar usando 'reorganizar_tareas_lote', 'crear_tarea', 'editar_tarea' o 'crear_evento' SIN pedir confirmación previa.
          4. Al finalizar, muestra un resumen limpio y exacto de lo que has creado o modificado (título, lista/calendario y fecha) para que el usuario pueda confiar al 100% en el resultado.
        - Si 'consultar_estado_dia' devuelve 'google_conectado: false', informa al usuario con el mensaje exacto de 'error_google'.
        - No crees tareas ni eventos por tu cuenta si el usuario solo está conversando sin pedirte agendar ni organizar nada.
        - Si el usuario incluye detalles o notas para una tarea/evento, pásalos siempre en el parámetro 'description'.

        MÓDULOS OPCIONALES (DEPORTE Y NUTRICIÓN):
        - STRAVA: Solo consulta 'consultar_entrenos_strava' cuando el usuario pregunte por entrenamientos, actividad física, carreras, ciclismo, gimnasio o rendimiento. Si no tiene Strava conectado y no pregunta por ello, no lo menciones.
        - NUTRICIÓN Y PESO: Si el usuario registra comidas o peso, usa las herramientas de nutrición ('registrar_comida', 'editar_comida', 'borrar_comida', 'registrar_peso', 'consultar_peso').
      `;

      let contents = [
        ...history,
        { role: 'user', parts: [{ text: message }] }
      ];

      let response = await llamarGeminiConReintento({
        model: MODELO_GEMINI,
        contents,
        config: { systemInstruction, tools: assistantTools }
      });

      let refreshedGoogleToken = null;
      let memorySavedCount = 0;

      while (response.functionCalls && response.functionCalls.length > 0) {
        contents.push(response.candidates[0].content);

        const functionResponseParts = [];
        for (const call of response.functionCalls) {
          if (call.name === 'actualizar_bloque_memoria') {
            memorySavedCount++;
          }

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

          functionResponseParts.push({
            functionResponse: {
              name: call.name,
              response: { result: resultadoBD }
            }
          });
        }

        contents.push({ role: 'user', parts: functionResponseParts });

        response = await llamarGeminiConReintento({
          model: MODELO_GEMINI,
          contents,
          config: { systemInstruction, tools: assistantTools }
        });
      }

      // Seguro anti-preguntas: si pidió reorganizar/repartir/planificar y terminó pidiendo permiso sin ejecutar
      const pidioReorganizar = /reorgani|repart|distribuy|muev|pospon|cambi.*fecha|organ[ií]zame/i.test(message);
      const terminoPreguntando = /\?|quieres que|prefieres|especifica|dime qué|cómo quieres/i.test(response.text || '');

      if (pidioReorganizar && terminoPreguntando) {
        contents.push(response.candidates[0].content);
        contents.push({
          role: 'user',
          parts: [{
            text: 'SISTEMA INTERNO: No pidas confirmación ni preguntes cómo distribuirlo. Decide tú mismo el reparto más equilibrado según el calendario del usuario y llama inmediatamente a reorganizar_tareas_lote, crear_tarea o editar_tarea para aplicar los cambios reales.'
          }]
        });

        response = await llamarGeminiConReintento({
          model: MODELO_GEMINI,
          contents,
          config: { systemInstruction, tools: assistantTools }
        });

        while (response.functionCalls && response.functionCalls.length > 0) {
          contents.push(response.candidates[0].content);
          const functionResponseParts = [];
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
            functionResponseParts.push({
              functionResponse: { name: call.name, response: { result: resultadoBD } }
            });
          }
          contents.push({ role: 'user', parts: functionResponseParts });
          response = await llamarGeminiConReintento({
            model: MODELO_GEMINI,
            contents,
            config: { systemInstruction, tools: assistantTools }
          });
        }
      }

      return res.status(200).json({
        reply: response.text,
        newGoogleToken: refreshedGoogleToken || null,
        memoryUpdated: memorySavedCount > 0
      });
    } catch (error) {
      console.error("❌ Error crítico en el servidor:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}