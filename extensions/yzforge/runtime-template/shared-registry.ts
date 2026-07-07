export class SharedRegistry {
    private readonly values = new Map<string, unknown>();

    public set<TValue>(key: string, value: TValue): void {
        this.values.set(key, value);
    }

    public get<TValue>(key: string): TValue | undefined {
        return this.values.get(key) as TValue | undefined;
    }
}
