// 一次性制作业务示例；结构、引用、序列化与自动绑定均走当前 Creator MCP。
import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
for (const [name, kind, id] of [
    ['ComponentTabPart', 'part', 'component-tab-part'],
    ['ComponentsLabPage', 'page', 'components-lab-page'],
    ['UiLabPage', 'entry', 'ui-lab-page'],
]) {
    if (process.argv[2] && !process.argv.slice(2).includes(kind)) continue;
    const url = `db://assets/game/modules/showcase/bundles/default/dynamic/${kind === 'part' ? 'prefabs' : 'ui'}/${name}.prefab`;
    await call('inspect_prefab', { target: url });
    const uuid = await editor('return await Editor.Message.request("asset-db","query-uuid",args.url);', { url });
    const authored = (
        await call('execute_javascript', {
            context: 'scene',
            args: { name, kind, uuid },
            code: `return await (async()=>{
const prefab=await new Promise((yes,no)=>cc.assetManager.loadAny(args.uuid,(e,v)=>e?no(e):yes(v)));
if(!(prefab instanceof cc.Prefab)||prefab.data?.name!==args.name)throw Error('预制体身份不匹配');
const root=prefab.data;
const cls=name=>{const c=cc.js.getClassByName('yzforge.'+name);if(!c)throw Error('脚本未编译 '+name);return c;};
const oldIds=[];function collect(n){if(n._prefab)oldIds.push(n._prefab.fileId);for(const c of n.components)if(c.__prefab)oldIds.push(c.__prefab.fileId);n.children.forEach(collect);}collect(root);
function node(name,parent,x,y,w,h){const n=new cc.Node(name);n.layer=cc.Layers.Enum.UI_2D;parent.addChild(n);n.setPosition(x,y,0);n.addComponent(cc.UITransform).setContentSize(w,h);return n;}
function widget(n,edges){const w=n.getComponent(cc.Widget)||n.addComponent(cc.Widget);w.alignMode=cc.Widget.AlignMode.ON_WINDOW_RESIZE;for(const [key,value] of Object.entries(edges)){w['isAlign'+key[0].toUpperCase()+key.slice(1)]=true;w[key]=value;}return w;}
function panel(name,parent,x,y,w,h,color='#20324D'){const n=node(name,parent,x,y,w,h);const p=n.addComponent(cls('PanelBackground'));p.color=new cc.Color(color);p.radius=12;return n;}
function label(name,parent,text,x,y,w,h,size=22){const n=node(name,parent,x,y,w,h),l=n.addComponent(cc.Label);l.string=text;l.fontSize=size;l.lineHeight=size+8;l.color=new cc.Color('#EAF1FF');l.horizontalAlign=cc.Label.HorizontalAlign.LEFT;l.verticalAlign=cc.Label.VerticalAlign.CENTER;l.overflow=cc.Label.Overflow.CLAMP;return n;}
function button(name,parent,text,x,y,w=180){const n=panel(name,parent,x,y,w,56,'#284B78');n.addComponent(cc.Button).transition=cc.Button.Transition.SCALE;const l=label('Text',n,text,0,0,w-12,52,21);l.getComponent(cc.Label).horizontalAlign=cc.Label.HorizontalAlign.CENTER;return n;}
if(args.kind==='entry'){
 const matches=[];function find(n){if(n.name==='node_content')matches.push(n);n.children.forEach(find);}find(root);
 if(matches.length!==1||!matches[0].getComponent(cc.Layout)||matches[0].getChildByName('btn_components'))throw Error('入口状态不匹配或已存在');
 button('btn_components',matches[0],'通用组件 / 安全区与异步交互',0,0,624).setSiblingIndex(0);
}else{
 if(root.children.length)throw Error('只允许制作空的新预制体');
 if(args.kind==='part'){
  root.getComponent(cc.UITransform).setContentSize(544,156);widget(root,{left:0,right:0,top:0,bottom:0});
  const title=label('lbl_title',root,'页签内容',0,40,496,42,24);widget(title,{left:24,right:24,top:10});
  const count=label('lbl_count',root,'点击 0 次',-126,-26,230,56,22);widget(count,{left:24,bottom:16});
  const add=button('btn_increment',root,'点击计数',162,-26,172);widget(add,{right:24,bottom:16});
 }else{
  widget(root,{left:0,right:0,top:0,bottom:0});panel('Background',root,0,0,5000,5000,'#101C2F');
  const safe=node('node_safe',root,0,0,720,1280);widget(safe,{left:0,right:0,top:0,bottom:0});safe.addComponent(cls('SafeWidget'));
  const header=node('Header',safe,0,570,624,80);widget(header,{left:48,right:48,top:24});
  label('Title',header,'通用组件 / 交互实验',-60,0,490,70,29);
  const back=button('btn_back',header,'返回',252,0,116);widget(back,{right:0,top:12});
  const toolbar=node('Toolbar',safe,0,488,624,70);widget(toolbar,{left:48,right:48,top:112});
  const info=label('lbl_safe',toolbar,'安全区：设备实际边距',-116,0,396,62,20);widget(info,{left:0,top:0,bottom:0});
  const simulate=button('btn_safe',toolbar,'模拟刘海',218,0,184);widget(simulate,{right:0,top:7});
  const scroll=node('scroll_examples',safe,0,-82,624,1052);widget(scroll,{left:48,right:48,top:204,bottom:24});
  const viewport=node('View',scroll,0,0,624,1052);widget(viewport,{left:0,right:0,top:0,bottom:0});viewport.addComponent(cc.Mask);
  const content=node('Content',viewport,0,526,624,100);content.getComponent(cc.UITransform).setAnchorPoint(0.5,1);widget(content,{left:0,right:0,top:0});
  const layout=content.addComponent(cc.Layout);layout.type=cc.Layout.Type.VERTICAL;layout.resizeMode=cc.Layout.ResizeMode.CONTAINER;layout.spacingY=18;layout.paddingBottom=8;
  const sv=scroll.addComponent(cc.ScrollView);sv.content=content;sv.horizontal=false;sv.vertical=true;sv.brake=0.75;
  function card(name,title,height){const n=panel(name,content,0,0,624,height);widget(n,{left:0,right:0});const t=label('Title',n,title,0,height/2-34,576,42,24);widget(t,{left:24,right:24,top:12});return n;}
  const bc=card('ButtonCard','01  异步按钮 · 连点只提交一次',158);
  const submit=button('btn_submit',bc,'模拟提交',-188,-27,200);widget(submit,{left:24,bottom:22});const busy=label('Busy',submit,'…',-80,0,24,44,21);busy.active=false;const ab=submit.addComponent(cls('AsyncButton'));ab.busyVisual=busy;
  const submitted=label('lbl_submit',bc,'完成 0 次',162,-27,196,48,22);widget(submitted,{right:24,bottom:26});
  const ic=card('ImageCard','02  异步图片 · 快速切换无旧图回写',172);
  const imageBg=panel('ImageBackground',ic,-234,-27,96,96,'#13233A');widget(imageBg,{left:24,bottom:16});
  const sprite=node('spr_preview',imageBg,0,0,72,72).addComponent(cc.Sprite);sprite.sizeMode=cc.Sprite.SizeMode.CUSTOM;sprite.node.addComponent(cls('AsyncSprite'));
  const alpha=button('btn_alpha',ic,'图标 A',-68,-27,168);widget(alpha,{left:152,bottom:32});
  const beta=button('btn_beta',ic,'图标 B',142,-27,168);widget(beta,{right:24,bottom:32});
  const vc=card('StateCard','03  区域四态 · 成功 / 空数据 / 失败',260);
  const reload=button('btn_reload',vc,'切换结果',190,28,176);widget(reload,{right:24,top:66});
  const vdesc=label('Description',vc,'失败后可点击重试',-108,28,306,52,20);widget(vdesc,{left:24,top:68});
  const region=node('node_state',vc,0,-61,576,108);widget(region,{left:24,right:24,bottom:20});const state=region.addComponent(cls('ViewState'));
  for(const [key,text] of [['loading','正在加载…'],['content','加载完成：这里是业务内容'],['empty','暂时没有数据'],['error','加载失败']]){
   const r=panel(key,region,0,0,576,108,'#13233A');widget(r,{left:0,right:0,top:0,bottom:0});state[key]=r;
   const l=label('Message',r,text,key==='error'?-90:0,0,key==='error'?330:532,80,22);widget(l,{left:20,right:key==='error'?210:20,top:14,bottom:14});
   if(key==='error'){const retry=button('Retry',r,'重试',182,0,160);widget(retry,{right:16,top:26});state.retryButton=retry.getComponent(cc.Button);}
   r.active=key==='loading';
  }
  const dc=card('CountdownCard','04  倒计时 · 恢复前台重新校正',156);
  const timer=label('lbl_countdown',dc,'00:00:15',-138,-28,310,60,34);widget(timer,{left:24,bottom:18});timer.addComponent(cls('CountdownLabel'));
  const restart=button('btn_restart',dc,'重新计时',190,-28,176);widget(restart,{right:24,bottom:20});
  const tc=card('TabCard','05  页签 · 按需创建，切换清理',326);
  const group=node('node_tabs',tc,0,68,576,56);widget(group,{left:24,right:24,top:64});group.addComponent(cc.ToggleContainer);
  const tg=group.addComponent(cls('TabGroup'));
  function toggle(name,text,left){const n=panel(name,group,0,0,278,56,'#284B78');widget(n,{[left?'left':'right']:0,top:0});const t=n.addComponent(cc.Toggle);const check=node('Checked',n,0,0,278,56);widget(check,{left:0,right:0,top:0,bottom:0});t.checkMark=check.addComponent(cc.Sprite);const fill=panel('Fill',check,0,0,278,56,'#337DAD');widget(fill,{left:0,right:0,top:0,bottom:0});const l=label('Text',n,text,0,0,258,50,22);l.getComponent(cc.Label).horizontalAlign=cc.Label.HorizontalAlign.CENTER;t.transition=cc.Button.Transition.SCALE;return t;}
  toggle('toggle_alpha','蓝色页签',true);toggle('toggle_beta','金色页签',false);
  const tabContent=panel('TabContent',tc,0,-55,576,172,'#13233A');widget(tabContent,{left:24,right:24,top:136,bottom:18});tg.contentRoot=tabContent;
 }
}
const {PrefabInfo,CompPrefabInfo}=cc.Prefab._utils;let serial=0;const next=()=> 'ui-components-'+args.kind+'-'+(++serial);
function visit(n){if(!n._prefab){n._prefab=new PrefabInfo();n._prefab.fileId=next();n._prefab.root=root;n._prefab.asset=prefab;}for(const c of n.components)if(!c.__prefab){c.__prefab=new CompPrefabInfo();c.__prefab.fileId=next();}n.children.forEach(visit);}visit(root);
const preserved=[];function check(n){if(n._prefab)preserved.push(n._prefab.fileId);for(const c of n.components)if(c.__prefab)preserved.push(c.__prefab.fileId);n.children.forEach(check);}check(root);
const content=cce.Utils.serialize(prefab);return {content:typeof content==='string'?content:JSON.stringify(content),added:serial,preserved:oldIds.every(id=>preserved.includes(id))};})();`,
        })
    ).data.result;
    assert.equal(authored.preserved, true, '既有 fileId 必须保留');
    await editor('return await Editor.Message.request("asset-db","save-asset",args.uuid,args.content);', {
        uuid,
        content: authored.content,
    });
    await editor(
        'return await Editor.Message.request("yzforge-editor","dispatch",args.action,{module:"showcase",id:args.id});',
        { id, action: kind === 'part' ? 'bindComponent' : 'bindView' },
    );
    assert.equal((await call('validate_prefab_references', { target: uuid })).ok, true);
    console.log(JSON.stringify({ name, added: authored.added, preserved: authored.preserved }));
}
