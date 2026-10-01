/* TV 回测记录器 · MAIN world 桥
 *
 * 运行在页面主世界，唯一职责：读 window.TradingViewApi，把仓位工具数据吐出来。
 * 与 ISOLATED world 的 content.js 通过 window.postMessage 通信。
 *
 * 注意：ISOLATED world 读不到 MAIN world 挂在 window 上的属性，
 * 所以不要试图用共享变量传 token，一律走 postMessage。
 */
(function () {
  'use strict';

  var CH = 'TVRC';
  var TAG = '[TVRC bridge]';

  function safe(fn, dflt) {
    try {
      var v = fn();
      return v === undefined ? dflt : v;
    } catch (e) {
      return dflt;
    }
  }

  /* ---------- 拿 widget / chart ---------- */

  function getWidget() {
    var cands = [
      window.TradingViewApi,
      window.tvWidget,
      window.TradingView && window.TradingView.widget
    ];
    for (var i = 0; i < cands.length; i++) {
      var w = cands[i];
      if (w && typeof w.activeChart === 'function') return w;
    }
    return null;
  }

  function getChart() {
    var w = getWidget();
    if (!w) return null;
    return safe(function () { return w.activeChart(); }, null);
  }

  /* ---------- 精度 ---------- */

  function getTick(chart) {
    var si = safe(function () {
      return chart.chartModel().mainSeries().symbolInfo();
    }, null);
    if (si && si.pricescale) {
      var minmov = si.minmov || 1;
      return minmov / si.pricescale;
    }
    return 0.01;
  }

  function decimalsFor(tick) {
    if (!tick || tick <= 0) return 2;
    var d = Math.ceil(-Math.log10(tick));
    return Math.max(0, Math.min(8, d));
  }

  function round(v, tick) {
    var d = decimalsFor(tick);
    return Number(Number(v).toFixed(d));
  }

  /* ---------- 可见性 ---------- */

  /* 画线被「隐藏」后仍留在 getAllShapes() 里，必须单独判定，否则会误列出来。
     ILineDataSourceApi 的官方方法表里没有 isVisible，所以按下面优先级多路兜底；
     哪一路命中会由 DIAG 报出来（via 字段）。 */
  function resolveVisible(chart, api, props, id) {
    /* 1) 属性树里的 visible —— line tool 通用属性 */
    if (props && typeof props.visible === 'boolean') {
      return { visible: props.visible, via: 'props.visible' };
    }
    /* 2) primitive 那套 getVisible / 某些版本的 isVisible */
    if (api) {
      var getter = (typeof api.getVisible === 'function' && api.getVisible) ||
                   (typeof api.isVisible === 'function' && api.isVisible);
      if (getter) {
        var v = safe(function () { return getter.call(api); }, undefined);
        if (typeof v === 'boolean') return { visible: v, via: 'api.getVisible' };
      }
    }
    /* 3) 老接口 chart.getEntityVisibility(id)（若该版本尚在） */
    if (chart && typeof chart.getEntityVisibility === 'function') {
      var v2 = safe(function () { return chart.getEntityVisibility(id); }, undefined);
      if (typeof v2 === 'boolean') return { visible: v2, via: 'chart.getEntityVisibility' };
    }
    return { visible: true, via: 'default' };
  }

  /* ---------- 读仓位工具 ---------- */

  var POS_RE = /^(long|short)_position$/i;

  function readPositions() {
    var chart = getChart();
    if (!chart) return { ok: false, error: 'chart api not found（图表可能还没加载完）' };

    var tick = getTick(chart);
    var shapes = safe(function () { return chart.getAllShapes() || []; }, []);
    var list = [];
    var hiddenCount = 0;

    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      if (!s || !POS_RE.test(String(s.name || ''))) continue;

      var api = safe(function () { return chart.getShapeById(s.id); }, null);
      if (!api) continue;

      var props = safe(function () { return api.getProperties(); }, {}) || {};

      /* 图上被「隐藏」的工具不该出现在面板里 */
      var vis = resolveVisible(chart, api, props, s.id);
      if (!vis.visible) {
        hiddenCount++;
        continue;
      }

      var pts = safe(function () { return api.getPoints(); }, []) || [];
      if (!pts.length || typeof pts[0].price !== 'number') continue;

      var entry = pts[0].price;
      var isLong = /^long/i.test(s.name);
      var stopLevel = Number(props.stopLevel) || 0;
      var profitLevel = Number(props.profitLevel) || 0;

      var stop = isLong ? entry - stopLevel * tick : entry + stopLevel * tick;
      var target = isLong ? entry + profitLevel * tick : entry - profitLevel * tick;

      /* 交叉校验：rawPoints 里若出现与算出止损相符的价格，说明公式可信 */
      var raw = safe(function () { return api.getRawPoints(); }, []) || [];
      var confirmed = false;
      for (var j = 0; j < raw.length; j++) {
        if (typeof raw[j].price === 'number' && Math.abs(raw[j].price - stop) < tick * 1.5) {
          confirmed = true;
          break;
        }
      }

      list.push({
        toolId: s.id,
        toolName: s.name,
        direction: isLong ? 'long' : 'short',
        entry: round(entry, tick),
        stop: round(stop, tick),
        target: round(target, tick),
        stopTicks: stopLevel,
        targetTicks: profitLevel,
        risk: round(Math.abs(entry - stop), tick),
        reward: round(Math.abs(target - entry), tick),
        riskReward: stopLevel > 0 ? Number((profitLevel / stopLevel).toFixed(2)) : null,
        tick: tick,
        verify: confirmed ? 'raw-confirmed' : 'formula-only',
        visibleVia: vis.via,
        tvAccountSize: props.accountSize != null ? props.accountSize : null,
        tvLotSize: props.lotSize != null ? props.lotSize : null,
        barTime: pts[0].time || null
      });
    }

    var meta = {
      symbol: safe(function () { return chart.symbol(); }, ''),
      symbolFull: safe(function () { return chart.symbolExt().full_name; }, ''),
      timeframe: String(safe(function () { return chart.resolution(); }, '')),
      chartType: safe(function () { return chart.chartType(); }, ''),
      pageUrl: location.href
    };

    return { ok: true, meta: meta, positions: list, tick: tick, hiddenCount: hiddenCount };
  }

  /* ---------- 诊断：一键把现场数据吐出来 ---------- */

  function diagnose() {
    var chart = getChart();
    if (!chart) return { ok: false, error: 'chart api not found' };

    var shapes = safe(function () { return chart.getAllShapes() || []; }, []);
    var items = [];

    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      var api = safe(function () { return chart.getShapeById(s.id); }, null);
      var props = api ? (safe(function () { return api.getProperties(); }, {}) || {}) : {};
      var keys = Object.keys(props);

      var visLike = {};
      for (var k = 0; k < keys.length; k++) {
        if (/vis|hide|show|frozen|lock|enable/i.test(keys[k])) visLike[keys[k]] = props[keys[k]];
      }

      var methods = [];
      if (api) {
        var walk = api;
        while (walk && methods.length < 80) {
          var n = Object.getOwnPropertyNames(walk);
          for (var m = 0; m < n.length; m++) {
            if (methods.indexOf(n[m]) < 0) methods.push(n[m]);
          }
          walk = Object.getPrototypeOf(walk);
          if (!walk || walk === Object.prototype) break;
        }
      }

      items.push({
        id: s.id,
        name: s.name,
        propKeys: keys,
        visLike: visLike,
        shapeMethods: methods.filter(function (x) { return /vis|hide|show/i.test(x); }),
        resolved: resolveVisible(chart, api, props, s.id),
        rawPointsLen: (safe(function () { return api.getRawPoints(); }, []) || []).length,
        pointsLen: (safe(function () { return api.getPoints(); }, []) || []).length
      });
    }

    return {
      ok: true,
      href: location.href,
      ua: navigator.userAgent,
      shapeCount: shapes.length,
      positionCount: items.filter(function (x) { return POS_RE.test(String(x.name)); }).length,
      items: items
    };
  }

  /* ---------- 消息处理 ---------- */

  function handle(type) {
    if (type === 'PING') return { ok: true, pong: true, href: location.href };
    if (type === 'READ') return readPositions();
    if (type === 'DIAG') return diagnose();
    return { ok: false, error: 'unknown type: ' + type };
  }

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__tvrc !== CH || d.kind !== 'REQ') return;

    var payload;
    try {
      payload = handle(d.type);
    } catch (e) {
      payload = { ok: false, error: String(e && e.message ? e.message : e) };
    }
    window.postMessage({ __tvrc: CH, kind: 'RES', reqId: d.reqId, payload: payload }, '*');
  });

  /* 告诉面板端：桥已就绪 */
  window.postMessage({ __tvrc: CH, kind: 'READY' }, '*');
  console.info(TAG + ' ready', location.href);
})();
