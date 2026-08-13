// Sub-Store 文件操作脚本
//
// 作用：
// 1. 把「机场合集」collection 的全部节点注入当前 Mihomo 配置。
// 2. 如果存在「落地节点」subscription，则把落地节点注入配置。
// 3. 原「🚀 节点选择」改名为「🚀 手动选择」，继续作为机场入口路线选择组。
// 4. 所有落地节点设置 dialer-proxy: 🚀 手动选择。
// 5. 新建顶层 select 组：优先使用 URL 参数 rootGroupName，其次脚本参数，再尝试当前文件显示名称，最后使用默认名称。
// 6. 顶层组仅包含：落地节点 + 🚀 手动选择。
// 7. 落地节点不会进入自动选择、地区、全部节点等其他策略组。
// 8. 如果「落地节点」不存在 / 无节点 / 读取失败，则不改策略组结构，仅注入机场合集。
// 9. 支持从最终订阅 URL query 动态调整 Mihomo：profile / mode / dns / rootGroupName。
//
// URL 参数示例：
//   ?mode=global
//   ?dns=global
//   ?profile=router
//   ?profile=phone&mode=rule&dns=cn
//   ?rootGroupName=MyProxy
//
// 参数说明：
//   profile=default  不额外覆盖模板
//   profile=home     家庭/局域网：allow-lan=true，DNS 默认 cn
//   profile=router   路由器：allow-lan=true，bind-address=*，DNS 默认 cn
//   profile=phone    手机：allow-lan=false，DNS 默认 global
//   mode=rule|global|direct
//   dns=default|cn|global|off
//
// 显式 mode/dns 参数优先于 profile 预设。
//
// 注意：本脚本只负责节点注入、落地链路和少量运行时配置，不负责 rule-provider 或自定义规则注入。

const yaml = ProxyUtils.yaml.safeLoad($content ?? $files[0]) || {};

const AIRPORT_COLLECTION = '机场合集';
const LANDING_SUBSCRIPTION = '落地节点';
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

const requestQuery = getRequestQuery();

function getScriptArguments() {
  try {
    if (typeof $arguments !== 'undefined' && $arguments && typeof $arguments === 'object') {
      return $arguments;
    }
  } catch (_) {}

  try {
    if (typeof arguments !== 'undefined' && arguments && typeof arguments === 'object') {
      return arguments;
    }
  } catch (_) {}

  return {};
}

const scriptArguments = getScriptArguments();

function getOption(...keys) {
  for (const key of keys) {
    const queryValue = requestQuery[key];
    if (queryValue !== undefined && queryValue !== null && queryValue !== '') {
      return queryValue;
    }
  }

  for (const key of keys) {
    const argValue = scriptArguments[key];
    if (argValue !== undefined && argValue !== null && argValue !== '') {
      return argValue;
    }
  }

  return undefined;
}

function applyDnsPreset(preset) {
  const value = lower(preset);
  if (!value || value === 'default') return;

  yaml.dns = yaml.dns && typeof yaml.dns === 'object' ? yaml.dns : {};

  if (value === 'off' || value === 'false' || value === '0') {
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

  // profile 只提供温和的运行环境预设，不改规则和策略组。
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
  if (dns !== undefined) {
    applyDnsPreset(dns);
  }
}

applyRuntimeOptions();

function getRootGroupNameFromOptions() {
  const value = getOption('rootGroupName', 'root_group_name', 'groupName');
  return cleanName(value);
}

// 当前 File Operator 在部分 Sub-Store 版本中 context.source 可能为 null。
// 保留探测逻辑，未来若 Sub-Store 暴露文件元数据可自动使用。
function getCurrentFileDisplayName() {
  const contexts = [];

  try {
    if (typeof context !== 'undefined' && context) contexts.push(context);
  } catch (_) {}

  try {
    if (typeof $context !== 'undefined' && $context) contexts.push($context);
  } catch (_) {}

  for (const ctx of contexts) {
    try {
      const directName = cleanName(ctx.displayName || ctx.name);
      if (directName) return directName;

      const source = ctx.source;
      if (source && typeof source === 'object') {
        for (const key of ['$file', '_file', '_mihomoConfig', '_source']) {
          const value = source[key];
          if (value && typeof value === 'object') {
            const name = cleanName(value.displayName || value.name);
            if (name) return name;
          }
        }

        for (const [key, value] of Object.entries(source)) {
          if (!key.startsWith('_') && value && typeof value === 'object') {
            const name = cleanName(value.displayName || value.name);
            if (name) return name;
          }
        }
      }
    } catch (_) {}
  }

  try {
    if (typeof $options !== 'undefined' && $options) {
      const candidates = [
        $options.file,
        $options._file,
        $options.source,
        $options._source
      ];

      for (const item of candidates) {
        if (item && typeof item === 'object') {
          const name = cleanName(item.displayName || item.name);
          if (name) return name;
        }
      }
    }
  } catch (_) {}

  return '';
}

function resolveRootGroupName() {
  return getRootGroupNameFromOptions()
    || getCurrentFileDisplayName()
    || FALLBACK_ROOT_GROUP;
}

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
// 可选读取落地节点
// -------------------------
let landings = [];
let landingEnabled = false;

try {
  const landingProxies = await produceArtifact({
    type: 'subscription',
    name: LANDING_SUBSCRIPTION,
    platform: 'ClashMeta',
    produceType: 'internal'
  });

  landings = validProxies(landingProxies);
  landingEnabled = landings.length > 0;
} catch (_) {
  landings = [];
  landingEnabled = false;
}

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

  // 落地节点只允许出现在顶层组，不能混入其他策略组。
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

  let rootGroupName = resolveRootGroupName();

  if (rootGroupName === MANUAL_GROUP) {
    rootGroupName = FALLBACK_ROOT_GROUP;
  }

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

  // 原来引用「🚀 节点选择」的其他策略组改为引用新的顶层组。
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

  // 原规则最终出口改为新的顶层组。
  if (Array.isArray(yaml.rules)) {
    yaml.rules = yaml.rules.map(rule => {
      if (typeof rule !== 'string') return rule;
      return rule.split(OLD_MANUAL_GROUP).join(rootGroupName);
    });
  }
} else {
  yaml.proxies = Array.from(merged.values());
}

$content = ProxyUtils.yaml.safeDump(yaml);
