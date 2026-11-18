/* global Tesseract */
const $ = (selector) => document.querySelector(selector);

const ui = {
  welcome: $('#welcome'), scanner: $('#scanner'), start: $('#startButton'),
  video: $('#video'), canvas: $('#captureCanvas'), status: $('#statusText'),
  dot: $('#statusDot'), translation: $('#translation'), source: $('#sourceText'),
  verifyBadge: $('#verifyBadge'), subtitleCard: $('#subtitleCard'),
  pause: $('#pauseButton'), voice: $('#voiceButton'), errorPanel: $('#errorPanel'),
  errorText: $('#errorText'), retry: $('#retryButton'), settings: $('#settingsPanel'),
  settingsButton: $('#settingsButton'), closeSettings: $('#closeSettings'),
  roiTop: $('#roiTop'), roiHeight: $('#roiHeight'), scanBox: $('#scanBox'),
  shadeTop: $('.shade-top'), shadeBottom: $('.shade-bottom')
};

const state = {
  worker: null, stream: null, running: false, busy: false, paused: false,
  voice: true, candidate: '', candidateCount: 0, lastTranslated: '',
  timer: null, translations: new Map(), wakeLock: null, recentReads: [],
  translationSeq: 0, verified: false, lastShownTranslation: ''
};

function setStatus(text, kind = 'ready') {
  ui.status.textContent = text;
  ui.dot.className = `status-dot ${kind === 'ready' ? '' : kind}`;
}

function normalizeText(text) {
  return text
    .replace(/[|]/g, 'I')
    .replace(/[^A-Za-z0-9À-ÿ'’“”!?.,:\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similar(a, b) {
  if (!a || !b) return false;
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x === y) return true;
  const shorter = Math.min(x.length, y.length);
  if (shorter / Math.max(x.length, y.length) < .78) return false;
  let same = 0;
  for (let i = 0; i < shorter; i++) if (x[i] === y[i]) same++;
  return same / shorter > .86;
}

function verification(label, kind) {
  ui.verifyBadge.textContent = label;
  ui.verifyBadge.className = `verify-badge ${kind}`;
}

async function requestWakeLock() {
  try { state.wakeLock = await navigator.wakeLock?.request('screen'); } catch (_) { /* iOS may not support it */ }
}

async function start() {
  ui.errorPanel.classList.add('hidden');
  ui.welcome.classList.add('hidden');
  ui.scanner.classList.remove('hidden');
  setStatus('Kamera açılıyor…', 'loading');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Safari kamera erişimini desteklemiyor veya sayfa HTTPS üzerinden açılmadı.');
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 }, height: { ideal: 1080 },
        frameRate: { ideal: 24, max: 30 }
      }
    });
    ui.video.srcObject = state.stream;
    await ui.video.play();
    await requestWakeLock();
    await prepareOCR();
    state.running = true;
    setStatus('Hazır — altyazıyı sarı alana getir');
    scheduleScan(250);
  } catch (error) {
    showError(error);
  }
}

async function prepareOCR() {
  if (state.worker) return;
  if (!window.Tesseract) throw new Error('OCR kütüphanesi yüklenemedi. İnternet bağlantısını kontrol et.');
  state.worker = await Tesseract.createWorker('eng', 1, {
    logger(message) {
      if (message.status === 'recognizing text') return;
      const pct = Number.isFinite(message.progress) ? ` %${Math.round(message.progress * 100)}` : '';
      setStatus(`OCR hazırlanıyor…${pct}`, 'loading');
    }
  });
  await state.worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
    preserve_interword_spaces: '1',
    user_defined_dpi: '220'
  });
}

function scheduleScan(delay = state.verified ? 950 : 520) {
  clearTimeout(state.timer);
  if (state.running) state.timer = setTimeout(scanFrame, delay);
}

