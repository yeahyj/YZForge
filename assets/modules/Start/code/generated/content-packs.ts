import { YZFORGE_RUNTIME_ABI } from 'yzforge';
import { defineContentPack, contentPackConfigContract, type ConfigTable } from 'yzforge/authoring';

/** testWaves table row. Source: config-source/excel/TestWaves.xlsx / TestWaves */
export interface TestWavesRow {
    /** Wave id */
    readonly id: string;

    /** Enemy id */
    readonly enemy: string;

    /** Enemy count */
    readonly count: number;
}

/** StartTest2TestWavesIds avoids handwritten config ids. */
export const StartTest2TestWavesIds = {
    wave1: "wave-1",
} as const;

export type StartTest2TestWavesId = typeof StartTest2TestWavesIds[keyof typeof StartTest2TestWavesIds];

const StartTest2ContentPackContract = {
    testWaves: contentPackConfigContract<TestWavesRow>({ primaryKey: 'id' }),
};

export interface StartTest2ContentPackConfigTables {
    readonly testWaves: ConfigTable<TestWavesRow, 'id'>;
}

export const StartTest2ContentPack = defineContentPack<typeof StartTest2ContentPackContract, StartTest2ContentPackConfigTables>({
    abi: YZFORGE_RUNTIME_ABI,
    id: 'start.test2',
    owner: 'Start',
    name: 'Test2',
    bundle: 'yzforge-content-pack-start-test2',
    libraries: [],
    presentationRequests: [],
    contract: StartTest2ContentPackContract,
});

export const contentPacks = {
    Test2: StartTest2ContentPack,
};
