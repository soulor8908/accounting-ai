/** 应用单例：Store（持久化）+ Engine（指令引擎） */
import { Engine } from '../core/engine/engine';
import { Store } from '../core/store/store';

export const store = new Store();
store.load();

export const engine = new Engine(store);

/** 启动时补齐到期的周期记账 */
export function bootstrap(): number {
  const today = new Date();
  const fmt = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return store.generateDueRecurring(fmt).length;
}
