async function operator(proxies, targetPlatform, context) {
  const counters = new Map();

  // ISO 3166-1 alpha-2 -> 中文国家/地区名称
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

  function normalizeSpace(str = '') {
    return String(str).replace(/\s+/g, ' ').trim();
  }

  function removeFlagEmoji(name = '') {
    return normalizeSpace(
      name.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, '')
    );
  }

  function formatNumberUnit(number, unit) {
    return `${number} ${String(unit).toUpperCase()}`;
  }

  // =========================
  // 流量信息识别
  // =========================
  function parseTraffic(name = '') {
    const text = normalizeSpace(name);

    // 剩余流量：183.39 GB
    // Remaining Traffic: 183.39 GB
    let match = text.match(
      /(?:剩余流量|可用流量|剩余|remaining(?:\s+traffic)?|traffic\s+remaining|available(?:\s+traffic)?)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|PB)/i
    );

    if (match) {
      return {
        kind: 'remaining',
        value: formatNumberUnit(match[1], match[2])
      };
    }

    // 已用流量：30 GB
    // Used Traffic: 30 GB
    match = text.match(
      /(?:已用流量|已使用|已用|used(?:\s+traffic)?|traffic\s+used)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB|PB)/i
    );

    if (match) {
      return {
        kind: 'used',
        value: formatNumberUnit(match[1], match[2])
      };
    }

    // 总流量：850 GB
    // Total Traffic: 850 GB
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
  // 到期日期识别
  // 只保留明确日期，不再保留“剩余 X 天”类信息节点
  // =========================
  function parseExpire(name = '') {
    const text = normalizeSpace(name);

    if (!/\bexp\b|expire|expired|expiration|expiry|到期|有效期|过期/i.test(text)) {
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

    // dd-mm-yyyy / dd/mm/yyyy / dd.mm.yyyy
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

    return null;
  }

  // =========================
  // 判断是否为可丢弃的“剩余天数 / 重置倒计时”信息节点
  // =========================
  function isRelativeTimeInfo(name = '') {
    const text = normalizeSpace(name);

    // 避免把“剩余流量”误判成剩余天数
    if (parseTraffic(text)) {
      return false;
    }

    const hasTimeValue =
      /\d+(?:\.\d+)?\s*(?:days?|day|hours?|hrs?|hour|天|小时)/i.test(text);

    const hasTimeKeyword =
      /reset|renew|expire|expiration|expiry|left|remaining|重置|到期|有效期|过期|剩余|还有/i.test(text);

    return hasTimeValue && hasTimeKeyword;
  }

  // =========================
  // 国家/地区识别
  // =========================
  function getGeo(name = '') {
    // 去掉原始国旗，避免“🇨🇳 Taiwan”之类旗帜与文本冲突
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

    return {
      iso,
      flag,
      country: countryNames[iso] || '其他'
    };
  }

  // =========================
  // 主处理
  // =========================
  const result = [];

  for (const proxy of proxies) {
    const originalName = normalizeSpace(proxy.name || '');

    const subName = normalizeSpace(
      proxy._subDisplayName ||
      proxy._subName ||
      '未知订阅'
    );

    const type = String(proxy.type || 'unknown').toLowerCase();

    // 1. 流量信息
    const traffic = parseTraffic(originalName);

    if (traffic) {
      if (traffic.kind === 'remaining') {
        proxy.name = `[${subName}] 📊 剩余流量 [${type}] ${traffic.value}`;
      } else if (traffic.kind === 'used') {
        proxy.name = `[${subName}] 📊 已用流量 [${type}] ${traffic.value}`;
      } else if (traffic.kind === 'total') {
        proxy.name = `[${subName}] 📊 总流量 [${type}] ${traffic.value}`;
      } else if (traffic.kind === 'usedTotal') {
        proxy.name = `[${subName}] 📊 流量 [${type}] ${traffic.used} / ${traffic.total}`;
      }

      result.push(proxy);
      continue;
    }

    // 2. 到期日期：只保留明确日期
    const expire = parseExpire(originalName);

    if (expire) {
      proxy.name = `[${subName}] ⏳ 到期 [${type}] ${expire.value}`;
      result.push(proxy);
      continue;
    }

    // 3. 删除“剩余 X 天 / 重置倒计时”类信息节点
    if (isRelativeTimeInfo(originalName)) {
      continue;
    }

    // 4. 普通代理节点
    const { iso, flag, country } = getGeo(originalName);

    const counterKey = `${subName}::${iso}::${type}`;
    const index = (counters.get(counterKey) || 0) + 1;
    counters.set(counterKey, index);

    const serial = String(index).padStart(2, '0');

    proxy.name = `[${subName}] ${flag} ${country} ${iso} [${type}] ${serial}`;
    result.push(proxy);
  }

  return result;
}
