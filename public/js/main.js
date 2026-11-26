import { initTheme } from './theme.js';
import { initVoice } from './voice.js';
import { initShortcuts, renderizarBarraAtajos } from './shortcuts.js';
import { initMemory } from './memory.js';
import { initChat, ajustarAlturaInput, enviarRapido } from './chat.js';
import { initAuth } from './auth.js';

if ('caches' in window) {
  caches.keys().then((keys) => {
    keys.forEach((k) => {
      if (k !== 'jarvis-shell-v6') caches.delete(k);
    });
  });
}

initTheme();
initVoice({ onResize: ajustarAlturaInput });
initShortcuts({ onSelectPrompt: enviarRapido });
initMemory();
initChat();
initAuth({ onAuthReady: renderizarBarraAtajos });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => reg.update())
      .catch((err) => console.log('Error al registrar el Service Worker:', err));
  });
}