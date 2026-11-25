# 赛呼康会话同步到 Home Assistant

Surge 在赛呼康小程序请求最新日报时，把已签发的会话交给你的 HA。它不会模拟微信登录，也不会访问分享、耗材或设备控制请求。前提是手机能访问 HA、赛呼康 API 已启用 MITM，且小程序实际发出日报请求。

## 准备 HA

需要支持 `safekang-session-sync` Webhook 的赛呼康 HA 集成（1.2.0 或以上）。在可信的终端执行以下命令，生成专用配对密钥及其 SHA-256。密钥只填在 Surge，SHA-256 填在 HA「赛呼康呼吸机 → 重新配置」，原有 Token 和设备编号继续使用。清空 SHA-256 即关闭接收。

```sh
python3 -c 'import hashlib,secrets; k=secrets.token_hex(32); print("PAIR_KEY",k); print("HA SHA-256",hashlib.sha256(k.encode()).hexdigest())'
```

## 安装模块

若使用私有 GitHub 仓库，把 `SafeKangSessionSync.sgmodule` 和 `session-sync.js` 放到自己的 HA 静态目录 `www/`，再使用手机上的 Surge 从 `/local/SafeKangSessionSync.sgmodule` 对应的网址安装。`SCRIPT_URL` 填同一台可信 HA 的 `/local/session-sync.js` 地址。`HA_URL` 只填协议、主机和端口，例如 `http://192.168.1.10:8123`。最后填 `PAIR_KEY` 并启用模块。不把配对密钥或厂商 Token 填进仓库文件。

模块只允许局域网地址使用 HTTP。HTTP 模式下 Token 和配对密钥在网络中为明文，只在可信局域网使用，勿映射 Webhook 到公网。已有私有 HTTPS 时优先使用它。HA 会核对设备、拒绝错误配对，并先验证最新日报和历史报告接口后才保存新会话。相同会话会直接跳过。
