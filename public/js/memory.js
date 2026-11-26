import { vibrar, escapeHtml } from './state.js';
import { obtenerSesionActiva } from './auth.js';

let memoriasCache = [];
let memoriaActivaId = null;

function formatearFechaRelativaMem(iso) {
  if (!iso) return '';
  const fecha = new Date(iso);
  const diffDias = Math.floor((Date.now() - fecha.getTime()) / 86400000);
  if (diffDias <= 0) return 'Actualizado hoy';
  if (diffDias === 1) return 'Actualizado ayer';
  if (diffDias < 7) return `Actualizado hace ${diffDias} días`;
  return 'Actualizado ' + fecha.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function formatearFechaLargaMem(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function normalizarItemMemoria(m) {
  const titulo = m.title || (m.category || 'General').replace(/[_-]+/g, ' ');
  const detalles = Array.isArray(m.details) && m.details.length > 0
    ? m.details
    : String(m.fact || '').split('\n').map(s => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
  const resumen = m.summary || detalles[0] || m.fact || '';

  return {
    ...m,
    kind: m.kind === 'area' ? 'area' : 'tema',
    title: titulo,
    summary: resumen,
    details: detalles
  };
}

function enlazarSlugsMemoria(textoSeguro) {
  let html = textoSeguro;
  for (const m of memoriasCache) {
    if (!m.category || m.id === memoriaActivaId) continue;
    const slugEscapado = m.category.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b(${slugEscapado})\\b`, 'gi');
    html = html.replace(regex, `<span class="mem-slug-link" data-mem-open="${escapeHtml(m.id)}">$1</span>`);
  }
  return html;
}

function renderizarVistaMemorias() {
  const bodyEl = document.getElementById('memories-body');
  const headerLeft = document.getElementById('mem-header-left');
  const inputEl = document.getElementById('memEditInput');
  if (!bodyEl || !headerLeft || !inputEl) return;

  const activa = memoriaActivaId ? memoriasCache.find(x => x.id === memoriaActivaId) : null;

  if (activa) {
    headerLeft.innerHTML = `<button class="mem-back-btn" data-mem-back="true">← Memoria de Jarvis</button>`;
    inputEl.placeholder = `Dile a Jarvis qué cambiar en "${activa.title}"...`;

    const bullets = activa.details
      .map(d => `<li>${enlazarSlugsMemoria(escapeHtml(d))}</li>`)
      .join('');

    bodyEl.innerHTML = `
      <div class="mem-detail-top">
        <div class="mem-detail-title">${escapeHtml(activa.title)}</div>
        <button class="mem-delete-btn" data-mem-delete="${escapeHtml(activa.id)}">Eliminar</button>
      </div>
      <div class="mem-detail-label">Última actualización</div>
      <div class="mem-detail-text">${formatearFechaLargaMem(activa.updated_at)}</div>

      <div class="mem-detail-label">Resumen</div>
      <div class="mem-detail-text">${escapeHtml(activa.summary)}</div>

      <div class="mem-detail-label">Detalles</div>
      <ul class="mem-detail-list">${bullets || '<li>Sin detalles adicionales.</li>'}</ul>
    `;
    return;
  }

  headerLeft.innerHTML = `<span>MEMORIA // JARVIS</span>`;
  inputEl.placeholder = 'Dile a Jarvis qué debe cambiar...';

  if (memoriasCache.length === 0) {
    bodyEl.innerHTML = `<div style="font-size:13px; color:var(--text-muted); padding:28px 10px; text-align:center; line-height:1.5;">Aún no hay bloques guardados. Háblale a Jarvis de tus proyectos, rutinas u objetivos y los irá organizando automáticamente en Temas y Áreas.</div>`;
    return;
  }

  const temas = memoriasCache.filter(m => m.kind === 'tema');
  const areas = memoriasCache.filter(m => m.kind === 'area');

  const renderGrupo = (tituloSeccion, lista) => {
    if (lista.length === 0) return '';
    const filas = lista.map(m => `
      <div class="mem-row" data-mem-open="${escapeHtml(m.id)}">
        <div class="mem-row-title">${escapeHtml(m.title)}</div>
        <div class="mem-row-summary">${escapeHtml(m.summary)}</div>
        <div class="mem-row-date">${formatearFechaRelativaMem(m.updated_at)}</div>
      </div>
    `).join('');
    return `<div class="mem-section-title">${tituloSeccion}</div>${filas}`;
  };

  bodyEl.innerHTML = renderGrupo('Temas', temas) + renderGrupo('Áreas', areas);
}

async function cargarListaMemoriasUI() {
  const bodyEl = document.getElementById('memories-body');
  if (!bodyEl) return;
  bodyEl.innerHTML = `<div style="font-size:12.5px; color:var(--text-muted); padding:12px;">Cargando memoria...</div>`;

  try {
    const sesionActiva = await obtenerSesionActiva();
    if (!sesionActiva) return;

    const res = await fetch('/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sesionActiva.access_token}`
      },
      body: JSON.stringify({ mode: 'list_memories' })
    });

    const data = await res.json();
    memoriasCache = (data.memories || []).map(normalizarItemMemoria);
    renderizarVistaMemorias();
  } catch (e) {
    bodyEl.innerHTML = `<div style="font-size:12.5px; color:var(--nothing-red); padding:12px;">Error al leer memorias.</div>`;
  }
}

async function borrarMemoriaUI(id) {
  vibrar(15);
  try {
    const sesionActiva = await obtenerSesionActiva();
    if (!sesionActiva) return;

    await fetch('/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sesionActiva.access_token}`
      },
      body: JSON.stringify({ mode: 'delete_memory', memoryId: id })
    });
    memoriaActivaId = null;
    await cargarListaMemoriasUI();
  } catch (e) {}
}

