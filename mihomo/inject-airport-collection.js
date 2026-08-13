// Sub-Store 文件操作脚本
//
// 作用：
// 1. 把「机场合集」collection 的全部节点注入当前 Mihomo 配置。
// 2. 支持从「落地节点」subscription 或同名独立 subscription 解析落地节点。
// 3. 原「🚀 节点选择」改名为「🚀 手动选择」，作为机场入口路线选择组。
// 4. 所有落地节点设置 dialer-proxy: 🚀 手动选择。
// 5. 顶层 select 组仅包含：落地节点 + 🚀 手动选择。
// 6. 落地节点不会进入自动选择、地区、全部节点等其他策略组。
// 7. 支持最终订阅 URL query：profile / mode / dns / rootGroupName / landing。
//
// landing 参数：
//   不传 landing            使用「落地节点」订阅中的全部节点
//   ?landing=节点名称       先在「落地节点」中按节点名精确匹配；若未命中，再读取同名 subscription
//   ?landing=节点A,节点B    对每个名称分别按上述规则解析并合并
//   ?landing=none           禁用全部落地节点，机场直接出站
//
// 例：
//   ?landing=Oracle-SG-1
//   如果「落地节点」里存在名为 Oracle-SG-1 的节点，则使用该节点；
//   否则尝试读取名为 Oracle-SG-1 的 Sub-Store 单条订阅，并使用其中全部节点作为落地。

const yaml = ProxyUtils.yaml.safeLoad($content ?? $files[0]) || {};

const AIRPORT_COLLECTION = '机场合集';
const LANDING_SUBSCRIPTION = '落地节点';
const OLD_MANUAL_GROUP = '🚀 节点选择';
const MANUAL_GROUP = '🚀 手动选择';
const FALLBACK_ROOT_GROUP = '🚀 节点选择';

