/* TV 回测记录器 · popup */
(function () {
  'use strict';

  var C = window.TVRC || {};
  var records = [];

  function bg(msg) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(msg, function (res) {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(res || { ok: false, error: '空响应' });
        }
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function copyText(text) {
    return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
  }

  function render() {
    var list = document.getElementById('list');
    var n = records.length;

    document.getElementById('summary').textContent =
      n ? ('共 ' + n + ' 笔') : '还没有记录';
    document.getElementById('btnCopyPending').disabled = !n;
    document.getElementById('btnClearExported').disabled = !n;

    if (!records.length) {
      list.innerHTML = '<div class="empty">还没有记录。<br>去 TradingView 图上点「复制这一笔」。</div>';
      return;
    }

    var html = '';
    for (var i = records.length - 1; i >= 0; i--) {
      var r = records[i];
      var isLong = r.direction === 'long';
      html +=
        '<div class="row" data-id="' + esc(r.id) + '">' +
        '  <span class="t">' + esc(r.createdAt || '') + '</span>' +
        '  <span class="sym">' + esc(r.symbol || '') + ' ' + esc(r.timeframe || '') + '</span>' +
        '  <span class="dir ' + (isLong ? 'long' : 'short') + '">' + (isLong ? '多' : '空') + '</span>' +
        '  <span class="px">' + r.entry + ' / ' + r.stop + ' / ' + r.target + '</span>' +
        '  <span class="st done">已复制</span>' +
        '  <button class="mini" data-act="copy">复制</button>' +
        '  <button class="mini" data-act="del">删</button>' +
        '</div>';
    }
    list.innerHTML = html;
  }

  function load() {
    return bg({ type: 'LIST_ALL' }).then(function (res) {
      records = (res && res.records) || [];
      render();
    });
  }

  document.getElementById('list').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    var row = btn.closest('.row');
    var id = row && row.getAttribute('data-id');
    var act = btn.getAttribute('data-act');
    var rec = null;
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === id) { rec = records[i]; break; }
    }
    if (!rec) return;

    if (act === 'copy') {
      copyText(C.toTsv([rec], { header: false })).then(function (ok) {
        btn.textContent = ok ? '✓' : '✗';
        setTimeout(function () { btn.textContent = '复制'; }, 1200);
      });
    } else if (act === 'del') {
      bg({ type: 'DELETE_RECORDS', ids: [id] }).then(load);
    }
  });

  document.getElementById('btnCopyPending').addEventListener('click', function () {
    if (!records.length) return;
    var btn = this;
    var all = records.slice();
    copyText(C.toTsv(all, { header: false })).then(function (ok) {
      btn.textContent = ok ? ('已复制 ' + all.length + ' 笔 ✓') : '复制失败';
      setTimeout(function () { btn.textContent = '复制全部记录'; }, 1600);
    });
  });

  document.getElementById('btnClearExported').addEventListener('click', function () {
    if (!records.length) return;
    if (!confirm('清空全部记录？（只清这个台账，图表上的画线工具不受影响）')) return;
    bg({ type: 'CLEAR_EXPORTED' }).then(load);
  });

  load();
})();
