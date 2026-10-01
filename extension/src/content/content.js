/* TV 回测记录器 · ISOLATED world 面板
 *
 * 职责：
 *   1. 注入悬浮面板（Shadow DOM 隔离样式），可拖拽，位置持久化
 *   2. 向 MAIN world 的桥请求仓位工具数据（已隐藏的工具不会出现）
 *   3. 单笔 / 批量复制：截图 → 图文一起进剪贴板，不落任何文件
 *
 * 复制状态（state.copied）只活在当前页面会话里，刷新即重置 —— 不做持久化。
 */
(function () {
  'use strict';

  if (window.__tvrcPanelMounted) return;
  window.__tvrcPanelMounted = true;

  var CH = 'TVRC';
  var HOST_ID = 'tvrc-panel-host';
  var C = window.TVRC || {};

  var hostEl = null;
  var shadow = null;

  var state = {
    meta: {},
    positions: [],
    error: null,
    hiddenCount: 0,
    bridgeReady: false,
    collapsed: false,
    busy: false,
    /* toolId -> 复制时刻。会话内存态，不落盘 */
    copied: Object.create(null)
  };

  /* ================= 跨 world 通信 ================= */

  var seq = 0;
  var waiting = new Map();

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__tvrc !== CH) return;

    /* postMessage 是广播的，自己发出去的 REQ 自己也会收到，
       所以必须靠 kind 区分请求(REQ)与响应(RES)，否则 Promise 会被 undefined 秒解。 */
    if (d.kind === 'READY') {
      state.bridgeReady = true;
      scheduleRefresh(200);
      return;
    }
    if (d.kind === 'RES' && d.reqId && waiting.has(d.reqId)) {
      var w = waiting.get(d.reqId);
      waiting.delete(d.reqId);
      clearTimeout(w.timer);
      w.resolve(d.payload);
    }
  });

  function ask(type, timeoutMs) {
    timeoutMs = timeoutMs || 6000;
    return new Promise(function (resolve) {
      var id = 'q' + (++seq);
      var timer = setTimeout(function () {
        waiting.delete(id);
        resolve({ ok: false, error: '读取超时' });
      }, timeoutMs);
      waiting.set(id, { resolve: resolve, timer: timer });
      window.postMessage({ __tvrc: CH, kind: 'REQ', type: type, reqId: id }, '*');
    });
  }

  function bg(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { ok: false, error: '空响应' });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    });
  }

  /* ================= 样式 ================= */

  var CSS = [
    ':host{all:initial}',
    '.wrap{font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;',
    'width:276px;background:#fff;border:1px solid rgba(0,0,0,.14);border-radius:10px;',
    'box-shadow:0 6px 24px rgba(0,0,0,.18);color:#1f2328;overflow:hidden}',
    '.hd{display:flex;align-items:center;gap:6px;padding:7px 10px;background:#f6f8fa;',
    'border-bottom:1px solid rgba(0,0,0,.08);cursor:move;user-select:none;touch-action:none}',
    '.ttl{flex:1;font-size:12px;font-weight:600;letter-spacing:.2px}',
    '.dot{width:6px;height:6px;border-radius:50%;background:#c9ced6;cursor:pointer;flex:0 0 auto}',
    '.dot.on{background:#2da44e}',
    '.dot.err{background:#d1242f}',
    '.ib{width:20px;height:20px;line-height:18px;text-align:center;border:1px solid rgba(0,0,0,.14);',
    'background:#fff;border-radius:5px;cursor:pointer;font-size:12px;color:#57606a;padding:0}',
    '.ib:hover{background:#eef1f4}',
    '.bd{padding:8px 10px;max-height:340px;overflow-y:auto}',
    '.meta{font-size:11px;color:#57606a;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.hided{font-size:10.5px;color:#bf8700;margin-bottom:6px}',
    '.hint{padding:14px 4px;text-align:center;color:#8b949e;font-size:11px;line-height:1.7}',
    '.item{border:1px solid #e3e6ea;border-radius:8px;padding:8px;margin-bottom:7px;background:#fcfcfd}',
    '.item:last-child{margin-bottom:0}',
    '.item.done{border-color:#a9dcb9;background:#f5fdf8}',
    '.r1{display:flex;align-items:center;gap:6px;margin-bottom:5px}',
    '.tag{font-size:10px;font-weight:600;color:#fff;border-radius:3px;padding:1px 5px}',
    '.tag.long{background:#d1242f}',
    '.tag.short{background:#1a7f37}',
    '.r1 .sym{font-size:11px;color:#57606a}',
    '.ok{margin-left:auto;font-size:10px;font-weight:600;color:#1a7f37;white-space:nowrap}',
    '.px{display:grid;grid-template-columns:auto 1fr;gap:1px 6px;font-size:11px;margin-bottom:5px}',
    '.px .k{color:#8b949e}',
    '.px .v{font-family:ui-monospace,Consolas,monospace;color:#1f2328;font-weight:600}',
    '.px .v.stop{color:#d1242f}',
    '.px .v.target{color:#1a7f37}',
    '.r3{display:flex;align-items:center;justify-content:space-between;gap:6px}',
    '.rr{font-size:10px;color:#8b949e}',
    '.cf{font-size:10px;color:#1a7f37}',
    '.cf.warn{color:#bf8700}',
    '.cp{margin-top:7px;width:100%;border:1px solid #1f6feb;background:#1f6feb;color:#fff;',
    'border-radius:6px;padding:5px 0;font-size:11.5px;font-weight:500;cursor:pointer}',
    '.cp:hover{background:#1a63d4}',
    '.cp:disabled{opacity:.6;cursor:default}',
    '.cp.again{background:#fff;color:#1f6feb}',
    '.cp.again:hover{background:#eef4ff}',
    '.ft{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:7px 10px;border-top:1px solid rgba(0,0,0,.08);background:#f6f8fa}',
    '.ft .cnt{flex:1 1 auto;font-size:11px;color:#57606a}',
    '.fb{flex:0 0 auto;border:1px solid rgba(0,0,0,.15);background:#fff;border-radius:6px;padding:4px 9px;',
    'font-size:11px;cursor:pointer;color:#1f2328;white-space:nowrap}',
    '.fb:hover{background:#eef1f4}',
    '.fb:disabled{opacity:.5;cursor:default}',
    '.fb.wide{flex:1 1 100%;border-color:#1f6feb;color:#1f6feb;font-weight:500}',
    '.fb.wide:hover{background:#eef4ff}',
    '.fb.wide:disabled{color:#8b949e;border-color:rgba(0,0,0,.15)}'
  ].join('');

  /* ================= 位置与拖拽 ================= */

  function clampPos(left, top) {
    var w = 276;
    var h = 44;
    if (hostEl) {
      var r = hostEl.getBoundingClientRect();
      if (r.width) w = r.width;
      if (r.height) h = Math.min(r.height, window.innerHeight);
    }
    return {
      left: Math.max(0, Math.min(Math.max(0, window.innerWidth - w), left)),
      top: Math.max(0, Math.min(Math.max(0, window.innerHeight - 40), top))
    };
  }

  function applyPos(p) {
    if (!hostEl) return;
    hostEl.style.left = p.left + 'px';
    hostEl.style.top = p.top + 'px';
  }

  function savePos() {
    if (!hostEl) return;
    var r = hostEl.getBoundingClientRect();
    try {
      chrome.storage.local.set({ panelPos: { left: Math.round(r.left), top: Math.round(r.top) } });
    } catch (e) { /* ignore */ }
  }

  var suppressClickUntil = 0;

  function makeDraggable() {
    var hd = shadow.querySelector('.hd');
    var dragging = false;
    var ox = 0;
    var oy = 0;

    hd.title = '按住拖动';

    hd.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      if (ev.target && ev.target.closest && ev.target.closest('button')) return;

      var r = hostEl.getBoundingClientRect();
      ox = ev.clientX - r.left;
      oy = ev.clientY - r.top;
      dragging = true;
      suppressClickUntil = Date.now() + 500;

      try { hd.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      ev.preventDefault();
      ev.stopPropagation();
    });

    hd.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      var p = clampPos(ev.clientX - ox, ev.clientY - oy);
      applyPos(p);
      ev.preventDefault();
    });

    function end(ev) {
      if (!dragging) return;
      dragging = false;
      suppressClickUntil = Date.now() + 500;
      try { hd.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      savePos();
    }
    hd.addEventListener('pointerup', end);
    hd.addEventListener('pointercancel', end);

    window.addEventListener('resize', function () {
      if (!hostEl) return;
      var r = hostEl.getBoundingClientRect();
      applyPos(clampPos(r.left, r.top));
    });
  }

  /* ================= 面板挂载 ================= */

  function mount() {
    hostEl = document.createElement('div');
    hostEl.id = HOST_ID;
    hostEl.style.cssText = 'position:fixed;z-index:2147483646;left:-9999px;top:76px;';
    (document.documentElement || document.body).appendChild(hostEl);

    shadow = hostEl.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' + CSS + '</style>' +
      '<div class="wrap">' +
      '  <div class="hd">' +
      '    <span class="dot" id="dot" title="点击复制诊断信息"></span>' +
      '    <span class="ttl">TV 回测记录器</span>' +
      '    <button class="ib" id="btnRefresh" title="重新读取">&#8635;</button>' +
      '    <button class="ib" id="btnCollapse" title="收起">&#8722;</button>' +
      '  </div>' +
      '  <div class="bd" id="body"></div>' +
      '  <div class="ft">' +
      '    <span class="cnt" id="cnt">—</span>' +
      '    <button class="fb" id="btnCopyAll">复制全部（含截图）</button>' +
      '    <button class="fb wide" id="btnXlsx" title="下载一个 xlsx：截图直接嵌进单元格（WPS 的 DISPIMG），所有格子水平+垂直居中">导出 Excel（图片嵌入单元格）</button>' +
      '  </div>' +
      '</div>';

    shadow.getElementById('btnRefresh').addEventListener('click', function () { refresh(true); });
    shadow.getElementById('btnCollapse').addEventListener('click', toggleCollapse);
    shadow.getElementById('btnCopyAll').addEventListener('click', copyAll);
    shadow.getElementById('btnXlsx').addEventListener('click', exportXlsx);
    shadow.getElementById('dot').addEventListener('click', runDiag);

    shadow.getElementById('body').addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('button[data-tool]') : null;
      if (!btn) return;
      var pos = findPos(btn.getAttribute('data-tool'));
      if (pos) copyOne(pos, btn);
    });

    /* 默认挂在图表右上角，随后若用户拖过就恢复上次的位置 */
    var dflt = clampPos(window.innerWidth - 276 - 80, 76);
    applyPos(dflt);
    try {
      chrome.storage.local.get('panelPos', function (o) {
        var p = o && o.panelPos;
        if (p && typeof p.left === 'number' && typeof p.top === 'number') {
          applyPos(clampPos(p.left, p.top));
        }
      });
    } catch (e) { /* ignore */ }

    makeDraggable();
    refresh(false);
  }

  function toggleCollapse() {
    state.collapsed = !state.collapsed;
    var bd = shadow.getElementById('body');
    var ft = shadow.querySelector('.ft');
    bd.style.display = state.collapsed ? 'none' : '';
    ft.style.display = state.collapsed ? 'none' : '';
    shadow.getElementById('btnCollapse').innerHTML = state.collapsed ? '&#43;' : '&#8722;';
    savePos();
  }

  /* ================= 渲染 ================= */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render() {
    if (!shadow) return;

    var dot = shadow.getElementById('dot');
    dot.className = 'dot' + (state.error ? ' err' : (state.positions.length ? ' on' : ''));

    var body = shadow.getElementById('body');
    var m = state.meta || {};

    /* 有些品种的 symbol() 与 symbolExt().full_name 完全相同（如 COMEX_MINI_DL:MGC1!），
     * 直接拼会重复显示，这里做一次去重。 */
    var fullName = (m.symbolFull && m.symbolFull !== m.symbol) ? m.symbolFull : '';

    var head = m.symbol
      ? '<div class="meta">' + esc(m.symbol) + ' · ' + esc(m.timeframe) + (fullName ? ' · ' + esc(fullName) : '') + '</div>'
      : '';

    if (state.hiddenCount) {
      head += '<div class="hided">已忽略 ' + state.hiddenCount + ' 个图上隐藏的工具</div>';
    }

    if (state.error) {
      body.innerHTML = head + '<div class="hint">' + esc(state.error) + '<br>点右上角 &#8635; 重试</div>';
      updateCounter();
      return;
    }

    if (!state.positions.length) {
      body.innerHTML = head +
        '<div class="hint">未检测到仓位工具<br><span style="font-size:10.5px">在图上画一个 Long/Short Position，然后点 &#8635;</span></div>';
      updateCounter();
      return;
    }

    var html = head;
    for (var i = 0; i < state.positions.length; i++) {
      var p = state.positions[i];
      var isLong = p.direction === 'long';
      var done = !!state.copied[p.toolId];
      html +=
        '<div class="item' + (done ? ' done' : '') + '">' +
        '  <div class="r1">' +
        '    <span class="tag ' + (isLong ? 'long' : 'short') + '">' + (isLong ? '多' : '空') + '</span>' +
        '    <span class="sym">' + esc(m.symbol || '') + ' ' + esc(m.timeframe || '') + '</span>' +
        (done ? '<span class="ok">&#10003; 已复制</span>' : '') +
        '  </div>' +
        '  <div class="px">' +
        '    <span class="k">开仓</span><span class="v">' + p.entry + '</span>' +
        '    <span class="k">止损</span><span class="v stop">' + p.stop + '</span>' +
        '    <span class="k">止盈</span><span class="v target">' + p.target + '</span>' +
        '  </div>' +
        '  <div class="r3">' +
        '    <span class="rr">风险 ' + p.risk + ' · 回报 ' + p.reward + ' · 盈亏比 ' + (p.riskReward == null ? '—' : p.riskReward) + '</span>' +
        '    <span class="cf' + (p.verify === 'raw-confirmed' ? '' : ' warn') + '">' + (p.verify === 'raw-confirmed' ? '✓ 已校验' : '仅公式') + '</span>' +
        '  </div>' +
        '  <button class="cp' + (done ? ' again' : '') + '" data-tool="' + esc(p.toolId) + '">' +
        (done ? '再复制一次' : '复制这一笔（含截图）') +
        '</button>' +
        '</div>';
    }
    body.innerHTML = html;
    updateCounter();
  }

  function doneCount() {
    var n = 0;
    for (var i = 0; i < state.positions.length; i++) {
      if (state.copied[state.positions[i].toolId]) n++;
    }
    return n;
  }

  function updateCounter() {
    if (!shadow) return;
    var el = shadow.getElementById('cnt');
    var btn = shadow.getElementById('btnCopyAll');
    if (!el || !btn) return;

    var total = state.positions.length;
    var done = doneCount();

    if (!total) {
      el.textContent = '—';
    } else if (done >= total) {
      el.textContent = '已全部复制 ' + total + ' 笔';
    } else if (done) {
      el.textContent = '已复制 ' + done + ' / ' + total + ' 笔';
    } else {
      el.textContent = total + ' 笔待复制';
    }
    btn.disabled = state.busy || !total;
  }

  var flashTimer = null;
  function flash(text) {
    var el = shadow.getElementById('cnt');
    if (!el) return;
    el.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(updateCounter, 2600);
  }

  /* ================= 刷新 ================= */

  var refreshTimer = null;
  function scheduleRefresh(delay) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      if (state.busy) return; /* 截图/复制期间不要重渲染，否则按钮状态会被冲掉 */
      refresh(false);
    }, delay || 300);
  }

  function refresh(showBusy) {
    if (showBusy) shadow.getElementById('btnRefresh').textContent = '…';
    return ask('READ').then(function (res) {
      if (res && res.ok) {
        state.meta = res.meta || {};
        state.positions = res.positions || [];
        state.hiddenCount = res.hiddenCount || 0;
        state.error = null;
      } else {
        state.positions = [];
        state.hiddenCount = 0;
        state.error = (res && res.error) || '读取失败';
      }
      if (showBusy) shadow.getElementById('btnRefresh').innerHTML = '&#8635;';
      render();
    });
  }

  function findPos(toolId) {
    for (var i = 0; i < state.positions.length; i++) {
      if (state.positions[i].toolId === toolId) return state.positions[i];
    }
    return null;
  }

  /* ================= 截图 =================
     全屏截（整页可见区域），不裁剪、不缩放 —— 复盘时信息越全越有用：
     顶栏的品种/周期、右侧报价、时间轴、远处的 K 线都留着。

     踩过的两个坑，都别再走：
       · 裁剪成「主图」：复盘时反而丢了上下文，且 TradingView 一改版就取错区域。
       · 缩小后塞剪贴板：PNG 是负收益 —— 图表是大片纯色 + 细线，压缩率本来就高
         （1124×796 约 64KB）；缩到 480 宽后抗锯齿产生灰阶渐变，反而涨到 71KB。
     截图前必须先藏面板，否则它会被拍进图里。 */

  function buildRecord(pos) {
    var now = new Date();
    return {
      id: C.compactStamp(now) + '-' + Math.random().toString(36).slice(2, 6),
      createdAt: C.stamp(now),
      symbol: state.meta.symbol || '',
      symbolFull: state.meta.symbolFull || '',
      timeframe: state.meta.timeframe || '',
      chartType: state.meta.chartType || '',
      direction: pos.direction,
      entry: pos.entry,
      stop: pos.stop,
      target: pos.target,
      stopTicks: pos.stopTicks,
      targetTicks: pos.targetTicks,
      risk: pos.risk,
      reward: pos.reward,
      riskReward: pos.riskReward,
      toolId: pos.toolId,
      verify: pos.verify,
      barTime: pos.barTime,
      shot: '',
      note: '',
      exported: true,
      exportedAt: C.stamp(now)
    };
  }

  /* ================= 剪贴板 ================= */

  function writeClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () {
        return legacyCopy(text);
      });
    }
    return Promise.resolve(legacyCopy(text));
  }

  /* 纯文本 + HTML 一起放：Excel/WPS 优先吃 HTML → 表格 + 内嵌截图一次进来；
     记事本之类只认 text/plain 的地方则拿到干净的 TSV。 */
  function writeClipboardRich(text, html) {
    var plainOnly = function () {
      return writeClipboard(text).then(function (ok) { return { ok: ok, withImage: false }; });
    };

    if (!html || typeof ClipboardItem === 'undefined' ||
        !navigator.clipboard || !navigator.clipboard.write) {
      return plainOnly();
    }

    var data = {};
    try {
      data['text/plain'] = new Blob([text], { type: 'text/plain' });
      data['text/html'] = new Blob([html], { type: 'text/html' });
      return navigator.clipboard.write([new ClipboardItem(data)]).then(
        function () { return { ok: true, withImage: true }; },
        function () { return plainOnly(); }
      );
    } catch (e) {
      return plainOnly();
    }
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-2000px;left:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  /* ================= 主流程 ================= */

  function setBtn(btn, text, disabled) {
    btn.textContent = text;
    btn.disabled = !!disabled;
  }

  function delay(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function hidePanel() { if (hostEl) hostEl.style.visibility = 'hidden'; }
  function showPanel() { if (hostEl) hostEl.style.visibility = ''; }

  /* 截图：先藏面板（否则会被拍进去），再截整个可见页面，不做裁剪 */
  function grabChartShot() {
    hidePanel();
    var shot = '';
    return delay(280)
      .then(function () { return bg({ type: 'CAPTURE' }); })
      .then(function (res) {
        showPanel();
        if (!res || !res.ok || !res.dataUrl) return null;
        shot = res.dataUrl;
      })
      .catch(function () { showPanel(); })
      .then(function () { return shot; });
  }

  function markCopied(positions) {
    var now = C.stamp(new Date());
    for (var i = 0; i < positions.length; i++) {
      state.copied[positions[i].toolId] = now;
    }
  }

  function copyOne(pos, btn) {
    if (state.busy) return;
    state.busy = true;
    setBtn(btn, '截图中…', true);

    grabChartShot()
      .then(function (shot) {
        var rec = buildRecord(pos);
        return bg({ type: 'ADD_RECORD', record: rec }).then(function () {
          var text = C.toTsv([rec], { header: false });
          var html = '';
          if (shot && C.toHtmlTable) {
            var images = {};
            images[rec.id] = shot;
            html = C.toHtmlTable([rec], { header: false, images: images });
          }
          return writeClipboardRich(text, html);
        });
      })
      .then(function (r) {
        if (!r || !r.ok) {
          setBtn(btn, '复制失败，点我再试', false);
          setTimeout(function () { setBtn(btn, '复制这一笔（含截图）', false); }, 2400);
          return;
        }
        markCopied([pos]);
        render();
        flash(r.withImage ? '已复制 ✓ 含截图 → 去表格 Ctrl+V' : '已复制文字（截图未带上）');
      })
      .catch(function (e) {
        setBtn(btn, '出错：' + (e && e.message ? e.message : e), false);
      })
      .then(function () {
        showPanel();
        state.busy = false;
        updateCounter();
      });
  }

  function copyAll() {
    if (state.busy) return;

    var positions = state.positions.slice();
    var btn = shadow.getElementById('btnCopyAll');

    if (!positions.length) {
      flash('没有可复制的仓位工具');
      return;
    }

    state.busy = true;
    btn.disabled = true;
    btn.textContent = '截图中…';

    grabChartShot()
      .then(function (shot) {
        /* 多笔共用同一张图：同屏画的几个仓位，本来就该是同一张画面 */
        var recs = positions.map(buildRecord);
        return bg({ type: 'ADD_RECORDS', records: recs }).then(function () {
          var text = C.toTsv(recs, { header: false });
          var html = '';
          if (shot && C.toHtmlTable) {
            var images = {};
            for (var i = 0; i < recs.length; i++) images[recs[i].id] = shot;
            html = C.toHtmlTable(recs, { header: false, images: images, imgWidth: 300 });
          }
          return writeClipboardRich(text, html);
        });
      })
      .then(function (r) {
        btn.disabled = false;
        btn.textContent = '复制全部（含截图）';
        if (!r || !r.ok) {
          flash('复制失败，再点一次');
          return;
        }
        markCopied(positions);
        render();
        flash(r.withImage
          ? '已复制 ' + positions.length + ' 笔（含截图）→ Ctrl+V'
          : '已复制 ' + positions.length + ' 笔文字（截图未带上）');
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = '复制全部（含截图）';
        flash('出错：' + (e && e.message ? e.message : e));
      })
      .then(function () {
        showPanel();
        state.busy = false;
        updateCounter();
      });
  }

  /* ================= 导出 xlsx（图片嵌入单元格） =================
     跟「复制」不同：这里生成一个真正的 .xlsx 文件。

     为什么非落文件不可：WPS / Excel 的「嵌入单元格图片」是私有结构
     （DISPIMG 公式 + xl/cellimages.xml），剪贴板粘贴只能得到浮动图片，
     这条路绕不过去。格式细节见 src/shared/xlsx.js 头部注释。 */

  function numOrEmpty(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : '';
  }

  function posToRecord(pos, when) {
    return {
      id: pos.toolId,
      time: when,
      symbol: state.meta.symbol || '',
      tf: state.meta.timeframe || '',
      dir: pos.direction === 'long' ? '多' : (pos.direction === 'short' ? '空' : ''),
      entry: numOrEmpty(pos.entry),
      stop: numOrEmpty(pos.stop),
      target: numOrEmpty(pos.target),
      risk: numOrEmpty(pos.risk),
      reward: numOrEmpty(pos.reward),
      rr: numOrEmpty(pos.riskReward),
      shot: '',
      note: '',
      pnl: '',
      win: ''
    };
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    }, 5000);
  }

  function exportXlsx() {
    if (state.busy) return;

    var positions = state.positions.slice();
    var btn = shadow.getElementById('btnXlsx');

    if (!positions.length) {
      flash('没有可导出的仓位工具');
      return;
    }
    if (!C.XLSX || !C.XLSX.build) {
      flash('xlsx 模块没加载，重新加载扩展试试');
      return;
    }

    state.busy = true;
    btn.disabled = true;
    btn.textContent = '截图中…';

    grabChartShot()
      .then(function (shot) {
        var now = new Date();
        var records = positions.map(function (p) { return posToRecord(p, now); });
        var images = {};
        if (shot) {
          for (var i = 0; i < records.length; i++) images[records[i].id] = shot;
        }
        var built = C.XLSX.build(records, images);
        downloadBlob(new Blob([built.bytes], { type: built.mime }),
          'TV回测_' + C.compactStamp(now) + '.xlsx');
        return built;
      })
      .then(function (built) {
        btn.disabled = false;
        btn.textContent = '导出 Excel（图片嵌入单元格）';
        flash(built.imgCount
          ? '已导出 ' + built.imgCount + ' 张嵌入图 → 看下载文件夹'
          : '已导出（这批没截到图）');
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = '导出 Excel（图片嵌入单元格）';
        flash('导出失败：' + (e && e.message ? e.message : e));
      })
      .then(function () {
        showPanel();
        state.busy = false;
        updateCounter();
      });
  }

  /* ================= 诊断 ================= */

  function runDiag() {
    flash('读取诊断…');
    ask('DIAG', 9000).then(function (res) {
      var txt = JSON.stringify(res, null, 1);
      try { console.log('[TVRC] 诊断', res); } catch (e) { /* ignore */ }
      writeClipboard(txt).then(function (ok) {
        flash(ok ? '诊断已复制 → 发给小B' : '诊断已打到控制台 F12');
      });
    });
  }

  /* ================= 启动 ================= */

  function boot() {
    if (!document.body) {
      setTimeout(boot, 300);
      return;
    }
    mount();

    /* 点击图表后（可能换了选中的工具）自动刷新一次；拖拽面板时不触发 */
    document.addEventListener('click', function () {
      if (Date.now() < suppressClickUntil) return;
      scheduleRefresh(200);
    }, true);

    /* 兜底轮询：TradingView 是 canvas，DOM 变化观察不到 */
    setInterval(function () {
      if (!state.busy) refresh(false);
    }, 4000);
  }

  boot();
})();
