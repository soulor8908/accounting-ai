/**
 * 轻量提示组件：替代 window.confirm / window.prompt / window.alert
 *
 * 设计原则（乔布斯视角）：
 * - 极简：每次只展示一个对话框，背景模糊聚焦当前操作
 * - 一致：所有弹框共享同一视觉语言（圆角、阴影、动画）
 * - 命令式 API：调用方无需写 JSX，await dialog.confirm(...) 即可
 *
 * 用法：
 *   import { dialog } from './Dialog';
 *   const ok = await dialog.confirm('确定删除？');
 *   const name = await dialog.prompt('输入名称', '默认值');
 *   dialog.toast('保存成功', 'success');
 *
 * 需在应用根节点挂载 <DialogContainer />
 */
import { useEffect, useRef, useState } from 'react';

// ---------- 类型 ----------
type DialogKind = 'confirm' | 'prompt' | 'alert';
type ToastKind = 'info' | 'success' | 'error';

interface DialogState {
  kind: DialogKind;
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  resolve: (value: boolean | string | null) => void;
}

interface ToastState {
  id: number;
  message: string;
  kind: ToastKind;
}

// ---------- 命令式 API（模块级单例） ----------
let dialogResolve: ((state: DialogState | null) => void) | null = null;
let pushToastFn: ((message: string, kind: ToastKind) => void) | null = null;

export const dialog = {
  /** 确认框，返回 true/false */
  confirm(message: string, title?: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      dialogResolve?.({ kind: 'confirm', message, title, resolve: resolve as (v: boolean | string | null) => void });
    });
  },
  /** 输入框，返回用户输入或 null（取消） */
  prompt(message: string, defaultValue = '', placeholder?: string, title?: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      dialogResolve?.({ kind: 'prompt', message, defaultValue, placeholder, title, resolve: resolve as (v: boolean | string | null) => void });
    });
  },
  /** 提示框，返回 void */
  alert(message: string, title?: string): Promise<void> {
    return new Promise<void>((resolve) => {
      dialogResolve?.({ kind: 'alert', message, title, resolve: resolve as unknown as (v: boolean | string | null) => void });
    });
  },
  /** 轻提示，自动消失 */
  toast(message: string, kind: ToastKind = 'info'): void {
    pushToastFn?.(message, kind);
  },
};

// ---------- 容器组件 ----------
export function DialogContainer() {
  const [state, setState] = useState<DialogState | null>(null);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const toastIdRef = useRef(0);

  // 注册命令式 API 的回调
  useEffect(() => {
    dialogResolve = setState;
    pushToastFn = (message: string, kind: ToastKind) => {
      const id = ++toastIdRef.current;
      setToasts((prev) => [...prev, { id, message, kind }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 2800);
    };
    return () => {
      dialogResolve = null;
      pushToastFn = null;
    };
  }, []);

  const handleClose = (value: boolean | string | null) => {
    const s = state;
    setState(null);
    s?.resolve(value);
  };

  return (
    <>
      {/* 对话框 */}
      {state && (
        <div className="dialog-overlay" onClick={() => handleClose(state.kind === 'prompt' ? null : false)}>
          <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
            {state.title && <div className="dialog-title">{state.title}</div>}
            <div className="dialog-message">{state.message}</div>
            {state.kind === 'prompt' && (
              <input
                className="dialog-input"
                type="text"
                defaultValue={state.defaultValue}
                placeholder={state.placeholder}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleClose((e.target as HTMLInputElement).value);
                }}
              />
            )}
            <div className="dialog-actions">
              {state.kind === 'prompt' && (
                <button type="button" className="dialog-btn cancel" onClick={() => handleClose(null)}>
                  取消
                </button>
              )}
              {state.kind === 'confirm' && (
                <button type="button" className="dialog-btn cancel" onClick={() => handleClose(false)}>
                  取消
                </button>
              )}
              <button
                type="button"
                className="dialog-btn primary"
                onClick={() => {
                  if (state.kind === 'prompt') {
                    const input = document.querySelector<HTMLInputElement>('.dialog-input');
                    handleClose(input?.value ?? '');
                  } else if (state.kind === 'confirm') {
                    handleClose(true);
                  } else {
                    handleClose(null);
                  }
                }}
              >
                {state.kind === 'alert' ? '知道了' : '确定'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast 轻提示 */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </>
  );
}
