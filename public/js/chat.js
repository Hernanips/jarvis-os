import {
  state,
  vibrar,
  escapeHtml,
  setEstadoGenerando,
  agregarMensajeChat
} from './state.js';
import { cargarConfigYAuth, obtenerSesionActiva } from './auth.js';
import { estaGrabando, finalizarAudioYTranscribir } from './voice.js';
import { abrirModalMemorias } from './memory.js';
import { leerSiActivo, hablarTexto, detenerVoz } from './tts.js';

export function ajustarAlturaInput() {
  const userInput = document.getElementById('userInput');
  if (!userInput) return;

  if (!userInput.value) {
    userInput.style.height = '24px';
    userInput.style.overflowY = 'hidden';
    return;
  }
  userInput.style.height = 'auto';
  const sh = Math.max(24, userInput.scrollHeight);
  userInput.style.height = Math.min(sh, 132) + 'px';
  userInput.style.overflowY = sh > 132 ? 'auto' : 'hidden';
}

function formatearTexto(texto) {
  const lineas = String(texto || '').split('\n');
  const procesadas = lineas.map(linea => {
    const trimmed = linea.trim();

    if (/^-{3,}$/.test(trimmed)) {
      return `<hr class="msg-divider">`;
    }
    if (/^#{1,6}\s+/.test(trimmed)) {
      const titulo = trimmed.replace(/^#{1,6}\s+/, '').replace(/\*\*(.*?)\*\*/g, '$1');
      return `<div class="msg-heading">${titulo}</div>`;
    }

    const esLista = /^\s*[-•*]\s+/.test(linea);
    let l = esLista ? linea.replace(/^\s*[-•*]\s+/, '') : linea;

    l = l
      .replace(/`([^`\n]+)`/g, '<span class="nothing-badge">$1</span>')
      .replace(/~~(.*?)~~/g, '<del style="opacity:0.55;">$1</del>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
      .replace(/\[PENDIENTE\]/gi, '<span class="nothing-badge pending">PENDIENTE</span>')
      .replace(/\[HECHA\]/gi, '<span class="nothing-badge done">HECHA</span>')
      .replace(/(\b\d+(?:[.,]\d+)?\s*(?:kcal|g\b|kg\b))/gi, '<span class="nothing-badge">$1</span>');

    if (esLista) {
      return `<div class="msg-list-item"><span class="msg-bullet">▪</span><span>${l}</span></div>`;
    }
    return l;
  });

  return procesadas
    .join('<br>')
    .replace(/<\/div><br><div class="msg-list-item">/g, '</div><div class="msg-list-item">')
    .replace(/(?:<br>)*<hr class="msg-divider">(?:<br>)*/g, '<hr class="msg-divider">')
    .replace(/(?:<br>)*<div class="msg-heading">/g, '<div class="msg-heading">')
    .replace(/<\/div><br>/g, '</div>');
}

function renderizarRecibosHtml(acciones) {
  if (!Array.isArray(acciones) || acciones.length === 0) return '';

  const chipsHtml = acciones.map(a => {
    const tipoLower = (a.type || '').toLowerCase();
    const esMem = tipoLower === 'memoria';
    const dataAttr = esMem ? 'data-open-memory="true"' : '';
    return `<div class="receipt-chip ${esMem ? 'clickable' : ''}" ${dataAttr}><span class="receipt-dot ${tipoLower}"></span><span class="receipt-type">${escapeHtml(a.type)}</span><span>${escapeHtml(a.label)}</span></div>`;
  }).join('');

  if (acciones.length <= 4) {
    return `<div class="action-receipts">${chipsHtml}</div>`;
  }

  let creadas = 0, borradas = 0, movidas = 0, hechas = 0, cal = 0, mem = 0, otras = 0;
  const tiposPresentes = new Set();

  acciones.forEach(a => {
    const t = (a.type || '').toUpperCase();
    const lbl = String(a.label || '');
    tiposPresentes.add(t.toLowerCase());

    if (t === 'TASKS') {
      if (/^Borrada:/i.test(lbl)) borradas++;
      else if (/→/.test(lbl)) movidas++;
      else if (/\(Hecha\)/i.test(lbl)) hechas++;
      else creadas++;
    } else if (t === 'CALENDAR') {
      cal++;
    } else if (t === 'MEMORIA') {
      mem++;
    } else {
      otras++;
    }
  });

  const partes = [];
  if (creadas) partes.push(`${creadas} ${creadas === 1 ? 'creada' : 'creadas'}`);
  if (movidas) partes.push(`${movidas} ${movidas === 1 ? 'movida' : 'movidas'}`);
  if (hechas) partes.push(`${hechas} ${hechas === 1 ? 'hecha' : 'hechas'}`);
  if (borradas) partes.push(`${borradas} ${borradas === 1 ? 'borrada' : 'borradas'}`);
  if (cal) partes.push(`${cal} ${cal === 1 ? 'evento' : 'eventos'}`);
  if (mem) partes.push('memoria');
  if (otras) partes.push(`${otras} ${otras === 1 ? 'registro' : 'registros'}`);

  const dotsHtml = [...tiposPresentes]
    .map(t => `<span class="receipt-dot ${t}"></span>`)
    .join('');

  return `
    <div class="action-receipts">
      <details class="receipts-accordion">
        <summary class="receipts-summary">
          <span class="receipts-summary-left">
            <span class="receipts-summary-dots">${dotsHtml}</span>
            <span class="receipts-summary-title">${acciones.length} ACCIONES</span>
            <span>· ${partes.join(' · ')}</span>
          </span>
          <svg class="receipts-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </summary>
        <div class="receipts-accordion-body">${chipsHtml}</div>
      </details>
    </div>
  `;
}

export function enviarRapido(texto) {
  if (state.isGenerating) return;
  vibrar(12);
  const userInput = document.getElementById('userInput');
  if (!userInput) return;
  userInput.value = texto;
  ajustarAlturaInput();
  enviarMensaje();
}

function adjuntarBotonVozMensaje(msgEl, textoCrudo) {
  if (!msgEl || !('speechSynthesis' in window)) return null;
  const bar = document.createElement('div');
  bar.className = 'msg-tts-bar';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'msg-tts-btn';
  btn.title = 'Escuchar mensaje';
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>';
  btn.addEventListener('click', () => hablarTexto(textoCrudo, btn));
  bar.appendChild(btn);
  msgEl.appendChild(bar);
  return btn;
}

export async function enviarMensaje() {
  if (state.isGenerating) return;

  if (estaGrabando()) {
    await finalizarAudioYTranscribir();
  }

  const userInput = document.getElementById('userInput');
  const chatBox = document.getElementById('chat-box');
  const authModal = document.getElementById('auth-modal');
  if (!userInput || !chatBox) return;

  const text = userInput.value.trim();
  if (!text) return;

  vibrar(14);
  detenerVoz();
  userInput.value = '';
  ajustarAlturaInput();

  if (!state.supabaseClient) {
    await cargarConfigYAuth();
  }

  const sesionActiva = await obtenerSesionActiva();
  if (!sesionActiva) {
    if (authModal) authModal.style.display = 'flex';
    return;
  }

  setEstadoGenerando(true);
  const msgEl = agregarMensajeChat(formatearTexto(reply) + recibosHtml);
  const btnVoz = adjuntarBotonVozMensaje(msgEl, reply);
  leerSiActivo(reply, btnVoz);

  const loadingId = 'loading-' + Date.now();
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'typing';
  loadingDiv.id = loadingId;
  loadingDiv.innerHTML = '<span></span><span></span><span></span>';
  chatBox.appendChild(loadingDiv);
  chatBox.scrollTop = chatBox.scrollHeight;

  try {
    const googleToken = sesionActiva.provider_token || localStorage.getItem('jarvis_google_token') || '';
    const googleRefreshToken = sesionActiva.provider_refresh_token || localStorage.getItem('jarvis_google_refresh_token') || '';

    const res = await fetch('/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sesionActiva.access_token}`,
        'X-Google-Token': googleToken,
        'X-Google-Refresh-Token': googleRefreshToken
      },
      body: JSON.stringify({ message: text, history: state.historial })
    });

    document.getElementById(loadingId)?.remove();
    const data = await res.json().catch(() => ({}));

    if (data.newGoogleToken) {
      localStorage.setItem('jarvis_google_token', data.newGoogleToken);
    }

    if (res.status === 401) {
      agregarMensajeChat(escapeHtml(data.error || 'Sesión expirada.'), { esError: true });
      if (authModal) authModal.style.display = 'flex';
      return;
    }

    if (!res.ok) {
      const msgError = data.error || (res.status === 504
        ? 'Tiempo de espera agotado (504). El servidor tardó demasiado en completar todas las acciones.'
        : `Error del servidor (HTTP ${res.status}).`);
      agregarMensajeChat(escapeHtml(msgError), { esError: true });
      return;
    }

    const reply = data.reply || data.error || 'Sin respuesta del servidor.';
    const recibosHtml = renderizarRecibosHtml(data.actions);

    vibrar(10);
    agregarMensajeChat(`${formatearTexto(reply)}${recibosHtml}`);

    state.historial.push({ role: 'user', parts: [{ text }] });
    state.historial.push({ role: 'model', parts: [{ text: reply }] });
    if (state.historial.length > 10) state.historial = state.historial.slice(-10);
  } catch (err) {
    document.getElementById(loadingId)?.remove();
    agregarMensajeChat(`Error de conexión: ${escapeHtml(err.message)}`, { esError: true });
  } finally {
    setEstadoGenerando(false);
    chatBox.scrollTop = chatBox.scrollHeight;
  }
}

export function initChat() {
  const userInput = document.getElementById('userInput');
  const chatBox = document.getElementById('chat-box');

  userInput?.addEventListener('input', ajustarAlturaInput);
  userInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const esMovil = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (!esMovil) {
        e.preventDefault();
        enviarMensaje();
      }
    }
  });

  document.getElementById('sendBtn')?.addEventListener('click', enviarMensaje);

  chatBox?.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-memory]')) {
      abrirModalMemorias();
    }
  });

  // Captura el toggle del acordeón de recibos para vibración háptica sin ontoggle inline
  chatBox?.addEventListener('toggle', (e) => {
    if (e.target.matches('details.receipts-accordion')) vibrar(8);
  }, true);
}