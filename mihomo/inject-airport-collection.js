// Sub-Store 文件操作脚本
//
// 作用：
// 1. 把「机场合集」collection 的全部节点注入当前 Mihomo 配置。
// 2. 如果存在「落地节点」subscription，则把落地节点注入配置。
// 3. 原「🚀 节点选择」改名为「🚀 手动选择」，继续作为机场入口路线选择组。
// 4. 所有落地节点设置 dialer-proxy: 🚀 手动选择。
// 5. 新建一个顶层 select 组，组名优先使用当前 Sub-Store 文件的“显示名称”。
//    该组仅包含：落地节点 + 🚀 手动选择。
// 6. 落地节点不会进入自动选择、地区、全部节点等其他策略组。
// 7. 如果「落地节点」不存在 / 无节点 / 读取失败，则不改策略组结构，仅注入机场合集。
// 8. 临时输出 substore-debug，用来定位 Mihomo 文件显示名称在运行时上下文中的真实字段。

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
      if (ctx.displayName || ctx.name) {
        return String(ctx.displayName || ctx.name).trim();
      }

      const source = ctx.source;
      if (source && typeof source === 'object') {
        for (const [key, value] of Object.entries(source)) {
          if (!key.startsWith('_') && value && typeof value === 'object') {
            const name = value.displayName || value.name;
            if (name) return String(name).trim();
          }
        }

        for (const key of ['_file', '_mihomoConfig', '_source']) {
          const value = source[key];
          if (value && typeof value === 'object') {
            const name = value.displayName || value.name;
            if (name) return String(name).trim();
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
          const name = item.displayName || item.name;
          if (name) return String(name).trim();
        }
      }
    }
  } catch (_) {}

  return '';
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
} catch (e) {
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

  let rootGroupName = getCurrentFileDisplayName() || FALLBACK_ROOT_GROUP;

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
  yaml.proxies = Array.from(merged.values());
}

// =====================================================
// 临时调试：把文件操作运行时上下文直接输出到最终 YAML
// 找到显示名称字段后会删除这一段。
// =====================================================
function makeDebugSafe(value, depth = 0, seen = new WeakSet()) {
  if (depth > 6) return '[max-depth]';

  if (value === null || value === undefined) return value ?? null;

  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return value;
  if (type === 'function') return '[function]';
  if (type !== 'object') return String(value);

  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, 30).map(item => makeDebugSafe(item, depth + 1, seen));
  }

  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    try {
      result[key] = makeDebugSafe(item, depth + 1, seen);
    } catch (_) {
      result[key] = '[unreadable]';
    }
  }
  return result;
}

const debug = {
  detectedDisplayName: getCurrentFileDisplayName() || null,
  context: null,
  $context: null,
  $options: null
};

try {
  debug.context = typeof context !== 'undefined'
    ? makeDebugSafe(context)
    : '[undefined]';
} catch (e) {
  debug.context = `[error: ${String(e)}]`;
}

try {
  debug.$context = typeof $context !== 'undefined'
    ? makeDebugSafe($context)
    : '[undefined]';
} catch (e) {
  debug.$context = `[error: ${String(e)}]`;
}

try {
  debug.$options = typeof $options !== 'undefined'
    ? makeDebugSafe($options)
    : '[undefined]';
} catch (e) {
  debug.$options = `[error: ${String(e)}]`;
}

yaml['substore-debug'] = debug;

$content = ProxyUtils.yaml.safeDump(yaml);
