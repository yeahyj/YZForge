import { call } from '../../tools/yzforge/mcp.mjs';
/** Execute in Game View or the explicitly owned built-game test window, never the edit scene. */
export async function preview(code, args = {}) {
    return (
        await call('execute_javascript', {
            context: 'editor',
            args: { code, args, built: process.env.YZFORGE_BUILT_RUNTIME === '1' },
            code: `return await (async()=>{
    const candidates=require('electron').webContents.getAllWebContents().filter(item=>args.built ? item.__yzforgeRuntimeCheck === true : item.getURL().startsWith('packages://scene/static/template/3d-webview.html?')&&item.getURL().endsWith('preview.js'));
    if(candidates.length!==1)throw Error('Expected one explicitly selected game runtime');
    const script='(async()=>{'+(args.built?'const cc=await System.import("cc");':'')+'const args='+JSON.stringify(args.args)+';const root=cc.director.getScene()?.getChildByName("GameRoot");const app=root?.getComponent("game.GameRoot")?.app;'+args.code+'})()';
    return await candidates[0].executeJavaScript(script);
  })();`,
        })
    ).data;
}
export async function screenshot(fileName) {
    return (
        await call('execute_javascript', {
            context: 'editor',
            args: { fileName, built: process.env.YZFORGE_BUILT_RUNTIME === '1' },
            code: `return await (async()=>{
    if(!/^[a-z0-9-]+\\.png$/.test(args.fileName))throw Error('Invalid capture name');
    const targets=require('electron').webContents.getAllWebContents().filter(item=>args.built ? item.__yzforgeRuntimeCheck === true : item.getURL().startsWith('packages://scene/static/template/3d-webview.html?')&&item.getURL().endsWith('preview.js'));
    if(targets.length!==1)throw Error('Expected one active Game View');const capture=await targets[0].capturePage();
    const destination=require('path').join(Editor.Project.path,'temp','mcp-captures',args.fileName);require('fs').writeFileSync(destination,capture.toPNG());
    return {path:destination,size:capture.getSize()};})();`,
        })
    ).data;
}
