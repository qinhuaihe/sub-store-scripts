// Sub-Store 文件操作脚本
// 作用：把名为「机场合集」的 collection 中全部节点注入当前 Mihomo 配置的 proxies。
// 适用于「文件 -> mihomo 配置 -> 操作 -> 脚本操作」。

const yaml = ProxyUtils.yaml.safeLoad($content ?? $files[0]) || {};

const collectionProxies = await produceArtifact({
  type: 'collection',
  name: '机场合集',
  platform: 'ClashMeta',
  produceType: 'internal'
});

// 模板中如果已有静态节点则一并保留；collection 节点追加到后面。
// 按 name 去重，后出现的 collection 节点优先覆盖同名静态节点。
const existingProxies = Array.isArray(yaml.proxies) ? yaml.proxies : [];
const merged = new Map();

for (const proxy of existingProxies) {
  if (proxy && proxy.name) {
    merged.set(proxy.name, proxy);
  }
}

for (const proxy of collectionProxies || []) {
  if (proxy && proxy.name) {
    merged.set(proxy.name, proxy);
  }
}

yaml.proxies = Array.from(merged.values());

$content = ProxyUtils.yaml.safeDump(yaml);
