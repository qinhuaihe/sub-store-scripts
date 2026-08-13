async function operator(proxies, targetPlatform, context) {
  const counters = new Map();

  // =========================
  // ISO -> 中文国家/地区名称
  // =========================
  const countryNames = {
    HK: '香港',
    MO: '澳门',
    TW: '台湾',
    CN: '中国',
    JP: '日本',
    KR: '韩国',
    SG: '新加坡',
    MY: '马来西亚',
    TH: '泰国',
    VN: '越南',
    PH: '菲律宾',
    ID: '印度尼西亚',
    IN: '印度',

    US: '美国',
    CA: '加拿大',
    MX: '墨西哥',
    BR: '巴西',
    AR: '阿根廷',

    GB: '英国',
    FR: '法国',
    DE: '德国',
    NL: '荷兰',
    TR: '土耳其',
    IT: '意大利',
    ES: '西班牙',
    PT: '葡萄牙',
    CH: '瑞士',
    SE: '瑞典',
    NO: '挪威',
    FI: '芬兰',
    DK: '丹麦',
    PL: '波兰',
    AT: '奥地利',
    BE: '比利时',
    IE: '爱尔兰',
    CZ: '捷克',
    RO: '罗马尼亚',
    UA: '乌克兰',
    RU: '俄罗斯',

    AU: '澳大利亚',
    NZ: '新西兰',

    AE: '阿联酋',
    IL: '以色列',
    SA: '沙特阿拉伯',

    ZA: '南非'
  };

  // =========================
  // 工具函数
  // =========================

  function normalizeSpace(str = '') {
    return String(str)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function removeFlagEmoji(name = '') {
    return normalizeSpace(
      name.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, '')
    );
  }

  function normalizeUnit(unit = '') {
    return String(unit).toUpperCase();
  }

  function formatNumberUnit(number, unit) {
    return `${number} ${normalizeUnit(unit)}`;
  }

  // =========================
  // 流量识别
  // =========================

  function parseTraffic(name = '') {
    const text = normalizeSpace(name);

    // 剩余流量：183.39 GB
    // 剩余：183.39GB
    // Remaining Traffic: 183.39 GB
    // Remaining: 183.39GB
    let match = text.match(
      /(?:剩余流量|剩余|remaining(?:\s+traffic)?|traffic\s+remaining)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|PB)/i
    );

    if (match) {
      return {
        kind: 'remaining',
        value: formatNumberUnit(match[1], match[2])
      };
    }

    // 已用流量：30 GB
    // 已用：30GB
    // Used Traffic: 30 GB
    // Used: 30GB
    match = text.match(
      /(?:已用流量|已用|used(?:\s+traffic)?|traffic\s+used)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|PB)/i
    );

    if (match) {
      return {
        kind: 'used',
        value: formatNumberUnit(match[1], match[2])
      };
    }

    // 总流量：850 GB
    // Total Traffic: 850 GB
    // Total: 850GB
    match = text.match(
      /(?:总流量|总量|套餐流量|total(?:\s+traffic)?|traffic\s+total)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|PB)/i
    );

    if (match) {
      return {
        kind: 'total',
        value: formatNumberUnit(match[1], match[2])
      };
    }

    // 30.19 GB | 850 GB
    // 30 GB / 100 GB
    // 30GB of 100GB
    match = text.match(
      /(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|PB)\s*(?:\||\/|of)\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|PB)/i
    );

    if (match) {
      return {
        kind: 'usedTotal',
        used: formatNumberUnit(match[1], match[2]),
        total: formatNumberUnit(match[3], match[4])
      };
    }

    return null;
  }

  // =========================
  // 重置时间识别
  // =========================

  function parseReset(name = '') {
    const text = normalizeSpace(name);

    if (!/(?:traffic\s*)?reset|renew|重置|流量重置|刷新/i.test(text)) {
      return null;
    }

    // 24 Days Left
    // Reset in 24 days
    // 24 天
    let match = text.match(
      /(\d+(?:\.\d+)?)\s*(?:days?|day|天)/i
    );

    if (match) {
      return {
        value: `${match[1]} 天`
      };
    }

    // 12 Hours
    match = text.match(
      /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|小时)/i
    );

    if (match) {
      return {
        value: `${match[1]} 小时`
      };
    }

    // 如果提取不到结构化值，就保留有效文本
    const cleaned = text
      .replace(/traffic\s*reset\s*[:：]?/ig, '')
      .replace(/\breset\b\s*[:：]?/ig, '')
      .replace(/\brenew\b\s*[:：]?/ig, '')
      .replace(/流量重置\s*[:：]?/g, '')
      .replace(/重置\s*[:：]?/g, '')
      .replace(/\bleft\b/ig, '')
      .replace(/\bin\b/ig, '')
      .trim();

    return cleaned
      ? { value: cleaned }
      : null;
  }

  // =========================
  // 到期时间识别
  // =========================

  function parseExpire(name = '') {
    const text = normalizeSpace(name);

    if (
      !/\bexp\b|expire|expired|expiration|expiry|到期|有效期|过期/i.test(text)
    ) {
      return null;
    }

    // yyyy-mm-dd / yyyy/mm/dd / yyyy.mm.dd
    let match = text.match(
      /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/
    );

    if (match) {
      return {
        value:
          `${match[1]}-` +
          `${String(match[2]).padStart(2, '0')}-` +
          `${String(match[3]).padStart(2, '0')}`
      };
    }

    // dd-mm-yyyy
    match = text.match(
      /(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/
    );

    if (match) {
      return {
        value:
          `${match[3]}-` +
          `${String(match[2]).padStart(2, '0')}-` +
          `${String(match[1]).padStart(2, '0')}`
      };
    }

    // 还有 X 天到期
    match = text.match(
      /(\d+(?:\.\d+)?)\s*(?:days?|day|天)/i
    );

    if (match) {
      return {
        value: `${match[1]} 天`
      };
    }

    // 无法结构化，保留剩余有效文本
    const cleaned = text
      .replace(/\bexp\b\s*[:：]?/ig, '')
      .replace(/\bexpire(?:d)?(?:\s*date)?\b\s*[:：]?/ig, '')
      .replace(/\bexpiration\b\s*[:：]?/ig, '')
      .replace(/\bexpiry\b\s*[:：]?/ig, '')
      .replace(/到期(?:时间|日期)?\s*[:：]?/g, '')
      .replace(/有效期\s*[:：]?/g, '')
      .replace(/过期\s*[:：]?/g, '')
      .trim();

    return cleaned
      ? { value: cleaned }
      : null;
  }

  // =========================
  // 国家地区识别
  // =========================

  function getGeo(name = '') {
    const geoText = removeFlagEmoji(name);

    let iso = '';
    let flag = '';

    try {
      iso = ProxyUtils.getISO(geoText) || '';
    } catch (e) {}

    try {
      flag = ProxyUtils.getFlag(geoText) || '';
    } catch (e) {}

    iso = String(iso).toUpperCase();

    if (!iso) {
      iso = 'ZZ';
    }

    if (!flag) {
      flag = '🌐';
    }

    const country =
      countryNames[iso] ||
      '其他';

    return {
      iso,
      flag,
      country
    };
  }

  // =========================
  // 主处理
  // =========================

  return proxies.map(proxy => {
    const originalName = normalizeSpace(proxy.name || '');

    const subName =
      normalizeSpace(
        proxy._subDisplayName ||
        proxy._subName ||
        '未知订阅'
      );

    const type =
      String(proxy.type || 'unknown').toLowerCase();

    // -------------------------
    // 1. 流量信息
    // -------------------------

    const traffic = parseTraffic(originalName);

    if (traffic) {
      if (traffic.kind === 'remaining') {
        proxy.name =
          `[${subName}] 📊 剩余流量 [${type}] ${traffic.value}`;
      }

      else if (traffic.kind === 'used') {
        proxy.name =
          `[${subName}] 📊 已用流量 [${type}] ${traffic.value}`;
      }

      else if (traffic.kind === 'total') {
        proxy.name =
          `[${subName}] 📊 总流量 [${type}] ${traffic.value}`;
      }

      else if (traffic.kind === 'usedTotal') {
        proxy.name =
          `[${subName}] 📊 流量 [${type}] ${traffic.used} / ${traffic.total}`;
      }

      return proxy;
    }

    // -------------------------
    // 2. 重置信息
    // -------------------------

    const reset = parseReset(originalName);

    if (reset) {
      proxy.name =
        `[${subName}] 🔄 重置 [${type}] ${reset.value}`;

      return proxy;
    }

    // -------------------------
    // 3. 到期信息
    // -------------------------

    const expire = parseExpire(originalName);

    if (expire) {
      proxy.name =
        `[${subName}] ⏳ 到期 [${type}] ${expire.value}`;

      return proxy;
    }

    // -------------------------
    // 4. 普通节点
    // -------------------------

    const {
      iso,
      flag,
      country
    } = getGeo(originalName);

    const counterKey =
      `${subName}::${iso}::${type}`;

    const index =
      (counters.get(counterKey) || 0) + 1;

    counters.set(counterKey, index);

    const serial =
      String(index).padStart(2, '0');

    proxy.name =
      `[${subName}] ${flag} ${country} ${iso} [${type}] ${serial}`;

    return proxy;
  });
}
