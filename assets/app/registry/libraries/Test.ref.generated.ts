import { YZFORGE_RUNTIME_ABI } from 'yzforge';
import { defineLibraryRef } from 'yzforge/authoring';
export const TestRef = defineLibraryRef({
    abi: YZFORGE_RUNTIME_ABI,
    name: 'Test',
    bundle: 'yzforge-lib-test',
    libraries: [],
});
