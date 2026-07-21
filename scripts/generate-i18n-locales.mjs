/**
 * Generates locale JSON files from flat translation maps.
 * Run: node scripts/generate-i18n-locales.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const en = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf8'));

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

function unflatten(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = cur[parts[i]] ?? {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = v;
  }
  return out;
}

const flatEn = flatten(en);
const keys = Object.keys(flatEn);

/** Per-locale flat overrides — { localeId: { 'nav.home': '...', ... } } */
const TRANSLATIONS = {
  zh: {
    'nav.home': '首页',
    'nav.locker': '音乐库',
    'nav.feed': '动态',
    'nav.explore': '探索',
    'nav.playlists': '播放列表',
    'nav.podcasts': '播客',
    'nav.djConsole': 'DJ 控制台',
    'nav.settings': '设置',
    'shell.searchPlaceholder.default': '搜索艺术家、专辑或曲目',
    'shell.searchPlaceholder.airGap': '搜索您的音乐库 — 目录已屏蔽',
    'shell.searchPlaceholder.offline': '搜索您的音乐库 — 无网络',
    'shell.searchAriaLabel': '搜索艺术家、专辑或曲目',
    'shell.runSearch': '执行搜索',
    'shell.settings': '设置',
    'shell.profile': '个人资料：{name}',
    'shell.connectivity': '连接状态',
    'login.appName': 'Sandbox Music',
    'login.title': '系统登录',
    'login.placeholder': '输入个人资料名称',
    'login.enterStation': '进入电台',
    'player.noTrack': '无曲目',
    'player.play': '播放',
    'player.pause': '暂停',
    'player.skipBack': '上一首',
    'player.skipForward': '下一首',
    'player.shuffle': '随机播放',
    'player.repeat': '循环',
    'player.thumbsUp': '点赞',
    'player.thumbsDown': '踩',
    'player.mute': '静音',
    'player.unmute': '取消静音',
    'player.volume': '音量',
    'player.volumePercent': '{percent}%',
    'player.lyrics': '打开歌词',
    'player.sleepTimer': '睡眠定时器',
    'player.sleepTimerActive': '睡眠定时器 {label}',
    'player.queue': '打开播放队列',
    'player.queueCount': '队列中有 {count} 首曲目',
    'player.castBrowser': '在浏览器中打开以投射',
    'player.castSpeaker': 'Sandbox 投射到扬声器',
    'player.carMode': '进入车载模式',
    'player.carModeTitle': '车载模式',
    'player.seek': '拖动进度',
    'player.castingTo': '正在投射到 {device}',
    'player.error': '错误',
    'player.resolving': '正在解析流…',
    'player.connecting': '正在连接…',
    'player.sandboxConnect': 'Sandbox Connect',
    'player.unknownTitle': '未知标题',
    'player.unknownArtist': '未知艺术家',
    'home.searchPrompt': '在上方搜索以开始播放',
    'home.featuredLabel': '— 精选推荐 —',
    'home.play': '播放',
    'home.pause': '暂停',
    'home.restart': '重新播放曲目',
    'home.progress': '进度',
    'home.albumArt': '{title} 专辑封面',
    'home.vinylPlayer': '黑胶播放器',
    'home.recentlyAdded': '最近添加到音乐库',
    'home.uploadTracks': '在音乐库中上传曲目',
    'home.mostPlayed': '播放最多',
    'home.playHistory': '播放历史将随收听积累',
    'home.resumeQueue': '恢复上次队列',
    'home.noSavedQueue': '尚无保存的队列',
    'home.tracksInQueue': '{count} 首曲目',
    'home.tracksInQueuePlural': '{count} 首曲目',
    'home.yourListening': '您的收听',
    'home.minutesThisMonth': '本月 {minutes}',
    'home.topArtist': '最爱：{artist}',
    'home.sessionsLogged': '已记录 {count} 次会话',
    'home.sessionsLoggedPlural': '已记录 {count} 次会话',
    'home.localStats': '本地统计 · 私密 · 不上传',
    'settings.controlPanel': '系统控制面板',
    'settings.title': '设置',
    'settings.subtitle': '定制高保真偏好与分区沙盒管理。',
    'settings.profile': '个人资料',
    'settings.signOut': '退出登录',
    'settings.tabs.fidelity': '音频保真度',
    'settings.tabs.playback': '播放引擎',
    'settings.tabs.vault': '设备容量',
    'settings.tabs.architect': '主题设计器',
    'settings.tabs.addons': '插件',
    'settings.tabs.telemetry': '信号台',
    'settings.tabs.diagnostics': '诊断',
    'settings.tabs.security': '防护',
    'settings.fidelity.title': '音频保真解码分辨率',
    'settings.fidelity.hint': '配置活动分辨率限制。真正的监听音箱需要无损以绕过压缩。',
    'settings.fidelity.standard': '标准',
    'settings.fidelity.standardDesc': '1411 kbps 标准网络音频文件解码',
    'settings.fidelity.high': '高',
    'settings.fidelity.highDesc': '预加载 24 位 FLAC 容器',
    'settings.fidelity.lossless': '无损',
    'settings.fidelity.losslessDesc': '绕过硬件压缩限制',
    'settings.fidelity.castTitle': '扬声器与 SANDBOX 投射输出',
    'settings.language.title': '语言',
    'settings.language.hint': '选择界面语言。更改将立即应用于整个应用。',
    'settings.language.interfaceLabel': '界面语言',
    'settings.language.active': '当前：{code} — 已保存在此设备。',
    'settings.architect.typography': '平台字体',
    'settings.architect.engineTheming': '引擎主题',
    'settings.architect.engineHint': '全平台实时 HSL 强调色扫描与结构强度。',
    'settings.architect.hueSpectrum': '色相光谱',
    'settings.architect.chassisAccent': '机箱发光强调色',
    'settings.architect.borderRadius': '容器边缘圆角',
    'settings.architect.activePreset': '活动预设信号',
    'settings.architect.activeSystemSignal': '活动系统信号',
    'settings.architect.albumCardSize': '专辑卡片大小',
    'settings.architect.albumCardHint': '缩放专辑和播放列表卡片。越大每行越少，细节越多。',
    'settings.cancelTimer': '取消定时器',
    'sleep.title': '睡眠与唤醒',
    'sleep.subtitle': '音乐闹钟',
    'sleep.close': '关闭睡眠定时器',
    'sleep.modes.sleep': '睡眠定时器',
    'sleep.modes.wake': '唤醒闹钟',
    'sleep.modes.sounds': '睡眠声音',
    'sleep.tabs.sleepStop': '睡眠停止',
    'sleep.tabs.wakeAlarm': '唤醒闹钟',
    'sleep.tabs.sleepSounds': '睡眠声音',
    'sleep.active': '活动中',
    'sleep.cancelTimer': '取消定时器',
    'sleep.stopAfter': '在…之后停止播放',
    'sleep.cancelWakeAlarm': '取消唤醒闹钟',
    'sleep.wakeAt': '在 {time} 唤醒',
    'sleep.wakeTime': '唤醒时间',
    'sleep.suggestions': '建议',
    'sleep.loadingPicks': '正在加载推荐…',
    'sleep.playForSuggestions': '播放曲目或添加到音乐库以获取建议。',
    'sleep.pickTrack': '选择曲目',
    'sleep.library': '音乐库',
    'sleep.online': '在线',
    'sleep.searchCatalog': '搜索目录中的唤醒曲目',
    'sleep.searchLocker': '搜索音乐库或最近播放',
    'sleep.airGapOnline': '气隙模式已开启。在线目录搜索已禁用 — 请使用音乐库或建议。',
    'sleep.searchingCatalog': '正在搜索目录…',
    'sleep.typeTwoChars': '至少输入 2 个字符以搜索目录。',
    'sleep.noCatalogTracks': '未找到目录曲目。请尝试上方的建议标签。',
    'sleep.noTracksFound': '未找到曲目。请先播放或添加到音乐库。',
    'sleep.catalog': '目录',
    'sleep.catalogPreview': '目录预览（约 30 秒）。将曲目获取到音乐库以获得完整长度的唤醒闹钟，尤其在 Android 上。',
    'sleep.armWakeAlarm': '设置唤醒闹钟',
    'sleep.playing': '正在播放',
    'sleep.ambientLoop': '环境循环活动中',
    'sleep.stopSound': '停止声音',
    'sleep.selectAmbient': '选择环境音',
    'sleep.category': '类别',
    'sleep.fadeOutAfter': '淡出时间',
    'sleep.noTimer': '无定时器',
    'sleep.restartSound': '重新开始声音',
    'sleep.startSleepSound': '开始睡眠声音',
    'connect.title': '设置 Sandbox Connect',
    'connect.steps.hostUrl': '主机 URL',
    'connect.steps.role': '角色',
    'connect.steps.device': '设备',
    'connect.hostUrlTitle': 'Tier34 主机 URL',
    'connect.hostUrlHint': '将遥控器指向在局域网运行 tier34 的机器（手机上不要用 localhost）。',
    'connect.roleTitle': 'Connect 角色',
    'connect.roleHint': '主机播放音频并发布状态。遥控器仅发送传输命令。',
    'connect.roleAuto': '自动',
    'connect.roleAutoHint': '桌面或 Tauri = 主机。手机或平板 = 遥控器。',
    'connect.roleHost': '主机',
    'connect.roleHostHint': '此设备播放音频并将队列状态同步到遥控器。',
    'connect.roleRemote': '遥控器',
    'connect.roleRemoteHint': '仅控制界面 — 播放保留在主机上。',
    'connect.effectiveRole': '有效角色：',
    'connect.deviceTitle': '设备名称',
    'connect.deviceHint': '显示给局域网中的其他 Connect 对等方。可选 — 留空则生成默认名称。',
    'connect.devicePlaceholder': '客厅电脑',
    'connect.testing': '正在测试连接…',
    'connect.testConnection': '测试连接',
    'connect.urlRequired': '请输入 tier34 后端 URL。',
    'connect.urlProtocol': 'URL 必须使用 http:// 或 https://。',
    'connect.urlHost': '请输入有效的主机地址。',
    'connect.urlInvalid': '请输入有效 URL（例如 http://192.168.1.10:3001）。',
    'connect.healthFailed': 'Tier34 /health 无响应。请检查主机是否在局域网上运行。',
    'connect.cannotReach': '无法连接到该 URL 的 tier34。',
    'connect.healthOkRelayTimeout': '健康检查通过。对等同步中继未及时响应 — Connect 可能仍可用。',
    'connect.connected': '已连接 — tier34 健康检查和对等同步中继均可达。',
    'connect.healthOkWsFailed': '健康检查通过。对等同步 WebSocket 无法连接 — 请检查防火墙规则。',
    'connect.healthOkWsBlocked': '健康检查通过。无法从此浏览器打开对等同步 WebSocket。',
    'offline.label': '离线',
    'offline.badge.airGap': '气隙模式',
    'offline.badge.noInternet': '无网络',
    'offline.badge.tier34Offline': 'Tier34 离线',
    'offline.searchHint.airGap': '气隙模式已开启。目录和艺术家图片被屏蔽；此设备上的音乐库和播放列表仍可用。',
    'offline.searchHint.noInternet': '无网络。目录搜索和艺术家图片不可用；此设备上的音乐库仍可用。',
    'offline.searchHint.tier34Offline': 'Tier34 不可达。动态、获取、Connect 和音乐库同步需要 tier34；仍可浏览和播放此设备上存储的曲目。',
    'offline.meilisearchDegraded': '音乐库搜索使用设备内匹配（全文索引离线）。',
    'offline.feed.airGap': '气隙模式会阻止动态。请在设置中关闭，或在本地网络运行 Tier34。',
    'offline.feed.noInternet': '动态需要本地网络上的 Tier34 服务器。打开设置 → 诊断以检查服务器状态。',
    'offline.feed.offline': '在设置 → 插件中开启 Tier34，或打开诊断以检查服务器状态。',
    'feed.title': '动态',
    'feed.subtitle': 'Tier34 服务器在线时，显示来自您自托管服务器的新发布。',
    'feed.loading': '正在加载动态…',
    'feed.offlineLabel': '动态不可用',
    'feed.sections.new': '最新更新',
    'feed.sections.week': '上周',
    'feed.sections.month': '上月',
    'feed.empty.title': '暂无新内容',
    'feed.empty.message': '当 Tier34 服务器索引到新发布时，它们会显示在这里。',
    'offline.lockerSearch': 'Tier34 离线 — 仅搜索此设备上存储的曲目。',
    'offline.connect': 'Connect 需要局域网上的 tier34 对等同步。请检查设置 → 主权系统状态。',
    'offline.acquire.airGap': '气隙模式激活时获取功能已禁用。',
    'offline.acquire.tier34Offline': '获取需要 tier34。Tier34 在线后下载和音乐库同步将恢复。',
    'offline.acquire.noInternet': '获取需要互联网和 tier34 进行源解析。',
    'common.cancel': '取消',
    'common.back': '返回',
    'common.next': '下一步',
    'common.done': '完成',
    'common.save': '保存',
    'common.saving': '正在保存…',
    'carMode.play': '播放',
    'carMode.pause': '暂停',
    'carMode.nextTrack': '下一首',
    'carMode.previousTrack': '上一首',
    'carMode.exit': '退出车载模式',
    'carMode.suggestion': '车载模式建议',
  },
};

const i18nDataDir = path.join(__dirname, 'i18n-data');
if (fs.existsSync(i18nDataDir)) {
  for (const file of fs.readdirSync(i18nDataDir).filter((f) => f.endsWith('.json'))) {
    const locale = file.replace('.json', '');
    const data = JSON.parse(fs.readFileSync(path.join(i18nDataDir, file), 'utf8'));
    TRANSLATIONS[locale] = { ...TRANSLATIONS[locale], ...data };
  }
}

for (const [locale, overrides] of Object.entries(TRANSLATIONS)) {
  const flat = { ...flatEn, ...overrides };
  for (const key of keys) {
    if (!flat[key]) flat[key] = flatEn[key];
  }
  const nested = unflatten(flat);
  fs.writeFileSync(
    path.join(localesDir, `${locale}.json`),
    JSON.stringify(nested, null, 2) + '\n',
    'utf8',
  );
  console.log(`Wrote ${locale}.json (${Object.keys(overrides).length} translated keys)`);
}

console.log(`English source: ${keys.length} keys`);
