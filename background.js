// LevOJ AI 助手 - 后台 Service Worker（MV3）
// 职责：代理 AI 接口请求（绕开页面 CORS，依赖 optional_host_permissions 授权）

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'ai') return;

  (async () => {
    try {
      const keys = await chrome.storage.local.get(['laj_baseUrl', 'laj_apiKey', 'laj_model']);
      const baseUrl = (keys.laj_baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
      const apiKey = keys.laj_apiKey || '';
      const model = keys.laj_model || 'gpt-4o-mini';

      if (!apiKey) {
        sendResponse({ ok: false, error: '未配置 API Key：请点悬浮窗右上角 ⚙ 进行设置' });
        return;
      }

      const payload = JSON.stringify({ model, messages: msg.messages, temperature: 0.4 });
      const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };

      const call = (url) => fetch(url, { method: 'POST', headers, body: payload });

      // 读取错误详情：优先 JSON 里的 error.message，兼容 message / error.code，
      // 最后回退原始文本。不少网关在 429 时返回空体或非 JSON，这里尽量把服务端
      // 原话带回来，否则用户只能看到一个光秃秃的状态码，没法判断该改什么。
      const readError = async (resp) => {
        let body = '';
        try { body = await resp.text(); } catch (e) { /* 无响应体 */ }
        if (!body) return '';
        try {
          const j = JSON.parse(body);
          const m = (j && j.error && (j.error.message || j.error.code)) || (j && j.message);
          if (m) return m;
          return JSON.stringify(j).slice(0, 300);
        } catch (e) {
          return body.replace(/\s+/g, ' ').trim().slice(0, 300);
        }
      };

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

      // 用户常把 Base URL 填成 https://api.deepseek.com（漏 /v1），此时会 404 → 自动补一次 /v1
      let url = baseUrl + '/chat/completions';
      let resp = await call(url);
      if (resp.status === 404 && !/\/v\d+$/.test(baseUrl)) {
        url = baseUrl + '/v1/chat/completions';
        resp = await call(url);
      }

      // 429 多为瞬时限流（免费额度 RPM 限制、上游负载饱和），做有限次退避重试。
      // 服务端给了 Retry-After 就按它等（上限 6s），否则 1.2s、2.4s 递增。
      for (let attempt = 0; resp.status === 429 && attempt < 2; attempt++) {
        const ra = parseInt(resp.headers.get('Retry-After') || '', 10);
        const waitMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 6000) : 1200 * (attempt + 1);
        await sleep(waitMs);
        resp = await call(url);
      }

      if (!resp.ok) {
        const detail = await readError(resp);
        let hint = '';
        if (resp.status === 401 || resp.status === 403) hint = '（API Key 无效或无权限）';
        else if (resp.status === 404) hint = '（接口路径 404：请确认 Base URL 形如 https://xxx/v1）';
        else if (resp.status === 429) hint = '（限流或额度不足，已自动退避重试 2 次仍未通过）';
        sendResponse({
          ok: false,
          error: 'AI 接口错误 ' + resp.status + hint +
            (detail ? '：' + detail : '（服务端未返回错误详情）'),
        });
        return;
      }

      let j = null;
      try { j = await resp.json(); } catch (e) { /* 非 JSON 响应 */ }

      const msgOut = j && j.choices && j.choices[0] && j.choices[0].message;
      let out = (msgOut && msgOut.content) || (j && j.choices && j.choices[0] && j.choices[0].text) || '';
      // 多模态网关可能把 content 返回为数组
      if (Array.isArray(out)) {
        out = out.map((p) => (typeof p === 'string' ? p : (p && p.text) || '')).join('');
      }
      // 推理类模型（如 deepseek-reasoner）可能只给 reasoning_content
      if (!out && msgOut && msgOut.reasoning_content) out = msgOut.reasoning_content;

      sendResponse({ ok: true, text: (out && String(out).trim()) || '(空响应：模型未返回内容，请检查模型名是否正确)' });
    } catch (e) {
      sendResponse({
        ok: false,
        error: '请求失败：' + e.message + '（请检查 Base URL 是否正确、网络能否访问该接口）',
      });
    }
  })();

  return true; // 保持通道开启，异步 sendResponse
});
