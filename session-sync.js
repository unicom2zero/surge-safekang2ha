// Sync only a normal latest-report request for the SafeKang device paired in HA.
(function () {
  const statusKey = 'safekang.session-sync.status.v1';
  const [origin, key] = (typeof $argument === 'string' ? $argument : '').split('|');
  const paired = /^[0-9a-f]{64}$/.test(key);

  function readStatus() {
    try { return JSON.parse($persistentStore.read(statusKey)) || {}; }
    catch (_) { return {}; }
  }

  function finish(result, code) {
    try {
      const before = readStatus();
      const now = new Date().toLocaleString();
      $persistentStore.write(JSON.stringify({result, code, attempt: now,
        success: result === 'ok' ? now : before.success}), statusKey);
    } catch (_) { /* Status storage must not affect the report request. */ }
    $done({});
  }

  if ((typeof $script !== 'undefined' && $script.type === 'generic') || typeof $request === 'undefined') {
    const status = readStatus();
    const labels = {
      ok: 'HA 已确认会话', network: '连接 HA 失败，请检查家庭 Wi-Fi',
      403: 'HA 拒绝配对，请检查密钥和设备', 422: '赛呼康拒绝新会话',
      429: 'HA 校验间隔未到，稍后再打开日报', 502: 'HA 暂时无法验证赛呼康会话',
    };
    const label = !paired ? '等待配置配对密钥' : status.result
      ? labels[status.result] || labels[status.code] || 'HA 同步失败（HTTP ' + status.code + '）'
      : '等待小程序读取日报';
    const lines = [label];
    if (paired && status.attempt) lines.push('最近尝试：' + status.attempt);
    if (paired && status.success && status.result !== 'ok') lines.push('上次确认：' + status.success);
    return $done({title: '赛呼康会话同步', content: lines.join('\n'),
      style: !paired || !status.result ? 'info' : status.result === 'ok' ? 'good' : 'alert'});
  }

  const endpoint = /^https:\/\/api\.ventilator\.safekang\.com\/client\/1\/device-data\/last-data(?:\?[^#]*)?$/;
  const privateAddress = /^(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/;
  if ($request.method !== 'POST' || !endpoint.test($request.url) || typeof $request.body !== 'string') {
    return $done({});
  }
  try {
    const target = new URL(origin);
    if (target.username || target.password || target.pathname !== '/' || target.search || target.hash
        || (target.protocol !== 'https:' && (target.protocol !== 'http:' || !privateAddress.test(target.hostname)))
        || !paired) return $done({});
    const fields = new URLSearchParams($request.body);
    const token = fields.get('token');
    const device = fields.get('outer_device_id');
    if (fields.get('frame_type') !== '4' || !token || !/^[a-fA-F0-9]{32}$/.test(token)
        || !device || device.length > 96) return $done({});
    $httpClient.post({
      url: target.origin + '/api/webhook/safekang-session-sync',
      headers: {'Content-Type': 'application/json', 'X-SafeKang-Pairing-Key': key},
      body: JSON.stringify({token, outer_device_id: device}),
      timeout: 3,
      'auto-cookie': false,
      'auto-redirect': false,
    }, (error, response) => {
      if (error || !response || !Number.isInteger(response.status)) return finish('network');
      return finish(response.status === 204 ? 'ok' : 'failed', response.status);
    });
  } catch (_) {
    $done({});
  }
})();
