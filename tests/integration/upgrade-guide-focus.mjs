// 通过当前 Creator MCP 增量升级旧的四矩形遮罩，保留业务节点及已有 prefab fileId。
import { call } from '../../tools/yzforge/mcp.mjs';
const url = 'db://assets/game/modules/showcase/bundles/default/dynamic/ui/TutorialLabPage.prefab';
const editor = async (code, args = {}) => (await call('execute_javascript', { context: 'editor', code, args })).data;
await call('inspect_prefab', { target: url });
const uuid = await editor('return await Editor.Message.request("asset-db","query-uuid",args.url);', { url });
const result = (
    await call('execute_javascript', {
        context: 'scene',
        args: { uuid },
        code: `
const prefab=await new Promise((yes,no)=>cc.assetManager.loadAny(args.uuid,(e,v)=>e?no(e):yes(v)));
if(!(prefab instanceof cc.Prefab)||prefab.data.name!=='TutorialLabPage')throw Error('Prefab identity mismatch');
const root=prefab.data,overlay=root.getChildByName('node_focus'),focus=overlay?.getComponent('yzforge.GuideFocusOverlay');
if(!focus||!('holeMask' in focus))throw Error('Wait for new script compilation');
const visual=focus.visual;
if(visual.getChildByName('HoleMask'))throw Error('Already upgraded');
const obsolete=['Top','Bottom','Left','Right'].map(name=>visual.getChildByName(name));
if(obsolete.some(n=>!n?.getComponent(cc.Graphics)||!n.getComponent(cc.BlockInputEvents)))throw Error('Unexpected old structure');
for(const n of obsolete){n.removeFromParent();n.destroy();}
const hole=new cc.Node('HoleMask');hole.layer=overlay.layer;visual.addChild(hole);hole.setSiblingIndex(0);hole.addComponent(cc.UITransform).setContentSize(720,1280);
const mask=hole.addComponent(cc.Mask);mask.type=cc.Mask.Type.GRAPHICS_STENCIL;mask.inverted=true;focus.holeMask=mask;
const shade=new cc.Node('Shade');shade.layer=overlay.layer;hole.addChild(shade);shade.addComponent(cc.UITransform).setContentSize(720,1280);focus.shade=shade.addComponent(cc.Graphics);
root.getChildByName('SafeContent').getChildByName('lbl_output').getComponent(cc.Label).string='点击开始：圆形聚焦训练按钮，随后连续变为第 21 项的矩形。';
const {PrefabInfo,CompPrefabInfo}=cc.Prefab._utils;let serial=0;const next=()=> 'guide-morph-'+(++serial);
function visit(n){if(!n._prefab){n._prefab=new PrefabInfo();n._prefab.fileId=next();n._prefab.root=root;n._prefab.asset=prefab;}for(const c of n.components)if(!c.__prefab){c.__prefab=new CompPrefabInfo();c.__prefab.fileId=next();}n.children.forEach(visit);}visit(root);
const content=cce.Utils.serialize(prefab);return {content:typeof content==='string'?content:JSON.stringify(content),added:serial};
`,
    })
).data.result;
await editor('return await Editor.Message.request("asset-db","save-asset",args.uuid,args.content);', {
    uuid,
    content: result.content,
});
console.log({ added: result.added, validation: await call('validate_prefab_references', { target: uuid }) });
