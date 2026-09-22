'use strict';
exports.template = require('./panel-template');
exports.style = require('fs').readFileSync(require('path').join(__dirname, 'panel.css'), 'utf8');
exports.$ = { workbench: '#workbench' };
exports.methods = {};
exports.ready = function () {
    const el = (id) => this.$.workbench.querySelector('#' + id),
        val = (id) => el(id).value.trim();
    let state,
        createPlan,
        creationRollbackPlan,
        deletePlan,
        workbookDraft,
        generationPlan,
        previewTimer,
        previewSequence = 0,
        closed = false,
        busy = false,
        settingsLoaded = false;
    const workbookDrafts = new Map(),
        moduleDrafts = new Map();
    const show = (result) => {
        el('output').textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    };
    const current = () => state?.modules.find((module) => module.id === val('module'));
    const renderFiles = (id, files, empty) => {
        const target = el(id);
        const labels = {
            create: '新建',
            'create-directory': '目录',
            Creator: '元数据',
            existing: '保留',
            update: '更新',
            generate: '生成',
            'regenerate-if-changed': '按需更新',
            conflict: '冲突',
            delete: '删除',
            restore: '恢复',
            reference: '被引用',
        };
        target.replaceChildren();
        target.classList.toggle('empty', !files.length);
        if (!files.length) {
            target.textContent = empty;
            return;
        }
        for (const file of files) {
            const row = document.createElement('div'),
                operation = document.createElement('span'),
                code = document.createElement('code');
            row.className = 'file-row';
            row.dataset.operation = file.operation ?? file.action;
            operation.className = 'operation';
            operation.textContent = labels[row.dataset.operation] ?? row.dataset.operation;
            const name = document.createElement('span'),
                directory = document.createElement('small');
            const boundary = file.path.lastIndexOf('/');
            name.className = 'file-name';
            name.textContent = file.path.slice(boundary + 1);
            directory.className = 'file-directory';
            directory.textContent = boundary >= 0 ? file.path.slice(0, boundary + 1) : '';
            code.title = file.path;
            code.append(name, directory);
            row.append(operation, code);
            target.appendChild(row);
        }
    };
    const renderRecovery = (id, plan) =>
        renderFiles(
            id,
            [
                ...(plan.changes ?? []),
                ...(plan.conflicts ?? []).map((path) => ({ path, operation: 'conflict' })),
                ...(plan.references ?? []).map((path) => ({ path, operation: 'reference' })),
            ],
            '文件已处于原始状态，可以完成恢复记录。',
        );
    const options = (id, items) => {
        const select = el(id),
            old = select.value;
        select.textContent = '';
        for (const [key, title] of items.length ? items : [['', '暂无可选内容']]) {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = title;
            select.appendChild(option);
        }
        if (items.some(([key]) => key === old)) select.value = old;
    };
    const invalidateCreate = () => {
        clearTimeout(previewTimer);
        previewSequence++;
        createPlan = null;
        el('create').disabled = true;
        el('createIssue').hidden = true;
        el('fileCount').textContent = val('newName') ? '等待校验' : '等待名称';
        renderFiles(
            'createPreview',
            [],
            val('newName') ? '正在准备文件预览…' : '填写名称，即可查看所有文件的名字和位置。',
        );
        if (!closed && state && val('newName')) previewTimer = setTimeout(() => void previewCreate(), 450);
    };
    const invalidateDelete = () => {
        deletePlan = null;
        el('delete').disabled = true;
        renderFiles('deletePreview', [], '预览后显示实际文件和外部引用。');
    };
    const updateCreationActions = () => {
        const record = state?.creations?.find((record) => record.id === val('creationRecord'));
        el('retryCreation').disabled = busy || !['awaiting-generation', 'generation-failed'].includes(record?.stage);
        el('previewCreationRollback').disabled = busy || !record || record.stage === 'creating';
        el('rollbackCreation').disabled =
            busy ||
            !creationRollbackPlan ||
            creationRollbackPlan.id !== record?.id ||
            creationRollbackPlan.conflicts.length > 0 ||
            creationRollbackPlan.references.length > 0;
        el('create').disabled = busy || !createPlan || createPlan.conflicts.length > 0;
        el('previewCreate').disabled = busy || !state || !val('newName');
        el('delete').disabled = busy || !deletePlan || deletePlan.references.length > 0;
        el('previewDelete').disabled =
            busy || !val('deleteModule') || (val('deleteKind') !== 'module' && !val('deleteItem'));
        el('saveModule').disabled = busy || !current();
        el('dependencies').disabled = busy || !current() || current().code?.mode === 'none';
        el('initial').disabled = busy || val('delivery') === 'none';
        el('bind').disabled = busy || !val('binding');
        for (const id of ['openWorkbook', 'saveTable', 'recalculate']) el(id).disabled = busy || !workbookDraft;
        el('restore').disabled = busy || !val('restoreRecord');
        el('previewGeneration').disabled = busy || !val('generationRecord');
        el('recoverGeneration').disabled =
            busy ||
            !generationPlan ||
            generationPlan.id !== val('generationRecord') ||
            generationPlan.conflicts.length > 0;
        el('moduleDirty').textContent = moduleDrafts.has(val('module')) ? '未保存' : '';
        el('tableDirty').textContent = workbookDrafts.has(val('workbook')) ? '未保存' : '';
    };
    const creationChanged = () => {
        creationRollbackPlan = undefined;
        const record = state?.creations?.find((record) => record.id === val('creationRecord'));
        el('creationPreview').textContent = record
            ? record.stage === 'creating'
                ? '此记录没有完整完成快照，请检查残留文件并使用普通删除流程。'
                : record.error || '请选择重试生成，或预览本次创建的撤销范围。'
            : '没有未完成的创建。';
        updateCreationActions();
    };
    const role = () => {
        const kind = val('kind'),
            ui = ['page', 'popup', 'overlay', 'toast', 'loading'].includes(kind),
            generic = ['part', 'prefab'].includes(kind);
        el('moduleOptions').hidden = kind !== 'module';
        el('bundleOptions').hidden = !(ui || generic || kind === 'table');
        el('presenterOptions').hidden = !ui;
        el('adoptOptions').hidden = !generic;
        if (val('delivery') === 'none') el('initial').value = 'resources';
        el('roleHelp').textContent = ui
            ? 'View 负责渲染与输入；Presenter 组织显示逻辑；跨界面状态放在模块 Service。'
            : generic
              ? '通用组件继承 GameComponent，通过创建实例或场景注入获得上下文。'
              : '';
        invalidateCreate();
        updateCreationActions();
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
        } else {
            el('tableEnabled').checked = false;
            el('tablePublic').checked = false;
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
        el('tableEmpty').textContent = workbookDraft ? '' : '此模块还没有工作簿。前往“创建内容”，选择“配置表 · XLSX”。';
        updateCreationActions();
    };
    const moduleChanged = () => {
        const m = current(),
            bundles = Object.entries(m?.bundles ?? {}).map(([g, b]) => [g, `${g} · ${b.id}`]);
        el('moduleTag').textContent =
            m?.code?.mode === 'none'
                ? '资源模块'
                : m?.code?.mode === 'bundled'
                  ? '按需加载'
                  : m
                    ? '启动加载'
                    : '无模块';
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
        el('bindingEmpty').textContent = val('binding')
            ? '修改预制体后，扫描以更新生成的 Binding 脚本。'
            : '暂无可绑定内容。可创建界面、Part，或接入已有预制体。';
        el('moduleInfo').textContent = JSON.stringify(m ?? {}, null, 2);
        const moduleDraft = moduleDrafts.get(m?.id);
        el('moduleDisplayName').value = moduleDraft?.displayName ?? m?.displayName ?? '';
        options(
            'dependencies',
            state.modules
                .filter((other) => other.id !== m?.id && other.code?.mode !== 'none')
                .map((other) => [other.id, other.displayName || other.id]),
        );
        for (const option of el('dependencies').options)
            option.selected = (moduleDraft?.dependencies ?? Object.values(m?.dependencies ?? {})).includes(
                option.value,
            );
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
                          .filter(
                              (f) => f.startsWith(`assets/game/modules/${m?.id}/code/`) && !f.includes('/generated/'),
                          )
                          .map((f) => [f, f.replace(`assets/game/modules/${m?.id}/`, '')]),
        );
        invalidateDelete();
        updateCreationActions();
    };
    const refresh = async () => {
        const next = await Editor.Message.request('yzforge-editor', 'state');
        if (closed) return;
        state = next;
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
        options(
            'creationRecord',
            (state.creations ?? []).map((record) => [
                record.id,
                `${record.request.kind} · ${record.request.id} · ${record.stage}`,
            ]),
        );
        creationChanged();
        options(
            'generationRecord',
            (state.generations ?? []).map((r) => [
                r.id,
                `${new Date(Number(r.id.split('-')[0])).toLocaleString()} · ${r.files} 个文件`,
            ]),
        );
        generationChanged();
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
            const offsets = new Set([s.calendar.offsetMinutes, ...Array.from({ length: 105 }, (_, i) => i * 15 - 720)]);
            options(
                'utcOffset',
                [...offsets]
                    .sort((a, b) => a - b)
                    .map((n) => [
                        String(n),
                        `UTC${n < 0 ? '−' : '+'}${String(Math.floor(Math.abs(n) / 60)).padStart(2, '0')}:${String(Math.abs(n) % 60).padStart(2, '0')}${n === 480 ? ' · 中国标准时间' : ''}`,
                    ]),
            );
            for (const [id, v] of Object.entries({
                appId: s.appId,
                cleanupTimeout: s.cleanupTimeoutMs,
                maxVoices: s.maxAudioVoices,
                utcOffset: s.calendar.offsetMinutes,
                weekStart: s.calendar.weekStartsOn,
                dayBoundary: `${String(Math.floor(s.calendar.resetMinute / 60)).padStart(2, '0')}:${String(s.calendar.resetMinute % 60).padStart(2, '0')}`,
                wechatClockUnit: s.wechatPerformanceUnit,
            }))
                el(id).value = v;
            el('audioChannels').replaceChildren();
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
            el('settingsDirty').textContent = '';
        }
        moduleChanged();
        deletion();
    };
    const run = async (action, args = {}, reload = true) => {
        if (busy || closed) return;
        busy = true;
        clearTimeout(previewTimer);
        previewSequence++;
        this.$.workbench.dataset.busy = 'true';
        this.$.workbench.setAttribute('aria-busy', 'true');
        el('health').textContent = '处理中';
        el('health').dataset.state = 'busy';
        el('status').textContent = '正在执行…';
        const controls = Array.from(this.$.workbench.querySelectorAll('button,input,select'), (control) => [
            control,
            control.disabled,
        ]);
        for (const [control] of controls) control.disabled = true;
        try {
            const result =
                action === 'refresh'
                    ? await refresh()
                    : await Editor.Message.request('yzforge-editor', 'dispatch', action, args);
            if (closed) return result;
            if (result !== undefined) show(result);
            if (action === 'saveWorkbook') workbookDrafts.delete(args.source);
            if (action === 'updateModule') moduleDrafts.delete(args.module);
            if (action === 'updateSettings') settingsLoaded = false;
            if (reload && action !== 'refresh') await refresh();
            el('status').textContent = result?.generationError ? '操作已保存，但生成失败；请修复后重新生成' : '已完成';
            el('health').textContent = result?.generationError ? '需要处理' : '已连接';
            el('health').dataset.state = result?.generationError ? 'error' : 'ready';
            if (result?.generationError) el('logDetails').open = true;
            return result;
        } finally {
            busy = false;
            if (!closed) {
                this.$.workbench.dataset.busy = 'false';
                this.$.workbench.setAttribute('aria-busy', 'false');
                for (const [control, disabled] of controls) control.disabled = disabled;
                updateCreationActions();
                if (!createPlan && val('newName')) previewTimer = setTimeout(() => void previewCreate(), 450);
            }
        }
    };
    const failure = (error) => {
        if (closed) return;
        show(error.message);
        el('status').textContent = '操作未完成，请查看原因';
        el('health').textContent = '需要处理';
        el('health').dataset.state = 'error';
        el('logDetails').open = true;
    };
    const on = (id, callback, event = 'click') =>
        el(id).addEventListener(event, () => {
            if (closed || busy) return;
            // Capture the current form synchronously before the next selection can replace it.
            try {
                Promise.resolve(callback()).catch(failure);
            } catch (error) {
                failure(error);
            }
        });
    this.$.workbench.querySelectorAll('[data-tab]').forEach((button) =>
        button.addEventListener('click', () => {
            this.$.workbench.querySelectorAll('[data-tab]').forEach((b) => {
                b.classList.toggle('selected', b === button);
                b.setAttribute('aria-selected', String(b === button));
            });
            this.$.workbench.querySelectorAll('[data-page]').forEach((page) => {
                page.hidden = page.dataset.page !== button.dataset.tab;
            });
        }),
    );
    on('module', moduleChanged, 'change');
    on('kind', role, 'change');
    for (const id of ['newName', 'displayName', 'delivery', 'initial', 'bundle', 'presenter', 'adopt'])
        on(id, invalidateCreate, 'input');
    on('delivery', role, 'change');
    on('refresh', () => run('refresh'));
    on('check', () => run('check'));
    on('generate', () => run('generate'));
    const previewCreate = async () => {
        if (closed || busy || !state || !val('newName')) return;
        clearTimeout(previewTimer);
        const sequence = ++previewSequence;
        createPlan = null;
        el('create').disabled = true;
        el('fileCount').textContent = '校验中…';
        try {
            const plan = await Editor.Message.request('yzforge-editor', 'dispatch', 'previewCreate', {
                kind: val('kind'),
                id: val('newName'),
                module: val('module'),
                bundle: val('bundle'),
                delivery: val('delivery'),
                displayName: val('displayName'),
                codeOnly: val('initial') === 'code',
                presenter: el('presenter').checked,
                prefabUUID: ['part', 'prefab'].includes(val('kind')) ? val('adopt') : undefined,
            });
            if (closed || sequence !== previewSequence) return;
            createPlan = plan;
            renderFiles('createPreview', plan.files, '没有需要创建的文件。');
            el('fileCount').textContent = `${plan.files.length} 项`;
            el('createIssue').hidden = !plan.conflicts.length;
            el('createIssue').textContent = plan.conflicts.length
                ? '以下文件已存在，请调整名称：\n' + plan.conflicts.join('\n')
                : '';
        } catch (error) {
            if (closed || sequence !== previewSequence) return;
            el('createIssue').textContent = error.message;
            el('createIssue').hidden = false;
            el('fileCount').textContent = '需要调整';
            renderFiles('createPreview', [], '调整输入后自动重新预览。');
        } finally {
            if (!closed && sequence === previewSequence) updateCreationActions();
        }
    };
    on('previewCreate', previewCreate);
    on('create', async () => {
        const plan = createPlan;
        if (!plan) return;
        invalidateCreate();
        await run('create', { request: plan.request, signature: plan.signature });
    });
    on('saveModule', () =>
        run('updateModule', {
            module: val('module'),
            displayName: val('moduleDisplayName'),
            dependencies: Array.from(el('dependencies').selectedOptions, (o) => o.value).filter(Boolean),
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
                    dependencies: Array.from(el('dependencies').selectedOptions, (option) => option.value).filter(
                        Boolean,
                    ),
                });
                updateCreationActions();
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
                updateCreationActions();
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
                    updateCreationActions();
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
    this.$.workbench.querySelector('[data-page="settings"]').addEventListener('input', () => {
        el('settingsDirty').textContent = '未保存';
    });
    on('saveSettings', () => {
        const [hour, minute] = val('dayBoundary').split(':').map(Number);
        if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw Error('请选择每日刷新时间');
        return run('updateSettings', {
            appId: val('appId'),
            cleanupTimeoutMs: Number(val('cleanupTimeout')),
            maxAudioVoices: Number(val('maxVoices')),
            wechatPerformanceUnit: val('wechatClockUnit'),
            calendar: {
                ...state.settings.calendar,
                offsetMinutes: Number(val('utcOffset')),
                weekStartsOn: Number(val('weekStart')),
                resetMinute: hour * 60 + minute,
            },
            audioChannels: Object.fromEntries(
                Array.from(el('audioChannels').querySelectorAll('input'), (i) => [i.dataset.channel, Number(i.value)]),
            ),
        });
    });
    on('deleteModule', deletion, 'change');
    on('deleteKind', deletion, 'change');
    on('deleteItem', invalidateDelete, 'change');
    on('previewDelete', async () => {
        deletePlan = await run(
            'previewDelete',
            { module: val('deleteModule'), kind: val('deleteKind'), id: val('deleteItem'), path: val('deleteItem') },
            false,
        );
        if (!deletePlan) return;
        renderFiles(
            'deletePreview',
            [
                ...(deletePlan.files ?? deletePlan.targets ?? []).map((file) => ({
                    path: typeof file === 'string' ? file : file.path,
                    operation: 'delete',
                })),
                ...deletePlan.references.map((path) => ({ path, operation: 'reference' })),
            ],
            '检查完成；操作详情包含完整范围。',
        );
        updateCreationActions();
    });
    on('delete', async () => {
        const plan = deletePlan;
        if (!plan) return;
        invalidateDelete();
        await run('deleteModule', plan);
    });
    on('formulaEnvironment', () => run('formulaEnvironment', {}, false));
    on('restore', () => run('restore', { id: val('restoreRecord') }));
    on('creationRecord', creationChanged, 'change');
    on('retryCreation', () => run('retryCreationGeneration', { id: val('creationRecord') }));
    on('previewCreationRollback', async () => {
        creationRollbackPlan = await run('previewCreationRollback', { id: val('creationRecord') }, false);
        if (creationRollbackPlan) renderRecovery('creationPreview', creationRollbackPlan);
        updateCreationActions();
    });
    on('rollbackCreation', async () => {
        const plan = creationRollbackPlan;
        if (!plan) return;
        creationRollbackPlan = undefined;
        el('rollbackCreation').disabled = true;
        await run('rollbackCreation', plan);
    });
    const generationChanged = () => {
        generationPlan = undefined;
        renderFiles(
            'generationPreview',
            [],
            val('generationRecord') ? '预览后恢复工具修改的文件；用户后续编辑会作为冲突保留。' : '没有需要恢复的生成。',
        );
        updateCreationActions();
    };
    on('generationRecord', generationChanged, 'change');
    on('previewGeneration', async () => {
        generationPlan = await run('previewGenerationRecovery', { id: val('generationRecord') }, false);
        if (generationPlan) renderRecovery('generationPreview', generationPlan);
        updateCreationActions();
    });
    on('recoverGeneration', async () => {
        const plan = generationPlan;
        generationPlan = undefined;
        if (plan) await run('recoverGeneration', plan);
    });
    this.disposeWorkbench = () => {
        closed = true;
        previewSequence++;
        clearTimeout(previewTimer);
    };
    this.$.workbench.querySelector('[data-tab="create"]').click();
    role();
    void run('refresh').catch((error) => {
        if (!closed) {
            show(error.message);
            el('logDetails').open = true;
            el('health').textContent = '连接失败';
            el('health').dataset.state = 'error';
        }
    });
};
exports.close = function () {
    this.disposeWorkbench?.();
};
