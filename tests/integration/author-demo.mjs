import { call } from '../../tools/yzforge/mcp.mjs';

// Run only against the initial empty example prefabs. All serialized writes go through MCP/Creator.
const definitions = [
  { target: 'db://assets/game/modules/lobby/res/ui/Dashboard.prefab', uuid: '91b45fca-617b-4fa0-82bb-e5f2871b57fa', kind: 'dashboard' },
  { target: 'db://assets/game/modules/lobby/res/ui/RewardPopup.prefab', uuid: '0505cd73-cb77-404c-a4ec-b2f75ec5a5a2', kind: 'reward' },
];
for (const definition of definitions) {
  await call('inspect_prefab', { target: definition.target });
  const result = await call('execute_javascript', { context: 'scene', args: definition, code: `
return await (async () => {
  const prefab = await new Promise((yes,no)=>cc.assetManager.loadAny(args.uuid,(error,value)=>error?no(error):yes(value)));
  if (!(prefab instanceof cc.Prefab) || !prefab.data) throw Error('Expected the verified example prefab');
  const root = prefab.data;
  if (root.children.length) {
    if (args.kind !== 'dashboard' || root.children.length !== 2 || !root.getChildByName('SafeContent')?.getChildByName('btn_reward')) throw Error('Example prefab already has unrelated content');
    const existing = cce.Utils.serialize(prefab);
    return { content: typeof existing === 'string' ? existing : JSON.stringify(existing), nodes: 'recover authored editor state' };
  }
  const color = hex => new cc.Color(hex);
  function node(name, parent, x, y, width, height) {
    const child = new cc.Node(name); child.layer = cc.Layers.Enum.UI_2D; parent.addChild(child);
    child.setPosition(x,y,0); child.addComponent(cc.UITransform).setContentSize(width,height); return child;
  }
  function panel(name, parent, x,y,w,h,fill,radius=20) {
    const n = node(name,parent,x,y,w,h), g = n.addComponent(cc.Graphics); g.fillColor=color(fill); g.roundRect(-w/2,-h/2,w,h,radius); g.fill(); return n;
  }
  function label(name,parent,text,x,y,w,h,size,fill='#F0F4FF',bold=false) {
    const n=node(name,parent,x,y,w,h), l=n.addComponent(cc.Label); l.string=text; l.fontSize=size;l.lineHeight=Math.round(size*1.45);
    l.color=color(fill);l.isBold=bold;l.overflow=cc.Label.Overflow.CLAMP;l.enableWrapText=true;l.horizontalAlign=cc.Label.HorizontalAlign.LEFT;l.verticalAlign=cc.Label.VerticalAlign.CENTER;return n;
  }
  function button(name,parent,text,x,y,w=280,fill='#3978E8') {
    const n=panel(name,parent,x,y,w,76,fill,14);const b=n.addComponent(cc.Button);b.transition=cc.Button.Transition.SCALE;b.zoomScale=0.97;
    const t=label('Text',n,text,0,0,w-24,60,25,'#FFFFFF',true);t.getComponent(cc.Label).horizontalAlign=cc.Label.HorizontalAlign.CENTER;return n;
  }
  const stretch=root.addComponent(cc.Widget);stretch.isAlignTop=stretch.isAlignBottom=stretch.isAlignLeft=stretch.isAlignRight=true;stretch.top=stretch.bottom=stretch.left=stretch.right=0;stretch.alignMode=cc.Widget.AlignMode.ON_WINDOW_RESIZE;
  if(args.kind==='dashboard') {
    panel('Backdrop',root,0,0,1800,2400,'#101827',0);
    const safe=node('SafeContent',root,0,0,720,1280);safe.addComponent(cc.SafeArea);
    label('Brand',safe,'YZFORGE',-5,539,620,64,47,'#F3F7FF',true);
    label('Subtitle',safe,'模块化 Cocos 游戏框架',-5,482,620,44,22,'#8FA7C9');
    panel('Version',safe,229,549,144,38,'#223754',12);label('VersionText',safe,'CREATOR 3.8.8',241,549,137,38,15,'#A7CDFF');
    panel('ClockCard',safe,0,303,628,244,'#1A2940');
    label('ClockTitle',safe,'时间与日历',0,378,568,42,25,'#ECF3FF',true);
    label('lbl_time',safe,'读取当前时间…',0,315,568,66,34,'#7EC6FF',true);
    label('lbl_period',safe,'本地时间 · 周一为每周开始',0,247,568,62,20,'#9EB1CE');
    panel('DataCard',safe,0,41,628,220,'#1A2940');
    label('DataTitle',safe,'模块资源与配置',0,108,568,42,25,'#ECF3FF',true);
    label('lbl_items',safe,'正在按需读取配置…',0,33,568,92,22,'#AFC2DD');
    const icon=node('spr_icon',safe,257,101,42,42);icon.addComponent(cc.Sprite);
    button('btn_reward',safe,'打开奖励弹窗',-163,-145,302);
    button('btn_audio',safe,'播放示例音效',163,-145,302,'#2B425F');
    button('btn_reload',safe,'重新读取配置',0,-247,628,'#22334D');
    panel('ResultCard',safe,0,-390,628,144,'#142136');
    label('lbl_result',safe,'点击按钮验证 UI 参数、结果与自动绑定。',0,-370,566,70,21,'#AFC2DD');
    label('lbl_status',safe,'准备中',0,-425,566,34,17,'#74D9AB');
    label('Footer',safe,'统一 Scope 管理资源与订阅的使用期限',0,-536,624,48,18,'#607B9E');
  } else {
    const overlay=panel('Scrim',root,0,0,1800,2400,'#080E1CDD',0);overlay.addComponent(cc.BlockInputEvents);
    const card=panel('Card',root,0,0,604,496,'#1C2D46',28);
    label('Eyebrow',card,'MODULE  /  LOBBY',0,170,512,38,17,'#78B8FF');
    label('lbl_title',card,'奖励已准备',0,96,512,64,35,'#F3F7FF',true);
    label('lbl_amount',card,'金币 × 100',0,15,512,68,29,'#FFD584',true);
    label('Description',card,'通过参数打开，通过结果返回。',0,-47,512,42,19,'#9EB5D5');
    button('btn_confirm',card,'领取奖励',134,-154,244);
    button('btn_cancel',card,'稍后再说',-134,-154,244,'#2B425F');
  }
  const {PrefabInfo,CompPrefabInfo}=cc.Prefab._utils;
  let serial=0; const id=()=> 'yz-demo-' + args.kind + '-' + (++serial);
  const visit=n=>{if(!n._prefab){n._prefab=new PrefabInfo();n._prefab.fileId=id();n._prefab.root=root;n._prefab.asset=prefab;}
    for(const c of n.components) if(!c.__prefab){c.__prefab=new CompPrefabInfo();c.__prefab.fileId=id();}for(const child of n.children)visit(child);};visit(root);
  const content=cce.Utils.serialize(prefab);return {content:typeof content==='string'?content:JSON.stringify(content),nodes:serial};
})();` });
  const authored = result.data.result;
  const saved = await call('execute_javascript', { context: 'editor', args: { uuid: definition.uuid, content: authored.content }, code: 'return await Editor.Message.request("asset-db", "save-asset", args.uuid, args.content);' });
  console.log(JSON.stringify({ prefab: definition.kind, nodes: authored.nodes, saved: saved.ok }));
  const bound = await call('execute_javascript', { context: 'editor', args: { id: definition.kind === 'dashboard' ? 'dashboard' : 'reward-popup' }, code: 'return await Editor.Message.request("yzforge-editor", "dispatch", "bindView", {module:"lobby",id:args.id});' });
  console.log(JSON.stringify({ bindings: bound.data }));
}
