import { _decorator, Component, instantiate } from 'cc';
import { Assets, destroyNode } from '../assets/asset-manager';
import { invariant } from '../core/errors';
import { Scope } from '../core/scope';
import { ModuleDefinition, ModuleFactory } from './module-manager';
const { ccclass } = _decorator;
/** Local code bundle adapter. It has no engine lifecycle startup. */
@ccclass('yzforge.ModuleEntry')
export class ModuleEntry extends Component {
  get moduleId(): string { throw Error('ModuleEntry must declare moduleId'); }
  get factory(): ModuleFactory { throw Error('ModuleEntry must provide factory'); }
}
export function bundleFactoryLoader(assets: Assets) {
  return async (definition: ModuleDefinition, scope: Scope): Promise<ModuleFactory> => {
    if (definition.factory) return definition.factory;
    invariant(definition.codeBundle && definition.entryPath, 'MODULE_ENTRY_MISSING', definition.id);
    const bundle = assets.release.bundles[definition.codeBundle];
    invariant(bundle && !/^https?:/.test(bundle.location ?? ''), 'REMOTE_CODE_FORBIDDEN', 'Executable code bundles must be locally delivered');
    await assets.prepareBundle(definition.codeBundle);
    const prefab = await assets.loadPath(definition.codeBundle, definition.entryPath, 'Prefab', scope);
    scope.signal.throwIfAborted();
    const node = instantiate(prefab); node.active = false;
    scope.defer(() => destroyNode(node));
    const entry = node.getComponent(ModuleEntry);
    invariant(entry && entry.moduleId === definition.id, 'MODULE_ENTRY_INVALID', definition.id);
    return entry.factory;
  };
}
