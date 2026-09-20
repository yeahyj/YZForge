import { sys } from 'cc';
import { FrameworkError } from '../core/errors';
export interface StorageKey<T> { readonly id: string; readonly version: number; readonly validate: (value: unknown) => value is T; }
/** Local persistence for small player preferences. It is not a security boundary. */
export class Storage {
  constructor(private readonly prefix: string) {}
  get<T>(key: StorageKey<T>): T | undefined {
    const raw = sys.localStorage.getItem(this.prefix + key.id);
    if (raw === null) return undefined;
    try {
      const data = JSON.parse(raw) as { version: number; value: unknown };
      if (data.version !== key.version || !key.validate(data.value)) throw Error('Incompatible saved value');
      return data.value;
    } catch (error) { throw new FrameworkError('STORAGE_INVALID', `Invalid saved data: ${key.id}`, { error }); }
  }
  set<T>(key: StorageKey<T>, value: T): void {
    if (!key.validate(value)) throw new FrameworkError('STORAGE_INVALID', `Invalid value: ${key.id}`);
    try { sys.localStorage.setItem(this.prefix + key.id, JSON.stringify({ version: key.version, value })); }
    catch (error) { throw new FrameworkError('STORAGE_WRITE_FAILED', `Could not save: ${key.id}`, { error }); }
  }
  remove<T>(key: StorageKey<T>): void { sys.localStorage.removeItem(this.prefix + key.id); }
}
