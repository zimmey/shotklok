(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const ledDisplay = $('#led-display');
  const btnStart = $('#btn-start');
  const btnReset = $('#btn-reset');
  const btnSettings = $('#btn-settings');
  const btnSettingsClose = $('#btn-settings-close');
  const btnUpdate = $('#btn-update');
  const settingsModal = $('#settings-modal');
  const overlay = $('#overlay');
  const buzzer = $('#buzzer');
  const durBtns = document.querySelectorAll('.dur');

  // Load saved duration or default to 5 minutes
  let totalSeconds = parseInt(localStorage.getItem('shotklok-duration'), 10) || 300;

  let ledThickness = parseFloat(localStorage.getItem('shotklok-thickness'));
  if (!(ledThickness >= 0.06 && ledThickness <= 0.18)) ledThickness = 0.12;
  let ledGap = parseFloat(localStorage.getItem('shotklok-gap'));
  if (!(ledGap >= 0 && ledGap <= 0.08)) ledGap = 0.03;
  let ledSize = parseFloat(localStorage.getItem('shotklok-size'));
  if (!(ledSize >= 0.8 && ledSize <= 1.5)) ledSize = 1.0;
  let theme = localStorage.getItem('shotklok-theme') || 'classic';
  let remaining = totalSeconds;
  let state = 'ready'; // ready | running | warning | paused | expired
  let interval = null;
  let wakeLock = null;
  let buzzerCtx = null;
  let buzzerTimeout = null;

  // Mark the saved duration button as active on load
  durBtns.forEach((b) => {
    b.classList.toggle('active', parseInt(b.dataset.seconds, 10) === totalSeconds);
  });

  // --- Seven-Segment Digit Rendering ---

  const SEGMENTS = {
    0: [1,1,1,1,1,1,0],
    1: [0,1,1,0,0,0,0],
    2: [1,1,0,1,1,0,1],
    3: [1,1,1,1,0,0,1],
    4: [0,1,1,0,0,1,1],
    5: [1,0,1,1,0,1,1],
    6: [1,0,1,1,1,1,1],
    7: [1,1,1,0,0,0,0],
    8: [1,1,1,1,1,1,1],
    9: [1,1,1,1,0,1,1],
  };

  function digitSegments(x, y, w, h) {
    const t = w * ledThickness;
    const g = w * ledGap;
    const sk = t * 0.15;

    return [
      // a - top horizontal
      `${x+g+sk},${y} ${x+w-g-sk},${y} ${x+w-g-sk-t},${y+t} ${x+g+sk+t},${y+t}`,
      // b - top right vertical
      `${x+w},${y+g+sk} ${x+w},${y+h/2-g-sk} ${x+w-t},${y+h/2-g-sk-t} ${x+w-t},${y+g+sk+t}`,
      // c - bottom right vertical
      `${x+w},${y+h/2+g+sk} ${x+w},${y+h-g-sk} ${x+w-t},${y+h-g-sk-t} ${x+w-t},${y+h/2+g+sk+t}`,
      // d - bottom horizontal
      `${x+g+sk},${y+h} ${x+w-g-sk},${y+h} ${x+w-g-sk-t},${y+h-t} ${x+g+sk+t},${y+h-t}`,
      // e - bottom left vertical
      `${x},${y+h/2+g+sk} ${x},${y+h-g-sk} ${x+t},${y+h-g-sk-t} ${x+t},${y+h/2+g+sk+t}`,
      // f - top left vertical
      `${x},${y+g+sk} ${x},${y+h/2-g-sk} ${x+t},${y+h/2-g-sk-t} ${x+t},${y+g+sk+t}`,
      // g - middle horizontal (diamond ends pointing outward)
      `${x+g+sk+t/2},${y+h/2-t/2} ${x+w-g-sk-t/2},${y+h/2-t/2} ${x+w-g-sk},${y+h/2} ${x+w-g-sk-t/2},${y+h/2+t/2} ${x+g+sk+t/2},${y+h/2+t/2} ${x+g+sk},${y+h/2}`,
    ];
  }

  function buildSVG() {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;

    let digits;
    if (mins >= 10) {
      digits = [Math.floor(mins / 10), mins % 10, Math.floor(secs / 10), secs % 10];
    } else {
      digits = [mins, Math.floor(secs / 10), secs % 10];
    }

    const colonAfter = mins >= 10 ? 1 : 0;

    const digitW = 100;
    const digitH = 180;
    const digitGap = 18 / ledSize;
    const colonW = 28 / ledSize;

    const padX = 16 / ledSize;
    const padY = 10 / ledSize;
    const viewH = digitH + padY * 2;

    let svgContent = '';
    let curX = padX;

    digits.forEach((d, i) => {
      const segs = digitSegments(curX, padY, digitW, digitH);
      const on = SEGMENTS[d];
      segs.forEach((points, si) => {
        const cls = on[si] ? 'seg-on' : 'seg-off';
        svgContent += `<polygon class="${cls}" points="${points}"/>`;
      });
      curX += digitW;

      if (i === colonAfter) {
        const cx = curX + (colonW + digitGap * 2) / 2;
        const dotR = digitW * 0.06;
        const dotCls = 'colon-dot on';
        svgContent += `<circle class="${dotCls}" cx="${cx}" cy="${padY + digitH * 0.3}" r="${dotR}"/>`;
        svgContent += `<circle class="${dotCls}" cx="${cx}" cy="${padY + digitH * 0.7}" r="${dotR}"/>`;
        curX += colonW + digitGap * 2;
      } else if (i < digits.length - 1) {
        curX += digitGap;
      }
    });

    const viewW = curX + padX;
    return `<svg viewBox="0 0 ${viewW} ${viewH}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${svgContent}</svg>`;
  }

  // --- Rendering ---

  function render() {
    ledDisplay.innerHTML = buildSVG();
    ledDisplay.className = state;
    const isActive = state === 'running' || state === 'warning' || state === 'caution';
    btnStart.textContent = isActive ? 'PAUSE' : state === 'expired' ? 'RESET' : 'START';
    btnStart.classList.toggle('running', isActive);
  }

  // --- Timer Core ---

  function tick() {
    if (remaining <= 0) { expire(); return; }
    remaining--;
    if (remaining <= 10 && remaining > 0) {
      state = 'warning';
    } else if (remaining <= 60 && remaining > 10) {
      state = 'caution';
    }
    render();
    if (remaining <= 0) expire();
  }

  function start() {
    if (state === 'expired') { reset(); return; }
    clearInterval(interval);
    state = remaining <= 10 ? 'warning' : remaining <= 60 ? 'caution' : 'running';
    interval = setInterval(tick, 1000);
    render();
  }

  function pause() {
    state = 'paused';
    clearInterval(interval);
    interval = null;
    render();
  }

  function reset() {
    clearInterval(interval);
    interval = null;
    remaining = totalSeconds;
    state = 'ready';
    stopBuzzer();
    render();
  }

  function expire() {
    clearInterval(interval);
    interval = null;
    state = 'expired';
    render();
    startBuzzer();
  }

  // --- Overlay is always visible now ---

  // --- Settings Modal ---

  btnSettings.addEventListener('click', () => {
    if (state === 'running') return;
    settingsModal.classList.remove('modal-hidden');
  });

  btnSettingsClose.addEventListener('click', () => {
    settingsModal.classList.add('modal-hidden');
  });

  btnUpdate.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!navigator.onLine) {
      btnUpdate.textContent = 'need wifi!';
      setTimeout(() => { btnUpdate.textContent = 'update'; }, 2000);
      return;
    }
    btnUpdate.textContent = 'updating...';
    // Clear all caches so reload fetches everything fresh
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    // Unregister SW so it doesn't serve stale files during reload
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    // Reload from network — SW will re-register and cache fresh files
    window.location.reload();
  });

  durBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state === 'running') return;
      durBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      totalSeconds = parseInt(btn.dataset.seconds, 10);
      remaining = totalSeconds;
      state = 'ready';
      localStorage.setItem('shotklok-duration', totalSeconds);
      render();
    });
  });

  // --- Theme + Display Preferences ---

  const themeBtns = document.querySelectorAll('.theme');
  const thicknessSlider = $('#thickness-slider');
  const gapSlider = $('#gap-slider');
  const sizeSlider = $('#size-slider');

  function applySize(s) {
    ledSize = s;
    document.body.style.setProperty('--led-size', s);
    localStorage.setItem('shotklok-size', s);
  }

  applySize(ledSize);

  function applyTheme(t) {
    document.body.classList.remove('theme-classic', 'theme-red');
    document.body.classList.add('theme-' + t);
    theme = t;
    localStorage.setItem('shotklok-theme', t);
    themeBtns.forEach((b) => b.classList.toggle('active', b.dataset.theme === t));
  }

  applyTheme(theme);

  themeBtns.forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  thicknessSlider.value = ledThickness;
  gapSlider.value = ledGap;
  sizeSlider.value = ledSize;

  thicknessSlider.addEventListener('input', (e) => {
    ledThickness = parseFloat(e.target.value);
    localStorage.setItem('shotklok-thickness', ledThickness);
    render();
  });

  gapSlider.addEventListener('input', (e) => {
    ledGap = parseFloat(e.target.value);
    localStorage.setItem('shotklok-gap', ledGap);
    render();
  });

  sizeSlider.addEventListener('input', (e) => {
    applySize(parseFloat(e.target.value));
    render();
  });

  // --- Buzzer (loops for 30s or until reset) ---
  // iOS requires Web Audio to be unlocked from a user gesture, so we create
  // the context lazily on first tap and reuse it across expirations.

  let buzzerOsc = null;

  function ensureAudioCtx() {
    if (!buzzerCtx) {
      buzzerCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return buzzerCtx;
  }

  function unlockAudio() {
    const ctx = ensureAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    try {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (_) {}
  }

  function startBuzzer() {
    stopBuzzer();
    const ctx = ensureAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
    playBuzzerCycle();
    buzzerTimeout = setTimeout(stopBuzzer, 30000);
  }

  function playBuzzerCycle() {
    if (!buzzerCtx || buzzerCtx.state === 'closed') return;
    const osc = buzzerCtx.createOscillator();
    const gain = buzzerCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = 440;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(buzzerCtx.destination);
    osc.start();
    const times = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    times.forEach((t, i) => {
      gain.gain.setValueAtTime(i % 2 === 0 ? 0.3 : 0, buzzerCtx.currentTime + t);
    });
    osc.stop(buzzerCtx.currentTime + 1.2);
    buzzerOsc = osc;
    osc.onended = () => { buzzerOsc = null; playBuzzerCycle(); };
  }

  function stopBuzzer() {
    clearTimeout(buzzerTimeout);
    buzzerTimeout = null;
    if (buzzerOsc) {
      try { buzzerOsc.onended = null; buzzerOsc.stop(); } catch (_) {}
      buzzerOsc = null;
    }
  }

  // --- Wake Lock ---

  async function acquireWakeLock() {
    if ('wakeLock' in navigator) {
      try { wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
    }
  }

  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release(); wakeLock = null; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquireWakeLock();
  });

  // --- Event Handlers ---

  btnStart.addEventListener('click', () => {
    unlockAudio();
    if (state === 'running' || state === 'warning' || state === 'caution') pause();
    else start();
  });

  btnReset.addEventListener('click', reset);

  // --- Service Worker ---

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }

  // --- Init ---
  render();
  acquireWakeLock();
})();
