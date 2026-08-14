// Sub-Store 文件操作脚本
const yaml = ProxyUtils.yaml.safeLoad($content ?? $files[0]) || {};

const AIRPORT_COLLECTION = '机场合集';
const OLD_MANUAL_GROUP = '🚀 节点选择';
const MANUAL_GROUP = '🚀 手动选择';
const FALLBACK_ROOT_GROUP = '🚀 节点选择';

function uniqueNames(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function validProxies(proxies) {
  return Array.isArray(proxies)
    ? proxies.filter(proxy => proxy && proxy.name)
    : [];
}

function uniqueProxies(proxies) {
  const map = new Map();
  for (const proxy of validProxies(proxies)) {
    map.set(proxy.name, proxy);
  }
  return Array.from(map.values());
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
    if (
      typeof $arguments !== 'undefined' &&
      $arguments &&
      typeof $arguments === 'object'
    ) {
      return $arguments;
    }
  } catch (_) {}
  return {};
}

const requestQuery = getRequestQuery();
const scriptArguments = getScriptArguments();

function getCaseInsensitive(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  const wanted = String(key).toLowerCase();
  for (const actualKey of Object.keys(obj)) {
    if (String(actualKey).toLowerCase() === wanted) {
      const value = obj[actualKey];
      if (value !== undefined && value !== null && value !== '') return value;
    }
  }
  return undefined;
}

function getOption(...keys) {
  for (const key of keys) {
    const value = getCaseInsensitive(requestQuery, key);
    if (value !== undefined) return value;
  }
  for (const key of keys) {
    const value = getCaseInsensitive(scriptArguments, key);
    if (value !== undefined) return value;
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

  const mode = lower(getOption('mihomo_mode', 'mihomoMode'));
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

function parseLandingSubscriptionNames() {
  const raw = getOption('landing');
  if (raw === undefined) return [];

  const value = cleanName(raw);
  if (!value || ['none', 'off', 'false', '0'].includes(value.toLowerCase())) {
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
    return validProxies(await produceArtifact({
      type: 'subscription',
      name,
      platform: 'ClashMeta',
      produceType: 'internal'
    }));
  } catch (_) {
    return [];
  }
}

async function resolveLandingProxies() {
  const subscriptionNames = parseLandingSubscriptionNames();
  if (subscriptionNames.length === 0) return [];

  const result = [];

  for (const subscriptionName of subscriptionNames) {
    const proxies = await readSubscription(subscriptionName);
    if (proxies.length === 0) {
      throw new Error(
        `Landing 订阅 "${subscriptionName}" 不存在，或订阅中没有可用节点`
      );
    }
    result.push(...proxies);
  }

  return uniqueProxies(result);
}

function rewriteGroupReferences(fromNames, toName, excludeGroups = []) {
  const fromSet = new Set(fromNames);

  for (const group of yaml['proxy-groups']) {
    if (!group || excludeGroups.includes(group) || !Array.isArray(group.proxies)) {
      continue;
    }
    group.proxies = uniqueNames(
      group.proxies.map(name => fromSet.has(name) ? toName : name)
    );
  }

  if (Array.isArray(yaml.rules)) {
    yaml.rules = yaml.rules.map(rule => {
      if (typeof rule !== 'string') return rule;
      let next = rule;
      for (const name of fromNames) {
        next = next.split(name).join(toName);
      }
      return next;
    });
  }
}

applyRuntimeOptions();

// -------------------------
// 读取机场合集
// -------------------------
const airports = validProxies(await produceArtifact({
  type: 'collection',
  name: AIRPORT_COLLECTION,
  platform: 'ClashMeta',
  produceType: 'internal'
}));

// -------------------------
// Landing 完全按订阅名解析
// 不传 landing / landing=none => 不使用 Landing
// landing=A => 读取订阅 A
// landing=A,B => 合并订阅 A 和 B
// -------------------------
const landings = await resolveLandingProxies();
const landingEnabled = landings.length > 0;

// -------------------------
// 合并机场节点
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

let finalRootGroupName = getRootGroupName();

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

  if (finalRootGroupName === MANUAL_GROUP) {
    finalRootGroupName = FALLBACK_ROOT_GROUP;
  }

  let rootGroup = findGroup(finalRootGroupName);
  if (!rootGroup || rootGroup === manualGroup) {
    rootGroup = {
      name: finalRootGroupName,
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

  rewriteGroupReferences(
    [OLD_MANUAL_GROUP],
    finalRootGroupName,
    [rootGroup, manualGroup]
  );
} else {
  // 无 Landing：直接把原主策略组提升为最终 root group。
  yaml.proxies = Array.from(merged.values());

  let manualGroup = findGroup(OLD_MANUAL_GROUP) || findGroup(MANUAL_GROUP);

  if (!manualGroup) {
    manualGroup = {
      name: finalRootGroupName,
      type: 'select',
      proxies: uniqueNames(airports.map(proxy => proxy.name))
    };
    yaml['proxy-groups'].unshift(manualGroup);
  } else {
    const oldName = manualGroup.name;
    manualGroup.name = finalRootGroupName;
    rewriteGroupReferences(
      [OLD_MANUAL_GROUP, MANUAL_GROUP, oldName],
      finalRootGroupName,
      [manualGroup]
    );
  }
}

// Mihomo global 模式固定走 GLOBAL 组。
// 显式把 GLOBAL 指向最终 root group，避免默认选择 DIRECT。
if (lower(yaml.mode) === 'global' && finalRootGroupName !== 'GLOBAL') {
  let globalGroup = findGroup('GLOBAL');

  if (!globalGroup) {
    globalGroup = {
      name: 'GLOBAL',
      type: 'select',
      proxies: []
    };
    yaml['proxy-groups'].unshift(globalGroup);
  }

  globalGroup.type = 'select';
  globalGroup.proxies = [finalRootGroupName];

  delete globalGroup['include-all'];
  delete globalGroup.use;
  delete globalGroup.filter;
  delete globalGroup['exclude-filter'];
  delete globalGroup['exclude-type'];
}

$content = ProxyUtils.yaml.safeDump(yaml);
