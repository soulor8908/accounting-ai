import { useCallback, useState } from 'react';

/** store 为外部可变对象：用版本号驱动重渲染 */
export function useStoreVersion(): [number, () => void] {
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  return [version, bump];
}
