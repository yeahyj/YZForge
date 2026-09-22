// 仅为本功能新建的两个空预制体补齐示例；所有序列化修改经当前 Cocos MCP/Creator。
import { call } from '../../tools/yzforge/mcp.mjs';

for (const [name, uuid, kind] of [
    ['VirtualListItemPart', '721bf3d6-8cd8-487d-b70d-2bd2f7f5ff95', 'item'],
    ['VirtualListLabPage', '3c70358c-8a45-4ee7-8829-7fe9b388aece', 'page'],
]) {
    await call('inspect_prefab', { target: uuid });
    const result = await call('execute_javascript', {
        context: 'scene',
        args: { name, uuid, kind },
        code: `return await (async()=>{
const prefab=await new Promise((yes,no)=>cc.assetManager.loadAny(args.uuid,(e,v)=>e?no(e):yes(v)));
if(!(prefab instanceof cc.Prefab)||!prefab.data||prefab.data.name!==args.name)throw Error('Unexpected prefab');
const root=prefab.data;if(root.children.length)throw Error('Only author an empty example prefab');
const Background=cc.js.getClassByName('yzforge.PanelBackground'),VirtualList=cc.js.getClassByName('yzforge.VirtualList');
if(!Background||!VirtualList)throw Error('Framework classes not compiled');
function node(name,parent,x,y,w,h){const n=new cc.Node(name);n.layer=cc.Layers.Enum.UI_2D;parent.addChild(n);n.setPosition(x,y,0);n.addComponent(cc.UITransform).setContentSize(w,h);return n;}
function widget(n,edges){const w=n.addComponent(cc.Widget);w.alignMode=cc.Widget.AlignMode.ON_WINDOW_RESIZE;for(const [key,value] of Object.entries(edges)){w['isAlign'+key[0].toUpperCase()+key.slice(1)]=true;w[key]=value;}return w;}
function panel(name,parent,x,y,w,h,color){const n=node(name,parent,x,y,w,h);const p=n.addComponent(Background);p.color=new cc.Color(color);p.radius=12;return n;}
function label(name,parent,text,x,y,w,h,size){const n=node(name,parent,x,y,w,h),l=n.addComponent(cc.Label);l.string=text;l.fontSize=size;l.lineHeight=size+8;l.color=new cc.Color('#EAF1FF');l.horizontalAlign=cc.Label.HorizontalAlign.LEFT;l.verticalAlign=cc.Label.VerticalAlign.CENTER;l.overflow=cc.Label.Overflow.CLAMP;return n;}
function button(name,parent,text,x,y,w=196){const n=panel(name,parent,x,y,w,64,'#284B78');n.addComponent(cc.Button).transition=cc.Button.Transition.SCALE;const textNode=label('Text',n,text,0,0,w-12,60,22);textNode.getComponent(cc.Label).horizontalAlign=cc.Label.HorizontalAlign.CENTER;return n;}
if(args.kind==='item'){
 root.getComponent(cc.UITransform).setContentSize(624,88);
 const background=root.addComponent(Background);background.color=new cc.Color('#20324D');background.radius=10;
 const title=label('lbl_title',root,'条目 #1',0,16,596,36,22);title.getComponent(cc.Label).enableWrapText=false;widget(title,{left:14,right:14,top:8});
 const detail=label('lbl_detail',root,'等待异步详情…',0,-20,596,30,17);detail.getComponent(cc.Label).enableWrapText=false;widget(detail,{left:14,right:14,bottom:8});
}else{
 widget(root,{left:0,right:0,top:0,bottom:0});
 panel('Background',root,0,0,5000,5000,'#101C2F');
 const safe=node('SafeContent',root,0,0,720,1280);widget(safe,{left:0,right:0,top:0,bottom:0});safe.addComponent(cc.SafeArea);
 const header=node('Header',safe,0,570,624,80);widget(header,{left:48,right:48,top:32});
 label('Title',header,'虚拟列表 / 固定网格',-60,0,460,70,32);
 const back=button('btn_back',header,'返回',250,0,120);widget(back,{right:0,top:8});
 const toolbar=node('Toolbar',safe,0,452,624,152);widget(toolbar,{left:48,right:48,top:132});
 button('btn_mode',toolbar,'切换三列网格',-214,42);
 button('btn_jump',toolbar,'定位第 5000 项',0,42);
 button('btn_refresh',toolbar,'刷新可见项',214,42);
 button('btn_data',toolbar,'清空 / 恢复',-214,-38);
 button('btn_event',toolbar,'广播更新',0,-38);
 button('btn_top',toolbar,'回到顶部',214,-38);
 const list=node('node_list',safe,0,-10,624,736);widget(list,{left:48,right:48,top:304,bottom:208});
 const view=node('View',list,0,0,624,736);widget(view,{left:0,right:0,top:0,bottom:0});view.addComponent(cc.Mask);
 const content=node('Content',view,-312,368,624,736);content.getComponent(cc.UITransform).setAnchorPoint(0,1);
 const scroll=list.addComponent(cc.ScrollView);scroll.content=content;scroll.horizontal=false;scroll.vertical=true;scroll.inertia=true;scroll.elastic=true;list.addComponent(VirtualList);
 const footer=node('Footer',safe,0,-544,624,144);widget(footer,{left:48,right:48,bottom:32});
 label('lbl_output',footer,'10000 条业务数据，仅实例化可见条目',0,18,624,90,21);
 label('Hint',footer,'拖动滚动 · 返回再进入验证 Scope 清理',0,-52,624,40,19);
}
const {PrefabInfo,CompPrefabInfo}=cc.Prefab._utils;let serial=0;const id=()=> 'virtual-list-'+args.kind+'-'+(++serial);
function visit(n){if(!n._prefab){n._prefab=new PrefabInfo();n._prefab.fileId=id();n._prefab.root=root;n._prefab.asset=prefab;}for(const c of n.components)if(!c.__prefab){c.__prefab=new CompPrefabInfo();c.__prefab.fileId=id();}for(const child of n.children)visit(child);}visit(root);
const content=cce.Utils.serialize(prefab);return {content:typeof content==='string'?content:JSON.stringify(content),objects:serial};})();`,
    });
    const authored = result.data.result;
    await call('execute_javascript', {
        context: 'editor',
        args: { uuid, content: authored.content },
        code: 'return await Editor.Message.request("asset-db","save-asset",args.uuid,args.content);',
    });
    const bound = await call('execute_javascript', {
        context: 'editor',
        args: { kind },
        code: 'return await Editor.Message.request("yzforge-editor","dispatch",args.kind==="item"?"bindComponent":"bindView",{module:"showcase",id:args.kind==="item"?"virtual-list-item-part":"virtual-list-lab-page"});',
    });
    console.log(JSON.stringify({ name, objects: authored.objects, bindings: bound.data }));
}
