// Sub-Store 文件操作脚本
// 作用：
// 1. 把「机场合集」collection 的全部节点注入当前 Mihomo 配置。
// 2. 如果 Sub-Store 中存在「落地节点」subscription，则把它的节点注入配置。
// 3. 为落地节点设置 dialer-proxy: ♻️ 自动选择。
// 4. 当存在落地节点时，把「♻️ 自动选择」限制为仅包含机场合集中的具体节点，避免代理链循环。
// 5. 把所有落地节点直接加入「🚀 节点选择」手动选择组。
// 6. 如果「落地节点」订阅不存在、读取失败、没有有效节点，或模板中不存在「♻️ 自动选择」组，则跳过落地节点相关处理，不影响正常配置生成。
//
// 适用于：文件 -> mihomo 配置 -> 操作 -> 脚本操作

const yaml = ProxyUtils.yaml.safeLoad($content ?? $files[0]) || {};

const AIRPORT_COLLECTION = '机场合集';
const LANDING_SUBSCRIPTION = '落地节点';
const MANUAL_GROUP = '🚀 节点选择';
const AUTO_GROUP = '♻️ 自动选择';

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
const airportProxies = await produceArtifact({
  type: 'collection',
  name: AIRPORT_COLLECTION,
  platform: 'ClashMeta',
  produceType: 'internal'
});

const airports = validProxies(airportProxies);
const airportNames = uniqueNames(airports.map(proxy => proxy.name));

// -------------------------
// 初始化策略组
// -------------------------
yaml['proxy-groups'] = Array.isArray(yaml['proxy-groups'])
  ? yaml['proxy-groups']
  : [];

function findGroup(name) {
  return yaml['proxy-groups'].find(group => group && group.name === name);
}

const autoGroup = findGroup(AUTO_GROUP);

// -------------------------
// 可选读取「落地节点」订阅
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

  // 只有同时满足：
  // 1. 落地节点订阅存在且有有效节点
  // 2. 当前 Mihomo 模板里存在「♻️ 自动选择」策略组
  // 才启用落地节点逻辑。
  landingEnabled = landings.length > 0 && !!autoGroup;

  if (landings.length > 0 && !autoGroup) {
    try {
      console.log(`[mihomo] 找到「${LANDING_SUBSCRIPTION}」订阅，但模板中不存在「${AUTO_GROUP}」策略组，已跳过落地节点处理`);
    } catch (_) {}
  }
} catch (e) {
  landingEnabled = false;
  landings = [];

  try {
    console.log(`[mihomo] 未找到或无法读取「${LANDING_SUBSCRIPTION}」订阅，已跳过落地节点处理`);
  } catch (_) {}
}

// -------------------------
// 如果启用落地节点，则把自动选择限制为机场合集中的具体节点
// -------------------------
if (landingEnabled) {
  // 关键点：不能继续使用 include-all。
  // 因为落地节点也会被注入 yaml.proxies，include-all 会把落地节点自身加入自动组，
  // 进而可能形成：落地节点 -> ♻️ 自动选择 -> 落地节点 的循环。
  autoGroup.proxies = airportNames;

  delete autoGroup['include-all'];
  delete autoGroup.use;
  delete autoGroup.filter;
  delete autoGroup['exclude-filter'];
  delete autoGroup['exclude-type'];

  // 保留模板原有的 type/url/interval/tolerance/lazy 等 url-test 参数。

  for (const proxy of landings) {
    proxy['dialer-proxy'] = AUTO_GROUP;
  }
}

// -------------------------
// 合并 proxies
// -------------------------
// 模板已有静态节点 -> 机场合集 -> 落地节点（仅启用时）
// 同名节点以后加入者优先。
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
// 把落地节点加入「🚀 节点选择」
// -------------------------
if (landingEnabled) {
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
