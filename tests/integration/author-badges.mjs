// 通过当前 Cocos MCP 给既有业务预制体增量添加红点，保留全部既有内部 ID。
import { call } from '../../tools/yzforge/mcp.mjs';

const targets = [
    ['workshop', 'TaskPart', 'dynamic/prefabs', 'task-part', 'bindComponent'],
    ['workshop', 'WorkflowPage', 'dynamic/ui', 'workflow-page', 'bindView'],
    ['showcase', 'VirtualListItemPart', 'dynamic/prefabs', 'virtual-list-item-part', 'bindComponent'],
    ['showcase', 'VirtualListLabPage', 'dynamic/ui', 'virtual-list-lab-page', 'bindView'],
    ['showcase', 'ShowcasePage', 'dynamic/ui', 'showcase-page', 'bindView'],
];
for (const [module, name, folder, id, action] of targets) {
    const url = `db://assets/game/modules/${module}/bundles/default/${folder}/${name}.prefab`;
    const inspected = await call('inspect_prefab', { target: url });
    if (!inspected.ok) throw Error(`无法检查 ${url}`);
    const uuid = (
        await call('execute_javascript', {
            context: 'editor',
            args: { url },
            code: 'return await Editor.Message.request("asset-db","query-uuid",args.url);',
        })
    ).data;
    if (typeof uuid !== 'string' || !uuid) throw Error('无法解析预制体 UUID');
    const value = (
        await call('execute_javascript', {
            context: 'scene',
            args: { uuid, name },
            code: `return await (async()=>{
const prefab=await new Promise((yes,no)=>cc.assetManager.loadAny(args.uuid,(e,v)=>e?no(e):yes(v)));
if(!(prefab instanceof cc.Prefab)||prefab.data?.name!==args.name)throw Error('预制体身份不匹配');
const root=prefab.data, Badge=cc.js.getClassByName('yzforge.Badge'),Background=cc.js.getClassByName('yzforge.PanelBackground');
if(!Badge||!Background)throw Error('请等待框架脚本编译');
const find=name=>{const nodes=[];function walk(n){if(n.name===name)nodes.push(n);n.children.forEach(walk);}walk(root);if(nodes.length!==1)throw Error('目标不唯一 '+name);return nodes[0];};
let parent=root,offset=12,top=10;
if(args.name==='ShowcasePage'){parent=find('btn_workflow');offset=18;}
else if(args.name==='WorkflowPage'){parent=find('btn_inspect');offset=8;}
else if(args.name==='VirtualListLabPage'){parent=find('btn_event');offset=8;}
if(parent.getChildByName('node_badge'))throw Error('红点已存在，拒绝重复制作');
const n=new cc.Node('node_badge');n.layer=cc.Layers.Enum.UI_2D;parent.addChild(n);n.addComponent(cc.UITransform).setContentSize(48,32);
const w=n.addComponent(cc.Widget);w.isAlignRight=true;w.right=offset;w.isAlignTop=true;w.top=top;w.alignMode=cc.Widget.AlignMode.ON_WINDOW_RESIZE;
const dot=new cc.Node('Visual');dot.layer=n.layer;n.addChild(dot);dot.addComponent(cc.UITransform).setContentSize(48,32);
const p=dot.addComponent(Background);p.color=new cc.Color('#E55263');p.radius=16;
const text=new cc.Node('Count');text.layer=n.layer;dot.addChild(text);text.addComponent(cc.UITransform).setContentSize(46,30);
const label=text.addComponent(cc.Label);label.string='1';label.fontSize=18;label.lineHeight=24;label.color=new cc.Color('#FFFFFF');label.horizontalAlign=cc.Label.HorizontalAlign.CENTER;label.verticalAlign=cc.Label.VerticalAlign.CENTER;label.overflow=cc.Label.Overflow.CLAMP;
const badge=n.addComponent(Badge);badge.visual=dot;badge.countLabel=label;dot.active=false;
if(args.name==='VirtualListItemPart'){const title=find('lbl_title').getComponent(cc.Widget);if(!title)throw Error('缺少标题布局');title.right=70;}
const {PrefabInfo,CompPrefabInfo}=cc.Prefab._utils;let serial=0;const next=()=> 'badge-'+args.name+'-'+(++serial);
function visit(n){if(!n._prefab){n._prefab=new PrefabInfo();n._prefab.fileId=next();n._prefab.root=root;n._prefab.asset=prefab;}for(const c of n.components)if(!c.__prefab){c.__prefab=new CompPrefabInfo();c.__prefab.fileId=next();}n.children.forEach(visit);}visit(root);
const content=cce.Utils.serialize(prefab);return {content:typeof content==='string'?content:JSON.stringify(content),added:serial};})();`,
        })
    ).data.result;
    await call('execute_javascript', {
        context: 'editor',
        args: { uuid, content: value.content },
        code: 'return await Editor.Message.request("asset-db","save-asset",args.uuid,args.content);',
    });
    await call('execute_javascript', {
        context: 'editor',
        args: { module, id, action },
        code: 'return await Editor.Message.request("yzforge-editor","dispatch",args.action,{module:args.module,id:args.id});',
    });
    console.log(
        JSON.stringify({
            name,
            added: value.added,
            validation: (await call('validate_prefab_references', { target: uuid })).ok,
        }),
    );
}
