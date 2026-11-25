// Sync only a normal latest-report request for the SafeKang device paired in HA.
(function () {
  const endpoint = /^https:\/\/api\.ventilator\.safekang\.com\/client\/1\/device-data\/last-data(?:\?[^#]*)?$/;
  const privateAddress = /^(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/;
  if ($request.method !== 'POST' || !endpoint.test($request.url) || typeof $request.body !== 'string') {
    return $done({});
  }
  try {
    const [origin, key] = (typeof $argument === 'string' ? $argument : '').split('|');
    const target = new URL(origin);
    if (target.username || target.password || target.pathname !== '/' || target.search || target.hash
        || (target.protocol !== 'https:' && (target.protocol !== 'http:' || !privateAddress.test(target.hostname)))
        || !/^[0-9a-f]{64}$/.test(key)) return $done({});
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
    }, () => $done({}));
  } catch (_) {
    $done({});
  }
})();
