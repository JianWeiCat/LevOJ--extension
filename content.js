// LevOJ 悬浮窗 AI 刷题助手 - 内容脚本（MV3 本地扩展版 v1.2）
// 约束要点（详见《约束文档.md》）：
//  1. 仅练习辅助，禁止任何自动作答/自动提交逻辑；
//  2. 考试(/exam)、比赛(/contest、/compete)页面自动禁用；
//  3. 不对 OJ 站点发起写操作请求；
//  4. apiKey 仅存本机扩展存储，AI 请求经 background 代理。

(function () {
  'use strict';

  if (window.__lajLoaded) return;
  window.__lajLoaded = true;

  /* ---------------- 常量 ---------------- */
  const ORIGIN = location.origin;
  const POS_KEY_WIN = 'laj_pos_win';
  const POS_KEY_BALL = 'laj_pos_ball';
  const COLLAPSED_KEY = 'laj_collapsed';
  const AUTO_KEY = 'laj_autoAnswer'; // '1'=进入题目页自动出答案（默认开，'0' 关闭）
  const Z = 2147483000;
  const DEFAULT_BASEURL = 'https://api.openai.com/v1';
  const DEFAULT_MODEL = 'gpt-4o-mini';
  const RESTRICTED_RE = /\/(contest|exam|compete)(\/|$|\?)/i;

  // 悬浮球与标题栏的标：DeepSeek 风格的鲸鱼（手绘近似，非官方素材）。
  // 想换成官方原版：把图片存成 logo.png 放进本扩展目录，然后把下面这个常量改成
  //   '<img src="' + chrome.runtime.getURL('logo.png') + '" alt="" style="width:100%;height:100%">'
  // 并在 manifest.json 里加 web_accessible_resources 放行 logo.png。
  const LOGO_SVG = '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path fill="currentColor" fill-rule="evenodd" d="M12.4 8.6h1.9c4.6 0 8.3 3.7 8.3 8.3 0 .7-.6 1.3-1.3 1.3' +
    'h-1.5c-.6 0-1.1.4-1.2 1-.6 3.2-3.4 5.6-6.7 5.6C8.3 24.8 5 21.5 5 17.4c0-4.9 3.3-8.8 7.4-8.8z' +
    'M11 13.7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z"/>' +
    '<path fill="currentColor" d="M22.4 13.1l4.9-4.1c.6-.5 1.5 0 1.5.8v6.2c0 .8-.9 1.3-1.5.8l-2.1-1.7-2.8-2z"/>' +
    '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
    'd="M10.4 7.4c0-1.4 1-2.6 2.3-2.9M13.7 6.7c.2-1.3 1.2-2.3 2.5-2.5"/></svg>';

  /* ---------------- 工具 ---------------- */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function toast(msg, isErr) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:' + (Z + 10),
      'padding:9px 16px', 'border-radius:10px', 'font-size:13px',
      'background:' + (isErr ? 'linear-gradient(135deg,#e5484d,#b3261e)' : 'linear-gradient(135deg,#5b78ff,#4d6bfe)'),
      'color:#fff', 'box-shadow:0 6px 24px rgba(0,0,0,.35)', 'transition:opacity .4s, transform .4s',
      'max-width:360px', 'line-height:1.5', 'font-family:inherit',
    ].join(';');
    document.documentElement.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; }, 2600);
    setTimeout(() => el.remove(), 3200);
  }

  /* ---------------- Markdown 渲染 ---------------- */
  function renderMD(src) {
    const blocks = [];
    let text = String(src || '').replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      blocks.push({ lang, code });
      return '\u0000CB' + (blocks.length - 1) + '\u0000';
    });
    let html = esc(text)
      .replace(/^####? (.*)$/gm, '<div class="md-h">$1</div>')
      .replace(/^## (.*)$/gm, '<div class="md-h md-h2">$1</div>')
      .replace(/^# (.*)$/gm, '<div class="md-h md-h2">$1</div>')
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*\n]+)\*/g, '<i>$1</i>')
      .replace(/`([^`\n]+)`/g, '<code class="md-ic">$1</code>')
      .replace(/^\s*[-*] (.*)$/gm, '<div class="md-li"><span class="md-bullet"></span><span>$1</span></div>')
      .replace(/\n{2,}/g, '<div class="md-gap"></div>')
      .replace(/\n/g, '<br>');
    html = html.replace(/\u0000CB(\d+)\u0000/g, (m, i) => {
      const b = blocks[+i];
      const cid = 'laj-code-' + i;
      return '<div class="md-cw"><div class="md-cbar"><span class="md-lang">' + esc(b.lang || 'code') +
        '</span><button class="md-copy" data-target="' + cid + '">复制</button></div>' +
        '<pre class="md-pre" id="' + cid + '">' + esc(b.code.replace(/\n$/, '')) + '</pre></div>';
    });
    return html;
  }

  /* ---------------- 题目抓取（双通道） ---------------- */
  let currentProblem = null;
  let currentPath = location.pathname;

  function parseProblemId(path) {
    const m = String(path || '').match(/\/problem\/(\d+)/);
    return m ? m[1] : null;
  }

  // 把题目正文里的 HTML 标签剥离成纯文本（很多 OJ 的 content 是富文本 HTML）
  function htmlToText(html) {
    const d = document.createElement('div');
    d.innerHTML = String(html);
    d.querySelectorAll('script,style').forEach((n) => n.remove());
    return (d.innerText || d.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function fetchProblemViaAPI(id) {
    const resp = await fetch(ORIGIN + '/v1/problem/' + id, {
      method: 'GET', credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });
    if (!resp.ok) throw new Error('API ' + resp.status);
    const raw = await resp.json();
    // 兼容 { data: {...} } 包裹与直接返回
    const p = raw && raw.data ? raw.data : raw;
    if (!p || !p.title) throw new Error('题目数据为空或无权限');

    const meta = [];
    if (p.timeLimit) meta.push('⏱ ' + p.timeLimit + 's');
    if (p.memoryLimit) meta.push('💾 ' + p.memoryLimit + 'MB');
    if (Array.isArray(p.tags) && p.tags.length) {
      meta.push('🏷 ' + p.tags.map((t) => (t && t.name) || t).join('、'));
    }

    let body = p.content || p.description || p.statement || '';
    if (typeof body === 'string' && /<[a-z][\s\S]*>/i.test(body)) body = htmlToText(body);

    const content = ((meta.length ? meta.join('　') + '\n\n' : '') + body).trim();
    return {
      id,
      title: p.title,
      content: content || JSON.stringify(p).slice(0, 4000),
    };
  }

  function fetchProblemViaDOM() {
    const title = document.title.replace(/ - .*$/, '');
    const sels = [
      '.problem-content', '#problem-content', '.problem-detail', '.problem-statement',
      '.problem-description', '#problem-statement', '.markdown-body',
      '.ant-card-body', '.card-body', '.panel-body',
      'main article', 'article', 'main .container', 'main', '.container',
    ];
    for (const s of sels) {
      const el = $(s);
      if (el && el.innerText && el.innerText.trim().length > 60) {
        console.debug('[LAJ] DOM 抓取命中选择器：', s);
        return { id: parseProblemId(location.pathname), title, content: el.innerText.trim().slice(0, 8000) };
      }
    }
    // 通用兜底：在内容容器里找文本量最大的块（剔除导航/页脚噪声）
    let best = '';
    document.querySelectorAll('main div, article div, #app div, #root div, .content div').forEach((el) => {
      if (el.querySelector('nav, header, footer, form')) return;
      const t = el.innerText ? el.innerText.trim() : '';
      if (t.length > best.length && t.length < 15000) best = t;
    });
    if (best.length > 60) {
      console.debug('[LAJ] DOM 抓取命中通用兜底容器');
      return { id: parseProblemId(location.pathname), title, content: best.slice(0, 8000) };
    }
    return null;
  }

  async function grabProblem() {
    const id = parseProblemId(location.pathname);
    if (id) {
      try {
        currentProblem = await fetchProblemViaAPI(id);
        return currentProblem;
      } catch (e) { console.debug('[LAJ] API 通道失败，降级 DOM：', e); }
    }
    currentProblem = fetchProblemViaDOM();
    return currentProblem;
  }

  /* ---------------- AI 调用（经 background 代理） ---------------- */
  // 只保留「直接出答案」一种用途：要的就是可提交的完整代码，不要思路不要解说。
  function buildMessages() {
    const p = currentProblem || {};
    const probText = '【题目标题】' + (p.title || '未知') + '\n【题目内容】\n' + (p.content || '（未抓取到题目）');
    const user = '下面是一道 OJ 算法题。请直接给出可以提交通过本题的完整 C++ 代码，' +
      '只输出一个代码块，代码之外不要任何解释、思路或提示。用最稳妥简洁的写法，' +
      '注意数据范围（必要时用 long long）、边界情况与输入输出格式。\n\n' + probText;
    return [
      { role: 'system', content: '你是一位算法竞赛教练，只输出可直接提交的完整代码，不做额外解说。' },
      { role: 'user', content: user },
    ];
  }

  async function askAI(messages) {
    let res = null;
    try { res = await chrome.runtime.sendMessage({ type: 'ai', messages }); } catch (e) { /* 通道异常 */ }
    if (!res) throw new Error('后台无响应：扩展可能刚重新加载，请刷新页面后重试');
    if (!res.ok) throw new Error(res.error || '未知错误');
    return res.text;
  }

  /* ---------------- 悬浮窗 UI ---------------- */
  const host = document.createElement('div');
  host.id = 'laj-host';
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:' + Z + ';';
  const shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);

  const CSS = `
  /* 变量必须挂在 :host 上：.ball 与 .win 是兄弟节点，挂在 .win 上球继承不到，
     会导致 linear-gradient(135deg, , ) 非法、球失去背景色。 */
  :host {
    all: initial;
    --bg: #0e0f14; --bg2: #16181f; --bg3: #1e212b;
    --line: #262a36; --line2: #333849;
    --tx: #e7eaf3; --tx2: #97a0b2; --tx3: #616a7d;
    --acc: #4d6bfe; --acc2: #6b85ff; --ok: #34d399; --warn: #fbbf24; --err: #f87171;
  }
  *, *::before, *::after { box-sizing: border-box; }
  .win {
    position: fixed; width: 400px; max-height: 78vh;
    display: flex; flex-direction: column;
    background: var(--bg2);
    color: var(--tx); border-radius: 14px; border: 1px solid var(--line);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 18px 44px rgba(0,0,0,.55);
    font: 13px/1.6 -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    overflow: hidden;
    animation: winIn .22s cubic-bezier(.2,.9,.3,1.2);
  }
  @keyframes winIn { from { opacity: 0; transform: translateY(10px) scale(.97); } }

  /* ---- 头部 ---- */
  .hd {
    position: relative; display: flex; align-items: center; gap: 9px; padding: 9px 10px 9px 12px;
    background: linear-gradient(180deg, rgba(77,107,254,.12), rgba(77,107,254,0));
    border-bottom: 1px solid var(--line); cursor: move; user-select: none; flex: none;
  }
  .hd::before {
    content: ''; position: absolute; left: 0; right: 0; top: 0; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(107,133,255,.55), transparent);
  }
  .hd .logo {
    width: 24px; height: 24px; border-radius: 7px; flex: none;
    background: linear-gradient(135deg, var(--acc), var(--acc2));
    display: flex; align-items: center; justify-content: center;
    font-size: 11.5px; font-weight: 700; color: #fff; letter-spacing: .2px;
  }
  .hd .logo svg { width: 15px; height: 15px; display: block; }
  .hd .name { font-weight: 600; font-size: 13px; flex: 1; letter-spacing: .2px; }
  .hd .name small { display: block; font-weight: 400; font-size: 10px; color: var(--tx3); letter-spacing: 0; margin-top: 1px; }
  .st { width: 6px; height: 6px; border-radius: 50%; background: var(--ok); flex: none; }
  .st.off { background: var(--warn); }
  .ib {
    width: 24px; height: 24px; border-radius: 7px; flex: none; cursor: pointer;
    border: 1px solid transparent; background: transparent; color: var(--tx2);
    font-size: 12px; line-height: 1; display: flex; align-items: center; justify-content: center;
    transition: background .15s, color .15s, border-color .15s;
  }
  .ib:hover { background: var(--bg3); color: var(--tx); border-color: var(--line2); }
  .ib.on { background: var(--acc); color: #fff; border-color: transparent; }

  /* ---- 主体 ---- */
  .bd { padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .bd::-webkit-scrollbar, .pv::-webkit-scrollbar, .md-pre::-webkit-scrollbar { width: 8px; }
  .bd::-webkit-scrollbar-thumb, .pv::-webkit-scrollbar-thumb, .md-pre::-webkit-scrollbar-thumb { background: #2e3341; border-radius: 4px; }
  .bd::-webkit-scrollbar-thumb:hover, .pv::-webkit-scrollbar-thumb:hover, .md-pre::-webkit-scrollbar-thumb:hover { background: #3a4050; }
  .bd::-webkit-scrollbar-track, .pv::-webkit-scrollbar-track { background: transparent; }

  .lockbar {
    display: none; padding: 8px 11px; border-radius: 9px; font-size: 12px; line-height: 1.55;
    background: rgba(251,191,36,.07); border: 1px solid rgba(251,191,36,.3); color: var(--warn);
  }

  /* 题目卡 */
  .pcard {
    background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
    padding: 9px 11px; cursor: pointer; transition: border-color .15s;
  }
  .pcard:hover { border-color: var(--line2); }
  .pcard .pt { display: flex; align-items: center; gap: 7px; font-weight: 600; font-size: 12.5px; }
  .pcard .pt .chev { margin-left: auto; color: var(--tx3); font-size: 9px; transition: transform .2s; }
  .pcard.open .pt .chev { transform: rotate(90deg); }
  .pv {
    display: none; margin-top: 8px; max-height: 170px; overflow-y: auto;
    font-size: 12px; color: var(--tx2); white-space: pre-wrap; word-break: break-word;
    border-top: 1px dashed var(--line2); padding-top: 8px;
  }
  .pcard.open .pv { display: block; }

  /* 操作行 */
  .acts { display: flex; gap: 8px; }
  .btn {
    border: 1px solid var(--line2); background: var(--bg3); color: var(--tx);
    border-radius: 9px; padding: 8px 13px; font: 600 12.5px inherit; cursor: pointer;
    transition: background .15s, border-color .15s, opacity .15s; letter-spacing: .2px;
  }
  .btn:hover { background: #262a36; border-color: #3d4354; }
  .btn:disabled { opacity: .45; cursor: not-allowed; }
  .btn.pri {
    flex: 1; background: linear-gradient(180deg, #5b78ff, #3f61f8); border: 1px solid transparent;
    color: #fff;
  }
  .btn.pri:hover { background: linear-gradient(180deg, #6b85ff, #4d6bfe); }

  /* 输出区 */
  .out {
    background: var(--bg); border: 1px solid var(--line); border-radius: 10px;
    padding: 11px 12px; min-height: 88px; max-height: 46vh; overflow-y: auto; word-break: break-word;
    font-size: 12.5px; line-height: 1.7;
  }
  .out .ph { color: var(--tx3); font-size: 12.5px; }
  .md-h { font-weight: 700; font-size: 13px; margin: 11px 0 5px; color: #c3cfff; }
  .md-h2 { font-size: 14px; }
  .md-h:first-child { margin-top: 0; }
  .md-li { display: flex; gap: 7px; margin: 4px 0; }
  .md-bullet { width: 4px; height: 4px; border-radius: 50%; background: var(--acc); margin-top: 9px; flex: none; }
  .md-gap { height: 7px; }
  .md-ic {
    background: var(--bg3); border: 1px solid var(--line); border-radius: 5px;
    padding: 1px 5px; font: 11.5px Consolas, monospace; color: #9db4ff;
  }
  .md-cw { margin: 9px 0; border-radius: 9px; overflow: hidden; border: 1px solid var(--line); }
  .md-cbar { display: flex; align-items: center; justify-content: space-between; background: #12141b; padding: 5px 10px; border-bottom: 1px solid var(--line); }
  .md-lang { font: 600 10px inherit; color: var(--tx3); text-transform: uppercase; letter-spacing: .9px; }
  .md-copy { border: 1px solid var(--line2); background: transparent; color: var(--tx2); border-radius: 6px; font: 500 11px inherit; padding: 2px 10px; cursor: pointer; transition: color .15s, border-color .15s; }
  .md-copy:hover { color: #fff; border-color: var(--acc); }
  .md-pre { margin: 0; padding: 11px 12px; overflow-x: auto; background: #0b0d12; color: #d5dae6; font: 12px/1.65 Consolas, "JetBrains Mono", monospace; }

  /* 设置面板 */
  .cfg { display: none; flex-direction: column; gap: 4px; }
  .cfg.open { display: flex; }
  .cfg label { font: 600 11px inherit; color: var(--tx2); margin: 5px 0 2px; letter-spacing: .3px; }
  .cfg input {
    width: 100%; background: var(--bg); color: var(--tx); border: 1px solid var(--line);
    border-radius: 9px; padding: 8px 11px; font: 12.5px inherit; outline: none; transition: border-color .15s;
  }
  .cfg input:focus { border-color: var(--acc); }
  /* 复选框行：需覆盖上面 .cfg label 的标题样式 */
  .cfg label.chk {
    display: flex; align-items: center; gap: 8px; margin: 9px 0 2px;
    font: 500 12px inherit; color: var(--tx2); letter-spacing: 0; cursor: pointer; user-select: none;
  }
  .cfg label.chk input { width: 15px; height: 15px; flex: none; margin: 0; padding: 0; accent-color: var(--acc); cursor: pointer; }
  .cfg .tip { font-size: 11px; color: var(--tx3); line-height: 1.7; margin-top: 4px; }
  .cfg .tip code { color: #9db4ff; }
  .cfgst { font-size: 12px; padding: 8px 11px; border-radius: 9px; display: none; line-height: 1.6; word-break: break-all; }
  .cfgst.ok { display: block; background: rgba(52,211,153,.08); border: 1px solid rgba(52,211,153,.3); color: var(--ok); }
  .cfgst.err { display: block; background: rgba(248,113,113,.08); border: 1px solid rgba(248,113,113,.3); color: var(--err); }

  /* 折叠球 */
  .ball {
    position: fixed; width: 48px; height: 48px; border-radius: 50%;
    background: linear-gradient(160deg, #6b85ff, #4d6bfe); color: #fff;
    display: flex; align-items: center; justify-content: center;
    cursor: move; user-select: none;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.22), 0 8px 22px rgba(77,107,254,.45);
    transition: box-shadow .2s, transform .15s;
    animation: ballIn .3s cubic-bezier(.2,.9,.3,1.3);
  }
  .ball svg { width: 27px; height: 27px; display: block; }
  .ball:hover { transform: scale(1.06); box-shadow: inset 0 1px 0 rgba(255,255,255,.22), 0 10px 26px rgba(77,107,254,.6); }
  .ball.locked { background: linear-gradient(160deg, #b45309, #b3261e); box-shadow: 0 8px 22px rgba(179,38,30,.35); }
  @keyframes ballIn { from { opacity: 0; transform: scale(.5); } }

  .spin {
    display: inline-block; width: 14px; height: 14px; vertical-align: -2px; margin-right: 7px;
    border: 2px solid rgba(107,133,255,.25); border-top-color: var(--acc2); border-radius: 50%;
    animation: sp .7s linear infinite;
  }
  @keyframes sp { to { transform: rotate(360deg); } }
  `;

  const wrap = document.createElement('div');
  wrap.innerHTML = `
  <style>${CSS}</style>

  <div class="ball" style="display:none">${LOGO_SVG}</div>

  <div class="win" style="display:none">
    <div class="hd">
      <div class="logo">${LOGO_SVG}</div>
      <div class="name">刷题助手<small>LevOJ Practice Coach</small></div>
      <span class="st"></span>
      <button class="ib" data-act="cfg" title="AI 接口设置">⚙</button>
      <button class="ib" data-act="min" title="折叠">—</button>
    </div>
    <div class="bd">
      <div class="lockbar">🔒 检测到考试 / 比赛页面，助手已按约束自动禁用。</div>

      <div class="pcard" id="pcard">
        <div class="pt"><span style="color:var(--acc)">📄</span><span id="ptitle">未抓取题目</span><span class="chev">▶</span></div>
        <div class="pv" id="pview">进入题目页后自动抓取。</div>
      </div>

      <div class="acts">
        <button class="btn pri" data-act="ask">⚡ 一键出答案</button>
      </div>

      <div class="out" id="out"><div class="ph">就绪。进入题目页会自动出答案，也可点上方按钮重新生成。首次使用请先点右上角 ⚙ 配置 AI 接口。</div></div>

      <div class="cfg" id="cfg">
        <label>API Base URL（OpenAI 兼容）</label>
        <input id="i-base" placeholder="${DEFAULT_BASEURL}" />
        <label>API Key</label>
        <input id="i-key" type="password" placeholder="sk-..." />
        <label>模型</label>
        <input id="i-model" placeholder="${DEFAULT_MODEL}" />
        <label class="chk"><input type="checkbox" id="i-auto" /><span>进入题目页自动出答案</span></label>
        <div class="acts" style="margin-top:8px">
          <button class="btn" data-act="test">测试连接</button>
          <button class="btn pri" data-act="save">保存配置</button>
        </div>
        <div class="cfgst" id="cfgst"></div>
        <div class="tip">Key 仅保存在本机浏览器扩展存储中。可填 OpenAI 官方，或 DeepSeek（<code>https://api.deepseek.com/v1</code>）、通义、本地中转等任意 OpenAI 兼容网关。</div>
      </div>
    </div>
  </div>
  `;
  shadow.appendChild(wrap);

  const el = {
    ball: $('.ball', shadow),
    win: $('.win', shadow),
    hd: $('.hd', shadow),
    st: $('.st', shadow),
    pcard: $('#pcard', shadow),
    ptitle: $('#ptitle', shadow),
    pview: $('#pview', shadow),
    out: $('#out', shadow),
    cfg: $('#cfg', shadow),
    lockbar: $('.lockbar', shadow),
    iBase: $('#i-base', shadow),
    iKey: $('#i-key', shadow),
    iModel: $('#i-model', shadow),
    cfgst: $('#cfgst', shadow),
    iAuto: $('#i-auto', shadow),
  };

  /* ---- 状态 ---- */
  let busy = false;
  let isRestricted = false;
  let autoAnswer = true;   // 进入题目页后是否自动出答案
  let lastAutoId = null;   // 已自动出过答案的题号，避免重复请求烧 token

  function refreshRestricted() {
    isRestricted = RESTRICTED_RE.test(location.pathname + location.search);
    el.lockbar.style.display = isRestricted ? 'block' : 'none';
    el.ball.classList.toggle('locked', isRestricted);
    el.st.classList.toggle('off', isRestricted);
    el.ball.title = isRestricted ? '考试/比赛页面，助手已禁用' : 'AI 刷题助手';
  }

  function setOut(html) { el.out.innerHTML = html; }

  function setProbCard(p) {
    if (!p) {
      el.ptitle.textContent = '未抓取题目';
      el.pview.textContent = '进入题目页后自动抓取。';
      return;
    }
    el.ptitle.textContent = '#' + (p.id || '?') + ' ' + p.title;
    el.pview.textContent = p.content.slice(0, 1500) + (p.content.length > 1500 ? '\n……（已截断，分析时使用全文）' : '');
  }

  /* ---- 折叠 / 展开 ---- */
  function setCollapsed(v) {
    el.win.style.display = v ? 'none' : 'flex';
    el.ball.style.display = v ? 'flex' : 'none';
    try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0'); } catch (e) {}
  }
  el.ball.addEventListener('click', () => {
    if (dragMoved) return;
    if (isRestricted) { toast('考试/比赛页面，助手已禁用', true); return; }
    setCollapsed(false);
  });
  $('[data-act="min"]', shadow).addEventListener('click', () => setCollapsed(true));

  /* ---- 题目卡展开/收起 ---- */
  el.pcard.addEventListener('click', () => el.pcard.classList.toggle('open'));

  /* ---- 拖动 ---- */
  let dragMoved = false;
  function makeDraggable(handle, target, storeKey) {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      dragging = true; dragMoved = false;
      sx = e.clientX; sy = e.clientY;
      const r = target.getBoundingClientRect();
      ox = r.left; oy = r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
      const x = Math.min(Math.max(0, ox + dx), window.innerWidth - 40);
      const y = Math.min(Math.max(0, oy + dy), window.innerHeight - 40);
      target.style.left = x + 'px';
      target.style.top = y + 'px';
      target.style.right = 'auto';
      target.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      if (dragMoved) {
        const r = target.getBoundingClientRect();
        try { localStorage.setItem(storeKey, JSON.stringify({ x: r.left, y: r.top })); } catch (e) {}
      }
      setTimeout(() => { dragMoved = false; }, 50);
    });
  }
  function restorePos(target, storeKey, defX, defY) {
    let pos = null;
    try { pos = JSON.parse(localStorage.getItem(storeKey) || 'null'); } catch (e) {}
    const x = pos && pos.x != null ? pos.x : defX;
    const y = pos && pos.y != null ? pos.y : defY;
    target.style.left = Math.min(x, window.innerWidth - 60) + 'px';
    target.style.top = Math.min(y, window.innerHeight - 60) + 'px';
  }
  // 窗口与圆球各自独立记忆位置，避免折叠/展开时互相“带跑”
  restorePos(el.win, POS_KEY_WIN, window.innerWidth - 450, 70);
  restorePos(el.ball, POS_KEY_BALL, window.innerWidth - 84, 70);
  makeDraggable(el.hd, el.win, POS_KEY_WIN);
  makeDraggable(el.ball, el.ball, POS_KEY_BALL);
  setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1');

  /* ---- 设置面板 ---- */
  const cfgBtn = $('[data-act="cfg"]', shadow);
  cfgBtn.addEventListener('click', async () => {
    const open = el.cfg.classList.toggle('open');
    cfgBtn.classList.toggle('on', open);
    if (open) {
      const c = await chrome.storage.local.get(['laj_baseUrl', 'laj_apiKey', 'laj_model', AUTO_KEY]);
      el.iBase.value = c.laj_baseUrl || '';
      el.iKey.value = c.laj_apiKey || '';
      el.iModel.value = c.laj_model || '';
      el.iAuto.checked = c[AUTO_KEY] !== '0';
      el.cfgst.className = 'cfgst';
      el.cfgst.textContent = '';
    }
  });

  function cfgStatus(text, cls) {
    el.cfgst.className = 'cfgst ' + (cls || '');
    el.cfgst.innerHTML = text;
  }

  $('[data-act="save"]', shadow).addEventListener('click', async () => {
    const base = (el.iBase.value.trim() || DEFAULT_BASEURL).replace(/\/+$/, '');
    const key = el.iKey.value.trim();
    const model = el.iModel.value.trim() || DEFAULT_MODEL;
    if (!key) { cfgStatus('❌ 请填写 API Key', 'err'); return; }
    try { new URL(base); } catch (e) { cfgStatus('❌ Base URL 格式不正确', 'err'); return; }
    await chrome.storage.local.set({ laj_baseUrl: base, laj_apiKey: key, laj_model: model });
    cfgStatus('✅ 已保存：' + esc(base) + ' · ' + esc(model), 'ok');
  });

  // 自动出答案开关：勾选即存，无需再点「保存配置」
  el.iAuto.addEventListener('change', () => {
    autoAnswer = el.iAuto.checked;
    chrome.storage.local.set({ [AUTO_KEY]: autoAnswer ? '1' : '0' }).catch(() => {});
  });

  $('[data-act="test"]', shadow).addEventListener('click', async () => {
    $('[data-act="save"]', shadow).click();
    if (el.cfgst.classList.contains('err')) return;
    cfgStatus('<span class="spin"></span>测试连接中……', '');
    try {
      const r = await askAI([{ role: 'user', content: '回复"连接成功"四个字' }]);
      cfgStatus('✅ 连接成功！模型响应：' + esc(r.slice(0, 60)), 'ok');
    } catch (e) {
      cfgStatus('❌ ' + esc(e.message), 'err');
    }
  });

  /* ---- 动作 ---- */
  async function runAsk() {
    if (isRestricted) return toast('考试/比赛页面，已禁用', true);
    if (busy) return;
    if (!currentProblem) {
      // 注意：抓取是异步的，不能靠 click() 后同步读 currentProblem（旧版必失败）
      setOut('<span class="spin"></span>正在自动抓取题目……');
      try { await grabProblem(); } catch (e) { /* 交由下方统一提示 */ }
      if (!currentProblem) {
        setProbCard(null);
        setOut('<div class="ph">❌ 未抓取到题目。请确认当前在 /problem/{id} 题目详情页。</div>');
        return;
      }
      setProbCard(currentProblem);
    }
    busy = true;
    const askBtn = $('[data-act="ask"]', shadow);
    askBtn.disabled = true;
    setOut('<span class="spin"></span>AI 正在生成答案，请稍候……');
    try {
      const answer = await askAI(buildMessages());
      setOut(renderMD(answer));
    } catch (e) {
      setOut('❌ ' + esc(e.message));
    } finally {
      busy = false;
      askBtn.disabled = false;
    }
  }

  /* ---- 进入题目页自动出答案 ----
     同一题号只自动跑一次：SPA 每次路由变化都会触发，不设闸会反复请求把额度烧光。 */
  async function autoRun(id) {
    if (isRestricted || busy || lastAutoId === id) return;
    lastAutoId = id;
    const p = await grabProblem().catch(() => null);
    if (!p) return;
    setProbCard(p);
    el.pcard.classList.add('open');
    if (!autoAnswer) {
      setOut('✅ 已抓取 <b>' + esc(p.title) + '</b>。点「⚡ 一键出答案」生成代码。');
      return;
    }
    runAsk();
  }

  $('[data-act="ask"]', shadow).addEventListener('click', () => runAsk());

  /* ---- 代码复制 ---- */
  // navigator.clipboard 仅在安全上下文（https / localhost）可用；
  // LevOJ 多为 http://IP，此时 clipboard 为 undefined，必须走 execCommand 兜底。
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.documentElement.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      ok ? resolve() : reject(new Error('execCommand copy 被拒绝'));
    });
  }

  el.out.addEventListener('click', (e) => {
    const btn = e.target.closest('.md-copy');
    if (!btn) return;
    const pre = $('#' + btn.getAttribute('data-target'), shadow);
    if (!pre) return;
    copyText(pre.textContent).then(() => {
      btn.textContent = '已复制 ✓';
      setTimeout(() => { btn.textContent = '复制'; }, 1500);
    }).catch(() => toast('复制失败，请手动选中复制', true));
  });

  /* ---- SPA 路由监听 ---- */
  setInterval(() => {
    if (location.pathname !== currentPath) {
      currentPath = location.pathname;
      currentProblem = null;
      refreshRestricted();
      setProbCard(null);
      const id = parseProblemId(location.pathname);
      // 离开题目页时清掉「已自动出过答案」的标记，这样再回到同一题会重新出答案
      if (!id) lastAutoId = null;
      else if (!isRestricted) autoRun(id);
    }
  }, 500);

  /* ---- 启动 ---- */
  refreshRestricted();
  (async () => {
    try {
      const c = await chrome.storage.local.get(AUTO_KEY);
      autoAnswer = c[AUTO_KEY] !== '0'; // 默认开
    } catch (e) { /* 读不到就按默认 */ }
    el.iAuto.checked = autoAnswer;
    const id = parseProblemId(location.pathname);
    if (!isRestricted && id) autoRun(id);
  })();

  console.debug('[LAJ] LevOJ AI 助手（本地扩展版）已加载 v1.3.1');
})();
