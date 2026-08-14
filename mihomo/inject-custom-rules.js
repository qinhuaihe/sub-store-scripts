// Sub-Store Mihomo 文件操作脚本
//
// 作用：
// 1. 注入 custom-proxy / custom-direct / custom-reject 三个 rule-provider。
// 2. provider 文件只保存“匹配条件”，不绑定具体策略组。
// 3. 当前配置通过 RULE-SET 决定动作：
//    - custom-reject -> REJECT
//    - custom-proxy  -> 可通过 proxyGroup 参数指定，默认 ♻️ 自动选择
//    - custom-direct -> DIRECT
// 4. 自定义规则保持最高优先级，并避免重复注入。
//
// 必填参数：
// - rule_provider_base：rule-provider 文件所在目录的基础 URL。
//   示例：https://raw.githubusercontent.com/<owner>/<repo>/main/rules
//
// 适用于：文件 -> mihomo 配置 -> 操作 -> 脚本操作

const yaml = ProxyUtils.yaml.safeLoad($content ?? $files[0]) || {};

const DEFAULT_PROXY_GROUP = '♻️ 自动选择';

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function getArgumentsObject() {
  const candidates = [];

  try {
    if (typeof $arguments !== 'undefined' && $arguments) candidates.push($arguments);
  } catch (_) {}

  // 兼容未来/其他运行环境可能采用的参数对象。
  try {
    if (typeof context !== 'undefined' && context?.arguments) {
      candidates.push(context.arguments);
    }
  } catch (_) {}

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') return candidate;
  }

  return {};
}

function resolveProxyGroup() {
  const args = getArgumentsObject();
  return cleanText(
    args.proxyGroup ??
    args.proxy_group ??
    args.proxy ??
    DEFAULT_PROXY_GROUP
  ) || DEFAULT_PROXY_GROUP;
}

function resolveRuleProviderBase() {
  const args = getArgumentsObject();
  const value = cleanText(args.rule_provider_base).replace(/\/+$/, '');

  if (!value) {
    throw new Error(
      '缺少必填参数 rule_provider_base，例如：https://raw.githubusercontent.com/<owner>/<repo>/main/rules'
    );
  }

  return value;
}

const proxyGroup = resolveProxyGroup();
const RULE_PROVIDER_BASE = resolveRuleProviderBase();

const providerDefs = {
  'custom-reject': {
    type: 'http',
    behavior: 'classical',
    format: 'yaml',
    url: `${RULE_PROVIDER_BASE}/custom-reject.yaml`,
    path: './ruleset/custom-reject.yaml',
    interval: 86400
  },
  'custom-proxy': {
    type: 'http',
    behavior: 'classical',
    format: 'yaml',
    url: `${RULE_PROVIDER_BASE}/custom-proxy.yaml`,
    path: './ruleset/custom-proxy.yaml',
    interval: 86400
  },
  'custom-direct': {
    type: 'http',
    behavior: 'classical',
    format: 'yaml',
    url: `${RULE_PROVIDER_BASE}/custom-direct.yaml`,
    path: './ruleset/custom-direct.yaml',
    interval: 86400
  }
};

// 合并 rule-providers，不覆盖其他已有 provider。
yaml['rule-providers'] = {
  ...(yaml['rule-providers'] || {}),
  ...providerDefs
};

yaml.rules = Array.isArray(yaml.rules) ? yaml.rules : [];

const prefixes = [
  'RULE-SET,custom-reject,',
  'RULE-SET,custom-proxy,',
  'RULE-SET,custom-direct,'
];

// 移除之前注入过的同名规则，避免重复或 proxyGroup 变更后旧策略残留。
yaml.rules = yaml.rules.filter(rule => {
  if (typeof rule !== 'string') return true;
  return !prefixes.some(prefix => rule.startsWith(prefix));
});

// 自定义规则放最前面，优先级高于 GEOSITE/GEOIP/MATCH 等通用规则。
yaml.rules.unshift(
  'RULE-SET,custom-reject,REJECT',
  `RULE-SET,custom-proxy,${proxyGroup}`,
  'RULE-SET,custom-direct,DIRECT'
);

$content = ProxyUtils.yaml.safeDump(yaml);
