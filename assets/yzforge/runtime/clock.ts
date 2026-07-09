export interface AppClockSnapshot {
    readonly nowMs: number;
    readonly unixMs: number;
    readonly serverUnixMs: number;
    readonly serverOffsetMs: number;
    readonly serverSynced: boolean;
    readonly timezoneOffsetMinutes: number;
    readonly dayOfWeek: number;
    readonly startOfDayMs: number;
    readonly startOfWeekMs: number;
    readonly startOfMonthMs: number;
    readonly msUntilNextDay: number;
    readonly msUntilNextWeek: number;
    readonly msUntilNextMonth: number;
}

export class AppClock {
    private readonly monotonicBaseMs = readMonotonicMs();
    private serverBaseUnixMs = 0;
    private serverBaseMonotonicMs = 0;
    private syncedServerOffsetMs = 0;
    private serverSynced = false;

    public nowMs(): number {
        return readMonotonicMs() - this.monotonicBaseMs;
    }

    public unixMs(): number {
        return Date.now();
    }

    public serverUnixMs(): number {
        if (!this.serverSynced) {
            return this.unixMs();
        }
        return Math.trunc(this.serverBaseUnixMs + readMonotonicMs() - this.serverBaseMonotonicMs);
    }

    public setServerUnixMs(serverUnixMs: number, localUnixMs: number = this.unixMs()): void {
        assertValidTimestamp(serverUnixMs, 'serverUnixMs');
        assertValidTimestamp(localUnixMs, 'localUnixMs');
        this.syncedServerOffsetMs = Math.trunc(serverUnixMs) - Math.trunc(localUnixMs);
        this.serverBaseUnixMs = this.unixMs() + this.syncedServerOffsetMs;
        this.serverBaseMonotonicMs = readMonotonicMs();
        this.serverSynced = true;
    }

    public clearServerUnixMs(): void {
        this.serverBaseUnixMs = 0;
        this.serverBaseMonotonicMs = 0;
        this.syncedServerOffsetMs = 0;
        this.serverSynced = false;
    }

    public dayOfWeek(unixMs: number = this.serverUnixMs()): number {
        const day = new Date(unixMs).getDay();
        return day === 0 ? 7 : day;
    }

    public startOfDayMs(unixMs: number = this.serverUnixMs()): number {
        const date = new Date(unixMs);
        date.setHours(0, 0, 0, 0);
        return date.getTime();
    }

    public startOfWeekMs(unixMs: number = this.serverUnixMs()): number {
        const date = new Date(this.startOfDayMs(unixMs));
        date.setDate(date.getDate() - (this.dayOfWeek(unixMs) - 1));
        return date.getTime();
    }

    public startOfMonthMs(unixMs: number = this.serverUnixMs()): number {
        const date = new Date(unixMs);
        return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    }

    public isSameDay(lhsUnixMs: number, rhsUnixMs: number): boolean {
        return this.startOfDayMs(lhsUnixMs) === this.startOfDayMs(rhsUnixMs);
    }

    public isSameWeek(lhsUnixMs: number, rhsUnixMs: number): boolean {
        return this.startOfWeekMs(lhsUnixMs) === this.startOfWeekMs(rhsUnixMs);
    }

    public isSameMonth(lhsUnixMs: number, rhsUnixMs: number): boolean {
        return this.startOfMonthMs(lhsUnixMs) === this.startOfMonthMs(rhsUnixMs);
    }

    public hasCrossedDay(fromUnixMs: number, toUnixMs: number = this.serverUnixMs()): boolean {
        return !this.isSameDay(fromUnixMs, toUnixMs);
    }

    public hasCrossedWeek(fromUnixMs: number, toUnixMs: number = this.serverUnixMs()): boolean {
        return !this.isSameWeek(fromUnixMs, toUnixMs);
    }

    public hasCrossedMonth(fromUnixMs: number, toUnixMs: number = this.serverUnixMs()): boolean {
        return !this.isSameMonth(fromUnixMs, toUnixMs);
    }

    public msUntilNextDay(unixMs: number = this.serverUnixMs()): number {
        return Math.max(0, addLocalDays(this.startOfDayMs(unixMs), 1) - unixMs);
    }

    public msUntilNextWeek(unixMs: number = this.serverUnixMs()): number {
        return Math.max(0, addLocalDays(this.startOfWeekMs(unixMs), 7) - unixMs);
    }

    public msUntilNextMonth(unixMs: number = this.serverUnixMs()): number {
        const date = new Date(this.startOfMonthMs(unixMs));
        return Math.max(0, new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime() - unixMs);
    }

    public snapshot(): AppClockSnapshot {
        const unixMs = this.unixMs();
        const serverUnixMs = this.serverUnixMs();
        return {
            nowMs: this.nowMs(),
            unixMs,
            serverUnixMs,
            serverOffsetMs: this.serverSynced ? this.syncedServerOffsetMs : 0,
            serverSynced: this.serverSynced,
            timezoneOffsetMinutes: new Date(serverUnixMs).getTimezoneOffset(),
            dayOfWeek: this.dayOfWeek(serverUnixMs),
            startOfDayMs: this.startOfDayMs(serverUnixMs),
            startOfWeekMs: this.startOfWeekMs(serverUnixMs),
            startOfMonthMs: this.startOfMonthMs(serverUnixMs),
            msUntilNextDay: this.msUntilNextDay(serverUnixMs),
            msUntilNextWeek: this.msUntilNextWeek(serverUnixMs),
            msUntilNextMonth: this.msUntilNextMonth(serverUnixMs),
        };
    }
}

function readMonotonicMs(): number {
    const runtime = globalThis as unknown as { performance?: { now?: () => number } };
    if (typeof runtime.performance?.now === 'function') {
        return runtime.performance.now();
    }
    return Date.now();
}

function addLocalDays(unixMs: number, days: number): number {
    const date = new Date(unixMs);
    date.setDate(date.getDate() + days);
    return date.getTime();
}

function assertValidTimestamp(value: number, label: string): void {
    if (typeof value !== 'number' || !isFinite(value)) {
        throw new Error(`Invalid ${label}: ${value}`);
    }
}
