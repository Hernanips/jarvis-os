export const state = {
  supabaseClient: null,
  currentSession: null,
  currentUserId: 'default',
  isGenerating: false,
  historial: [],
  stravaClientIdGlobal: '',
  pendingStravaCode: new URLSearchParams(window.location.search).get('code') || null
};

export function vibrar(ms = 14) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (e) {}
}

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function setEstadoGenerando(activo) {
  state.isGenerating = activo;
  const userInput = document.getElementById('userInput');
  const sendBtn = document.getElementById('sendBtn');
  const micBtn = document.getElementById('micBtn');

  if (userInput) userInput.disabled = activo;
  if (sendBtn) sendBtn.disabled = activo;
  if (micBtn) micBtn.disabled = activo;
  document.querySelectorAll('.chip').forEach((btn) => {
    btn.disabled = activo;
  });
}

export function actualizarEstadoConexion(estado) {
  const dot = document.querySelector('.status-dot');
  if (!dot) return;
  dot.style.backgroundColor = '#D71921';
  dot.style.boxShadow = estado === 'online'
    ? '0 0 8px rgba(215, 25, 33, 0.85)'
    : 'none';
}

export function marcarStravaConectadoUI(conectado) {
  const btn = document.getElementById('stravaBtn');
  if (!btn || !conectado) return;
  btn.style.borderColor = '#D71921';
  btn.style.color = 'var(--text-strong)';
  btn.title = 'Strava conectado';
}

export function agregarMensajeChat(html, { tipo = 'assistant', esError = false } = {}) {
  const chatBox = document.getElementById('chat-box');
  if (!chatBox) return;
  const div = document.createElement('div');
  div.className = 'message ' + tipo;
  if (esError) div.style.color = 'var(--nothing-red)';
  div.innerHTML = html;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}