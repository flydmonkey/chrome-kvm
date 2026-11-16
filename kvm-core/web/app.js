(() => {
  const token = localStorage.getItem('kvm_token');
  if (!token) {
    location.href = '/login.html';
    return;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');
  let inputWs = null;
  let lastX = null;
  let lastY = null;
  let absoluteMouse = true;

  function authUrl(path) {
    const u = new URL(path, location.origin);
    u.searchParams.set('token', token);
    return u;
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/api/status', { headers });
      if (res.status === 401) {
        location.href = '/login.html';
        return;
      }
      const s = await res.json();
      absoluteMouse = !!s.serial.absolute_mouse;
      statusEl.textContent =
        `视频 ${s.video.source}/${s.encoder.kind} · 串口 ${s.serial.mock ? 'mock' : (s.serial.port || '-')} · 观看 ${s.viewers}`;
      const hasAtx = !!s.atx;
      document.getElementById('btnAtxShort').hidden = !hasAtx;
      document.getElementById('btnAtxLong').hidden = !hasAtx;
      document.getElementById('btnAtxReset').hidden = !(s.atx && s.atx.reset_channel != null);
    } catch (_) {
      statusEl.textContent = '状态获取失败';
    }
  }

  function iceComplete(pc) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const check = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', check);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(resolve, 1500);
    });
  }

  function drawJpeg(buf) {
    const blob = new Blob([buf], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width;
        canvas.height = img.height;
      }
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function startWsVideo() {
    const ws = new WebSocket(authUrl('/api/ws/video'));
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (m) => {
      if (typeof m.data === 'string') return;
      drawJpeg(m.data);
    };
    ws.onclose = () => setTimeout(startWsVideo, 1000);
  }

  async function startVideo() {
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      // Negotiate so server-created channel can attach via ondatachannel
      pc.addTransceiver('video', { direction: 'recvonly' });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await iceComplete(pc);
      const res = await fetch('/api/webrtc/offer', {
        method: 'POST',
        headers,
        body: JSON.stringify({ sdp: pc.localDescription.sdp }),
      });
      if (!res.ok) throw new Error('webrtc offer failed');
      const answer = await res.json();
      await pc.setRemoteDescription({ type: answer.type || 'answer', sdp: answer.sdp });
      pc.ondatachannel = (ev) => {
        if (ev.channel.label !== 'video') return;
        ev.channel.binaryType = 'arraybuffer';
        ev.channel.onmessage = (m) => drawJpeg(m.data);
        statusEl.title = 'WebRTC DataChannel';
      };
      // Also keep WS as backup if no frames in 3s
      setTimeout(() => {
        if (canvas.width < 2) startWsVideo();
      }, 3000);
    } catch (e) {
      console.warn('WebRTC failed, using WS video', e);
      startWsVideo();
    }
  }

  function sendInput(obj) {
    if (inputWs && inputWs.readyState === 1) {
      inputWs.send(JSON.stringify(obj));
    }
  }

  function connectInput() {
    inputWs = new WebSocket(authUrl('/api/ws/input'));
    inputWs.onclose = () => setTimeout(connectInput, 1000);
  }

  function contentSize() {
    return { content_w: canvas.clientWidth || 1, content_h: canvas.clientHeight || 1 };
  }

  function localPos(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  canvas.addEventListener('mousemove', (ev) => {
    const p = localPos(ev);
    const c = contentSize();
    const dx = lastX == null ? 0 : Math.round(p.x - lastX);
    const dy = lastY == null ? 0 : Math.round(p.y - lastY);
    lastX = p.x;
    lastY = p.y;
    sendInput({ type: 'mousemove', ...p, ...c, dx, dy });
  });
  canvas.addEventListener('mousedown', (ev) => {
    canvas.focus();
    const button = ev.button === 2 ? 2 : ev.button === 1 ? 4 : 1;
    sendInput({ type: 'mousedown', button });
  });
  canvas.addEventListener('mouseup', (ev) => {
    const button = ev.button === 2 ? 2 : ev.button === 1 ? 4 : 1;
    sendInput({ type: 'mouseup', button });
  });
  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      sendInput({ type: 'wheel', wheel: ev.deltaY > 0 ? -1 : 1 });
    },
    { passive: false }
  );
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (ev) => {
    if (document.activeElement !== canvas) return;
    ev.preventDefault();
    sendInput({ type: 'keydown', code: ev.code });
  });
  window.addEventListener('keyup', (ev) => {
    if (document.activeElement !== canvas) return;
    ev.preventDefault();
    sendInput({ type: 'keyup', code: ev.code });
  });
  window.addEventListener('blur', () => sendInput({ type: 'release' }));

  document.getElementById('btnCad').onclick = async () => {
    for (const code of ['ControlLeft', 'AltLeft', 'Delete']) {
      await fetch('/api/input/key', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'down', code }),
      });
    }
    for (const code of ['Delete', 'AltLeft', 'ControlLeft']) {
      await fetch('/api/input/key', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'up', code }),
      });
    }
  };

  async function atx(kind) {
    await fetch('/api/atx/press', {
      method: 'POST',
      headers,
      body: JSON.stringify({ kind }),
    });
  }
  document.getElementById('btnAtxShort').onclick = () => atx('short');
  document.getElementById('btnAtxLong').onclick = () => atx('long');
  document.getElementById('btnAtxReset').onclick = () => atx('reset');
  document.getElementById('btnLogout').onclick = async () => {
    await fetch('/api/logout', { method: 'POST', headers });
    localStorage.removeItem('kvm_token');
    location.href = '/login.html';
  };

  void absoluteMouse;
  connectInput();
  startVideo();
  refreshStatus();
  setInterval(refreshStatus, 3000);
  canvas.focus();
})();
