/* TV 回测记录器 · background service worker
 *
 * 职责：
 *   · 截图（captureVisibleTab）
 *   · 记录池（chrome.storage.local）
 *
 * 注：0.2.0 起不再把截图下载到本地 —— 图片直接内嵌进剪贴板跟着记录一起进表格。
 */

const KEY = 'records';
const MAX_RECORDS = 2000;

async function getRecords() {
  const o = await chrome.storage.local.get(KEY);
  return Array.isArray(o[KEY]) ? o[KEY] : [];
}

async function setRecords(list) {
  await chrome.storage.local.set({ [KEY]: list });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true; /* 异步响应 */
});

async function handle(msg, sender) {
  const type = msg && msg.type;

  switch (type) {
    case 'PING':
      return { ok: true, version: chrome.runtime.getManifest().version };

    case 'CAPTURE': {
      const windowId = sender && sender.tab ? sender.tab.windowId : null;
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      return { ok: true, dataUrl };
    }

    case 'ADD_RECORD': {
      const list = await getRecords();
      list.push(msg.record);
      if (list.length > MAX_RECORDS) list.splice(0, list.length - MAX_RECORDS);
      await setRecords(list);
      return { ok: true, total: list.length };
    }

    case 'ADD_RECORDS': {
      const list = await getRecords();
      const add = Array.isArray(msg.records) ? msg.records : [];
      for (const r of add) list.push(r);
      if (list.length > MAX_RECORDS) list.splice(0, list.length - MAX_RECORDS);
      await setRecords(list);
      return { ok: true, added: add.length, total: list.length };
    }

    case 'UPDATE_RECORD': {
      const list = await getRecords();
      const i = list.findIndex((r) => r.id === msg.id);
      if (i < 0) return { ok: false, error: '记录不存在' };
      list[i] = Object.assign({}, list[i], msg.patch || {});
      await setRecords(list);
      return { ok: true, record: list[i] };
    }

    case 'LIST_ALL': {
      return { ok: true, records: await getRecords() };
    }

    case 'LIST_PENDING': {
      const list = await getRecords();
      return { ok: true, records: list.filter((r) => !r.exported) };
    }

    case 'COUNT_PENDING': {
      const list = await getRecords();
      return { ok: true, count: list.filter((r) => !r.exported).length };
    }

    case 'MARK_EXPORTED': {
      const ids = new Set(msg.ids || []);
      const list = await getRecords();
      const now = new Date().toISOString();
      for (const r of list) {
        if (ids.has(r.id)) {
          r.exported = true;
          r.exportedAt = now;
        }
      }
      await setRecords(list);
      return { ok: true, total: list.length };
    }

    case 'DELETE_RECORDS': {
      const ids = new Set(msg.ids || []);
      const list = (await getRecords()).filter((r) => !ids.has(r.id));
      await setRecords(list);
      return { ok: true, total: list.length };
    }

    case 'CLEAR_EXPORTED': {
      const list = (await getRecords()).filter((r) => !r.exported);
      await setRecords(list);
      return { ok: true, total: list.length };
    }

    default:
      return { ok: false, error: 'unknown message: ' + type };
  }
}
