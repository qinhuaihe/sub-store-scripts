// Sub-Store 文件操作脚本
// 作用：
// 1. 把「机场合集」collection 的全部节点注入当前 Mihomo 配置。
// 2. 把「落地节点」subscription 的全部节点注入配置。
// 3. 为所有落地节点设置 dialer-proxy: 🔗 前置代理。
// 4. 自动创建/更新「🔗 前置代理」策略组，仅包含机场合集节点，避免代理链循环。
// 5. 把所有落地节点直接加入「🚀 节点选择」手动选择组。
//
// 适用于：文件 -> mihomo 配置 -> 操作 -> 脚本操作

const yaml = ProxyUtils.yaml.safeLoad($content ?? $files[0]) || {};

const AIRPORT_COLLECTION = '机场合集';
const LANDING_SUBSCRIPTION = '落地节点';
const MANUAL_GROUP = '🚀 节点选择';
const DIALER_GROUP = '🔗 前置代理';

// -------------------------
// 读取机场合集
// -------------------------
const airportProxies = await produceArtifact({
  type: 'collection',
  name: AIRPORT_COLLECTION,
  platform: 'ClashMeta',
  produceType: 'internal'
});

// -------------------------
// 读取落地节点订阅
// -------------------------
const landingProxies = await produceArtifact({
  type: 'subscription',
  name: LANDING_SUBSCRIPTION,
  platform: 'ClashMeta',
  produceType: 'internal'
});

const airports = Array.isArray(airportProxies)
  ? airportProxies.filter(proxy => proxy && proxy.name)
  : [];

const landings = Array.isArray(landingProxies)
  ? landingProxies.filter(proxy => proxy && proxy.name)
  : [];

// -------------------------
// 为落地节点设置前置代理
// -------------------------
// 这里不要把 dialer-proxy 指向「全部节点」或 include-all 的自动组，
// 因为这些组可能同时包含落地节点自身，容易形成代理链循环。
// 「🔗 前置代理」只放机场合集里的入口节点，因此更安全。
for (const proxy of landings) {
  proxy['dialer-proxy'] = DIALER_GROUP;
}

// -------------------------
// 合并 proxies
// -------------------------
// 保留模板已有静态节点；然后加入机场节点和落地节点。
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

for (const proxy of landings) {
  merged.set(proxy.name, proxy);
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

function uniqueNames(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

// -------------------------
// 创建 / 更新「🔗 前置代理」
// -------------------------
// 使用 select 而不是 include-all，显式限定只能选择机场合集节点。
// 第一个节点会成为 Mihomo 没有历史选择记录时的默认入口。
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

// -------------------------
// 把落地节点加入手动选择组
// -------------------------
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

$content = ProxyUtils.yaml.safeDump(yaml);
