// 一次性把示例配置为编辑器即用模式；全部引用与场景对象由当前 Creator MCP 操作。
import { call } from '../../tools/yzforge/mcp.mjs';
const uuid = '5bc3950a-6092-4976-ac90-91f99c15cc7c';
await call('inspect_prefab', { target: uuid });
const content = (
    await call('execute_javascript', {
        context: 'scene',
        args: { uuid },
        code: `return await (async()=>{
const prefab=await new Promise((yes,no)=>cc.assetManager.loadAny(args.uuid,(e,v)=>e?no(e):yes(v))),root=prefab.data;
if(root.name!=='ComponentsLabPage')throw Error('示例身份不符');
const find=name=>{const found=[];function visit(n){if(n.name===name)found.push(n);n.children.forEach(visit);}visit(root);if(found.length!==1)throw Error('节点不唯一 '+name);return found[0];};
function event(target,component,handler,data=''){const e=new cc.Component.EventHandler();e.target=target;e.component=component;e.handler=handler;e.customEventData=data;return e;}
const sprite=find('spr_preview').getComponent('yzforge.AsyncSprite'),timer=find('lbl_countdown').getComponent('yzforge.CountdownLabel'),state=find('node_state').getComponent('yzforge.ViewState'),group=find('node_tabs').getComponent('yzforge.TabGroup');
if(typeof sprite.setSource!=='function'||typeof timer.restart!=='function'||typeof group.selectIndex!=='function')throw Error('等待新组件编译完成');
if(group.contentRoot.children.length)throw Error('配置型示例已存在');
sprite.source='icons/alpha/token';
find('btn_alpha').getComponent(cc.Button).clickEvents=[event(sprite.node,'yzforge.AsyncSprite','loadFromEvent','icons/alpha/token')];
find('btn_beta').getComponent(cc.Button).clickEvents=[event(sprite.node,'yzforge.AsyncSprite','loadFromEvent','icons/beta/token')];
timer.duration=15;timer.autoStart=true;timer.textFormat='{mm}:{ss}';
find('btn_restart').getComponent(cc.Button).clickEvents=[event(timer.node,'yzforge.CountdownLabel','restart')];
state.initialState=0;state.retryEvents=[event(state.node,'yzforge.ViewState','showContent')];
function node(name,parent,w,h){const n=new cc.Node(name);n.layer=parent.layer;n.addComponent(cc.UITransform).setContentSize(w,h);parent.addChild(n);return n;}
function stretch(n,edges){const w=n.addComponent(cc.Widget);w.alignMode=cc.Widget.AlignMode.ON_WINDOW_RESIZE;for(const [key,value]of Object.entries(edges)){w['isAlign'+key[0].toUpperCase()+key.slice(1)]=true;w[key]=value;}return w;}
function label(parent,text,w,h,size=22){const n=node('Text',parent,w,h),l=n.addComponent(cc.Label);l.string=text;l.fontSize=size;l.lineHeight=size+9;l.color=new cc.Color('#EAF1FF');l.horizontalAlign=cc.Label.HorizontalAlign.CENTER;l.verticalAlign=cc.Label.VerticalAlign.CENTER;l.overflow=cc.Label.Overflow.CLAMP;return n;}
const card=find('StateCard');card.getChildByName('Title').getComponent(cc.Label).string='03  区域四态 · 拖拽配置切换';card.getChildByName('Description').active=false;
const controls=node('StateControls',card,576,56);stretch(controls,{left:24,right:24,top:64});const layout=controls.addComponent(cc.Layout);layout.type=cc.Layout.Type.HORIZONTAL;layout.resizeMode=cc.Layout.ResizeMode.CHILDREN;layout.spacingX=12;
const old=find('btn_reload');old.getComponent(cc.Widget).enabled=false;old.setParent(controls);old.setPosition(0,0);
for(const [index,name,title,method]of [[0,'btn_loading','加载','showLoading'],[1,'btn_content','内容','showContent'],[2,'btn_reload','空数据','showEmpty'],[3,'btn_error','失败','showError']]){
 const b=name==='btn_reload'?old:node(name,controls,132,56);if(b!==old){const bg=b.addComponent(cc.js.getClassByName('yzforge.PanelBackground'));bg.color=new cc.Color('#284B78');bg.radius=12;b.addComponent(cc.Button).transition=cc.Button.Transition.SCALE;label(b,title,120,52,20);}else{b.getComponent(cc.UITransform).setContentSize(132,56);const l=b.getChildByName('Text');l.getComponent(cc.Label).string=title;l.getComponent(cc.Label).fontSize=20;l.getComponent(cc.UITransform).width=120;}
 b.setSiblingIndex(index);b.getComponent(cc.Button).clickEvents=[event(state.node,'yzforge.ViewState',method)];
}
find('TabCard').getChildByName('Title').getComponent(cc.Label).string='05  页签 · 拖入按钮与内容即用';
const Page=cc.js.getClassByName('yzforge.TabPage');group.pages=[];
for(const [name,toggle,title]of [['PageAlpha','toggle_alpha','蓝色页签内容\\n切换只需在 Inspector 拖入对应节点'],['PageBeta','toggle_beta','金色页签内容\\n这里放业务自己的布局、图片与按钮']]){
 const n=node(name,group.contentRoot,576,172);stretch(n,{left:0,right:0,top:0,bottom:0});const text=label(n,title,532,142);stretch(text,{left:22,right:22,top:15,bottom:15});const page=new Page();page.toggle=find(toggle).getComponent(cc.Toggle);page.content=n;group.pages.push(page);n.active=group.pages.length===1;
}
group.initialIndex=0;
const {PrefabInfo,CompPrefabInfo}=cc.Prefab._utils;let serial=0;function visit(n){if(!n._prefab){n._prefab=new PrefabInfo();n._prefab.fileId='configured-components-node-'+(++serial);n._prefab.root=root;n._prefab.asset=prefab;}for(const c of n.components)if(!c.__prefab){c.__prefab=new CompPrefabInfo();c.__prefab.fileId='configured-components-component-'+(++serial);}n.children.forEach(visit);}visit(root);
const serialized=cce.Utils.serialize(prefab);return typeof serialized==='string'?serialized:JSON.stringify(serialized);})();`,
    })
).data.result;
await call('execute_javascript', {
    context: 'editor',
    args: { uuid, content },
    code: 'await Editor.Message.request("asset-db","save-asset",args.uuid,args.content);return await Editor.Message.request("yzforge-editor","dispatch","bindView",{module:"showcase",id:"components-lab-page"});',
});
console.log((await call('validate_prefab_references', { target: uuid })).ok);
