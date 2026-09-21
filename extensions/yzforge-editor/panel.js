'use strict';
const input = (id, label, type = 'text') => `<label>${label}<input id="${id}" type="${type}"></label>`;
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
    ['prefab', '通用预制体 · Prefab + Component'],
    ['component', '节点脚本 · Component'],
    ['service', '业务服务 · Service'],
    ['table', '配置表 · XLSX'],
];
exports.template = `<main id="workbench"><header><h1>YZForge <small>框架工作台</small></h1>${button('refresh', '刷新')}</header><p id="project"></p><div class="context">${select('module', '当前模块')}<span id="summary"></span>${button('check', '检查')}${button('generate', '生成清单与配置')}</div><nav>${[
    ['create', '创建'],
    ['bindings', '自动绑定'],
    ['tables', '配置表'],
    ['settings', '项目设置'],
    ['recovery', '删除与恢复'],
]
    .map(([id, text]) => `<button data-tab="${id}">${text}</button>`)
    .join('')}</nav><p id="autoStatus"></p><section>
<article data-page="create"><h2>选择要创建的内容</h2><p>名称自动添加角色后缀。Bundle 根目录统一包含 dynamic 与 static；动态清单自动生成。</p><div class="grid">${select('kind', '类型', kinds)}${input('newName', '名称（例如 Inventory）')}</div><div id="moduleOptions" class="grid">${input('displayName', '显示名称（可选）')}${select(
    'delivery',
    '代码加载',
    [
        ['bundled', '按需加载代码包'],
        ['eager', '随应用启动加载'],
    ],
)}${select('initial', '初始资源', [
    ['resources', '创建默认资源包'],
    ['code', '仅代码'],
])}</div><div id="bundleOptions">${select('bundle', '目标资源包')}</div><div id="presenterOptions">${input('presenter', '同时创建 Presenter（复杂页面可选）', 'checkbox')}</div><div id="adoptOptions">${select('adopt', '预制体来源')}</div><p id="roleHelp"></p>${button('previewCreate', '预览所有文件')}${button('create', '创建预览内容', 'class="primary" disabled')}<pre id="createPreview">输入名称后预览，确认后创建。</pre><details><summary>当前模块结构与依赖</summary><pre id="moduleInfo"></pre>${input('moduleDisplayName', '显示名称')}${select('dependencies', '运行依赖（多选）', [], 'multiple size="4"')}${button('saveModule', '保存模块设置')}</details></article>
<article data-page="bindings" hidden><h2>自动绑定节点引用</h2><p>节点按 btn_confirm、lbl_title 等前缀命名。生成 Binding 并自动写回引用，无需拖节点；嵌套预制体保留自己的绑定边界。</p>${select('binding', '预制体')}${button('bind', '扫描节点并更新绑定', 'class="primary"')}<p>已有通用预制体：在“创建”选择 UI 部件或普通预制体，再选择已有文件接入。场景中手动放置的 GameComponent 通过 app.bindScene 注入模块上下文。</p><pre id="bindingInfo"></pre></article>
<article data-page="tables" hidden><h2>XLSX 配置表</h2><p>__config 是唯一导出声明；__enums 定义枚举。数据表依次为字段、类型、默认值、注释，数据从第 5 行开始。</p>${select('workbook', '工作簿')}${button('openWorkbook', '打开工作簿')}${input('workbookEnabled', '启用此工作簿', 'checkbox')}${select('workbookBundle', '工作簿默认资源包')}${select('table', '导出表')}<div class="grid">${select('sheet', '数据工作表')}${select('primaryKey', '主键字段')}${select('tableBundle', '此表的资源包')}${input('tableEnabled', '启用此表', 'checkbox')}${input('tablePublic', '公开 TS 类型合同', 'checkbox')}</div>${button('saveTable', '保存此表设置', 'class="primary"')}${button('previewTables', '预览校验')}${button('recalculate', '重新计算公式')}${button('exportTables', '校验并正式导出')}<pre id="tableInfo"></pre><p>索引、约束、分片路由和跨工作簿输入在 __config 声明；面板保留其余声明。类型行可使用 enum&lt;Quality&gt; 或 enum&lt;module.Quality&gt;。公式缓存仅供预览，正式导出需要重算快照。</p></article>
<article data-page="settings" hidden><h2>项目设置</h2><h3>Bundle 公共配置</h3><p>代码配置和资源配置是 Creator 中的两份真实配置。支持分包的小游戏默认采用分包，其他平台按配置回退。</p>${button('ensurePresets', '检查并创建缺失配置')}${button('bundleSettings', '打开 Creator Bundle 配置')}<pre id="presets"></pre><h3>运行参数</h3><div class="grid">${input('appId', '应用标识')}${input('cleanupTimeout', '清理超时（毫秒）', 'number')}${input('maxVoices', '最大同时播放数量', 'number')}${input('utcOffset', '日历 UTC 偏移（分钟）', 'number')}${select(
    'weekStart',
    '每周起始日',
    [
        [1, '星期一'],
        [0, '星期日'],
        [2, '星期二'],
        [3, '星期三'],
        [4, '星期四'],
        [5, '星期五'],
        [6, '星期六'],
    ],
)}${input('dayBoundary', '日历边界（当天第几分钟）', 'number')}${select('wechatClockUnit', '微信性能计时单位', [
    ['microseconds', '微秒'],
    ['milliseconds', '毫秒'],
])}</div><div id="audioChannels"></div>${button('saveSettings', '保存设置', 'class="primary"')}<details><summary>节点命名前缀</summary><pre id="prefixes"></pre></details></article>
<article data-page="recovery" hidden><h2>检查、备份、删除</h2><p>默认包适用同一流程。外部引用会阻止删除；完整备份后由 Creator 删除，恢复前检查冲突，恢复后核验 UUID。</p><div class="grid">${select('deleteModule', '模块或残留目录')}${select(
    'deleteKind',
    '范围',
    [
        ['module', '整个模块'],
        ['bundle', '资源包'],
        ['view', '界面及配套脚本'],
        ['prefab', '部件/通用预制体及脚本'],
        ['script', '手写脚本'],
    ],
)}</div><div id="deleteItemOptions">${select('deleteItem', '内容')}</div>${button('previewDelete', '检查引用并预览')}${button('delete', '备份并删除预览内容', 'class="danger" disabled')}<pre id="deletePreview">删除前必须预览实际文件清单。</pre><hr>${select('restoreRecord', '可恢复记录')}${button('restore', '恢复并核验 UUID')}</article>
</section><footer><strong id="status">就绪</strong><pre id="output">操作结果与校验信息会显示在这里。</pre></footer></main>`;
exports.style = `:host{display:block;height:100%;color:#dce5f2;background:#1b202a;font:13px/1.6 "Microsoft YaHei",sans-serif}*{box-sizing:border-box}main{height:100%;padding:18px;display:flex;flex-direction:column;gap:10px}header,.context,nav{display:flex;align-items:center;gap:10px}header h1{flex:1}h1{margin:0;font-size:23px;color:#fff}small{font-weight:400;font-size:14px;color:#9baec8}h2{margin:0 0 8px;font-size:19px}h3{font-size:14px}p{margin:4px 0 15px;color:#a0b0c7}#project{font-size:11px;margin:0}section{overflow:auto;flex:1;min-height:180px;padding:6px 8px 16px 0}.context{border-block:1px solid #344154;padding:8px 0}.context label{margin:0;min-width:170px}#summary{flex:1;font-size:12px;color:#9aadc6}nav{gap:5px;flex-wrap:wrap}label{display:flex;flex-direction:column;gap:5px;margin:8px 0 14px;color:#afbed3}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 18px}input,select{font:inherit;color:#e6edf8;background:#121925;border:1px solid #3b4a60;border-radius:5px;padding:7px 10px;width:100%;min-width:0}input:focus,select:focus{outline:1px solid #69aef7}input[type=checkbox]{width:auto;align-self:flex-start}button{font:inherit;border:1px solid #435570;border-radius:5px;background:#29364a;color:#e2ecfb;padding:7px 12px;cursor:pointer;margin:3px 5px 3px 0}button:hover{background:#354963}button.selected,button.primary{background:#25699c;border-color:#488bc0}button.danger{background:#713e49;border-color:#9b6070}button:disabled{opacity:.4;cursor:default}pre{font:12px/1.65 Consolas,"Microsoft YaHei",monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#121925;border:1px solid #344154;border-radius:5px;padding:12px;max-height:260px;overflow:auto;color:#bccde3}details{margin-top:15px}summary{cursor:pointer;color:#b5c9e4}footer{border-top:1px solid #344154;padding-top:8px}#status{color:#8ed7b8;font-weight:400}#output{max-height:125px;margin:5px 0 0}[hidden]{display:none!important}hr{border:0;border-top:1px solid #344154}`;
exports.$ = { workbench: '#workbench' };
exports.methods = {};
exports.ready = function () {
    const el = (id) => this.$.workbench.querySelector('#' + id),
        val = (id) => el(id).value.trim();
    let state,
        createPlan,
        deletePlan,
        workbookDraft,
        busy = false,
        settingsLoaded = false;
    const workbookDrafts = new Map(),
        moduleDrafts = new Map();
    const show = (result) => {
        el('output').textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    };
    const current = () => state?.modules.find((module) => module.id === val('module'));
    const options = (id, items) => {
        const select = el(id),
            old = select.value;
        select.textContent = '';
        for (const [key, title] of items) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = title;
            select.appendChild(option);
        }
        if (items.some(([key]) => key === old)) select.value = old;
    };
    const invalidateCreate = () => {
        createPlan = null;
        el('create').disabled = true;
    };
    const invalidateDelete = () => {
        deletePlan = null;
        el('delete').disabled = true;
    };
    const role = () => {
        const kind = val('kind'),
            ui = ['page', 'popup', 'overlay', 'toast', 'loading'].includes(kind),
            generic = ['part', 'prefab'].includes(kind);
        el('moduleOptions').hidden = kind !== 'module';
        el('bundleOptions').hidden = !(ui || generic || kind === 'table');
        el('presenterOptions').hidden = !ui;
        el('adoptOptions').hidden = !generic;
        el('roleHelp').textContent = ui
            ? 'View 负责渲染与输入；Presenter 组织显示逻辑；跨界面状态放在模块 Service。'
            : generic
              ? '通用组件继承 GameComponent，通过创建实例或场景注入获得上下文。'
              : '';
        invalidateCreate();
    };
    const fields = () =>
        options(
            'primaryKey',
            (workbookDraft?.sheets.find((s) => s.name === val('sheet'))?.fields ?? []).map((f) => [f, f]),
        );
    const loadTable = () => {
        const t = workbookDraft?.config.tables.find((t) => t.id === val('table'));
        options('sheet', workbookDraft?.sheets.map((s) => [s.name, s.name]) ?? []);
        if (t) el('sheet').value = t.sheet;
        fields();
        if (t) {
            el('primaryKey').value = t.primaryKey;
            el('tableBundle').value = t.bundle ?? '';
            el('tableEnabled').checked = t.enabled;
            el('tablePublic').checked = t.public;
        }
        el('tableInfo').textContent = JSON.stringify({ enums: workbookDraft?.enums ?? [], table: t ?? null }, null, 2);
    };
    const loadWorkbook = () => {
        workbookDraft =
            workbookDrafts.get(val('workbook')) ??
            structuredClone(state?.workbooks.find((w) => w.source === val('workbook')) ?? null);
        el('workbookEnabled').checked = workbookDraft?.config.enabled ?? false;
        el('workbookBundle').value = workbookDraft?.config.bundle ?? '';
        options('table', workbookDraft?.config.tables.map((t) => [t.id, t.id]) ?? []);
        loadTable();
    };
    const moduleChanged = () => {
        const m = current(),
            bundles = Object.entries(m?.bundles ?? {}).map(([g, b]) => [g, `${g} · ${b.id}`]);
        options('bundle', bundles);
        options('workbookBundle', bundles);
        options('tableBundle', [['', '使用工作簿默认资源包'], ...bundles]);
        options('adopt', [
            ['', '新建预制体'],
            ...state.prefabs
                .filter((p) =>
                    Object.values(m?.bundles ?? {}).some((bundle) =>
                        p.url.startsWith(`db://assets/game/modules/${m?.id}/${bundle.root}/`),
                    ),
                )
                .map((p) => [p.uuid, p.url.replace(`db://assets/game/modules/${m?.id}/`, '')]),
        ]);
        options('binding', [
            ...Object.entries(m?.views ?? {}).map(([id, v]) => ['view:' + id, `${v.className} · ${v.kind}`]),
            ...Object.entries(m?.components ?? {}).map(([id, c]) => ['component:' + id, c.className]),
        ]);
        el('bindingInfo').textContent = JSON.stringify(
            { views: m?.views ?? {}, components: m?.components ?? {} },
            null,
            2,
        );
        el('moduleInfo').textContent = JSON.stringify(m ?? {}, null, 2);
        const moduleDraft = moduleDrafts.get(m?.id);
        el('moduleDisplayName').value = moduleDraft?.displayName ?? m?.displayName ?? '';
        options(
            'dependencies',
            state.modules
                .filter((other) => other.id !== m?.id)
                .map((other) => [other.id, other.displayName || other.id]),
        );
        for (const option of el('dependencies').options)
            option.selected = (moduleDraft?.dependencies ?? m?.dependencies ?? []).includes(option.value);
        options(
            'workbook',
            state.workbooks.filter((w) => w.config.module === m?.id).map((w) => [w.source, w.source]),
        );
        loadWorkbook();
        invalidateCreate();
    };
    const deletion = () => {
        const m = state?.modules.find((m) => m.id === val('deleteModule')),
            kind = val('deleteKind');
        el('deleteItemOptions').hidden = kind === 'module';
        options(
            'deleteItem',
            kind === 'bundle'
                ? Object.entries(m?.bundles ?? {}).map(([id, b]) => [id, `${id} · ${b.id}`])
                : kind === 'view'
                  ? Object.keys(m?.views ?? {}).map((id) => [id, id])
                  : kind === 'prefab'
                    ? Object.entries(m?.components ?? {}).map(([id, value]) => [id, value.className])
                    : (state?.scripts ?? [])
                          .filter((f) => f.startsWith(`assets/game/modules/${m?.id}/code/`))
                          .map((f) => [f, f.replace(`assets/game/modules/${m?.id}/`, '')]),
        );
        invalidateDelete();
    };
    const refresh = async () => {
        state = await Editor.Message.request('yzforge-editor', 'state');
        el('project').textContent = state.project;
        el('summary').textContent = `${state.modules.length} 个模块 · ${state.tables.tables.length} 张表`;
        options(
            'module',
            state.modules.map((m) => [m.id, `${m.displayName || m.id} · ${m.id}`]),
        );
        options(
            'deleteModule',
            [...state.modules, ...state.orphans].map((m) => [m.id, m.displayName || m.id]),
        );
        options(
            'restoreRecord',
            state.history.map((r) => [r.id, `${r.original} · ${r.stage} · ${r.id}`]),
        );
        el('presets').textContent = JSON.stringify(state.presets, null, 2);
        el('prefixes').textContent = JSON.stringify(state.settings.bindingPrefixes, null, 2);
        el('autoStatus').textContent = [
            state.autoStatus?.message,
            ...(state.workbookDiagnostics ?? []).map((d) => d.message),
        ]
            .filter(Boolean)
            .join('；');
        if (!settingsLoaded) {
            const s = state.settings;
            for (const [id, v] of Object.entries({
                appId: s.appId,
                cleanupTimeout: s.cleanupTimeoutMs,
                maxVoices: s.maxAudioVoices,
                utcOffset: s.calendar.offsetMinutes,
                weekStart: s.calendar.weekStartsOn,
                dayBoundary: s.calendar.resetMinute,
                wechatClockUnit: s.wechatPerformanceUnit,
            }))
                el(id).value = v;
            for (const [name, volume] of Object.entries(s.audioChannels)) {
                const label = document.createElement('label'),
                    input = document.createElement('input');
                label.textContent = `${name} 初始音量（0—1）`;
                input.type = 'number';
                input.min = '0';
                input.max = '1';
                input.step = '0.1';
                input.value = volume;
                input.dataset.channel = name;
                label.appendChild(input);
                el('audioChannels').appendChild(label);
            }
            settingsLoaded = true;
        }
        moduleChanged();
        deletion();
    };
    const run = async (action, args = {}, reload = true) => {
        if (busy) return;
        busy = true;
        el('status').textContent = '正在执行…';
        this.$.workbench.querySelectorAll('button').forEach((b) => {
            b.disabled = true;
        });
        try {
            const result = await Editor.Message.request('yzforge-editor', 'dispatch', action, args);
            show(result);
            if (action === 'saveWorkbook') workbookDrafts.delete(args.source);
            if (action === 'updateModule') moduleDrafts.delete(args.module);
            if (reload) await refresh();
            el('status').textContent = result?.generationError ? '操作已保存，但生成失败；请修复后重新生成' : '已完成';
            return result;
        } finally {
            busy = false;
            this.$.workbench.querySelectorAll('button').forEach((b) => {
                b.disabled = false;
            });
            el('create').disabled = !createPlan || createPlan.conflicts.length > 0;
            el('delete').disabled = !deletePlan || deletePlan.references.length > 0;
        }
    };
    const on = (id, callback, event = 'click') =>
        el(id).addEventListener(event, () =>
            Promise.resolve()
                .then(callback)
                .catch((error) => {
                    show(error.message);
                    el('status').textContent = '操作未完成，请查看原因';
                }),
        );
    this.$.workbench.querySelectorAll('[data-tab]').forEach((button) =>
        button.addEventListener('click', () => {
            this.$.workbench
                .querySelectorAll('[data-tab]')
                .forEach((b) => b.classList.toggle('selected', b === button));
            this.$.workbench.querySelectorAll('[data-page]').forEach((page) => {
                page.hidden = page.dataset.page !== button.dataset.tab;
            });
        }),
    );
    on('module', moduleChanged, 'change');
    on('kind', role, 'change');
    for (const id of ['newName', 'displayName', 'delivery', 'initial', 'bundle', 'presenter', 'adopt'])
        on(id, invalidateCreate, 'input');
    on('refresh', refresh);
    on('check', () => run('check'));
    on('generate', () => run('generate'));
    on('previewCreate', async () => {
        createPlan = await run(
            'previewCreate',
            {
                kind: val('kind'),
                id: val('newName'),
                module: val('module'),
                bundle: val('bundle'),
                delivery: val('delivery'),
                displayName: val('displayName'),
                codeOnly: val('initial') === 'code',
                presenter: el('presenter').checked,
                prefabUUID: ['part', 'prefab'].includes(val('kind')) ? val('adopt') : undefined,
            },
            false,
        );
        el('createPreview').textContent = createPlan.files.map((f) => `${f.operation.padEnd(16)} ${f.path}`).join('\n');
        el('create').disabled = createPlan.conflicts.length > 0;
    });
    on('create', async () => {
        const plan = createPlan;
        invalidateCreate();
        await run('create', { request: plan.request, signature: plan.signature });
    });
    on('saveModule', () =>
        run('updateModule', {
            module: val('module'),
            displayName: val('moduleDisplayName'),
            dependencies: Array.from(el('dependencies').selectedOptions, (o) => o.value),
        }),
    );
    on('bind', () => {
        const [kind, id] = val('binding').split(':');
        return run(kind === 'view' ? 'bindView' : 'bindComponent', { module: val('module'), id });
    });
    for (const id of ['moduleDisplayName', 'dependencies'])
        on(
            id,
            () => {
                moduleDrafts.set(val('module'), {
                    displayName: val('moduleDisplayName'),
                    dependencies: Array.from(el('dependencies').selectedOptions, (option) => option.value),
                });
            },
            'input',
        );
    for (const id of ['workbookEnabled', 'workbookBundle', 'primaryKey', 'tableBundle', 'tableEnabled', 'tablePublic'])
        on(
            id,
            () => {
                if (!workbookDraft) return;
                workbookDraft.config.enabled = el('workbookEnabled').checked;
                workbookDraft.config.bundle = val('workbookBundle');
                const table = workbookDraft.config.tables.find((table) => table.id === val('table'));
                if (table)
                    Object.assign(table, {
                        sheet: val('sheet'),
                        primaryKey: val('primaryKey'),
                        bundle: val('tableBundle') || undefined,
                        enabled: el('tableEnabled').checked,
                        public: el('tablePublic').checked,
                    });
                workbookDrafts.set(workbookDraft.source, workbookDraft);
            },
            'input',
        );
    on('workbook', loadWorkbook, 'change');
    on('table', loadTable, 'change');
    on(
        'sheet',
        () => {
            fields();
            if (workbookDraft) {
                const table = workbookDraft.config.tables.find((t) => t.id === val('table'));
                if (table) {
                    table.sheet = val('sheet');
                    table.primaryKey = val('primaryKey');
                    workbookDrafts.set(workbookDraft.source, workbookDraft);
                }
            }
        },
        'change',
    );
    on('openWorkbook', () => run('openWorkbook', { source: val('workbook') }, false));
    on('saveTable', () => {
        if (!workbookDraft) throw Error('请先选择工作簿');
        const config = structuredClone(workbookDraft.config),
            t = config.tables.find((t) => t.id === val('table'));
        config.enabled = el('workbookEnabled').checked;
        config.bundle = val('workbookBundle');
        if (t)
            Object.assign(t, {
                sheet: val('sheet'),
                primaryKey: val('primaryKey'),
                bundle: val('tableBundle') || undefined,
                enabled: el('tableEnabled').checked,
                public: el('tablePublic').checked,
            });
        return run('saveWorkbook', { source: workbookDraft.source, hash: workbookDraft.hash, config });
    });
    on('previewTables', () => run('previewTables', {}, false));
    on('exportTables', () => run('generate'));
    on('recalculate', () => run('recalculate', { source: val('workbook') }, false));
    on('ensurePresets', () => run('ensurePresets'));
    on('bundleSettings', () => run('openBundleSettings', {}, false));
    on('saveSettings', () =>
        run('updateSettings', {
            appId: val('appId'),
            cleanupTimeoutMs: Number(val('cleanupTimeout')),
            maxAudioVoices: Number(val('maxVoices')),
            wechatPerformanceUnit: val('wechatClockUnit'),
            calendar: {
                ...state.settings.calendar,
                offsetMinutes: Number(val('utcOffset')),
                weekStartsOn: Number(val('weekStart')),
                resetMinute: Number(val('dayBoundary')),
            },
            audioChannels: Object.fromEntries(
                Array.from(el('audioChannels').querySelectorAll('input'), (i) => [i.dataset.channel, Number(i.value)]),
            ),
        }),
    );
    on('deleteModule', deletion, 'change');
    on('deleteKind', deletion, 'change');
    on('deleteItem', invalidateDelete, 'change');
    on('previewDelete', async () => {
        deletePlan = await run(
            'previewDelete',
            { module: val('deleteModule'), kind: val('deleteKind'), id: val('deleteItem'), path: val('deleteItem') },
            false,
        );
        el('deletePreview').textContent = JSON.stringify(deletePlan, null, 2);
        el('delete').disabled = deletePlan.references.length > 0;
    });
    on('delete', async () => {
        const plan = deletePlan;
        invalidateDelete();
        await run('deleteModule', plan);
    });
    on('restore', () => run('restore', { id: val('restoreRecord') }));
    role();
    refresh().catch((error) => show(error.message));
};
exports.close = function () {};
