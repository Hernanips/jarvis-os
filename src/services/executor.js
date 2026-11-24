import { supabase } from '../config/clients.js';
import { ejecutarAccionGoogle } from './googleApi.js';
import { consultarEntrenosStrava } from './stravaApi.js';

// Calcula el inicio y fin del día en hora exacta de España (Europe/Madrid)
function obtenerRangoDiaMadrid(fechaStr) {
  const hoyMadrid = fechaStr || new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  // Obtenemos el offset dinámico de Madrid (+01:00 en invierno, +02:00 en verano)
  const fechaRef = new Date(`${hoyMadrid}T12:00:00Z`);
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    timeZoneName: 'longOffset'
  }).formatToParts(fechaRef);
  const offsetTz = (partes.find(p => p.type === 'timeZoneName')?.value || 'GMT+01:00').replace('GMT', '') || '+01:00';

  return {
    fecha: hoyMadrid,
    inicioDia: new Date(`${hoyMadrid}T00:00:00.000${offsetTz}`).toISOString(),
    finDia: new Date(`${hoyMadrid}T23:59:59.999${offsetTz}`).toISOString()
  };
}

export async function ejecutarHerramienta(nombre, args, userId, googleToken, googleRefreshToken = null) {
  // 1. ACCIONES DIRECTAS EN GOOGLE API OFICIAL (Multiusuario real)
  const accionesDirectas = [
    'crear_lista', 'editar_lista', 'borrar_lista', 'limpiar_completadas',
    'crear_calendario', 'editar_calendario', 'borrar_calendario',
    'crear_evento', 'editar_evento', 'borrar_evento', 'consultar_calendario',
    'crear_tarea', 'crear_tareas_lote', 'editar_tarea', 'reorganizar_tareas_lote',
    'borrar_tarea', 'borrar_tareas_lote'
  ];

  if (accionesDirectas.includes(nombre)) {
    return await ejecutarAccionGoogle(nombre, args, googleToken, userId, googleRefreshToken);
  }

  // 2. REGISTRAR COMIDA EN SUPABASE
  if (nombre === 'registrar_comida') {
    const { data, error } = await supabase
      .from('meals')
      .insert([{
        user_id: userId,
        description: args.description,
        calories: Math.round(Number(args.calories) || 0),
        protein_g: Math.round(Number(args.protein_g) || 0),
        carbs_g: Math.round(Number(args.carbs_g) || 0),
        fat_g: Math.round(Number(args.fat_g) || 0)
      }])
      .select();

    return error ? { error: error.message } : { ok: true, comida_registrada: data[0] };
  }

  // 3. EDITAR COMIDA EN SUPABASE
  if (nombre === 'editar_comida') {
    const { data: encontradas, error: errBusq } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .ilike('description', `%${args.search_description}%`)
      .order('created_at', { ascending: false })
      .limit(1);

    if (errBusq || !encontradas || encontradas.length === 0) {
      return { ok: false, error: `No se encontró ninguna comida que coincida con "${args.search_description}"` };
    }

    const comidaActual = encontradas[0];
    const cambios = {};
    if (args.new_description) cambios.description = args.new_description;
    if (args.calories !== undefined) cambios.calories = Math.round(Number(args.calories));
    if (args.protein_g !== undefined) cambios.protein_g = Math.round(Number(args.protein_g));
    if (args.carbs_g !== undefined) cambios.carbs_g = Math.round(Number(args.carbs_g));
    if (args.fat_g !== undefined) cambios.fat_g = Math.round(Number(args.fat_g));

    const { data: actualizada, error: errUpd } = await supabase
      .from('meals')
      .update(cambios)
      .eq('id', comidaActual.id)
      .eq('user_id', userId)
      .select();

    return errUpd ? { error: errUpd.message } : { ok: true, comida_actualizada: actualizada[0] };
  }

  // 4. BORRAR COMIDA EN SUPABASE
  if (nombre === 'borrar_comida') {
    const { data: encontradas } = await supabase
      .from('meals')
      .select('*')
      .eq('user_id', userId)
      .ilike('description', `%${args.search_description}%`)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!encontradas || encontradas.length === 0) {
      return { ok: false, error: `No se encontró ninguna comida que coincida con "${args.search_description}"` };
    }

    const { error } = await supabase
      .from('meals')
      .delete()
      .eq('id', encontradas[0].id)
      .eq('user_id', userId);

    return error ? { error: error.message } : { ok: true, comida_eliminada: encontradas[0].description };
  }

  // 5. CONSULTAR COMIDAS POR FECHA (Con zona horaria Europe/Madrid corregida)
  if (nombre === 'consultar_comidas') {
    const { fecha, inicioDia, finDia } = obtenerRangoDiaMadrid(args.date);

    const { data: comidas, error } = await supabase
      .from('meals')
      .select('id, description, calories, protein_g, carbs_g, fat_g, created_at')
      .eq('user_id', userId)
      .gte('created_at', inicioDia)
      .lte('created_at', finDia)
      .order('created_at', { ascending: true });

    if (error) return { error: error.message };

    const lista = comidas || [];
    const resumen = lista.reduce((acc, c) => ({
      calorias: acc.calorias + (Number(c.calories) || 0),
      proteina_g: acc.proteina_g + (Number(c.protein_g) || 0),
      carbohidratos_g: acc.carbohidratos_g + (Number(c.carbs_g) || 0),
      grasas_g: acc.grasas_g + (Number(c.fat_g) || 0)
    }), { calorias: 0, proteina_g: 0, carbohidratos_g: 0, grasas_g: 0 });

    return {
      fecha_consultada: fecha,
      comidas: lista,
      totales_del_dia: resumen
    };
  }

  // 6. REGISTRAR PESO CORPORAL
  if (nombre === 'registrar_peso') {
    const { data, error } = await supabase
      .from('weight_logs')
      .insert([{
        user_id: userId,
        weight_kg: Number(args.weight_kg),
        body_fat_pct: args.body_fat_pct !== undefined ? Number(args.body_fat_pct) : null,
        muscle_mass_kg: args.muscle_mass_kg !== undefined ? Number(args.muscle_mass_kg) : null,
        notes: args.notes || null
      }])
      .select();

    return error ? { error: error.message } : { ok: true, registro_peso: data[0] };
  }

  // 7. CONSULTAR HISTORIAL DE PESO
  if (nombre === 'consultar_peso') {
    const limite = Number(args.limit) || 10;
    const { data, error } = await supabase
      .from('weight_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limite);

    return error ? { error: error.message } : { historial_peso: data || [] };
  }

  // 8. CONSULTAR ESTADO DEL DÍA (Rápido: solo Supabase + Google Calendar/Tasks)
  if (nombre === 'consultar_estado_dia') {
    const { inicioDia, finDia } = obtenerRangoDiaMadrid();

    const [comidas, peso, dataG] = await Promise.all([
      supabase.from('meals').select('*').eq('user_id', userId).gte('created_at', inicioDia).lte('created_at', finDia),
      supabase.from('weight_logs').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1),
      ejecutarAccionGoogle('leer_tareas', {}, googleToken, userId, googleRefreshToken)
    ]);

    const totalCalorias = comidas.data?.reduce((acc, c) => acc + (Number(c.calories) || 0), 0) || 0;
    const totalProteinas = comidas.data?.reduce((acc, c) => acc + (Number(c.protein_g) || 0), 0) || 0;

    return {
      resumen_nutricion: {
        calorias_hoy: totalCalorias,
        proteinas_hoy: totalProteinas,
        comidas_registradas: comidas.data || []
      },
      ultimo_peso: peso.data?.[0]?.weight_kg || 'No registrado',
      google_conectado: dataG?.ok === true,
      error_google: dataG?.ok === false ? dataG.error : null,
      tareas_por_lista: dataG?.tareas || {},
      eventos_calendario: dataG?.eventos || {},
      calendarios_disponibles_del_usuario: dataG?.calendarios_disponibles || [],
      listas_tasks_disponibles_del_usuario: dataG?.listas_disponibles || [],
      _newGoogleAccessToken: dataG?._newGoogleAccessToken || null
    };
  }

  // 9. ACTUALIZAR BLOQUE DE MEMORIA VIVA ESTRUCTURADA (Estilo Claude)
  if (nombre === 'actualizar_bloque_memoria') {
    const tema = (args.topic || args.title || 'general')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'general';

    const kind = String(args.kind || 'tema').toLowerCase() === 'area' ? 'area' : 'tema';
    const title = (args.title || tema.replace(/-/g, ' ')).trim();
    const summary = (args.summary || '').trim();

    let details = args.details;
    if (typeof details === 'string') {
      try {
        details = JSON.parse(details);
      } catch {
        details = details.split('\n').map(s => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
      }
    }
    if (!Array.isArray(details)) details = [];
    details = details.map(d => String(d).trim()).filter(Boolean);

    const factFallback = [summary, ...details.map(d => `- ${d}`)].filter(Boolean).join('\n') || title;

    const { data: existentes } = await supabase
      .from('user_memories')
      .select('id')
      .eq('user_id', userId)
      .eq('category', tema)
      .order('updated_at', { ascending: false });

    const payload = {
      category: tema,
      kind,
      title,
      summary,
      details,
      fact: factFallback,
      updated_at: new Date().toISOString()
    };

    if (existentes && existentes.length > 0) {
      const idPrincipal = existentes[0].id;
      const { data: actualizada, error } = await supabase
        .from('user_memories')
        .update(payload)
        .eq('id', idPrincipal)
        .eq('user_id', userId)
        .select();

      if (existentes.length > 1) {
        const idsDuplicados = existentes.slice(1).map(x => x.id);
        await supabase.from('user_memories').delete().in('id', idsDuplicados).eq('user_id', userId);
      }

      return error ? { error: error.message } : { ok: true, bloque_actualizado: actualizada[0] };
    }

    const { data: creada, error } = await supabase
      .from('user_memories')
      .insert([{ user_id: userId, ...payload }])
      .select();

    return error ? { error: error.message } : { ok: true, bloque_creado: creada[0] };
  }

  // 10. OLVIDAR BLOQUE DE MEMORIA
  if (nombre === 'olvidar_bloque_memoria') {
    const q = (args.topic || '').trim();
    const { error } = await supabase
      .from('user_memories')
      .delete()
      .eq('user_id', userId)
      .or(`category.ilike.%${q}%,fact.ilike.%${q}%`);

    return error ? { error: error.message } : { ok: true, tema_eliminado: q };
  }

  // 11. CONSULTAR ENTRENOS DE STRAVA (Historial completo y analítica)
  if (nombre === 'consultar_entrenos_strava') {
    return await consultarEntrenosStrava(userId, {
      limit: args.limit || 60,
      sport_filter: args.sport_filter || 'ALL',
      include_latest_details: args.include_latest_details !== false
    });
  }
}