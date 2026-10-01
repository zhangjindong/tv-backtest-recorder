/* TV 回测记录器 · xlsx 生成器
 *
 * 纯手写 zip（STORE，无压缩）+ OOXML，零外部依赖。
 *
 * 核心难点是 WPS 的「嵌入单元格图片」，它不是普通浮动图，而是：
 *   1) 单元格里写公式  =DISPIMG("ID_xxx",1)
 *      XML 里必须长这样（t="str" + <v> 放带等号的公式文本）：
 *      <c r="K2" s="2" t="str">
 *        <f xml:space="preserve">_xlfn.DISPIMG(&quot;ID_xxx&quot;,1)</f>
 *        <v>=DISPIMG(&quot;ID_xxx&quot;,1)</v>
 *      </c>
 *   2) xl/cellimages.xml 里登记图片，且 xdr:cNvPr/@name 必须 == 公式里的 ID
 *   3) xl/_rels/workbook.xml.rels 里用 WPS 私有关系类型指向 cellimages.xml
 *   4) [Content_Types].xml 里声明 application/vnd.wps-officedocument.cellimage+xml
 *
 * 以上格式是从一份 WPS 自己生成的文件里实测反推的，缺一不可。
 * 所有单元格统一「水平居中 + 垂直居中」。
 */
