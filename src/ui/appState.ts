/** 应用单例：Store（持久化）+ Engine（指令引擎） */
import { Engine } from '../core/engine/engine';
import { Store } from '../core/store/store';
import { isVaultEnabled } from '../core/security/vault';

export const store = new Store();
// 启用加密时不立即加载明文 state（避免读到空明文）；由 LockView 解锁后 loadFromJson
if (!isVaultEnabled()) {
  store.load();
}

export const engine = new Engine(store);

/** 启动时补齐到期的周期记账（仅在已解锁时调用） */
export function bootstrap(): number {
  if (isVaultEnabled()) return 0;
  const today = new Date();
  const fmt = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return store.generateDueRecurring(fmt).length;
}