async function enviarEdicionMemoria(event) {
  event.preventDefault();
  const inputEl = document.getElementById('memEditInput');
  const sendBtnEl = document.getElementById('memEditSendBtn');
  const instruccion = inputEl.value.trim();
  if (!instruccion) return;

  vibrar(12);
  const activa = memoriaActivaId ? memoriasCache.find(x => x.id === memoriaActivaId) : null;
  const slugActivo = activa ? activa.category : null;

  inputEl.disabled = true;
  sendBtnEl.disabled = true;
  const prevPlaceholder = inputEl.placeholder;
  inputEl.value = '';
  inputEl.placeholder = 'Actualizando memoria...';

  try {
    const sesionActiva = await obtenerSesionActiva();
    if (!sesionActiva) return;

    const res = await fetch('/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sesionActiva.access_token}`
      },
      body: JSON.stringify({
        mode: 'edit_memory_prompt',
        instruction: instruccion,
        activeTopic: slugActivo
      })
    });

    const data = await res.json().catch(() => ({}));
    if (Array.isArray(data.memories)) {
      memoriasCache = data.memories.map(normalizarItemMemoria);
      if (memoriaActivaId && !memoriasCache.some(m => m.id === memoriaActivaId)) {
        memoriaActivaId = null;
      }
      renderizarVistaMemorias();
    }
  } catch (e) {
    console.error('Error editando memoria:', e);
  } finally {
    inputEl.disabled = false;
    sendBtnEl.disabled = false;
    inputEl.placeholder = prevPlaceholder;
  }
}

export async function abrirModalMemorias() {
  vibrar(12);
  memoriaActivaId = null;
  const mModal = document.getElementById('memories-modal');
  if (mModal) mModal.style.display = 'flex';
  await cargarListaMemoriasUI();
}

export function cerrarModalMemorias() {
  const mModal = document.getElementById('memories-modal');
  if (mModal) mModal.style.display = 'none';
  memoriaActivaId = null;
}

export function initMemory() {
  const modal = document.getElementById('memories-modal');
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) cerrarModalMemorias();
  });

  document.getElementById('memoryBtn')?.addEventListener('click', abrirModalMemorias);
  document.getElementById('closeMemoriesBtn')?.addEventListener('click', cerrarModalMemorias);
  document.getElementById('memEditForm')?.addEventListener('submit', enviarEdicionMemoria);

  document.getElementById('mem-header-left')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-mem-back]')) {
      vibrar(8);
      memoriaActivaId = null;
      renderizarVistaMemorias();
    }
  });

  document.getElementById('memories-body')?.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('[data-mem-delete]');
    if (deleteBtn) {
      borrarMemoriaUI(deleteBtn.dataset.memDelete);
      return;
    }

    const openEl = e.target.closest('[data-mem-open]');
    if (openEl) {
      vibrar(10);
      memoriaActivaId = openEl.dataset.memOpen;
      renderizarVistaMemorias();
    }
  });
}