(function (g) {
  'use strict';

  /* ================= CRC32 ================= */

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ================= 工具 ================= */

  var TEXT_ENC = new TextEncoder();

  function utf8(s) { return TEXT_ENC.encode(s); }

  function concat(list) {
    var n = 0, i;
    for (i = 0; i < list.length; i++) n += list[i].length;
    var out = new Uint8Array(n);
    var pos = 0;
    for (i = 0; i < list.length; i++) {
      out.set(list[i], pos);
      pos += list[i].length;
    }
    return out;
  }

  function dataUrlToBytes(dataUrl) {
    var s = String(dataUrl || '');
    var comma = s.indexOf(',');
    if (comma < 0) return null;
    var meta = s.slice(0, comma);
    var body = s.slice(comma + 1);
    if (/;base64/i.test(meta)) {
      var bin = atob(body);
      var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return arr;
    }
    return null;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function colLetter(n) {
    var s = '';
    while (n > 0) {
      var r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  /* WPS 的图片 ID 是 "ID_" + 32 位大写十六进制 */
  function hex32() {
    var s = '';
    for (var i = 0; i < 4; i++) {
      s += ('00000000' + Math.floor(Math.random() * 0x100000000).toString(16))
        .slice(-8);
    }
    return s.toUpperCase();
  }

  function newImageId() { return 'ID_' + hex32(); }

  /* Excel 日期序列值：把本地时间当 UTC 处理，避免时区偏移 */
  function excelSerial(d) {
    var ms = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(),
      d.getHours(), d.getMinutes(), d.getSeconds());
    return ms / 86400000 + 25569;
  }

  /* ================= zip（STORE） ================= */

  function makeZip(files) {
    var chunks = [];
    var central = [];
    var offset = 0;
    var now = new Date();
    var dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) |
      (now.getSeconds() >> 1)) & 0xFFFF;
    var dosDate = (((now.getFullYear() - 1980) << 9) |
      ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var nameBytes = utf8(f.name);
      var data = f.data;
      var crc = crc32(data);
      var size = data.length;

      var lh = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, dosTime, true);
      dv.setUint16(12, dosDate, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      chunks.push(lh, data);

      var ch = new Uint8Array(46 + nameBytes.length);
      var cd = new DataView(ch.buffer);
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, size, true);
      cd.setUint32(24, size, true);
      cd.setUint16(28, nameBytes.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);

      offset += lh.length + size;
    }

    var cdSize = 0;
    for (var j = 0; j < central.length; j++) cdSize += central[j].length;

    var eocd = new Uint8Array(22);
    var e = new DataView(eocd.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(4, 0, true);
    e.setUint16(6, 0, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true);
    e.setUint32(16, offset, true);
    e.setUint16(20, 0, true);

    return concat(chunks.concat(central).concat([eocd]));
  }

  /* ================= XML 部件 ================= */

  /* 列定义：与码哥台账的 14 列对齐 */
  var HEADERS = ['时间', '品种', '周期', '方向', '开仓价', '止损价', '止盈价',
    '风险', '回报', '盈亏比', '截图', '备注', '盈亏', '胜率'];

  /* 与 HEADERS 一一对应的记录字段名 */
  var FIELDS = ['time', 'symbol', 'tf', 'dir', 'entry', 'stop', 'target',
    'risk', 'reward', 'rr', 'shot', 'note', 'pnl', 'win'];

  var S_TIME = 1;     /* 日期格式 + 居中 + 边框 */
  var S_DATA = 2;     /* 居中 + 边框 */
  var S_HEAD = 3;     /* 加粗 + 居中 + 边框 */

  var COL_WIDTHS = [
    [1, 1, 15.625], [2, 2, 17], [3, 10, 10.625],
    [11, 11, 18], [12, 14, 12]
  ];

  var CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    '<Override PartName="/xl/cellimages.xml" ContentType="application/vnd.wps-officedocument.cellimage+xml"/>' +
    '</Types>';

  var ROOT_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  var WORKBOOK_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
    '<Relationship Id="rId4" Type="http://www.wps.cn/officeDocument/2020/cellImage" Target="cellimages.xml"/>' +
    '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';

  var WORKBOOK =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<fileVersion appName="xl" lastEdited="3" lowestEdited="5" rupBuild="9302"/>' +
    '<workbookPr/>' +
    '<bookViews><workbookView windowWidth="27945" windowHeight="12255"/></bookViews>' +
    '<sheets><sheet name="回测记录" sheetId="1" r:id="rId1"/></sheets>' +
    '<calcPr calcId="191029"/>' +
    '</workbook>';

  /* 所有格子水平+垂直居中；s=0 默认 / s=1 时间 / s=2 数据 / s=3 表头 */
  var STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="176" formatCode="yyyy/m/d h:mm"/></numFmts>' +
    '<fonts count="2">' +
    '<font><sz val="11"/><color theme="1"/><name val="Microsoft YaHei"/><charset val="134"/></font>' +
    '<font><b/><sz val="11"/><color theme="1"/><name val="Microsoft YaHei"/><charset val="134"/></font>' +
    '</fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left style="thin"><color indexed="64"/></left>' +
    '<right style="thin"><color indexed="64"/></right>' +
    '<top style="thin"><color indexed="64"/></top>' +
    '<bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="176" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>' +
    '<dxfs count="0"/>' +
    '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
    '</styleSheet>';

  /* 主题：直接从一份 WPS 生成的文件里取，保证 Excel/WPS 都认 */
  var THEME_XML = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"Office Theme\"><a:themeElements><a:clrScheme name=\"Office\"><a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1><a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1><a:dk2><a:srgbClr val=\"1F497D\"/></a:dk2><a:lt2><a:srgbClr val=\"EEECE1\"/></a:lt2><a:accent1><a:srgbClr val=\"4F81BD\"/></a:accent1><a:accent2><a:srgbClr val=\"C0504D\"/></a:accent2><a:accent3><a:srgbClr val=\"9BBB59\"/></a:accent3><a:accent4><a:srgbClr val=\"8064A2\"/></a:accent4><a:accent5><a:srgbClr val=\"4BACC6\"/></a:accent5><a:accent6><a:srgbClr val=\"F79646\"/></a:accent6><a:hlink><a:srgbClr val=\"0000FF\"/></a:hlink><a:folHlink><a:srgbClr val=\"800080\"/></a:folHlink></a:clrScheme><a:fontScheme name=\"Office\"><a:majorFont><a:latin typeface=\"Cambria\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/><a:font script=\"Jpan\" typeface=\"\uff2d\uff33 \uff30\u30b4\u30b7\u30c3\u30af\"/><a:font script=\"Hang\" typeface=\"\ub9d1\uc740 \uace0\ub515\"/><a:font script=\"Hans\" typeface=\"\u5b8b\u4f53\"/><a:font script=\"Hant\" typeface=\"\u65b0\u7d30\u660e\u9ad4\"/><a:font script=\"Arab\" typeface=\"Times New Roman\"/><a:font script=\"Hebr\" typeface=\"Times New Roman\"/><a:font script=\"Thai\" typeface=\"Tahoma\"/><a:font script=\"Ethi\" typeface=\"Nyala\"/><a:font script=\"Beng\" typeface=\"Vrinda\"/><a:font script=\"Gujr\" typeface=\"Shruti\"/><a:font script=\"Khmr\" typeface=\"MoolBoran\"/><a:font script=\"Knda\" typeface=\"Tunga\"/><a:font script=\"Guru\" typeface=\"Raavi\"/><a:font script=\"Cans\" typeface=\"Euphemia\"/><a:font script=\"Cher\" typeface=\"Plantagenet Cherokee\"/><a:font script=\"Yiii\" typeface=\"Microsoft Yi Baiti\"/><a:font script=\"Tibt\" typeface=\"Microsoft Himalaya\"/><a:font script=\"Thaa\" typeface=\"MV Boli\"/><a:font script=\"Deva\" typeface=\"Mangal\"/><a:font script=\"Telu\" typeface=\"Gautami\"/><a:font script=\"Taml\" typeface=\"Latha\"/><a:font script=\"Syrc\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Orya\" typeface=\"Kalinga\"/><a:font script=\"Mlym\" typeface=\"Kartika\"/><a:font script=\"Laoo\" typeface=\"DokChampa\"/><a:font script=\"Sinh\" typeface=\"Iskoola Pota\"/><a:font script=\"Mong\" typeface=\"Mongolian Baiti\"/><a:font script=\"Viet\" typeface=\"Times New Roman\"/><a:font script=\"Uigh\" typeface=\"Microsoft Uighur\"/></a:majorFont><a:minorFont><a:latin typeface=\"Calibri\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/><a:font script=\"Jpan\" typeface=\"\uff2d\uff33 \uff30\u30b4\u30b7\u30c3\u30af\"/><a:font script=\"Hang\" typeface=\"\ub9d1\uc740 \uace0\ub515\"/><a:font script=\"Hans\" typeface=\"\u5b8b\u4f53\"/><a:font script=\"Hant\" typeface=\"\u65b0\u7d30\u660e\u9ad4\"/><a:font script=\"Arab\" typeface=\"Arial\"/><a:font script=\"Hebr\" typeface=\"Arial\"/><a:font script=\"Thai\" typeface=\"Tahoma\"/><a:font script=\"Ethi\" typeface=\"Nyala\"/><a:font script=\"Beng\" typeface=\"Vrinda\"/><a:font script=\"Gujr\" typeface=\"Shruti\"/><a:font script=\"Khmr\" typeface=\"DaunPenh\"/><a:font script=\"Knda\" typeface=\"Tunga\"/><a:font script=\"Guru\" typeface=\"Raavi\"/><a:font script=\"Cans\" typeface=\"Euphemia\"/><a:font script=\"Cher\" typeface=\"Plantagenet Cherokee\"/><a:font script=\"Yiii\" typeface=\"Microsoft Yi Baiti\"/><a:font script=\"Tibt\" typeface=\"Microsoft Himalaya\"/><a:font script=\"Thaa\" typeface=\"MV Boli\"/><a:font script=\"Deva\" typeface=\"Mangal\"/><a:font script=\"Telu\" typeface=\"Gautami\"/><a:font script=\"Taml\" typeface=\"Latha\"/><a:font script=\"Syrc\" typeface=\"Estrangelo Edessa\"/><a:font script=\"Orya\" typeface=\"Kalinga\"/><a:font script=\"Mlym\" typeface=\"Kartika\"/><a:font script=\"Laoo\" typeface=\"DokChampa\"/><a:font script=\"Sinh\" typeface=\"Iskoola Pota\"/><a:font script=\"Mong\" typeface=\"Mongolian Baiti\"/><a:font script=\"Viet\" typeface=\"Arial\"/><a:font script=\"Uigh\" typeface=\"Microsoft Uighur\"/></a:minorFont></a:fontScheme><a:fmtScheme name=\"Office\"><a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"50000\"/><a:satMod val=\"300000\"/></a:schemeClr></a:gs><a:gs pos=\"35000\"><a:schemeClr val=\"phClr\"><a:tint val=\"37000\"/><a:satMod val=\"300000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:tint val=\"15000\"/><a:satMod val=\"350000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"16200000\" scaled=\"1\"/></a:gradFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:shade val=\"51000\"/><a:satMod val=\"130000\"/></a:schemeClr></a:gs><a:gs pos=\"80000\"><a:schemeClr val=\"phClr\"><a:shade val=\"93000\"/><a:satMod val=\"130000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"94000\"/><a:satMod val=\"135000\"/></a:schemeClr></a:gs></a:gsLst><a:lin ang=\"16200000\" scaled=\"0\"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w=\"9525\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"><a:shade val=\"95000\"/><a:satMod val=\"105000\"/></a:schemeClr></a:solidFill><a:prstDash val=\"solid\"/></a:ln><a:ln w=\"25400\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/></a:ln><a:ln w=\"38100\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:prstDash val=\"solid\"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst><a:outerShdw blurRad=\"40000\" dist=\"20000\" dir=\"5400000\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"38000\"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad=\"40000\" dist=\"23000\" dir=\"5400000\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"35000\"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad=\"40000\" dist=\"23000\" dir=\"5400000\" rotWithShape=\"0\"><a:srgbClr val=\"000000\"><a:alpha val=\"35000\"/></a:srgbClr></a:outerShdw></a:effectLst><a:scene3d><a:camera prst=\"orthographicFront\"><a:rot lat=\"0\" lon=\"0\" rev=\"0\"/></a:camera><a:lightRig rig=\"threePt\" dir=\"t\"><a:rot lat=\"0\" lon=\"0\" rev=\"1200000\"/></a:lightRig></a:scene3d><a:sp3d><a:bevelT w=\"63500\" h=\"25400\"/></a:sp3d></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"40000\"/><a:satMod val=\"350000\"/></a:schemeClr></a:gs><a:gs pos=\"40000\"><a:schemeClr val=\"phClr\"><a:tint val=\"45000\"/><a:shade val=\"99000\"/><a:satMod val=\"350000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"20000\"/><a:satMod val=\"255000\"/></a:schemeClr></a:gs></a:gsLst><a:path path=\"circle\"><a:fillToRect l=\"50000\" t=\"-80000\" r=\"50000\" b=\"180000\"/></a:path></a:gradFill><a:gradFill rotWithShape=\"1\"><a:gsLst><a:gs pos=\"0\"><a:schemeClr val=\"phClr\"><a:tint val=\"80000\"/><a:satMod val=\"300000\"/></a:schemeClr></a:gs><a:gs pos=\"100000\"><a:schemeClr val=\"phClr\"><a:shade val=\"30000\"/><a:satMod val=\"200000\"/></a:schemeClr></a:gs></a:gsLst><a:path path=\"circle\"><a:fillToRect l=\"50000\" t=\"50000\" r=\"50000\" b=\"50000\"/></a:path></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/></a:theme>";

  function buildSharedStrings(strs) {
    var uniq = {};
    var order = [];
    for (var i = 0; i < strs.length; i++) {
      var s = strs[i];
      if (s === '' || s == null) continue;
      if (!Object.prototype.hasOwnProperty.call(uniq, s)) {
        uniq[s] = order.length;
        order.push(s);
      }
    }
    var out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' +
      strs.length + '" uniqueCount="' + order.length + '">'];
    for (var j = 0; j < order.length; j++) {
      out.push('<si><t xml:space="preserve">' + esc(order[j]) + '</t></si>');
    }
    out.push('</sst>');
    return { xml: out.join(''), index: uniq };
  }

  function buildSheet(rows, sstIndex, imgByRow) {
    var nCol = HEADERS.length;
    var out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
      'xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData">',
      '<sheetPr/>',
      '<dimension ref="A1:' + colLetter(nCol) + (rows.length + 1) + '"/>',
      '<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
      '</sheetView></sheetViews>',
      '<sheetFormatPr defaultColWidth="9" defaultRowHeight="16"/>',
      '<cols>'];

    for (var c = 0; c < COL_WIDTHS.length; c++) {
      var w = COL_WIDTHS[c];
      out.push('<col min="' + w[0] + '" max="' + w[1] + '" width="' + w[2] +
        '" style="1" customWidth="1"/>');
    }
    out.push('</cols><sheetData>');

    /* 表头 */
    out.push('<row r="1" ht="26" customHeight="1" spans="1:' + nCol + '">');
    for (var h = 0; h < nCol; h++) {
      out.push('<c r="' + colLetter(h + 1) + '1" s="' + S_HEAD + '" t="s"><v>' +
        sstIndex[HEADERS[h]] + '</v></c>');
    }
    out.push('</row>');

    /* 数据行 */
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var rowNo = i + 2;
      out.push('<row r="' + rowNo + '" ht="60" customHeight="1" spans="1:' +
        nCol + '">');
      for (var j = 0; j < nCol; j++) {
        var ref = colLetter(j + 1) + rowNo;
        var key = FIELDS[j];

        if (key === 'shot') {
          var id = imgByRow[rowNo];
          if (id) {
            out.push('<c r="' + ref + '" s="' + S_DATA + '" t="str">' +
              '<f xml:space="preserve">_xlfn.DISPIMG(&quot;' + id +
              '&quot;,1)</f><v>=DISPIMG(&quot;' + id + '&quot;,1)</v></c>');
          } else {
            out.push('<c r="' + ref + '" s="' + S_DATA + '"/>');
          }
          continue;
        }

        var v = r[key];
        /* 用鸭子类型判断日期，不用 instanceof —— 跨 realm（vm/iframe）会失效 */
        if (key === 'time' && v && typeof v.getTime === 'function') {
          out.push('<c r="' + ref + '" s="' + S_TIME + '"><v>' +
            excelSerial(v).toFixed(10) + '</v></c>');
        } else if (typeof v === 'number' && isFinite(v)) {
          out.push('<c r="' + ref + '" s="' + S_DATA + '"><v>' + v + '</v></c>');
        } else if (v === '' || v == null) {
          out.push('<c r="' + ref + '" s="' + S_DATA + '"/>');
        } else {
          var sv = String(v);
          var idx = sstIndex[sv];
          if (idx == null) {
            /* 兜底：共享字符串表里没有就用 inlineStr，避免索引错位串行 */
            out.push('<c r="' + ref + '" s="' + S_DATA +
              '" t="inlineStr"><is><t xml:space="preserve">' + esc(sv) +
              '</t></is></c>');
          } else {
            out.push('<c r="' + ref + '" s="' + S_DATA + '" t="s"><v>' +
              idx + '</v></c>');
          }
        }
      }
      out.push('</row>');
    }

    out.push('</sheetData>');
    out.push('<pageMargins left="0.75" right="0.75" top="1" bottom="1" ' +
      'header="0.5" footer="0.5"/><headerFooter/></worksheet>');
    return out.join('');
  }

  function buildCellImages(entries) {
    var out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<etc:cellImages ' +
      'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData">'];

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      out.push('<etc:cellImage><xdr:pic><xdr:nvPicPr>' +
        '<xdr:cNvPr id="' + (i + 1) + '" name="' + e.id + '" descr="截图"/>' +
        '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>' +
        '</xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId' + (i + 1) + '"/>' +
        '<a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
        '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + e.cx +
        '" cy="' + e.cy + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
        '<a:noFill/><a:ln><a:noFill/></a:ln></xdr:spPr></xdr:pic></etc:cellImage>');
    }
    out.push('</etc:cellImages>');
    return out.join('');
  }

  function buildCellImageRels(entries) {
    var out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'];
    for (var i = 0; i < entries.length; i++) {
      out.push('<Relationship Id="rId' + (i + 1) + '" ' +
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
        'Target="media/image' + entries[i].mediaNo + '.png"/>');
    }
    out.push('</Relationships>');
    return out.join('');
  }

  /* ================= 主入口 =================
   * records: [{id, time:Date, symbol, tf, dir:'多'|'空', entry, stop, target,
   *            risk, reward, rr, note, pnl, win}]
   * images:  {recordId: 'data:image/png;base64,...'}
   * 返回 {bytes: Uint8Array, mime, ext, imgCount}
   */
  function build(records, images) {
    images = images || {};

    var rows = [];
    var imgByRow = {};
    var entries = [];
    /* 多笔共用同一张截图时，图片本体只存一份，
       多个 cellImage 的 rId 都指向同一个 media 部件 */
    var mediaList = [];
    var mediaSeen = Object.create(null);

    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      var rowNo = i + 2;
      rows.push(rec);

      var dataUrl = images[rec.id];
      if (dataUrl) {
        var bytes = dataUrlToBytes(dataUrl);
        if (bytes && bytes.length) {
          var no = mediaSeen[dataUrl];
          if (no == null) {
            mediaList.push(bytes);
            no = mediaList.length;
            mediaSeen[dataUrl] = no;
          }
          var id = newImageId();
          entries.push({ id: id, mediaNo: no, cx: 1128000, cy: 768000 });
          imgByRow[rowNo] = id;
        }
      }
    }

    /* 共享字符串：凡是会被写成字符串的单元格值都要收进来，一个不漏 */
    var strs = HEADERS.slice();
    for (var k = 0; k < rows.length; k++) {
      var r = rows[k];
      for (var f = 0; f < FIELDS.length; f++) {
        var fk = FIELDS[f];
        if (fk === 'time' || fk === 'shot') continue;
        var fv = r[fk];
        if (fv === '' || fv == null) continue;
        if (typeof fv === 'number' && isFinite(fv)) continue;
        if (fv && typeof fv.getTime === 'function') continue;
        strs.push(String(fv));
      }
    }
    var sst = buildSharedStrings(strs);

    var files = [
      { name: '[Content_Types].xml', data: utf8(CONTENT_TYPES) },
      { name: '_rels/.rels', data: utf8(ROOT_RELS) },
      { name: 'xl/workbook.xml', data: utf8(WORKBOOK) },
      { name: 'xl/_rels/workbook.xml.rels', data: utf8(WORKBOOK_RELS) },
      { name: 'xl/styles.xml', data: utf8(STYLES) },
      { name: 'xl/theme/theme1.xml', data: utf8(THEME_XML) },
      { name: 'xl/sharedStrings.xml', data: utf8(sst.xml) },
      { name: 'xl/worksheets/sheet1.xml', data: utf8(buildSheet(rows, sst.index, imgByRow)) }
    ];

    if (entries.length) {
      files.push({ name: 'xl/cellimages.xml', data: utf8(buildCellImages(entries)) });
      files.push({
        name: 'xl/_rels/cellimages.xml.rels',
        data: utf8(buildCellImageRels(entries))
      });
      for (var e = 0; e < mediaList.length; e++) {
        files.push({
          name: 'xl/media/image' + (e + 1) + '.png',
          data: mediaList[e]
        });
      }
    }

    return {
      bytes: makeZip(files),
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ext: '.xlsx',
      imgCount: entries.length,
      uniqueImages: mediaList.length
    };
  }

  g.TVRC = g.TVRC || {};
  g.TVRC.XLSX = {
    build: build,
    HEADERS: HEADERS,
    _internals: { makeZip: makeZip, crc32: crc32, excelSerial: excelSerial }
  };
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis));
