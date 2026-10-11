// LevOJ AI 助手 - 工具栏弹窗设置（与悬浮窗 ⚙ 面板读写同一份存储）
const $ = (id) => document.getElementById(id);
const DEFAULT_BASEURL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

function setStatus(text, cls) {
  const el = $('status');
  el.textContent = text;
  el.className = cls || '';
}

async function load() {
  const cfg = await chrome.storage.local.get(['laj_baseUrl', 'laj_apiKey', 'laj_model', 'laj_autoAnswer']);
  $('base').value = cfg.laj_baseUrl || '';
  $('key').value = cfg.laj_apiKey || '';
  $('model').value = cfg.laj_model || '';
  $('auto').checked = cfg.laj_autoAnswer !== '0'; // 默认开
}

// 开关即时生效，与悬浮窗 ⚙ 面板共用同一份存储
$('auto').addEventListener('change', () => {
  chrome.storage.local.set({ laj_autoAnswer: $('auto').checked ? '1' : '0' });
});

// 保存表单；silent=true 时不覆盖状态栏（供「测试连接」先落盘再测）
async function saveConfig(silent) {
  const base = ($('base').value.trim() || DEFAULT_BASEURL).replace(/\/+$/, '');
  const key = $('key').value.trim();
  const model = $('model').value.trim() || DEFAULT_MODEL;

  if (!key) { if (!silent) setStatus('❌ 请填写 API Key', 'err'); return false; }
  try { new URL(base); } catch (e) { if (!silent) setStatus('❌ Base URL 格式不正确', 'err'); return false; }

  await chrome.storage.local.set({ laj_baseUrl: base, laj_apiKey: key, laj_model: model });
  if (!silent) setStatus('✅ 已保存：' + base + ' · ' + model, 'ok');
  return true;
}

$('save').addEventListener('click', () => saveConfig(false));

$('test').addEventListener('click', async () => {
  setStatus('测试连接中……');
  // 关键：先把当前输入落盘，否则后台读到的还是旧配置
  if (!(await saveConfig(true))) { setStatus('❌ 请先填写 API Key 和合法的 Base URL', 'err'); return; }
  try {
    const res = await chrome.runtime.sendMessage({
      type: 'ai',
      messages: [{ role: 'user', content: '回复"连接成功"四个字' }],
    });
    if (!res) { setStatus('❌ 后台无响应：扩展可能刚重载，请关闭本弹窗重试', 'err'); return; }
    if (res.ok) setStatus('✅ ' + res.text.slice(0, 80), 'ok');
    else setStatus('❌ ' + res.error, 'err');
  } catch (e) {
    setStatus('❌ ' + e.message, 'err');
  }
});

load();
