// Sub-Store 文件操作脚本
const yaml = ProxyUtils.yaml.safeLoad($content ?? $files[0]) || {};

const NODE_SELECT_GROUP = '🚀 节点选择';
const DEFAULT_LANDING_ROOT_GROUP = '🚀 代理选择';

function uniqueNames(items){return Array.from(new Set((items||[]).filter(Boolean)))}
function validProxies(proxies){return Array.isArray(proxies)?proxies.filter(proxy=>proxy&&proxy.name):[]}
function uniqueProxies(proxies){const map=new Map();for(const proxy of validProxies(proxies))map.set(proxy.name,proxy);return Array.from(map.values())}
function escapeRegex(text=''){return String(text).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}
function cleanName(value){if(value===null||value===undefined)return '';return String(value).trim()}
function lower(value){return cleanName(value).toLowerCase()}
function getRequestQuery(){try{if(typeof $options!=='undefined'&&$options&&$options._req&&$options._req.query&&typeof $options._req.query==='object')return $options._req.query}catch(_){}return {}}
function getScriptArguments(){try{if(typeof $arguments!=='undefined'&&$arguments&&typeof $arguments==='object')return $arguments}catch(_){}return {}}
const requestQuery=getRequestQuery();
const scriptArguments=getScriptArguments();
function getCaseInsensitive(obj,key){if(!obj||typeof obj!=='object')return undefined;const wanted=String(key).toLowerCase();for(const actualKey of Object.keys(obj)){if(String(actualKey).toLowerCase()===wanted){const value=obj[actualKey];if(value!==undefined&&value!==null&&value!=='')return value}}return undefined}
function getOption(...keys){for(const key of keys){const value=getCaseInsensitive(requestQuery,key);if(value!==undefined)return value}for(const key of keys){const value=getCaseInsensitive(scriptArguments,key);if(value!==undefined)return value}return undefined}
function applyDnsPreset(preset){const value=lower(preset);if(!value||value==='default')return;yaml.dns=yaml.dns&&typeof yaml.dns==='object'?yaml.dns:{};if(['off','false','0'].includes(value)){yaml.dns.enable=false;return}yaml.dns.enable=true;if(value==='cn'){yaml.dns['default-nameserver']=['223.5.5.5','223.6.6.6','119.29.29.29','119.28.28.28'];yaml.dns.nameserver=['https://223.5.5.5/dns-query','https://doh.pub/dns-query','https://dns.alidns.com/dns-query'];return}if(value==='global'){yaml.dns['default-nameserver']=['1.1.1.1','8.8.8.8','9.9.9.9'];yaml.dns.nameserver=['https://1.1.1.1/dns-query','https://8.8.8.8/dns-query','https://dns.quad9.net/dns-query']}}
function applyRuntimeOptions(){const profile=lower(getOption('profile'))||'default';if(profile==='home'){yaml['allow-lan']=true;if(getOption('dns')===undefined)applyDnsPreset('cn')}else if(profile==='router'){yaml['allow-lan']=true;yaml['bind-address']='*';if(getOption('dns')===undefined)applyDnsPreset('cn')}else if(profile==='phone'){yaml['allow-lan']=false;if(getOption('dns')===undefined)applyDnsPreset('global')}const mode=lower(getOption('mihomo_mode','mihomoMode'));if(['rule','global','direct'].includes(mode))yaml.mode=mode;const dns=getOption('dns');if(dns!==undefined)applyDnsPreset(dns)}
function getConfiguredRootGroupName(){return cleanName(getOption('rootGroupName','root_group_name','groupName'))}
function getSubName(){const name=cleanName(getOption('sub'));if(!name)throw new Error('缺少必填参数 sub：请指定组合订阅或单个订阅名称');return name}
function getRuleProviderBase(){const value=cleanName(getOption('rule_provider_base','ruleProviderBase'));return value?value.replace(/\/+$/,''):''}
function parseLandingSubscriptionNames(){const raw=getOption('landing');if(raw===undefined)return[];const value=cleanName(raw);if(!value||['none','off','false','0'].includes(value.toLowerCase()))return[];return uniqueNames(value.split(',').map(name=>cleanName(name)).filter(Boolean))}
async function readArtifact(type,name){try{return validProxies(await produceArtifact({type,name,platform:'ClashMeta',produceType:'internal'}))}catch(_){return[]}}
async function resolveMainProxies(){const name=getSubName();const collection=await readArtifact('collection',name);if(collection.length>0)return collection;const subscription=await readArtifact('subscription',name);if(subscription.length>0)return subscription;throw new Error(`主订阅来源 "${name}" 不存在，或没有可用节点（已依次尝试组合订阅和单个订阅）`)}
async function resolveLandingProxies(){const subscriptionNames=parseLandingSubscriptionNames();if(subscriptionNames.length===0)return[];const result=[];for(const subscriptionName of subscriptionNames){const proxies=await readArtifact('subscription',subscriptionName);if(proxies.length===0)throw new Error(`Landing 订阅 "${subscriptionName}" 不存在，或订阅中没有可用节点`);result.push(...proxies)}return uniqueProxies(result)}
function rewriteGroupReferences(fromName,toName,excludeGroups=[]){if(!fromName||fromName===toName)return;for(const group of yaml['proxy-groups']){if(!group||excludeGroups.includes(group)||!Array.isArray(group.proxies))continue;group.proxies=uniqueNames(group.proxies.map(name=>name===fromName?toName:name))}if(Array.isArray(yaml.rules)){yaml.rules=yaml.rules.map(rule=>typeof rule==='string'?rule.split(fromName).join(toName):rule)}}
function injectCustomRules(ruleProviderBase,proxyGroup){if(!ruleProviderBase)return;const providerDefs={'custom-reject':{type:'http',behavior:'classical',format:'yaml',url:`${ruleProviderBase}/custom-reject.yaml`,path:'./ruleset/custom-reject.yaml',interval:86400},'custom-proxy':{type:'http',behavior:'classical',format:'yaml',url:`${ruleProviderBase}/custom-proxy.yaml`,path:'./ruleset/custom-proxy.yaml',interval:86400},'custom-direct':{type:'http',behavior:'classical',format:'yaml',url:`${ruleProviderBase}/custom-direct.yaml`,path:'./ruleset/custom-direct.yaml',interval:86400}};yaml['rule-providers']={...(yaml['rule-providers']||{}),...providerDefs};yaml.rules=Array.isArray(yaml.rules)?yaml.rules:[];const prefixes=['RULE-SET,custom-reject,','RULE-SET,custom-proxy,','RULE-SET,custom-direct,'];yaml.rules=yaml.rules.filter(rule=>typeof rule!=='string'||!prefixes.some(prefix=>rule.startsWith(prefix)));yaml.rules.unshift('RULE-SET,custom-reject,REJECT',`RULE-SET,custom-proxy,${proxyGroup}`,'RULE-SET,custom-direct,DIRECT')}

