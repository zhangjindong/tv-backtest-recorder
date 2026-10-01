/* 列定义与 TSV 生成 —— content script 与 popup 共用
 *
 * 改列顺序 / 增删列，改这里的 COLUMNS 即可。
 * 目标是让复制出去的列顺序与码哥 Excel 台账完全对齐，避免粘错列。
 */
(function (g) {
  'use strict';

  function absDiff(a, b) {
    if (typeof a !== 'number' || typeof b !== 'number') return '';
    return Number(Math.abs(a - b).toFixed(4));
  }

  var COLUMNS = [
    {
      key: 'createdAt',
      label: '时间',
      get: function (r) { return r.createdAt || ''; }
    },
    {
      key: 'symbol',
      label: '品种',
      get: function (r) { return r.symbol || ''; }
    },
    {
      key: 'timeframe',
      label: '周期',
      get: function (r) { return r.timeframe || ''; }
    },
    {
      key: 'direction',
      label: '方向',
      get: function (r) {
        if (r.direction === 'long') return '多';
        if (r.direction === 'short') return '空';
        return '';
      }
    },
    {
      key: 'entry',
      label: '开仓价',
      get: function (r) { return r.entry != null ? r.entry : ''; }
    },
    {
      key: 'stop',
      label: '止损价',
      get: function (r) { return r.stop != null ? r.stop : ''; }
    },
    {
      key: 'target',
      label: '止盈价',
      get: function (r) { return r.target != null ? r.target : ''; }
    },
    {
      key: 'risk',
      label: '风险',
      get: function (r) { return r.risk != null ? r.risk : absDiff(r.entry, r.stop); }
    },
    {
      key: 'reward',
      label: '回报',
      get: function (r) { return r.reward != null ? r.reward : absDiff(r.target, r.entry); }
    },
    {
      key: 'riskReward',
      label: '盈亏比',
      get: function (r) { return r.riskReward != null ? r.riskReward : ''; }
    },
    {
      key: 'shot',
      label: '截图',
      get: function (r) { return r.shot || ''; }
    },
    {
      key: 'note',
      label: '备注',
      get: function (r) { return r.note || ''; }
    }
  ];

  function cell(v) {
    return String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
  }

  function escHtml(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toTsv(records, opts) {
    opts = opts || {};
    var cols = opts.columns || COLUMNS;
    var lines = [];
    if (opts.header !== false) {
      lines.push(cols.map(function (c) { return c.label; }).join('\t'));
    }
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      lines.push(cols.map(function (c) { return cell(c.get(r)); }).join('\t'));
    }
    return lines.join('\r\n');
  }

  /* 富文本版：图片以 base64 内嵌在「截图」格里，粘到 Excel/WPS 会连图一起进来。
   * 实测（WPS 表格 12.1）：text/html 剪贴板 → 表格 12 列全落位 + 图片成为浮动图片。
   * images = { [recordId]: 'data:image/png;base64,...' }
   */
  function toHtmlTable(records, opts) {
    opts = opts || {};
    var cols = opts.columns || COLUMNS;
    var images = opts.images || {};
    var imgW = opts.imgWidth || 360;

    var out = ['<meta charset="utf-8">',
      '<table border="1" cellspacing="0" cellpadding="3" ',
      'style="border-collapse:collapse;font:12px &quot;Microsoft YaHei&quot;,sans-serif">'];

    if (opts.header !== false) {
      out.push('<tr>' + cols.map(function (c) {
        return '<th>' + escHtml(c.label) + '</th>';
      }).join('') + '</tr>');
    }

    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var tds = [];
      for (var j = 0; j < cols.length; j++) {
        var c = cols[j];
        var img = c.key === 'shot' ? images[r.id] : '';
        if (img && /^data:image\//.test(img)) {
          tds.push('<td><img src="' + img + '" width="' + imgW + '" alt="截图"></td>');
        } else {
          tds.push('<td>' + escHtml(cell(c.get(r))) + '</td>');
        }
      }
      out.push('<tr>' + tds.join('') + '</tr>');
    }

    out.push('</table>');
    return out.join('');
  }

  /* 人类可读的时间戳：2026-09-26 11:45:00 */
  function stamp(d) {
    d = d || new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /* 文件名安全的时间戳：20260926-114500 */
  function compactStamp(d) {
    d = d || new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  g.TVRC = g.TVRC || {};
  g.TVRC.COLUMNS = COLUMNS;
  g.TVRC.toTsv = toTsv;
  g.TVRC.toHtmlTable = toHtmlTable;
  g.TVRC.stamp = stamp;
  g.TVRC.compactStamp = compactStamp;
})(typeof window !== 'undefined' ? window : self);
