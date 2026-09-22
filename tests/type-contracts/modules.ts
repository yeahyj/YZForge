import { defineModule, moduleServices, type ModuleRef } from '../../assets/framework/modules/module-manager';
import type { ViewShowContext } from '../../assets/framework/ui/ui-view';
import { defineTable } from '../../assets/framework/config/schema';
const Profile: ModuleRef<{ coins: number }> = { id: 'profile' };
const Lobby: ModuleRef<{ name: string }> = { id: 'lobby' };
const Services = moduleServices<{ title: string }>('lobby');
defineModule(Lobby, { services: Services, dependencies: { profile: Profile } }, (_ctx, deps) => {
    const coins: number = deps.profile.coins;
    // @ts-expect-error 已声明依赖没有未知的字段。
    void deps.profile.missing;
    return { api: { name: String(coins) }, services: { title: 'lobby' } };
});
// @ts-expect-error 返回值必须满足公开 API，不能让 factory 反向拓宽 ModuleRef 的类型。
defineModule(Lobby, {}, () => ({ api: { name: 123 } }));
// @ts-expect-error 内部服务返回值必须匹配服务合同。
defineModule(Lobby, { services: Services }, () => ({ api: { name: 'x' }, services: { title: 123 } }));
declare const show: ViewShowContext<void, void>;
// @ts-expect-error 展示上下文不暴露宿主关闭权限。
void show.scope.close;
// @ts-expect-error 展示上下文不暴露宿主取消权限。
void show.scope.cancel;
const localOwner = show.scope.child('explicit-owner');
void localOwner.close();
const Table = defineTable<{ id: number; name: string }, number, Record<string, never>>({
    id: 'common.names',
    schemaHash: 'test',
    primaryKey: 'id',
    fields: { id: { kind: 'int' }, name: { kind: 'string' } },
    indexes: {},
});
async function configTypes() {
    const rows = await show.config.load(Table, { bundle: 'common-data' });
    const name: string = rows.require(1).name;
    // @ts-expect-error 主键保持 number 类型。
    rows.require('1');
    return name;
}
void configTypes;
