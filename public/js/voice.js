import { state, vibrar, agregarMensajeChat } from './state.js';
import { obtenerSesionActiva } from './auth.js';
import { detenerVoz } from './tts.js';

const NUM_WAVE_BARS = 48;
const waveBarElements = [];

let isRecording = false;
let audioCtx = null;
let analyserNode = null;
let micStream = null;
let mediaRecorder = null;
let audioChunks = [];
let rafWaveId = null;
let onInputResize = () => {};

export function estaGrabando() {
  return isRecording;
}

function ponerBarrasACero() {
  cancelAnimationFrame(rafWaveId);
  for (let i = 0; i < waveBarElements.length; i++) {
    waveBarElements[i].style.height = '3px';
    waveBarElements[i].classList.remove('active');
  }
}

function cambiarIconoBotonMicro(grabando) {
  const micIconSvg = document.getElementById('micIconSvg');
  if (!micIconSvg) return;
  if (grabando) {
    micIconSvg.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"></rect>';
  } else {
    micIconSvg.innerHTML =
      '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>' +
      '<path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>' +
      '<line x1="12" x2="12" y1="19" y2="22"></line>';
  }
}

function blobABase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = String(reader.result || '');
      resolve(res.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function iniciarGrabacion() {
  detenerVoz();

  if (state.isGenerating || isRecording) return;
  vibrar(16);

  const inputArea = document.getElementById('inputArea');

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const source = audioCtx.createMediaStreamSource(micStream);
    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 128;
    analyserNode.smoothingTimeConstant = 0.65;
    source.connect(analyserNode);

    audioChunks = [];
    const recOptions = { audioBitsPerSecond: 64000 };
    if (window.MediaRecorder) {
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        recOptions.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        recOptions.mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        recOptions.mimeType = 'audio/mp4';
      }
      mediaRecorder = new MediaRecorder(micStream, recOptions);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };
      mediaRecorder.start(250);
    }

    isRecording = true;
    ponerBarrasACero();
    inputArea?.classList.add('listening');
    cambiarIconoBotonMicro(true);

    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);

    function loopFrecuencias() {
      if (!isRecording) return;
      analyserNode.getByteFrequencyData(dataArray);

      let suma = 0;
      for (let j = 1; j < 28; j++) suma += dataArray[j];
      const promedio = suma / 27;

      if (promedio < 10) {
        for (let i = 0; i < NUM_WAVE_BARS; i++) {
          waveBarElements[i].style.height = '3px';
          waveBarElements[i].classList.remove('active');
        }
      } else {
        const mitad = NUM_WAVE_BARS / 2;
        for (let i = 0; i < NUM_WAVE_BARS; i++) {
          const distCentro = Math.abs(i - mitad) / mitad;
          const binIdx = 1 + Math.floor(distCentro * 24);
          const val = dataArray[binIdx] || 0;
          const envolventeBordes = Math.max(0.25, 1 - Math.pow(distCentro, 1.6) * 0.7);
          const px = Math.max(3, Math.min(34, Math.round((val / 255) * 36 * envolventeBordes)));
          waveBarElements[i].style.height = px + 'px';
          waveBarElements[i].classList.toggle('active', px > 5);
        }
      }

      rafWaveId = requestAnimationFrame(loopFrecuencias);
    }

    loopFrecuencias();
  } catch (err) {
    alert('No se pudo acceder al micrófono: ' + err.message);
  }
}

export async function finalizarAudioYTranscribir() {
  if (!isRecording) return '';
  vibrar(12);
  isRecording = false;
  ponerBarrasACero();
  document.getElementById('inputArea')?.classList.remove('listening');
  cambiarIconoBotonMicro(false);

  const blob = await new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      resolve(null);
      return;
    }
    const mime = mediaRecorder.mimeType || 'audio/webm';
    mediaRecorder.onstop = () => resolve(new Blob(audioChunks, { type: mime }));
    try {
      mediaRecorder.stop();
    } catch (e) {
      resolve(null);
    }
  });

  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }

  if (!blob || blob.size === 0) return '';

  const userInput = document.getElementById('userInput');
  const textoPrevio = userInput.value.trim();
  const placeholderOriginal = userInput.placeholder;
  userInput.placeholder = 'Transcribiendo voz...';
  userInput.disabled = true;

  try {
    const audioBase64 = await blobABase64(blob);
    const sesionActiva = await obtenerSesionActiva();
    if (!sesionActiva) return '';

    const res = await fetch('/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + sesionActiva.access_token
      },
      body: JSON.stringify({
        mode: 'transcribe',
        audioBase64,
        mimeType: blob.type || 'audio/webm'
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      console.error('Error del servidor en transcripción:', data.error);
      agregarMensajeChat('Error transcribiendo audio: ' + (data.error || res.status), { esError: true });
      return '';
    }

    const nuevoTexto = (data.transcript || '').trim();
    if (nuevoTexto) {
      userInput.value = textoPrevio ? (textoPrevio + ' ' + nuevoTexto) : nuevoTexto;
    }
  } catch (e) {
    console.error('Error transcribiendo audio:', e);
  } finally {
    userInput.disabled = false;
    userInput.placeholder = placeholderOriginal;
    onInputResize();
  }

  return userInput.value.trim();
}

export async function toggleDictado() {
  if (state.isGenerating) return;
  if (isRecording) {
    await finalizarAudioYTranscribir();
    document.getElementById('userInput')?.focus();
  } else {
    await iniciarGrabacion();
  }
}

export function initVoice({ onResize } = {}) {
  if (onResize) onInputResize = onResize;

  const waveformBarsContainer = document.getElementById('waveformBars');
  if (waveformBarsContainer && waveBarElements.length === 0) {
    for (let i = 0; i < NUM_WAVE_BARS; i++) {
      const bar = document.createElement('div');
      bar.className = 'wave-bar';
      waveformBarsContainer.appendChild(bar);
      waveBarElements.push(bar);
    }
  }

  document.getElementById('micBtn')?.addEventListener('click', toggleDictado);
}