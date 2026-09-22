// 自动生成的配置合同，JSON 数据行留在资源 Bundle。
import { defineTable } from '../../../../../../framework/config/schema';
import type { SamplesRow, SamplesId, SamplesIndexes } from './Samples.types';
/**
 * showcase.samples 的轻量加载合同，import 本常量不会加载数据。
 * 页面使用 show.config.load(SamplesTable)；模块服务使用 ctx.config.load；多分片通过选项选择 bundle。
 * 表句柄跟随所选 Scope；公开合同可跨模块导入，读取数据不启动所属模块业务工厂。
 * @example
 * const table = await show.config.load(SamplesTable);
 * const rows = table.all(); // 按主键排序的只读数据行
 */
export const SamplesTable = defineTable<SamplesRow, SamplesId, SamplesIndexes>({
    id: 'showcase.samples',
    primaryKey: 'id',
    fields: {
        id: {
            kind: 'int',
        },
        name: {
            kind: 'string',
        },
        pack: {
            kind: 'string',
        },
        enabled: {
            kind: 'bool',
        },
        weight: {
            kind: 'float',
            min: 0,
        },
        quality: {
            kind: 'enum',
            values: ['normal', 'rare'],
            enumId: 'showcase.Quality',
        },
        tags: {
            kind: 'array',
            element: {
                kind: 'string',
            },
        },
        position: {
            kind: 'vec2',
        },
        tint: {
            kind: 'color',
        },
        icon: {
            kind: 'asset',
            assetType: 'SpriteFrame',
        },
        economy: {
            kind: 'ref',
            target: 'common.economy',
            keyKind: 'int',
        },
        note: {
            kind: 'string',
            nullable: true,
        },
        releasedAt: {
            kind: 'string',
            format: 'date-time',
        },
    },
    indexes: {
        quality: {
            field: 'quality',
            unique: false,
        },
    },
    schemaHash: 'sha256:3f9667eebce52db76af9379133a734030992f7f0f4c909b4bb9b8cd0558f0828',
});
