// Sync only a normal latest-report request for the SafeKang device paired in HA.
(function () {
  const statusKey = 'safekang.session-sync.status.v2';
  const checkKey = 'safekang.session-sync.check.v1';
  const pendingKey = 'safekang.session-sync.pending.v1';
  const [origin, key] = (typeof $argument === 'string' ? $argument : '').split('|');
  const paired = /^[0-9a-f]{64}$/.test(key);
  const endpoint = /^https:\/\/api\.ventilator\.safekang\.com\/client\/1\/device-data\/(?:last-data|list)(?:\?[^#]*)?$/;
  const privateAddress = /^(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/;
  const reasons = {
    400: 'HA 拒绝请求格式', 403: 'HA 拒绝请求：检查配对密钥、设备和家庭 Wi-Fi',
    404: 'HA 同步入口不存在，请检查 HA 地址或集成版本',
    409: 'HA 配置正在更新，请重新打开日报', 422: '赛呼康拒绝新会话',
    429: 'HA 校验间隔未到，稍后再打开日报',
    502: 'HA 暂时无法验证赛呼康会话', 503: 'HA 重载集成失败',
  };

  function readStatus(storeKey = statusKey) {
    try { return JSON.parse($persistentStore.read(storeKey)) || {}; }
    catch (_) { return {}; }
  }

  function remember(capture, sync, code) {
    try {
      const before = readStatus();
      const now = new Date().toLocaleString();
      $persistentStore.write(JSON.stringify({capture, sync, code, attempt: now,
        success: sync === 'ok' ? now : before.success}), statusKey);
    } catch (_) { /* Status storage must not affect the report request. */ }
  }

  function finish(capture, sync, code) {
    remember(capture, sync, code);
    $done({});
  }

  function webhookURL() {
    const url = new URL(origin);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
        || (url.protocol !== 'https:' && (url.protocol !== 'http:' || !privateAddress.test(url.hostname)))) {
      throw new Error('Invalid HA address');
    }
    return url.origin + '/api/webhook/safekang-session-sync';
  }

  function post(url, body, timeout, callback) {
    $httpClient.post({url, headers: {'Content-Type': 'application/json', 'X-SafeKang-Pairing-Key': key},
      body: JSON.stringify(body), timeout, 'auto-cookie': false, 'auto-redirect': false}, callback);
  }

  function networkReason(error) {
    return /timed?\s*out|timeout/i.test(String(error)) ? '连接 HA 超时' : '连不上 HA，请检查地址和家庭 Wi-Fi';
  }

  function deliver(url, pending, timeout, done) {
    try {
      post(url, {token: pending.token, outer_device_id: pending.device}, timeout, (error, response) => {
        if (error || !response || !Number.isInteger(response.status)) {
          return done(/timed?\s*out|timeout/i.test(String(error)) ? 'timeout' : 'network');
        }
        if (response.status === 204 || response.status === 422) {
          try {
            if (readStatus(pendingKey).seen === pending.seen) $persistentStore.write(null, pendingKey);
          } catch (_) { /* Ignore local state write failures. */ }
        }
        return done(response.status === 204 ? 'ok' : 'failed', response.status);
      });
    } catch (_) { done('network'); }
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
    const check = readStatus(checkKey);
    if (check.message) lines.push('HA 检查：' + check.message + ' · ' + check.time);
    const style = !paired ? 'info' : check.failed ? 'alert' : status.sync === 'ok' ? 'good' :
      status.sync || (status.capture && status.capture !== 'ok') ? 'alert' : 'info';
    $done({title: '赛呼康会话同步', content: lines.join('\n'), style});
  }

  function manualCheck() {
    function complete(message, failed) {
      try { $persistentStore.write(JSON.stringify({message, failed, time: new Date().toLocaleString()}), checkKey); }
      catch (_) { /* Panel remains usable when local storage is unavailable. */ }
      return panel();
    }
    if (!paired) return complete('等待配置配对密钥', true);
    let url;
    try { url = webhookURL(); }
    catch (_) { return complete('失败 · HA 地址无效', true); }
    const pending = readStatus(pendingKey);
    if (pending.token && Date.now() - pending.seen < 10 * 60 * 1000) {
      return deliver(url, pending, 9, (sync, code) => {
        remember('ok', sync, code);
        return panel();
      });
    }
    if (pending.token) {
      try { $persistentStore.write(null, pendingKey); } catch (_) { /* Ignore local cleanup failures. */ }
    }
    try {
      return post(url, {action: 'check'}, 9, (error, response) => {
        if (error || !response || !Number.isInteger(response.status)) return complete('失败 · ' + networkReason(error), true);
        if (response.status === 204) return complete('最新和历史日报均可读取', false);
        return complete('失败 · ' + (reasons[response.status] || 'HA 返回 HTTP ' + response.status), true);
      });
    } catch (_) { return complete('失败 · 连不上 HA', true); }
  }

  if ((typeof $script !== 'undefined' && $script.type === 'generic') || typeof $request === 'undefined') {
    return typeof $trigger !== 'undefined' && $trigger === 'button' ? manualCheck() : panel();
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
  const pending = {token, device, seen: Date.now()};
  try { $persistentStore.write(JSON.stringify(pending), pendingKey); } catch (_) { /* Automatic delivery still works. */ }
  if (!paired) return finish('ok');
  let url;
  try { url = webhookURL(); }
  catch (_) { return finish('ok', 'config'); }
  return deliver(url, pending, 3, (sync, code) => finish('ok', sync, code));
})();
