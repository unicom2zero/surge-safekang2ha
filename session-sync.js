// Sync only a normal latest-report request for the SafeKang device paired in HA.
(function () {
  const statusKey = 'safekang.session-sync.status.v2';
  const [origin, key] = (typeof $argument === 'string' ? $argument : '').split('|');
  const paired = /^[0-9a-f]{64}$/.test(key);
  const endpoint = /^https:\/\/api\.ventilator\.safekang\.com\/client\/1\/device-data\/last-data(?:\?[^#]*)?$/;
  const privateAddress = /^(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/;
  const reasons = {
    400: 'HA 拒绝请求格式', 403: 'HA 拒绝请求：检查配对密钥、设备和家庭 Wi-Fi',
    404: 'HA 同步入口不存在，请检查 HA 地址或集成版本',
    409: 'HA 配置正在更新，请重新打开日报', 422: '赛呼康拒绝新会话',
    429: 'HA 校验间隔未到，稍后再打开日报',
    502: 'HA 暂时无法验证赛呼康会话', 503: 'HA 重载集成失败',
  };

  function readStatus() {
    try { return JSON.parse($persistentStore.read(statusKey)) || {}; }
    catch (_) { return {}; }
  }

  function finish(capture, sync, code) {
    try {
      const before = readStatus();
      const now = new Date().toLocaleString();
      $persistentStore.write(JSON.stringify({capture, sync, code, attempt: now,
        success: sync === 'ok' ? now : before.success}), statusKey);
    } catch (_) { /* Status storage must not affect the report request. */ }
    $done({});
  }

  function panel() {
    const status = readStatus();
    const token = status.capture === 'ok' ? '已获取' : status.capture === 'invalid'
      ? '失败 · 日报请求缺少有效 Token' : status.capture === 'body'
        ? '失败 · 读取日报请求正文失败' : '等待小程序读取日报';
    let sync = '等待获取 Token';
    if (!paired) sync = '等待配置配对密钥';
    else if (status.sync === 'ok') sync = '成功 · HA 已确认会话';
    else if (status.sync === 'config') sync = '失败 · HA 地址无效，请检查模块配置';
    else if (status.sync === 'device') sync = '失败 · 日报请求缺少设备编号';
    else if (status.sync === 'timeout') sync = '失败 · 连接 HA 超时';
    else if (status.sync === 'network') sync = '失败 · 连不上 HA，请检查地址和家庭 Wi-Fi';
    else if (status.sync === 'failed') sync = '失败 · ' + (reasons[status.code] || 'HA 返回 HTTP ' + status.code);
    const lines = ['Token 获取：' + token, 'HA 同步：' + sync];
    if (status.attempt) lines.push('最近尝试：' + status.attempt);
    if (status.success && status.sync !== 'ok') lines.push('上次成功：' + status.success);
    const style = !paired ? 'info' : status.sync === 'ok' ? 'good' :
      status.sync || (status.capture && status.capture !== 'ok') ? 'alert' : 'info';
    $done({title: '赛呼康会话同步', content: lines.join('\n'), style});
  }

  if ((typeof $script !== 'undefined' && $script.type === 'generic') || typeof $request === 'undefined') {
    return panel();
  }
  if ($request.method !== 'POST' || !endpoint.test($request.url)) return $done({});
  if (typeof $request.body !== 'string') return finish('body');
  let fields;
  try { fields = new URLSearchParams($request.body); }
  catch (_) { return finish('body'); }
  if (fields.get('frame_type') !== '4') return $done({});
  const token = fields.get('token');
  const device = fields.get('outer_device_id');
  if (!token || !/^[a-fA-F0-9]{32}$/.test(token)) return finish('invalid');
  if (!device || device.length > 96) return finish('ok', 'device');
  if (!paired) return finish('ok');
  let target;
  try { target = new URL(origin); }
  catch (_) { return finish('ok', 'config'); }
  if (target.username || target.password || target.pathname !== '/' || target.search || target.hash
      || (target.protocol !== 'https:' && (target.protocol !== 'http:' || !privateAddress.test(target.hostname)))) {
    return finish('ok', 'config');
  }
  try {
    $httpClient.post({
      url: target.origin + '/api/webhook/safekang-session-sync',
      headers: {'Content-Type': 'application/json', 'X-SafeKang-Pairing-Key': key},
      body: JSON.stringify({token, outer_device_id: device}),
      timeout: 3,
      'auto-cookie': false,
      'auto-redirect': false,
    }, (error, response) => {
      if (error || !response || !Number.isInteger(response.status)) {
        return finish('ok', /timed?\s*out|timeout/i.test(String(error)) ? 'timeout' : 'network');
      }
      return finish('ok', response.status === 204 ? 'ok' : 'failed', response.status);
    });
  } catch (_) { finish('ok', 'network'); }
})();
