import { defineConfig, tableRef, type ConfigTable } from 'yzforge/authoring';

/** startItems table row. Source: config-source/excel/StartItems.xlsx / StartItems */
export interface StartItemsRow {
    /** Start item id */
    readonly id: string;

    /** Display label */
    readonly label: string;
}

/** StartItemsIds avoids handwritten config ids. */
export const StartItemsIds = {
    start: "start",
} as const;

export type StartItemsId = typeof StartItemsIds[keyof typeof StartItemsIds];

export interface StartConfigTables {
    readonly startItems: ConfigTable<StartItemsRow, 'id'>;
}

export const config = defineConfig({
    tables: {
        /** startItems */
        startItems: tableRef<StartItemsRow, 'id'>({ name: 'res/content/config/StartItems', primaryKey: 'id' }),
    },
});
