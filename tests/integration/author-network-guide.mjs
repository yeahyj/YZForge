// 示例预制体结构和引用全部通过当前 MCP/Creator 创建，既有资源只增量修改。
import { call } from '../../tools/yzforge/mcp.mjs';
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
for (const [name, kind, id] of [
    ['NetworkLabPage', 'network', 'network-lab-page'],
    ['TutorialLabPage', 'guide', 'tutorial-lab-page'],
    ['UiLabPage', 'entry', 'ui-lab-page'],
    ['VirtualListItemPart', 'item', 'virtual-list-item-part'],
]) {
    const url = `db://assets/game/modules/showcase/bundles/default/dynamic/${kind === 'item' ? 'prefabs' : 'ui'}/${name}.prefab`;
    await call('inspect_prefab', { target: url });
    const uuid = await editor('return await Editor.Message.request("asset-db","query-uuid",args.url);', { url });
    const authored = (
        await call('execute_javascript', {
            context: 'scene',
            args: { name, kind, uuid },
            code: `return await (async()=>{
const prefab=await new Promise((yes,no)=>cc.assetManager.loadAny(args.uuid,(e,v)=>e?no(e):yes(v)));
if(!(prefab instanceof cc.Prefab)||prefab.data?.name!==args.name)throw Error('预制体身份不匹配');
const root=prefab.data,Background=cc.js.getClassByName('yzforge.PanelBackground'),VirtualList=cc.js.getClassByName('yzforge.VirtualList'),Focus=cc.js.getClassByName('yzforge.GuideFocusOverlay');
if(!Background||!VirtualList||!Focus)throw Error('脚本尚未编译');
function node(name,parent,x,y,w,h){const n=new cc.Node(name);n.layer=cc.Layers.Enum.UI_2D;parent.addChild(n);n.setPosition(x,y,0);n.addComponent(cc.UITransform).setContentSize(w,h);return n;}
function widget(n,edges){const w=n.addComponent(cc.Widget);w.alignMode=cc.Widget.AlignMode.ON_WINDOW_RESIZE;for(const [key,value] of Object.entries(edges)){w['isAlign'+key[0].toUpperCase()+key.slice(1)]=true;w[key]=value;}return w;}
function panel(name,parent,x,y,w,h,color){const n=node(name,parent,x,y,w,h);const p=n.addComponent(Background);p.color=new cc.Color(color);p.radius=12;return n;}
function label(name,parent,text,x,y,w,h,size){const n=node(name,parent,x,y,w,h),l=n.addComponent(cc.Label);l.string=text;l.fontSize=size;l.lineHeight=size+9;l.color=new cc.Color('#EAF1FF');l.horizontalAlign=cc.Label.HorizontalAlign.LEFT;l.verticalAlign=cc.Label.VerticalAlign.CENTER;l.overflow=cc.Label.Overflow.CLAMP;return n;}
function button(name,parent,text,x,y,w=196){const n=panel(name,parent,x,y,w,64,'#284B78');n.addComponent(cc.Button).transition=cc.Button.Transition.SCALE;const l=label('Text',n,text,0,0,w-12,60,22);l.getComponent(cc.Label).horizontalAlign=cc.Label.HorizontalAlign.CENTER;return n;}
function find(name){const values=[];function walk(n){if(n.name===name)values.push(n);n.children.forEach(walk);}walk(root);if(values.length!==1)throw Error('目标不唯一 '+name);return values[0];}
if(args.kind==='entry'){
 const content=find('node_content');if(!content.getComponent(cc.Layout))throw Error('入口布局不匹配');
 if(content.getChildByName('btn_network')||content.getChildByName('btn_tutorial'))throw Error('入口已存在');
 const network=button('btn_network',content,'网络 / 请求与取消',0,0,624),guide=button('btn_tutorial',content,'新手引导 / 聚焦动画',0,0,624);
 network.setSiblingIndex(0);guide.setSiblingIndex(1);
}else if(args.kind==='item'){
 if(root.getComponent(cc.Button))throw Error('条目按钮已存在');root.addComponent(cc.Button).transition=cc.Button.Transition.NONE;
}else{
 if(root.children.length)throw Error('只允许制作空的新预制体');
 widget(root,{left:0,right:0,top:0,bottom:0});panel('Background',root,0,0,5000,5000,'#101C2F');
 const safe=node('SafeContent',root,0,0,720,1280);widget(safe,{left:0,right:0,top:0,bottom:0});safe.addComponent(cc.SafeArea);
 const header=node('Header',safe,0,570,624,80);widget(header,{left:48,right:48,top:32});
 label('Title',header,args.kind==='network'?'网络 / 请求生命周期':'新手引导 / 聚焦动画',-50,0,480,70,30);
 const back=button('btn_back',header,'返回',250,0,120);widget(back,{right:0,top:8});
 if(args.kind==='network'){
  const intro=label('Description',safe,'先体验模拟成功、失败、超时和取消。\\n输入本机测试地址后，可执行真实 HTTP GET。',0,456,624,96,21);widget(intro,{left:48,right:48,top:132});
  const input=panel('edit_url',safe,0,364,624,64,'#20324D');widget(input,{left:48,right:48,top:244});
  const text=label('Value',input,'http://127.0.0.1:8787/health',0,0,596,60,19).getComponent(cc.Label);
  const placeholder=label('Placeholder',input,'输入 http(s) 地址',0,0,596,60,19).getComponent(cc.Label);
  text.node.getComponent(cc.UITransform).setAnchorPoint(0,1);placeholder.node.getComponent(cc.UITransform).setAnchorPoint(0,1);const edit=input.addComponent(cc.EditBox);edit.textLabel=text;edit.placeholderLabel=placeholder;edit.maxLength=1024;edit.inputMode=cc.EditBox.InputMode.URL;edit.string='http://127.0.0.1:8787/health';
  const toolbar=node('Toolbar',safe,0,188,624,152);widget(toolbar,{left:48,right:48,top:344});
  button('btn_success',toolbar,'模拟成功',-214,42);button('btn_failure',toolbar,'模拟 503',0,42);button('btn_timeout',toolbar,'模拟超时',214,42);
  button('btn_cancel',toolbar,'取消当前请求',-214,-38);button('btn_real',toolbar,'真实 HTTP GET',0,-38);
  const output=label('lbl_output',safe,'等待请求',0,-130,624,340,24);widget(output,{left:48,right:48,top:532,bottom:136});
  const hint=label('Hint',safe,'本机服务：node tests/integration/http-fixture.mjs\\n关闭页面会取消其请求；写入请求默认不重试。',0,-554,624,96,20);widget(hint,{left:48,right:48,bottom:32});
 }else{
  const toolbar=node('Toolbar',safe,0,454,624,80);widget(toolbar,{left:48,right:48,top:144});
  button('btn_start',toolbar,'开始 / 继续引导',-214,0);button('btn_reset',toolbar,'重置引导进度',0,0);button('btn_train',toolbar,'完成一次训练',214,0);
  const status=label('lbl_state',safe,'训练 0 次 · 领取 0 次',0,364,624,64,24);widget(status,{left:48,right:48,top:244});
  const list=node('node_list',safe,0,-10,624,736);widget(list,{left:48,right:48,top:332,bottom:184});
  const viewport=node('View',list,0,0,624,736);widget(viewport,{left:0,right:0,top:0,bottom:0});viewport.addComponent(cc.Mask);
  const content=node('Content',viewport,-312,368,624,736);content.getComponent(cc.UITransform).setAnchorPoint(0,1);
  const scroll=list.addComponent(cc.ScrollView);scroll.content=content;scroll.horizontal=false;scroll.vertical=true;list.addComponent(VirtualList);
  const output=label('lbl_output',safe,'点击开始：圆形聚焦训练按钮，随后连续变为第 21 项的矩形。',0,-550,624,120,21);widget(output,{left:48,right:48,bottom:32});
  const overlay=node('node_focus',root,0,0,720,1280);widget(overlay,{left:0,right:0,top:0,bottom:0});
  const focus=overlay.addComponent(Focus),visual=node('Visual',overlay,0,0,720,1280);widget(visual,{left:0,right:0,top:0,bottom:0});focus.visual=visual;
  const mask=node('HoleMask',visual,0,0,720,1280).addComponent(cc.Mask);mask.type=cc.Mask.Type.GRAPHICS_STENCIL;mask.inverted=true;focus.holeMask=mask;
  focus.shade=node('Shade',mask.node,0,0,720,1280).addComponent(cc.Graphics);
  const outline=node('FocusOutline',visual,0,0,720,1280);focus.outline=outline.addComponent(cc.Graphics);
  const shield=node('InputShield',visual,0,0,720,1280);widget(shield,{left:0,right:0,top:0,bottom:0});shield.addComponent(cc.BlockInputEvents);focus.inputShield=shield;
  const controls=node('SafeControls',visual,0,0,720,1280);widget(controls,{left:0,right:0,top:0,bottom:0});controls.addComponent(cc.SafeArea);
  const hint=panel('HintPanel',controls,0,-508,624,160,'#FFFFFF');widget(hint,{left:48,right:48,bottom:112});hint.addComponent(cc.BlockInputEvents);
  const message=label('Message',hint,'请点击高亮区域',0,0,588,140,24);message.getComponent(cc.Label).color=new cc.Color('#20324D');focus.messageLabel=message.getComponent(cc.Label);
  const skip=button('Skip',controls,'跳过引导',0,-590,196);widget(skip,{right:48,bottom:32});focus.skipButton=skip.getComponent(cc.Button);
  visual.active=false;
 }
}
const {PrefabInfo,CompPrefabInfo}=cc.Prefab._utils;let serial=0;const next=()=> 'network-guide-'+args.kind+'-'+(++serial);
function visit(n){if(!n._prefab){n._prefab=new PrefabInfo();n._prefab.fileId=next();n._prefab.root=root;n._prefab.asset=prefab;}for(const c of n.components)if(!c.__prefab){c.__prefab=new CompPrefabInfo();c.__prefab.fileId=next();}n.children.forEach(visit);}visit(root);
const content=cce.Utils.serialize(prefab);return {content:typeof content==='string'?content:JSON.stringify(content),added:serial};})();`,
        })
    ).data.result;
    await editor('return await Editor.Message.request("asset-db","save-asset",args.uuid,args.content);', {
        uuid,
        content: authored.content,
    });
    await editor(
        'return await Editor.Message.request("yzforge-editor","dispatch",args.action,{module:"showcase",id:args.id});',
        { id, action: kind === 'item' ? 'bindComponent' : 'bindView' },
    );
    console.log(
        JSON.stringify({
            name,
            added: authored.added,
            validated: (await call('validate_prefab_references', { target: uuid })).ok,
        }),
    );
}
