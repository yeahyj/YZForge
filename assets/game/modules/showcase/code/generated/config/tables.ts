// 自动生成的配置表引用集合，不包含 JSON 数据行。
import { SamplesTable } from '../../../contracts/generated/config/Samples.table';
/** showcase 模块的表合同集合；可传给 config.loadMany，实际 JSON 按需加载。 */
export const ShowcaseTables = {
    /** showcase.samples 的加载合同；用 config.load 或 loadMany 取得可查询的数据。 */
    samples: SamplesTable,
} as const;
