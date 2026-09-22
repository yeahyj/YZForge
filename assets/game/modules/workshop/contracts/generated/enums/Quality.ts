// 根据 XLSX 的 __enums 自动生成，成员值属于稳定数据合同。
/** workshop.Quality 的命名枚举值，可在表字段类型 enum<Quality> 中使用；不加载表数据。 */
export const Quality = {
    /** 普通任务；配置中实际保存 "normal"。 */
    Normal: 'normal',
    /** 进阶任务；配置中实际保存 "rare"。 */
    Rare: 'rare',
} as const;
/** Quality 所有成员值的联合类型，与上方同名值对象分别用于类型声明和取值。 */
export type Quality = (typeof Quality)[keyof typeof Quality];
