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
//
// 适用于：文件 -> mihomo 配置 -> 操作 -> 脚本操作

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

// 尽量从 Sub-Store 当前脚本上下文中取得“文件显示名称”。
// Sub-Store 官方 demo 对 source 的推荐取法也是优先 displayName，其次 name。
// 不同版本/运行环境上下文可能略有差异，因此这里做了多层兼容。
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
        // 优先当前非内部 source。
        for (const [key, value] of Object.entries(source)) {
          if (!key.startsWith('_') && value && typeof value === 'object') {
            const name = value.displayName || value.name;
            if (name) return String(name).trim();
          }
        }

        // 部分上下文会把当前资源放在内部字段。
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

  // 某些文件操作环境可能会通过 $options 暴露当前文件信息。
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

  try {
    console.log(`[mihomo] 未找到或无法读取「${LANDING_SUBSCRIPTION}」订阅，已跳过落地节点处理`);
  } catch (_) {}
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

// -------------------------
// 落地节点链路处理
// -------------------------
if (landingEnabled) {
  const landingNames = uniqueNames(landings.map(proxy => proxy.name));
  const landingNameSet = new Set(landingNames);

  // 原「🚀 节点选择」就是机场路线的手动选择器。
  // 将它改名为「🚀 手动选择」。
  let manualGroup = findGroup(OLD_MANUAL_GROUP) || findGroup(MANUAL_GROUP);

  if (!manualGroup) {
    // 模板里意外没有原手动组时，兜底创建一个只包含机场节点的 select。
    manualGroup = {
      name: MANUAL_GROUP,
      type: 'select',
      proxies: uniqueNames(airports.map(proxy => proxy.name))
    };
    yaml['proxy-groups'].unshift(manualGroup);
  } else {
    manualGroup.name = MANUAL_GROUP;
  }

  // 落地节点必须通过手动选择的机场路线拨号。
  for (const proxy of landings) {
    proxy['dialer-proxy'] = MANUAL_GROUP;
    merged.set(proxy.name, proxy);
  }

  yaml.proxies = Array.from(merged.values());

  // --------------------------------------------------
  // 确保落地节点不会出现在任何其他策略组中
  // --------------------------------------------------
  // 对显式 proxies：直接删除落地节点名。
  // 对 include-all / use 等动态组：通过 exclude-filter 精确排除落地节点。
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

  // 手动选择本身也不允许直接包含任何落地节点，避免代理链递归。
  if (Array.isArray(manualGroup.proxies)) {
    manualGroup.proxies = manualGroup.proxies.filter(name => !landingNameSet.has(name));
  }

  // --------------------------------------------------
  // 创建顶层选择组：文件显示名称
  // --------------------------------------------------
  let rootGroupName = getCurrentFileDisplayName() || FALLBACK_ROOT_GROUP;

  // 避免与内部手动组重名。
  if (rootGroupName === MANUAL_GROUP) {
    rootGroupName = FALLBACK_ROOT_GROUP;
  }

  // 如果已经有同名组则更新，否则创建。
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

  // 顶层组必须是纯显式选择组，避免动态把其他节点混进来。
  delete rootGroup['include-all'];
  delete rootGroup.use;
  delete rootGroup.filter;
  delete rootGroup['exclude-filter'];
  delete rootGroup['exclude-type'];

  // --------------------------------------------------
  // 更新原配置中对「🚀 节点选择」的引用
  // --------------------------------------------------
  // 原先规则/其他策略组都把 🚀 节点选择 当作总出口。
  // 现在新的总出口是“文件显示名称”组；而旧组本身改名为 🚀 手动选择。
  for (const group of yaml['proxy-groups']) {
    if (!group || group === rootGroup || group === manualGroup) continue;

    if (Array.isArray(group.proxies)) {
      group.proxies = group.proxies.map(name =>
        name === OLD_MANUAL_GROUP ? rootGroupName : name
      );
      group.proxies = uniqueNames(group.proxies);
    }
  }

  if (Array.isArray(yaml.rules)) {
    yaml.rules = yaml.rules.map(rule => {
      if (typeof rule !== 'string') return rule;

      // 只替换策略字段中的组名；模板里组名本身足够独特，直接替换即可。
      return rule.split(OLD_MANUAL_GROUP).join(rootGroupName);
    });
  }

  try {
    console.log(
      `[mihomo] 已启用落地节点：顶层组「${rootGroupName}」 -> [${landingNames.join(', ')}, ${MANUAL_GROUP}]；落地 dialer-proxy -> ${MANUAL_GROUP}`
    );
  } catch (_) {}
} else {
  // 没有落地节点时保持模板原有结构。
  yaml.proxies = Array.from(merged.values());
}

$content = ProxyUtils.yaml.safeDump(yaml);
