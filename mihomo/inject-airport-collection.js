// Sub-Store 文件操作脚本
//
// 作用：
// 1. 把「机场合集」collection 的全部节点注入当前 Mihomo 配置。
// 2. 如果存在「落地节点」subscription，则把落地节点注入配置。
// 3. 原「🚀 节点选择」改名为「🚀 手动选择」，继续作为机场入口路线选择组。
// 4. 所有落地节点设置 dialer-proxy: 🚀 手动选择。
// 5. 新建顶层 select 组：优先使用 rootGroupName 参数，其次尝试当前文件显示名称，最后使用默认名称。
// 6. 顶层组仅包含：落地节点 + 🚀 手动选择。
// 7. 落地节点不会进入自动选择、地区、全部节点等其他策略组。
// 8. 如果「落地节点」不存在 / 无节点 / 读取失败，则不改策略组结构，仅注入机场合集。
//
// 注意：本脚本只负责节点注入和落地链路，不负责 rule-provider 或自定义规则注入。

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

function getRootGroupNameFromArguments() {
  const candidates = [];

  try {
    if (typeof $arguments !== 'undefined' && $arguments) candidates.push($arguments);
  } catch (_) {}

  try {
    if (typeof arguments !== 'undefined' && arguments && typeof arguments === 'object') {
      candidates.push(arguments);
    }
  } catch (_) {}

  for (const args of candidates) {
    try {
      const value = args.rootGroupName ?? args.root_group_name ?? args.groupName;
      const name = cleanName(value);
      if (name) return name;
    } catch (_) {}
  }

  return '';
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
  return getRootGroupNameFromArguments()
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
