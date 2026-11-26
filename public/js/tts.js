import { vibrar } from './state.js';

const STORAGE_KEY = 'jarvis_tts_enabled';
const ICON_SPEAKER_ON = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>';
const ICON_SPEAKER_OFF = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="22" y1="9" x2="16" y2="15"></line><line x1="16" y1="9" x2="22" y2="15"></line>';

let ttsActivo = localStorage.getItem(STORAGE_KEY) === 'true';
let vozPreferida = null;
let colaFrases = [];
let botonActivo = null;

function cargarVozEspanola() {
  if (!('speechSynthesis' in window)) return;
  const voces = window.speechSynthesis.getVoices() || [];
  if (voces.length === 0) return;

  const vocesEs = voces.filter((v) => /^es([-_]|$)/i.test(v.lang));
  if (vocesEs.length === 0) return;

  const esEspana = vocesEs.filter((v) => /es[-_]ES/i.test(v.lang));
  const candidatas = esEspana.length > 0 ? esEspana : vocesEs;

  vozPreferida =
    candidatas.find((v) => /natural|online|google|alvaro|elvira|helena|pablo|laura|monica/i.test(v.name)) ||
    candidatas[0];
}

function limpiarTextoParaVoz(texto) {
  return String(texto || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/`([^`]+)`/g, (_, p1) => p1)
    .replace(/\*\*([^*]+)\*\*/g, (_, p1) => p1)
    .replace(/\*([^*]+)\*/g, (_, p1) => p1)
    .replace(/~~([^~]+)~~/g, (_, p1) => p1)
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^-{3,}$/gm, '')
    .replace(/^\s*[-•*▪]\s+/gm, '')
    .replace(/\[PENDIENTE\]/gi, 'pendiente')
    .replace(/\[HECHA\]/gi, 'hecha')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function dividirEnFrases(texto) {
  const partes = texto
    .replace(/([.!?]+)\s+/g, (_, p1) => p1 + '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return partes.length > 0 ? partes : [texto];
}

function limpiarEstadoBoton() {
  if (botonActivo) {
    botonActivo.classList.remove('speaking');
    botonActivo.title = 'Escuchar mensaje';
    botonActivo = null;
  }
}

export function detenerVoz() {
  colaFrases = [];
  limpiarEstadoBoton();
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function hablarTexto(texto, btnEl = null) {
  if (!('speechSynthesis' in window)) return;

  if (btnEl && botonActivo === btnEl && window.speechSynthesis.speaking) {
    vibrar(8);
    detenerVoz();
    return;
  }

  detenerVoz();
  const limpio = limpiarTextoParaVoz(texto);
  if (!limpio) return;

  if (!vozPreferida) cargarVozEspanola();

  colaFrases = dividirEnFrases(limpio);
  if (btnEl) {
    botonActivo = btnEl;
    botonActivo.classList.add('speaking');
    botonActivo.title = 'Detener lectura';
  }

  function hablarSiguiente() {
    if (colaFrases.length === 0) {
      limpiarEstadoBoton();
      return;
    }

    const frase = colaFrases.shift();
    const utter = new SpeechSynthesisUtterance(frase);
    utter.lang = vozPreferida ? vozPreferida.lang : 'es-ES';
    if (vozPreferida) utter.voice = vozPreferida;
    utter.rate = 1.06;
    utter.pitch = 1.0;

    utter.onend = () => hablarSiguiente();
    utter.onerror = () => limpiarEstadoBoton();

    window.speechSynthesis.speak(utter);
  }

  hablarSiguiente();
}

export function leerSiActivo(texto, btnEl = null) {
  if (!ttsActivo) return;
  hablarTexto(texto, btnEl);
}

function actualizarBotonHeader() {
  const btn = document.getElementById('ttsToggleBtn');
  const svg = document.getElementById('ttsIconSvg');
  if (!btn || !svg) return;

  btn.classList.toggle('tts-active', ttsActivo);
  btn.title = ttsActivo ? 'Voz automática activada (pulsa para silenciar)' : 'Activar voz automática';
  svg.innerHTML = ttsActivo ? ICON_SPEAKER_ON : ICON_SPEAKER_OFF;
}

export function toggleTTS() {
  vibrar(10);
  ttsActivo = !ttsActivo;
  localStorage.setItem(STORAGE_KEY, String(ttsActivo));
  if (!ttsActivo) detenerVoz();
  actualizarBotonHeader();
}

export function initTTS() {
  if ('speechSynthesis' in window) {
    cargarVozEspanola();
    window.speechSynthesis.addEventListener('voiceschanged', cargarVozEspanola);
  }
  actualizarBotonHeader();
  document.getElementById('ttsToggleBtn')?.addEventListener('click', toggleTTS);
}