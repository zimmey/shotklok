(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const ledDisplay = $('#led-display');
  const btnStart = $('#btn-start');
  const btnReset = $('#btn-reset');
  const btnSettings = $('#btn-settings');
  const btnSettingsClose = $('#btn-settings-close');
  const settingsModal = $('#settings-modal');
  const overlay = $('#overlay');
  const buzzer = $('#buzzer');
  const durBtns = document.querySelectorAll('.dur');

  // Load saved duration or default to 5 minutes
  let totalSeconds = parseInt(localStorage.getItem('shotklok-duration'), 10) || 300;
  let remaining = totalSeconds;
  let state = 'ready'; // ready | running | warning | paused | expired
  let interval = null;
  let wakeLock = null;
  let overlayTimeout = null;
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
    const t = w * 0.08;
    const g = t * 0.25;
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
    const digitGap = 18;
    const colonW = 28;

    const padX = 16;
    const padY = 10;
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
    btnStart.textContent = (state === 'running' || state === 'warning') ? 'PAUSE' : state === 'expired' ? 'RESET' : 'START';
    btnStart.classList.toggle('running', state === 'running' || state === 'warning');
  }

  // --- Timer Core ---

  function tick() {
    if (remaining <= 0) { expire(); return; }
    remaining--;
    if (remaining <= 10 && remaining > 0 && state !== 'warning') {
      state = 'warning';
    }
    render();
    if (remaining <= 0) expire();
  }

  function start() {
    if (state === 'expired') { reset(); return; }
    state = remaining <= 10 ? 'warning' : 'running';
    interval = setInterval(tick, 1000);
    acquireWakeLock();
    render();
    autoHideOverlay();
  }

  function pause() {
    state = 'paused';
    clearInterval(interval);
    interval = null;
    releaseWakeLock();
    render();
    showOverlay();
  }

  function reset() {
    clearInterval(interval);
    interval = null;
    remaining = totalSeconds;
    state = 'ready';
    stopBuzzer();
    releaseWakeLock();
    render();
    showOverlay();
  }

  function expire() {
    clearInterval(interval);
    interval = null;
    state = 'expired';
    render();
    startBuzzer();
    releaseWakeLock();
    showOverlay();
  }

  // --- Overlay auto-hide while running ---

  function autoHideOverlay() {
    clearTimeout(overlayTimeout);
    overlay.classList.remove('hidden');
    overlayTimeout = setTimeout(() => {
      if (state === 'running' || state === 'warning') overlay.classList.add('hidden');
    }, 3000);
  }

  function showOverlay() {
    clearTimeout(overlayTimeout);
    overlay.classList.remove('hidden');
  }

  ledDisplay.addEventListener('click', () => {
    if (state === 'running' || state === 'warning') {
      if (overlay.classList.contains('hidden')) {
        autoHideOverlay();
      } else {
        overlay.classList.add('hidden');
      }
    }
  });

  // --- Settings Modal ---

  btnSettings.addEventListener('click', () => {
    if (state === 'running') return;
    settingsModal.classList.remove('modal-hidden');
  });

  btnSettingsClose.addEventListener('click', () => {
    settingsModal.classList.add('modal-hidden');
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

  // --- Buzzer (loops for 30s or until reset) ---

  function startBuzzer() {
    stopBuzzer();
    buzzerCtx = new (window.AudioContext || window.webkitAudioContext)();
    playBuzzerCycle();
    // Auto-stop after 30 seconds
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
    // Beep pattern: on/off/on/off/on/off over 1.2s
    const times = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    times.forEach((t, i) => {
      gain.gain.setValueAtTime(i % 2 === 0 ? 0.3 : 0, buzzerCtx.currentTime + t);
    });
    osc.stop(buzzerCtx.currentTime + 1.2);
    // Repeat after a short pause
    osc.onended = () => playBuzzerCycle();
  }

  function stopBuzzer() {
    clearTimeout(buzzerTimeout);
    buzzerTimeout = null;
    if (buzzerCtx) {
      buzzerCtx.close();
      buzzerCtx = null;
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
    if (document.visibilityState === 'visible' && state === 'running') acquireWakeLock();
  });

  // --- Event Handlers ---

  btnStart.addEventListener('click', () => {
    if (state === 'running') pause();
    else start();
  });

  btnReset.addEventListener('click', reset);

  // --- Service Worker ---

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }

  // --- Init ---
  render();
})();
