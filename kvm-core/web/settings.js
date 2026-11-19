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
  const msg = document.getElementById('msg');

  function fillSelect(sel, items, current) {
    sel.innerHTML = '';
    const seen = new Set();
    for (const it of items) {
      const opt = document.createElement('option');
      opt.value = it.id;
      opt.textContent = it.label || it.id;
      sel.appendChild(opt);
      seen.add(it.id);
    }
    if (current && !seen.has(current)) {
      const opt = document.createElement('option');
      opt.value = current;
      opt.textContent = current;
      sel.appendChild(opt);
    }
    if (current) sel.value = current;
  }

  async function load() {
    const [settings, devices] = await Promise.all([
      fetch('/api/settings', { headers }).then((r) => r.json()),
      fetch('/api/devices', { headers }).then((r) => r.json()),
    ]);
    fillSelect(document.getElementById('video_source'), devices.video || [], settings.video_source);
    fillSelect(
      document.getElementById('serial_port'),
      devices.serial || [],
      settings.serial_port || 'mock'
    );
    document.getElementById('baud').value = settings.baud;
    document.getElementById('width').value = settings.width;
    document.getElementById('height').value = settings.height;
    document.getElementById('fps').value = settings.fps;
    document.getElementById('bitrate_kbps').value = settings.bitrate_kbps;
    document.getElementById('mouse_absolute').checked = !!settings.mouse_absolute;
    document.getElementById('prefer_gpu_encode').checked = !!settings.prefer_gpu_encode;
  }

  document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '保存中…';
    const videoCustom = document.getElementById('video_custom').value.trim();
    const serialCustom = document.getElementById('serial_custom').value.trim();
    const body = {
      video_source: videoCustom || document.getElementById('video_source').value,
      serial_port: serialCustom || document.getElementById('serial_port').value,
      baud: Number(document.getElementById('baud').value),
      width: Number(document.getElementById('width').value),
      height: Number(document.getElementById('height').value),
      fps: Number(document.getElementById('fps').value),
      bitrate_kbps: Number(document.getElementById('bitrate_kbps').value),
      mouse_absolute: document.getElementById('mouse_absolute').checked,
      prefer_gpu_encode: document.getElementById('prefer_gpu_encode').checked,
    };
    const pw = document.getElementById('password').value;
    if (pw) body.password = pw;
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || '保存失败';
      return;
    }
    msg.textContent = data.restart_required
      ? '已保存。请重启 kvm-core 使视频/串口/分辨率生效。'
      : '已保存。';
  });

  load().catch((e) => {
    msg.textContent = String(e);
  });
})();