function uniqueNames(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function uniqueProxies(proxies) {
  const map = new Map();
  for (const proxy of validProxies(proxies)) {
    map.set(proxy.name, proxy);
  }
  return Array.from(map.values());
}

function validProxies(proxies) {
  return Array.isArray(proxies)
    ? proxies.filter(proxy => proxy && proxy.name)
    : [];
}

function escapeRegex(text = '') {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanName(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function lower(value) {
  return cleanName(value).toLowerCase();
}

function getRequestQuery() {
  try {
    if (
      typeof $options !== 'undefined' &&
      $options &&
      $options._req &&
      $options._req.query &&
      typeof $options._req.query === 'object'
    ) {
      return $options._req.query;
    }
  } catch (_) {}
  return {};
}

function getScriptArguments() {
  try {
    if (typeof $arguments !== 'undefined' && $arguments && typeof $arguments === 'object') {
      return $arguments;
    }
  } catch (_) {}
  return {};
}

const requestQuery = getRequestQuery();
const scriptArguments = getScriptArguments();

function getOption(...keys) {
  for (const key of keys) {
    const value = requestQuery[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }

  for (const key of keys) {
    const value = scriptArguments[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }

  return undefined;
}

function applyDnsPreset(preset) {
  const value = lower(preset);
  if (!value || value === 'default') return;

  yaml.dns = yaml.dns && typeof yaml.dns === 'object' ? yaml.dns : {};

  if (['off', 'false', '0'].includes(value)) {
    yaml.dns.enable = false;
    return;
  }

  yaml.dns.enable = true;

  if (value === 'cn') {
    yaml.dns['default-nameserver'] = [
      '223.5.5.5',
      '223.6.6.6',
      '119.29.29.29',
      '119.28.28.28'
    ];
    yaml.dns.nameserver = [
      'https://223.5.5.5/dns-query',
      'https://doh.pub/dns-query',
      'https://dns.alidns.com/dns-query'
    ];
    return;
  }

  if (value === 'global') {
    yaml.dns['default-nameserver'] = [
      '1.1.1.1',
      '8.8.8.8',
      '9.9.9.9'
    ];
    yaml.dns.nameserver = [
      'https://1.1.1.1/dns-query',
      'https://8.8.8.8/dns-query',
      'https://dns.quad9.net/dns-query'
    ];
  }
}

function applyRuntimeOptions() {
  const profile = lower(getOption('profile')) || 'default';

  if (profile === 'home') {
    yaml['allow-lan'] = true;
    if (getOption('dns') === undefined) applyDnsPreset('cn');
  } else if (profile === 'router') {
    yaml['allow-lan'] = true;
    yaml['bind-address'] = '*';
    if (getOption('dns') === undefined) applyDnsPreset('cn');
  } else if (profile === 'phone') {
    yaml['allow-lan'] = false;
    if (getOption('dns') === undefined) applyDnsPreset('global');
  }

  const mode = lower(getOption('mode'));
  if (['rule', 'global', 'direct'].includes(mode)) {
    yaml.mode = mode;
  }

  const dns = getOption('dns');
  if (dns !== undefined) applyDnsPreset(dns);
}

function getRootGroupName() {
  return cleanName(getOption('rootGroupName', 'root_group_name', 'groupName'))
    || FALLBACK_ROOT_GROUP;
}

function parseLandingNames() {
  const raw = getOption('landing');
  if (raw === undefined) return null;

  const value = cleanName(raw);
  if (['none', 'off', 'false', '0'].includes(value.toLowerCase())) {
    return [];
  }

  return uniqueNames(
    value
      .split(',')
      .map(name => cleanName(name))
      .filter(Boolean)
  );
}

async function readSubscription(name) {
  try {
    const proxies = await produceArtifact({
      type: 'subscription',
      name,
      platform: 'ClashMeta',
      produceType: 'internal'
    });
    return validProxies(proxies);
  } catch (_) {
    return [];
  }
}

async function resolveLandingProxies(allLandings) {
  const wantedNames = parseLandingNames();

  // 未传 landing：保持原行为，使用「落地节点」订阅中的全部节点。
  if (wantedNames === null) return allLandings;

  // landing=none/off/false/0
  if (wantedNames.length === 0) return [];

  const result = [];
  const landingMap = new Map(allLandings.map(proxy => [proxy.name, proxy]));

  for (const name of wantedNames) {
    // 第一优先级：在「落地节点」汇总订阅中按节点名精确匹配。
    const matchedProxy = landingMap.get(name);
    if (matchedProxy) {
      result.push(matchedProxy);
      continue;
    }

    // 第二优先级：把参数值当成 Sub-Store subscription 名称读取。
    // 这样可以给某个落地节点单独维护一个订阅。
    const dedicatedProxies = await readSubscription(name);
    result.push(...dedicatedProxies);
  }

  return uniqueProxies(result);
}

applyRuntimeOptions();

// -------------------------
// 读取机场合集（必需）
// -------------------------
const airportProxies = await produceArtifact({
  type: 'collection',
  name: AIRPORT_COLLECTION,
  platform: 'ClashMeta',
  produceType: 'internal'
});

const airports = validProxies(airportProxies);

// -------------------------
// 读取并解析落地节点（可选）
// -------------------------
const allLandings = await readSubscription(LANDING_SUBSCRIPTION);
const landings = await resolveLandingProxies(allLandings);
const landingEnabled = landings.length > 0;

// -------------------------
// 合并 proxies
// -------------------------
const existingProxies = Array.isArray(yaml.proxies) ? yaml.proxies : [];
const merged = new Map();

for (const proxy of existingProxies) {
  if (proxy && proxy.name) merged.set(proxy.name, proxy);
}

for (const proxy of airports) {
  merged.set(proxy.name, proxy);
}

yaml['proxy-groups'] = Array.isArray(yaml['proxy-groups'])
  ? yaml['proxy-groups']
  : [];

function findGroup(name) {
  return yaml['proxy-groups'].find(group => group && group.name === name);
}

if (landingEnabled) {
  const landingNames = uniqueNames(landings.map(proxy => proxy.name));
  const landingNameSet = new Set(landingNames);

  let manualGroup = findGroup(OLD_MANUAL_GROUP) || findGroup(MANUAL_GROUP);

  if (!manualGroup) {
    manualGroup = {
      name: MANUAL_GROUP,
      type: 'select',
      proxies: uniqueNames(airports.map(proxy => proxy.name))
    };
    yaml['proxy-groups'].unshift(manualGroup);
  } else {
    manualGroup.name = MANUAL_GROUP;
  }

  for (const proxy of landings) {
    proxy['dialer-proxy'] = MANUAL_GROUP;
    merged.set(proxy.name, proxy);
  }

  yaml.proxies = Array.from(merged.values());

  const landingExcludePattern = landingNames.length
    ? `(?:${landingNames.map(name => `^${escapeRegex(name)}$`).join('|')})`
    : '';

  for (const group of yaml['proxy-groups']) {
    if (!group || group === manualGroup) continue;

    if (Array.isArray(group.proxies)) {
      group.proxies = group.proxies.filter(name => !landingNameSet.has(name));
    }

    const isDynamic = group['include-all'] || group.use || group.filter;
    if (isDynamic && landingExcludePattern) {
      const oldExclude = group['exclude-filter'];
      group['exclude-filter'] = oldExclude
        ? `(?:${oldExclude})|${landingExcludePattern}`
        : landingExcludePattern;
    }
  }

  if (Array.isArray(manualGroup.proxies)) {
    manualGroup.proxies = manualGroup.proxies.filter(name => !landingNameSet.has(name));
  }

  let rootGroupName = getRootGroupName();
  if (rootGroupName === MANUAL_GROUP) rootGroupName = FALLBACK_ROOT_GROUP;

  let rootGroup = findGroup(rootGroupName);

  if (!rootGroup || rootGroup === manualGroup) {
    rootGroup = {
      name: rootGroupName,
      type: 'select',
      proxies: []
    };
    yaml['proxy-groups'].unshift(rootGroup);
  }

  rootGroup.type = 'select';
  rootGroup.proxies = uniqueNames([
    ...landingNames,
    MANUAL_GROUP
  ]);

  delete rootGroup['include-all'];
  delete rootGroup.use;
  delete rootGroup.filter;
  delete rootGroup['exclude-filter'];
  delete rootGroup['exclude-type'];

  for (const group of yaml['proxy-groups']) {
    if (!group || group === rootGroup || group === manualGroup) continue;

    if (Array.isArray(group.proxies)) {
      group.proxies = uniqueNames(
        group.proxies.map(name =>
          name === OLD_MANUAL_GROUP ? rootGroupName : name
        )
      );
    }
  }

  if (Array.isArray(yaml.rules)) {
    yaml.rules = yaml.rules.map(rule => {
      if (typeof rule !== 'string') return rule;
      return rule.split(OLD_MANUAL_GROUP).join(rootGroupName);
    });
  }
} else {
  // landing=none 或没有匹配到节点/订阅：只使用机场合集，保持模板原策略结构。
  yaml.proxies = Array.from(merged.values());
}

$content = ProxyUtils.yaml.safeDump(yaml);