applyRuntimeOptions();
const airports=await resolveMainProxies();
const landings=await resolveLandingProxies();
const landingEnabled=landings.length>0;
const configuredRootGroupName=getConfiguredRootGroupName();
let finalRootGroupName=configuredRootGroupName||(landingEnabled?DEFAULT_LANDING_ROOT_GROUP:NODE_SELECT_GROUP);

const existingProxies=Array.isArray(yaml.proxies)?yaml.proxies:[];
const merged=new Map();
for(const proxy of existingProxies)if(proxy&&proxy.name)merged.set(proxy.name,proxy);
for(const proxy of airports)merged.set(proxy.name,proxy);
yaml['proxy-groups']=Array.isArray(yaml['proxy-groups'])?yaml['proxy-groups']:[];
function findGroup(name){return yaml['proxy-groups'].find(group=>group&&group.name===name)}

if(landingEnabled){
  if(finalRootGroupName===NODE_SELECT_GROUP){
    throw new Error(`Landing 模式下 root_group_name 不能与 "${NODE_SELECT_GROUP}" 同名；请设置一个外层 Root Group 名称`);
  }

  let nodeSelectGroup=findGroup(NODE_SELECT_GROUP);
  if(!nodeSelectGroup){
    nodeSelectGroup={
      name:NODE_SELECT_GROUP,
      type:'select',
      proxies:uniqueNames(['♻️ 自动选择',...airports.map(proxy=>proxy.name)])
    };
    yaml['proxy-groups'].unshift(nodeSelectGroup);
  }

  const landingNames=uniqueNames(landings.map(proxy=>proxy.name));
  const landingNameSet=new Set(landingNames);
  for(const proxy of landings){proxy['dialer-proxy']=NODE_SELECT_GROUP;merged.set(proxy.name,proxy)}
  yaml.proxies=Array.from(merged.values());

  const landingExcludePattern=landingNames.length?`(?:${landingNames.map(name=>`^${escapeRegex(name)}$`).join('|')})`:'';
  for(const group of yaml['proxy-groups']){
    if(!group)continue;
    if(Array.isArray(group.proxies))group.proxies=group.proxies.filter(name=>!landingNameSet.has(name));
    const isDynamic=group['include-all']||group.use||group.filter;
    if(isDynamic&&landingExcludePattern){const oldExclude=group['exclude-filter'];group['exclude-filter']=oldExclude?`(?:${oldExclude})|${landingExcludePattern}`:landingExcludePattern}
  }

  let rootGroup=findGroup(finalRootGroupName);
  if(!rootGroup){
    rootGroup={name:finalRootGroupName,type:'select',proxies:[]};
    yaml['proxy-groups'].unshift(rootGroup);
  }
  rootGroup.type='select';
  rootGroup.proxies=uniqueNames([...landingNames,NODE_SELECT_GROUP]);
  delete rootGroup['include-all'];delete rootGroup.use;delete rootGroup.filter;delete rootGroup['exclude-filter'];delete rootGroup['exclude-type'];

  // 业务分流统一指向外层 Root；内层「🚀 节点选择」只负责选择前置机场节点。
  rewriteGroupReferences(NODE_SELECT_GROUP,finalRootGroupName,[nodeSelectGroup,rootGroup]);
}else{
  yaml.proxies=Array.from(merged.values());
  let nodeSelectGroup=findGroup(NODE_SELECT_GROUP);

  if(finalRootGroupName===NODE_SELECT_GROUP){
    if(!nodeSelectGroup){
      nodeSelectGroup={name:NODE_SELECT_GROUP,type:'select',proxies:uniqueNames(airports.map(proxy=>proxy.name))};
      yaml['proxy-groups'].unshift(nodeSelectGroup);
    }
  }else{
    if(nodeSelectGroup){
      nodeSelectGroup.name=finalRootGroupName;
      rewriteGroupReferences(NODE_SELECT_GROUP,finalRootGroupName,[nodeSelectGroup]);
    }else{
      nodeSelectGroup={name:finalRootGroupName,type:'select',proxies:uniqueNames(airports.map(proxy=>proxy.name))};
      yaml['proxy-groups'].unshift(nodeSelectGroup);
      rewriteGroupReferences(NODE_SELECT_GROUP,finalRootGroupName,[nodeSelectGroup]);
    }
  }
}

if(lower(yaml.mode)==='global'&&finalRootGroupName!=='GLOBAL'){
  let globalGroup=findGroup('GLOBAL');
  if(!globalGroup){globalGroup={name:'GLOBAL',type:'select',proxies:[]};yaml['proxy-groups'].unshift(globalGroup)}
  globalGroup.type='select';
  globalGroup.proxies=[finalRootGroupName];
  delete globalGroup['include-all'];delete globalGroup.use;delete globalGroup.filter;delete globalGroup['exclude-filter'];delete globalGroup['exclude-type'];
}

injectCustomRules(getRuleProviderBase(),finalRootGroupName);
$content=ProxyUtils.yaml.safeDump(yaml);