async function scanFrame() {
  if (!state.running || state.paused || state.busy) return scheduleScan();
  if (ui.video.readyState < 2) return scheduleScan(400);
  state.busy = true;
  try {
    const vw = ui.video.videoWidth, vh = ui.video.videoHeight;
    const top = Number(ui.roiTop.value) / 100;
    const height = Math.min(Number(ui.roiHeight.value) / 100, 1 - top);
    const sx = Math.round(vw * .05), sy = Math.round(vh * top);
    const sw = Math.round(vw * .90), sh = Math.round(vh * height);

    const scale = Math.min(2, 1500 / sw);
    const canvas = ui.canvas;
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.filter = 'grayscale(1) contrast(1.65) brightness(1.08)';
    ctx.drawImage(ui.video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    const result = await state.worker.recognize(canvas);
    const text = normalizeText(result.data.text || '');
    if (text.length >= 3 && /[A-Za-z]/.test(text)) acceptCandidate(text, Number(result.data.confidence) || 0);
  } catch (error) {
    setStatus('OCR tekrar deneniyor…', 'loading');
  } finally {
    state.busy = false;
    scheduleScan();
  }
}

function acceptCandidate(text, confidence) {
  const now = Date.now();
  state.recentReads = state.recentReads.filter(read => now - read.at < 5000);
  state.recentReads.push({ text, confidence, at: now });
  state.recentReads = state.recentReads.slice(-3);

  if (similar(text, state.candidate)) state.candidateCount++;
  else {
    state.candidate = text;
    state.candidateCount = 1;
    state.verified = false;
  }

  // İlk mantıklı okumayı hemen göster; kullanıcı çeviriyi beklemesin.
  if (!state.lastTranslated || (!similar(text, state.lastTranslated) && state.candidateCount === 1)) {
    state.lastTranslated = text;
    ui.source.textContent = text;
    verification('HIZLI ÇEVİRİ • KONTROL EDİLİYOR', 'checking');
    translate(text, false);
    return;
  }

  if (state.candidateCount < 2) return;

  // Benzer okumalardan en güvenli ve en tam olanı seç.
  const group = state.recentReads.filter(read => similar(read.text, text));
  const best = group.sort((a, b) => {
    const scoreA = a.confidence + Math.min(a.text.length, 100) * .18;
    const scoreB = b.confidence + Math.min(b.text.length, 100) * .18;
    return scoreB - scoreA;
  })[0]?.text || text;

  state.verified = true;
  if (!similar(best, state.lastTranslated) || best !== state.lastTranslated) {
    state.lastTranslated = best;
    ui.source.textContent = best;
    verification('DÜZELTİLİYOR', 'corrected');
    translate(best, true);
  } else {
    verification('DOĞRULANDI', 'verified');
  }
}

async function translate(text, correction = false) {
  const requestId = ++state.translationSeq;
  if (state.translations.has(text)) {
    if (requestId === state.translationSeq) showTranslation(state.translations.get(text), correction);
    return;
  }
  setStatus('Türkçeye çevriliyor…', 'loading');
  try {
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', text.slice(0, 480));
    url.searchParams.set('langpair', 'en|tr');
    url.searchParams.set('mt', '1');
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const translated = decodeEntities(data?.responseData?.translatedText || '');
    if (!translated) throw new Error('Boş çeviri');
    state.translations.set(text, translated);
    if (requestId !== state.translationSeq) return;
    showTranslation(translated, correction);
    setStatus('Hazır — altyazı taranıyor');
  } catch (_) {
    if (requestId !== state.translationSeq) return;
    ui.translation.textContent = 'Çeviri servisine ulaşılamadı';
    setStatus('Bağlantıyı kontrol et', 'error');
    state.lastTranslated = '';
  }
}

function decodeEntities(value) {
  const el = document.createElement('textarea');
  el.innerHTML = value;
  return el.value;
}

function showTranslation(text, correction = false) {
  ui.translation.textContent = text;
  const changed = text !== state.lastShownTranslation;
  state.lastShownTranslation = text;
  if (correction) verification('DÜZELTİLDİ', 'corrected');
  else if (state.verified) verification('DOĞRULANDI', 'verified');
  if (state.voice && changed && 'speechSynthesis' in window) {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'tr-TR';
    utterance.rate = .96;
    const trVoice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith('tr'));
    if (trVoice) utterance.voice = trVoice;
    speechSynthesis.speak(utterance);
  }
}

function showError(error) {
  state.running = false;
  ui.scanner.classList.add('hidden');
  ui.errorPanel.classList.remove('hidden');
  const denied = error?.name === 'NotAllowedError';
  ui.errorText.textContent = denied
    ? 'iPhone Ayarlar → Safari → Kamera bölümünden izin verip sayfayı yenile.'
    : (error?.message || 'Bilinmeyen bir hata oluştu.');
}

function updateROI() {
  const top = Number(ui.roiTop.value);
  const height = Math.min(Number(ui.roiHeight.value), 100 - top);
  ui.scanBox.style.top = `${top}%`;
  ui.scanBox.style.height = `${height}%`;
  ui.shadeTop.style.height = `${top}%`;
  ui.shadeBottom.style.top = `${top + height}%`;
}

ui.start.addEventListener('click', start);
ui.retry.addEventListener('click', start);
ui.pause.addEventListener('click', () => {
  state.paused = !state.paused;
  ui.pause.textContent = state.paused ? 'Devam' : 'Durdur';
  setStatus(state.paused ? 'Tarama durduruldu' : 'Hazır — altyazı taranıyor', state.paused ? 'loading' : 'ready');
  if (!state.paused) scheduleScan(100);
});
ui.voice.addEventListener('click', () => {
  state.voice = !state.voice;
  ui.voice.classList.toggle('active', state.voice);
  ui.voice.setAttribute('aria-pressed', String(state.voice));
  ui.voice.setAttribute('aria-label', `Seslendirme ${state.voice ? 'açık' : 'kapalı'}`);
  if (!state.voice) speechSynthesis?.cancel();
});
ui.settingsButton.addEventListener('click', () => ui.settings.classList.toggle('hidden'));
ui.closeSettings.addEventListener('click', () => ui.settings.classList.add('hidden'));
ui.roiTop.addEventListener('input', updateROI);
ui.roiHeight.addEventListener('input', updateROI);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { requestWakeLock(); if (!state.paused) scheduleScan(200); }
});
window.addEventListener('pagehide', () => {
  state.stream?.getTracks().forEach(track => track.stop());
  state.worker?.terminate();
});

updateROI();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
