// Sub-Store 文件操作脚本
// 作用：
// 1. 把「机场合集」collection 的全部节点注入当前 Mihomo 配置。
// 2. 如果 Sub-Store 中存在「落地节点」subscription，则把它的节点注入配置。
// 3. 为落地节点设置 dialer-proxy: 🔗 前置代理。
// 4. 自动创建/更新「🔗 前置代理」策略组，仅包含机场合集节点，避免代理链循环。
// 5. 把所有落地节点直接加入「🚀 节点选择」手动选择组。
// 6. 如果「落地节点」订阅不存在、读取失败或没有有效节点，则整段落地逻辑跳过，不影响正常配置生成。
//
// 适用于：文件 -> mihomo 配置 -> 操作 -> 脚本操作

const yaml = ProxyUtils.yaml.safeLoad($content ?? $files[0]) || {};

const AIRPORT_COLLECTION = '机场合集';
const LANDING_SUBSCRIPTION = '落地节点';
const MANUAL_GROUP = '🚀 节点选择';
const DIALER_GROUP = '🔗 前置代理';

function uniqueNames(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function validProxies(proxies) {
  return Array.isArray(proxies)
    ? proxies.filter(proxy => proxy && proxy.name)
    : [];
}

// -------------------------
// 读取机场合集
// -------------------------
// 机场合集是主节点来源，因此这里保持必需；读取失败时让 Sub-Store 正常抛错，方便发现配置问题。
const airportProxies = await produceArtifact({
  type: 'collection',
  name: AIRPORT_COLLECTION,
  platform: 'ClashMeta',
  produceType: 'internal'
});

const airports = validProxies(airportProxies);

// -------------------------
// 可选读取「落地节点」订阅
// -------------------------
// Sub-Store 没有单独的 exists() 判断时，最稳妥的方式是尝试 produceArtifact：
// - 订阅存在且有节点 -> 启用落地逻辑
// - 订阅不存在 / 读取失败 / 返回空数组 -> 跳过落地逻辑
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
  // 「落地节点」是可选订阅，不应因为不存在而导致整个 Mihomo 文件生成失败。
  landingEnabled = false;
  landings = [];

  try {
    console.log(`[mihomo] 未找到或无法读取「${LANDING_SUBSCRIPTION}」订阅，已跳过落地节点处理`);
  } catch (_) {}
}

// -------------------------
// 如果存在落地节点，为其设置前置代理
// -------------------------
if (landingEnabled) {
  // 不要把 dialer-proxy 指向「全部节点」或 include-all 自动组，
  // 否则该组可能包含落地节点自身，容易形成代理链循环。
  // 「🔗 前置代理」只包含机场合集入口节点。
  for (const proxy of landings) {
    proxy['dialer-proxy'] = DIALER_GROUP;
  }
}

// -------------------------
// 合并 proxies
// -------------------------
// 保留模板已有静态节点；再加入机场节点；仅在落地订阅有效时加入落地节点。
// 按 name 去重，后加入的节点优先。
const existingProxies = Array.isArray(yaml.proxies) ? yaml.proxies : [];
const merged = new Map();

for (const proxy of existingProxies) {
  if (proxy && proxy.name) {
    merged.set(proxy.name, proxy);
  }
}

for (const proxy of airports) {
  merged.set(proxy.name, proxy);
}

if (landingEnabled) {
  for (const proxy of landings) {
    merged.set(proxy.name, proxy);
  }
}

yaml.proxies = Array.from(merged.values());

// -------------------------
// 策略组辅助函数
// -------------------------
yaml['proxy-groups'] = Array.isArray(yaml['proxy-groups'])
  ? yaml['proxy-groups']
  : [];

function findGroup(name) {
  return yaml['proxy-groups'].find(group => group && group.name === name);
}

// -------------------------
// 只有存在「落地节点」订阅且有有效节点时，才处理相关策略组
// -------------------------
if (landingEnabled) {
  // 创建 / 更新「🔗 前置代理」
  // 使用 select，显式限定只能选择机场合集节点。
  const airportNames = uniqueNames(airports.map(proxy => proxy.name));
  let dialerGroup = findGroup(DIALER_GROUP);

  if (!dialerGroup) {
    dialerGroup = {
      name: DIALER_GROUP,
      type: 'select',
      proxies: airportNames
    };

    // 放在策略组前面，便于 UI 中查看和切换入口节点。
    yaml['proxy-groups'].unshift(dialerGroup);
  } else {
    dialerGroup.type = 'select';
    dialerGroup.proxies = airportNames;

    // 避免旧配置中的动态包含规则把落地节点混进来。
    delete dialerGroup['include-all'];
    delete dialerGroup.use;
    delete dialerGroup.filter;
    delete dialerGroup['exclude-filter'];
    delete dialerGroup['exclude-type'];
  }

  // 把落地节点加入手动选择组
  const landingNames = uniqueNames(landings.map(proxy => proxy.name));
  let manualGroup = findGroup(MANUAL_GROUP);

  if (!manualGroup) {
    manualGroup = {
      name: MANUAL_GROUP,
      type: 'select',
      proxies: landingNames
    };

    yaml['proxy-groups'].push(manualGroup);
  } else {
    const existingManualItems = Array.isArray(manualGroup.proxies)
      ? manualGroup.proxies
      : [];

    manualGroup.proxies = uniqueNames([
      ...existingManualItems,
      ...landingNames
    ]);
  }
}

$content = ProxyUtils.yaml.safeDump(yaml);
