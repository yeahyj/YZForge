'use strict';
const field = (id, label, type = 'text', extra = '') =>
    type === 'checkbox'
        ? `<label class="check"><input id="${id}" type="checkbox" ${extra}><span>${label}</span></label>`
        : `<label>${label}<input id="${id}" type="${type}" ${extra}></label>`;
const select = (id, label, values = [], extra = '') =>
    `<label>${label}<select id="${id}" ${extra}>${values.map(([key, text]) => `<option value="${key}">${text}</option>`).join('')}</select></label>`;
const button = (id, text, extra = '') => `<button id="${id}" ${extra}>${text}</button>`;
const kinds = [
    ['module', '模块'],
    ['bundle', '资源包'],
    ['page', '页面 · Page'],
    ['popup', '弹窗 · Popup'],
    ['overlay', '覆盖层 · Overlay'],
    ['toast', '提示 · Toast'],
    ['loading', '加载界面 · Loading'],
    ['part', 'UI 部件 · Part'],
    ['prefab', '通用预制体'],
    ['component', '节点脚本 · Component'],
    ['service', '业务服务 · Service'],
    ['table', '配置表 · XLSX'],
];
const tabs = [
    ['create', '创建内容', '模块 / 界面 / 脚本', 'M12 5v14M5 12h14'],
    ['bindings', '自动绑定', '扫描并连接节点', 'M9 15l6-6M8 17H6a4 4 0 010-8h3m6-2h3a4 4 0 010 8h-3'],
    ['tables', '配置表', '工作簿与导出', 'M4 4h16v16H4zM4 10h16M10 4v16'],
    ['settings', '项目设置', '分包 / 音频 / 日历', 'M4 7h16M4 17h16M8 4v6M16 14v6'],
    ['recovery', '删除与恢复', '引用检查与操作记录', 'M5 8a8 8 0 111 10M5 3v6h6'],
];
module.exports = `<main id="workbench">
<header class="topbar"><span class="brand-mark">Y</span><div class="brand"><strong>YZForge</strong><span>框架工作台</span></div><span id="health" class="badge">正在连接</span>${button('refresh', '刷新', 'class="quiet"')}</header>
<div class="workspace"><aside><div class="nav-caption">工作流程</div><nav role="tablist" aria-label="工作台页面">${tabs.map(([id, title, detail, icon]) => `<button data-tab="${id}" role="tab" aria-selected="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icon}"/></svg><span>${title}<small>${detail}</small></span></button>`).join('')}</nav><div class="sidebar-foot"><span id="summary"></span><span id="project" title="当前项目"></span></div></aside>
<div class="body"><div class="context">${select('module', '当前模块')}<span id="moduleTag" class="badge subtle"></span><div class="context-actions">${button('check', '检查项目', 'class="quiet"')}${button('generate', '同步清单与配置')}</div></div><div id="autoStatus" class="notice" role="status"></div>
<section class="pages">
<article data-page="create"><div class="page-head"><div><h1>创建内容</h1><p>选择职责，预览文件，然后创建。</p></div><span class="badge subtle">自动命名 · 自动登记</span></div>
<div class="split"><div class="card"><h2>基本信息</h2><div class="grid">${select('kind', '创建类型', kinds)}${field('newName', '名称', 'text', 'placeholder="例如 Inventory 或 Reward" autocomplete="off"')}</div><div id="moduleOptions"><div class="grid">${field('displayName', '显示名称（可选）', 'text', 'placeholder="便于团队识别的名称"')}${select(
    'delivery',
    '代码交付',
    [
        ['bundled', '按需加载代码包'],
        ['eager', '随应用启动加载'],
        ['none', '仅资源与配置'],
    ],
)}</div>${select('initial', '初始内容', [
    ['resources', '同时创建默认资源包'],
    ['code', '仅创建代码'],
])}</div>
<div id="bundleOptions">${select('bundle', '目标资源包')}</div><div id="presenterOptions">${field('presenter', '同时创建 Presenter（复杂页面可选）', 'checkbox')}</div><div id="adoptOptions">${select('adopt', '预制体来源')}</div><p id="roleHelp" class="hint"></p><div id="createIssue" class="issue" role="alert" hidden></div></div>
<div class="card preview-card"><div class="card-heading"><h2>文件预览</h2><span id="fileCount" class="badge subtle">等待名称</span></div><p class="hint">修改输入后自动校验；包含脚本、预制体和生成文件。</p><div id="createPreview" class="file-list empty">填写名称，即可查看所有文件的名字和位置。</div><div class="card-actions">${button('previewCreate', '重新预览', 'class="quiet"')}${button('create', '创建这些内容', 'class="primary" disabled')}</div></div></div>
<details class="card"><summary>当前模块设置 <span id="moduleDirty" class="dirty"></span></summary><div class="grid">${field('moduleDisplayName', '显示名称')}${select('dependencies', '业务依赖（Ctrl / Cmd 多选）', [], 'multiple size="3"')}</div><p class="hint">依赖的类型入口随声明自动生成。纯资源模块无需业务依赖。</p>${button('saveModule', '保存模块设置')}<details><summary>查看模块声明</summary><pre id="moduleInfo"></pre></details></details></article>
<article data-page="bindings" hidden><div class="page-head"><div><h1>自动绑定</h1><p>按命名规则连接节点，无需拖拽引用。</p></div></div><div class="card"><h2>选择预制体</h2>${select('binding', '界面或部件')}<div class="card-actions">${button('bind', '扫描并更新绑定', 'class="primary"')}</div><p id="bindingEmpty" class="hint"></p></div><div class="card"><h2>节点命名示例</h2><div class="examples"><code>btn_confirm <span>Button</span></code><code>lbl_title <span>Label</span></code><code>spr_icon <span>Sprite</span></code></div><p>增删节点或改名后重新扫描。嵌套预制体保留各自的绑定边界。</p><p>已有预制体可在“创建内容”选择 Part 或通用预制体接入。</p><details><summary>查看已登记的绑定</summary><pre id="bindingInfo"></pre></details></div></article>
<article data-page="tables" hidden><div class="page-head"><div><h1>配置表</h1><p>在工作簿中维护数据，在这里选择导出目标并校验。</p></div><span id="tableDirty" class="dirty"></span></div><div class="card"><div class="grid">${select('workbook', '当前工作簿')}${select('table', '导出表')}</div><div class="card-actions">${button('openWorkbook', '打开工作簿', 'class="quiet"')}${button('previewTables', '预览校验')}</div><div id="tableEmpty" class="hint"></div></div><div class="card"><h2>导出设置</h2><div class="grid">${select('workbookBundle', '工作簿默认资源包')}${select('tableBundle', '此表的资源包')}${select('sheet', '数据工作表')}${select('primaryKey', '主键字段')}</div><div class="checks">${field('workbookEnabled', '启用工作簿', 'checkbox')}${field('tableEnabled', '启用此表', 'checkbox')}${field('tablePublic', '公开类型合同，供其他模块使用', 'checkbox')}</div><div class="card-actions">${button('saveTable', '保存设置', 'class="primary"')}${button('exportTables', '校验并导出')}</div></div><details class="card"><summary>公式与高级声明</summary><p>正式导出使用经过重算校验的结果；工作簿中的缓存仅用于预览。</p>${button('formulaEnvironment', '检测公式环境')}${button('recalculate', '重新计算公式')}<p>__config 定义索引、约束、分片及工作簿联动；__enums 定义可用于类型行的枚举。</p><pre id="tableInfo"></pre></details></article>
<article data-page="settings" hidden><div class="page-head"><div><h1>项目设置</h1><p>统一维护交付方式和框架默认行为。</p></div><span id="settingsDirty" class="dirty"></span></div><div class="card"><h2>Bundle 公共配置</h2><p>代码与资源分别使用独立配置。支持分包的小游戏使用分包交付。</p>${button('ensurePresets', '检查配置')}${button('bundleSettings', '打开 Creator 配置', 'class="quiet"')}<details><summary>配置详情</summary><pre id="presets"></pre></details></div><div class="card"><h2>业务日历</h2><div class="grid">${select(
    'utcOffset',
    '固定业务时区',
    [
        [0, 'UTC · 世界标准时间'],
        [480, 'UTC+08:00 · 中国标准时间'],
        [540, 'UTC+09:00'],
        [330, 'UTC+05:30'],
        [-300, 'UTC−05:00'],
        [-480, 'UTC−08:00'],
    ],
)}${field('dayBoundary', '每日刷新时间', 'time')}${select('weekStart', '每周起始日', [
    [1, '星期一'],
    [0, '星期日'],
    [2, '星期二'],
    [3, '星期三'],
    [4, '星期四'],
    [5, '星期五'],
    [6, '星期六'],
])}</div><p class="hint">日期显示与日、周、月、年边界共用此规则。固定时区不自动应用夏令时。</p></div><div class="card"><h2>应用与音频</h2><div class="grid">${field('appId', '应用标识')}${field('maxVoices', '最大同时播放数量', 'number', 'min="1" step="1"')}</div><div id="audioChannels" class="grid"></div><details><summary>运行与节点高级设置</summary><div class="grid">${field('cleanupTimeout', '清理诊断超时（毫秒）', 'number', 'min="1"')}${select(
    'wechatClockUnit',
    '微信性能计时单位',
    [
        ['microseconds', '微秒'],
        ['milliseconds', '毫秒'],
    ],
)}</div><p class="hint">清理超时用于报告未结束工作，不会强制释放仍在使用的资源。</p><pre id="prefixes"></pre></details><div class="card-actions">${button('saveSettings', '保存项目设置', 'class="primary"')}</div></div></article>
<article data-page="recovery" hidden><div class="page-head"><div><h1>删除与恢复</h1><p>先检查引用和文件范围，再执行。恢复遇到后续编辑时保留冲突。</p></div></div><div class="card"><h2>删除内容</h2><div class="grid">${select('deleteModule', '模块或残留目录')}${select(
    'deleteKind',
    '删除范围',
    [
        ['module', '整个模块'],
        ['bundle', '资源包'],
        ['view', '界面及配套脚本'],
        ['prefab', '部件 / 通用预制体及脚本'],
        ['script', '手写脚本'],
    ],
)}</div><div id="deleteItemOptions">${select('deleteItem', '具体内容')}</div><div id="deletePreview" class="file-list empty">预览后显示实际文件和外部引用。</div><div class="card-actions">${button('previewDelete', '检查并预览')}${button('delete', '备份并删除', 'class="danger" disabled')}</div></div>
<div class="card"><h2>已删除的内容</h2>${select('restoreRecord', '可恢复记录')}${button('restore', '恢复并核验引用')}</div><div class="card"><h2>未完成的创建</h2>${select('creationRecord', '创建记录')}<p>创建内容和生成结果分别记录。重试不会把用户后续编辑认领为工具修改。</p><div id="creationPreview" class="file-list empty">没有未完成的创建。</div><div class="card-actions">${button('retryCreation', '重试生成')}${button('previewCreationRollback', '预览撤销', 'class="quiet"')}${button('rollbackCreation', '撤销本次创建', 'class="danger" disabled')}</div></div>
<div class="card"><h2>中断的生成</h2>${select('generationRecord', '生成记录')}<div id="generationPreview" class="file-list empty">没有需要恢复的生成。</div><div class="card-actions">${button('previewGeneration', '预览恢复范围')}${button('recoverGeneration', '恢复上次内容', 'class="danger" disabled')}</div></div></article>
</section><footer><div class="status-line"><span id="statusDot"></span><strong id="status" role="status">就绪</strong><span class="footer-hint">所有操作以当前项目为范围</span></div><details id="logDetails"><summary>操作详情</summary><pre id="output">操作结果与校验信息会显示在这里。</pre></details></footer></div></div></main>`;
