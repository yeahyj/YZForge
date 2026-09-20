'use strict';
exports.template = `
<main id="workbench">
  <header><div><h1>YZForge <span>工作台</span></h1><p id="project">正在连接当前项目…</p></div><button id="refresh">刷新</button></header>
  <div class="toolbar"><span id="summary"></span><button id="check">检查项目</button><button id="generate" class="primary">生成资源目录与配置</button></div>
  <div class="body"><nav id="tabs">
    <button data-tab="modules" class="selected">模块与资源包</button><button data-tab="views">界面与绑定</button>
    <button data-tab="assets">动态资源清单</button><button data-tab="tables">配置表</button><button data-tab="settings">项目设置</button><button data-tab="recovery">删除与恢复</button>
  </nav><section id="content">
    <div data-page="modules"><h2>模块与资源包</h2><p>模块组织代码与业务边界。资源包按加载、更新和交付需求划分，按需添加。</p>
      <div class="grid"><label>模块标识<input id="moduleId" placeholder="example"></label><label>显示名称<input id="moduleName" placeholder="模块显示名"></label></div>
      <label>初始结构<select id="moduleTemplate"><option value="resources">代码与默认资源包</option><option value="code">仅代码，稍后按需添加资源包</option></select></label>
      <button id="createModule" class="primary">创建模块</button><hr>
      <div class="grid"><label>已有模块<select id="moduleSelect"></select></label><label>新资源包标识<input id="bundleId" placeholder="extra（默认包填写 default）"></label></div>
      <button id="createBundle">添加资源包</button>
      <label>所选模块显示名称<input id="moduleDisplayName" placeholder="模块显示名"></label>
      <label>运行依赖（逗号分隔）<input id="dependencies" placeholder="module-a, module-b"></label><button id="updateModule">保存显示名称与依赖</button>
      <hr><div class="grid"><label>新脚本标识<input id="scriptId" placeholder="example-component"></label><label>脚本类型<select id="scriptKind"><option value="component">节点组件</option><option value="service">普通业务服务</option></select></label></div><button id="createScript">为所选模块创建脚本</button>
      <pre id="moduleList"></pre>
    </div>
    <div data-page="views" hidden><h2>界面与自动绑定</h2><p>业务 View 继承生成的 Binding。节点按 btn_confirm、lbl_title 等命名；重新绑定会自动写入引用。</p>
      <div class="grid"><label>模块<select id="viewModule"></select></label><label>界面标识<input id="viewId" placeholder="example-view"></label></div>
      <label>目标资源包组<input id="viewBundle" value="default"></label>
      <label>界面类型<select id="viewKind"><option value="popup">弹窗</option><option value="page">页面</option><option value="overlay">覆盖层</option><option value="toast">提示</option><option value="loading">加载界面</option></select></label>
      <button id="createView" class="primary">创建 UI 脚本和预制体</button><button id="bindView">生成绑定并保存引用</button><pre id="viewList"></pre>
    </div>
    <div data-page="assets" hidden><h2>动态资源清单</h2><p>逻辑名字与 UUID 关联。移动文件保留名字；跨模块同名资源用完整逻辑标识区分。</p>
      <label>所属模块<select id="assetModule"></select></label><label>逻辑标识<input id="assetId" placeholder="example/default/sprite/icon"></label>
      <div class="grid"><label>资源类型<select id="assetType"><option>SpriteFrame</option><option>Prefab</option><option>AudioClip</option><option>JsonAsset</option><option>Texture2D</option><option>SpriteAtlas</option><option>Material</option><option>TextAsset</option><option>Font</option></select></label>
      <label>资源 UUID<input id="assetUuid" placeholder="从资源管理器选中资源后点右侧按钮"></label></div>
      <button id="useSelection">使用选中资源</button><button id="registerAsset" class="primary">登记动态资源</button>
      <label>图集内帧名（普通图片留空；图集帧选择 SpriteFrame 类型并填写 SpriteAtlas 的 UUID）<input id="atlasFrame" placeholder="可选"></label>
      <label>移动到（项目相对路径，含扩展名）<input id="assetTarget" placeholder="assets/game/modules/example/res/icons/icon.png"></label><button id="moveAsset">保留 UUID 移动 / 重命名文件</button><pre id="assetList"></pre>
    </div>
    <div data-page="tables" hidden><h2>配置表</h2><p>支持 XLSX / CSV 四行表头：字段名、类型、默认值、注释。数据从第五行开始；导出 JSON 数据与 TS 合同。</p>
      <div class="grid"><label>模块<select id="tableModule"></select></label><label>表标识<input id="tableId" placeholder="entries"></label></div>
      <button id="createTable">创建 CSV 模板并登记</button>
      <label>源文件（项目内路径）<input id="tableSource" placeholder="config-source/example/Entries.xlsx"></label>
      <div class="grid"><label>Sheet（CSV 留空）<input id="tableSheet" placeholder="Entries"></label><label>目标资源组<input id="tableBundle" value="default"></label><label>主键字段<input id="tablePk" value="id"></label></div>
      <label>索引、范围、外键和分片等高级选项（JSON）<textarea id="tableAdvanced" rows="5">{"indexes": {}}</textarea></label>
      <button id="saveTable" class="primary">保存导入项</button><button id="previewTables">预览导入与校验</button><button id="importTables">校验并导入全部表</button><button id="removeTable">移除当前导入项</button><pre id="tableList"></pre>
    </div>
    <div data-page="settings" hidden><h2>项目设置</h2><p>这些规则属于当前项目。保存后重新生成；设计分辨率与方向使用 Creator 项目设置，新建界面读取该设置。</p>
      <label>应用标识（用于隔离本地存档，发布后保持稳定）<input id="appId" placeholder="com.company.product"></label>
      <div class="grid"><label>清理超时（毫秒）<input id="cleanupTimeout" type="number" min="1"></label><label>最大同时播放数量<input id="maxVoices" type="number" min="1"></label></div>
      <label>音频分组与初始音量（JSON）<textarea id="audioChannels" rows="3"></textarea></label>
      <label>日历规则（JSON：UTC 偏移分钟、周起始日、周期边界分钟）<textarea id="calendarRules" rows="3"></textarea></label>
      <label>微信计时 API 单位（以目标 SDK 为准）<select id="wechatClockUnit"><option value="microseconds">微秒</option><option value="milliseconds">毫秒</option></select></label>
      <label>节点前缀与组件类型（JSON）<textarea id="bindingPrefixes" rows="6"></textarea></label><button id="saveSettings" class="primary">保存项目设置</button>
    </div>
    <div data-page="recovery" hidden><h2>删除与恢复</h2><p>检查引用后移入项目回收区，恢复时保留 UUID。删除或恢复后，重新生成并检查项目。</p>
      <div class="grid"><label>模块<select id="deleteModuleSelect"></select></label><label>删除类型<select id="deleteKind"><option value="module">整个模块</option><option value="view">界面与配套脚本</option><option value="bundle">资源包</option><option value="script">普通手写脚本</option></select></label></div>
      <label>界面 / 资源包标识，或脚本的项目相对路径<input id="deleteItem" placeholder="example-view / extra / assets/game/modules/…/Example.ts"></label>
      <button id="previewDelete">检查引用与预览删除</button><button id="deleteModule" class="danger" disabled>将预览内容移入回收区</button>
      <pre id="deletePreview">尚未生成删除预览。</pre><label>恢复记录 ID<input id="restoreId" placeholder="删除操作返回的 restoreId"></label><button id="restore">恢复内容</button>
    </div>
  </section></div>
  <footer><strong id="status">就绪</strong><pre id="output">操作结果、文件清单和定位信息会显示在这里。</pre></footer>
</main>`;
exports.style = `
:host{display:block;height:100%;color:#dfe6f0;background:#191e28;font:13px/1.6 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif}
*{box-sizing:border-box}main{height:100%;display:flex;flex-direction:column;padding:20px}header{display:flex;justify-content:space-between;align-items:center;gap:20px}h1{font-size:23px;letter-spacing:.6px;margin:0;color:#fff}h1 span{font-size:14px;font-weight:400;color:#99a9c0}h2{font-size:18px;margin:0 0 8px}p{color:#9aaac1;margin:5px 0 18px}#project{font-size:11px;margin-bottom:10px}.toolbar{display:flex;align-items:center;gap:8px;border-top:1px solid #333b4a;border-bottom:1px solid #333b4a;padding:12px 0}#summary{flex:1;color:#a6b6cc}.body{display:flex;flex:1;min-height:220px;overflow:hidden;padding-top:16px}nav{width:145px;flex-shrink:0;padding-right:14px;border-right:1px solid #333b4a}nav button{display:block;width:100%;text-align:left;margin:0 0 7px;background:transparent;border-color:transparent;color:#a8b7ca}nav button.selected{background:#263b56;color:#99ccff;border-color:#395a80}section{flex:1;overflow:auto;padding:0 8px 20px 20px}label{display:flex;flex-direction:column;gap:5px;color:#aab9cd;margin:8px 0 13px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 14px}input,select,textarea{font:inherit;color:#e7eef8;background:#121824;border:1px solid #39475c;border-radius:5px;padding:7px 9px;min-width:0;width:100%}textarea{resize:vertical;font-family:Consolas,monospace}input:focus,select:focus,textarea:focus{outline:1px solid #76b7ff;border-color:#76b7ff}button{border:1px solid #44536a;background:#2a3546;color:#e3ecf9;border-radius:5px;padding:7px 12px;font:inherit;cursor:pointer;margin:4px 5px 4px 0}button:hover{background:#364861}button.primary{background:#2469a8;border-color:#3b88ca;color:white}button.danger{background:#683b42;border-color:#97616a}button:disabled{opacity:.4;cursor:default}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#131923;border:1px solid #303b4c;border-radius:5px;padding:10px;font:12px/1.6 Consolas,"Microsoft YaHei",monospace;max-height:240px;overflow:auto;color:#b9cce2}hr{border:0;border-top:1px solid #333b4a;margin:20px 0}footer{border-top:1px solid #333b4a;padding-top:10px;flex-shrink:0}#output{max-height:150px;margin:6px 0 0}#status{font-weight:500;color:#8cd2b4}[hidden]{display:none!important}
`;
exports.$ = { workbench: '#workbench' };
exports.methods = {};
exports.ready = function () {
  const find = id => this.$.workbench.querySelector('#' + id);
  const value = id => find(id).value.trim();
  let state, preview;
  const show = result => { find('output').textContent = typeof result === 'string' ? result : JSON.stringify(result, null, 2); };
  const selectModule = () => {
    const module = state?.modules.find(item => item.id === value('moduleSelect'));
    find('moduleDisplayName').value = module?.displayName || '';
    find('dependencies').value = module?.dependencies.join(', ') || '';
  };
  const refresh = async () => {
    state = await Editor.Message.request('yzforge-editor', 'state');
    find('project').textContent = state.project;
    find('summary').textContent = `${state.modules.length} 个模块 · ${state.modules.reduce((sum, m) => sum + Object.keys(m.views || {}).length, 0)} 个界面 · ${state.tables.tables.length} 张表`;
    for (const id of ['moduleSelect','viewModule','assetModule','tableModule','deleteModuleSelect']) {
      const selected = value(id), select = find(id); select.textContent = '';
      for (const module of state.modules) { const option = document.createElement('option'); option.value = module.id; option.textContent = `${module.displayName} (${module.id})`; select.appendChild(option); }
      if (state.modules.some(m => m.id === selected)) select.value = selected;
    }
    selectModule();
    find('moduleList').textContent = state.modules.map(m => `${m.id}  ${m.displayName}\n  依赖：${m.dependencies.join(', ') || '无'}\n  包：${Object.entries(m.bundles).map(([group,b]) => group + ' → ' + b.id).join(' / ')}`).join('\n\n') || '创建第一个模块后开始开发。';
    find('viewList').textContent = state.modules.flatMap(m => Object.entries(m.views || {}).map(([id,v]) => `${m.id}.${id}  [${v.kind}]\n  ${v.prefab}`)).join('\n');
    find('assetList').textContent = state.modules.flatMap(m => Object.entries(m.assets || {}).map(([id,a]) => `${id}\n  ${a.type} · ${a.uuid}`)).join('\n');
    find('tableList').textContent = JSON.stringify(state.tables.tables, null, 2);
    find('appId').value = state.settings.appId;
    find('cleanupTimeout').value = state.settings.cleanupTimeoutMs; find('maxVoices').value = state.settings.maxAudioVoices;
    find('wechatClockUnit').value = state.settings.wechatPerformanceUnit || 'microseconds';
    for (const [id,key] of [['audioChannels','audioChannels'],['calendarRules','calendar'],['bindingPrefixes','bindingPrefixes']]) find(id).value = JSON.stringify(state.settings[key] || {}, null, 2);
  };
  const run = async (action, args = {}) => {
    find('status').textContent = '正在执行…';
    this.$.workbench.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try { const result = await Editor.Message.request('yzforge-editor', 'dispatch', action, args); show(result); await refresh(); find('status').textContent = '已完成'; return result; }
    catch (error) { show(error.message); find('status').textContent = '操作未完成，请查看定位信息'; throw error; }
    finally { this.$.workbench.querySelectorAll('button').forEach(button => { button.disabled = false; }); find('deleteModule').disabled = !preview || preview.references.length > 0; }
  };
  const bind = (id, fn) => find(id).addEventListener('click', () => { Promise.resolve().then(fn).catch(error => { show(error.message); }); });
  this.$.workbench.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    this.$.workbench.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('selected', b === button));
    this.$.workbench.querySelectorAll('[data-page]').forEach(page => { page.hidden = page.dataset.page !== button.dataset.tab; });
  }));
  bind('refresh', refresh); bind('check', () => run('check')); bind('generate', () => run('generate'));
  bind('createModule', () => run('createModule', { id: value('moduleId'), displayName: value('moduleName'), codeOnly: value('moduleTemplate') === 'code' }));
  bind('createBundle', () => run('createBundle', { module: value('moduleSelect'), id: value('bundleId') }));
  bind('createScript', () => run('createScript', { module: value('moduleSelect'), id: value('scriptId'), kind: value('scriptKind') }));
  find('moduleSelect').addEventListener('change', selectModule);
  bind('updateModule', () => run('updateModule', { module: value('moduleSelect'), displayName: value('moduleDisplayName') || undefined, dependencies: value('dependencies').split(',').map(v => v.trim()).filter(Boolean) }));
  bind('createView', () => run('createView', { module: value('viewModule'), id: value('viewId'), kind: value('viewKind'), bundle: value('viewBundle') }));
  bind('bindView', () => run('bindView', { module: value('viewModule'), id: value('viewId') }));
  bind('useSelection', () => { const selection = Editor.Selection.getSelected('asset'); if (selection.length !== 1) throw Error('请在资源管理器选中一个资源或子资源'); find('assetUuid').value = selection[0]; });
  bind('registerAsset', () => run('registerAsset', { module: value('assetModule'), id: value('assetId'), uuid: value('assetUuid'), type: value('assetType'), atlasFrame: value('atlasFrame') }));
  bind('moveAsset', () => run('moveAsset', { uuid: value('assetUuid'), target: value('assetTarget') }));
  bind('createTable', () => run('createTableTemplate', { module: value('tableModule'), id: value('tableId'), bundle: value('tableBundle') }));
  bind('saveTable', () => run('tableMapping', { mapping: { ...JSON.parse(value('tableAdvanced')), id: `${value('tableModule')}.${value('tableId')}`, source: value('tableSource'), ...(value('tableSheet') ? { sheet: value('tableSheet') } : {}), bundle: value('tableBundle'), primaryKey: value('tablePk') } }));
  bind('previewTables', () => run('previewTables')); bind('importTables', () => run('generate')); bind('removeTable', () => run('removeTable', { id: `${value('tableModule')}.${value('tableId')}` }));
  bind('saveSettings', () => run('updateSettings', { appId: value('appId'), cleanupTimeoutMs: Number(value('cleanupTimeout')), maxAudioVoices: Number(value('maxVoices')), audioChannels: JSON.parse(value('audioChannels')), calendar: JSON.parse(value('calendarRules')), bindingPrefixes: JSON.parse(value('bindingPrefixes')), wechatPerformanceUnit: value('wechatClockUnit') }));
  for (const id of ['deleteModuleSelect','deleteKind','deleteItem']) find(id).addEventListener('change', () => { preview = undefined; find('deleteModule').disabled = true; });
  bind('previewDelete', async () => { preview = await run('previewDelete', { module: value('deleteModuleSelect'), kind: value('deleteKind'), id: value('deleteItem'), path: value('deleteItem') }); find('deletePreview').textContent = JSON.stringify(preview, null, 2); find('deleteModule').disabled = preview.references.length > 0; });
  bind('deleteModule', async () => { if (!preview) throw Error('请先预览'); const result = await run('deleteModule', { module: preview.module, kind: preview.kind, id: preview.id, path: preview.path, signature: preview.signature }); find('restoreId').value = result.restoreId; preview = undefined; find('deleteModule').disabled = true; });
  bind('restore', () => run('restore', { id: value('restoreId') }));
  refresh().catch(error => show(error.message));
};
exports.close = function () {};
