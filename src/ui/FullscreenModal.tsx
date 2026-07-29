/**
 * 全屏模态弹窗组件
 *
 * 设计原则（卡帕西视角）：
 * - 正确性优先：用 React Portal 渲染到 document.body，彻底脱离父级 transform /
 *   堆叠上下文 / z-index 陷阱。父级有 transform/filter/z-index 时，内部 fixed
 *   元素会被「截断」或被遮挡，Portal 是标准解法。
 * - 零副作用：动画只用 opacity（不用 transform），避免为后代创建包含块；
 *   打开时锁定 body 滚动，关闭时恢复。
 * - 可访问性：role=dialog aria-modal，ESC 关闭，焦点管理交给调用方。
 *
 * 用法：
 *   <FullscreenModal open={chatOpen} onClose={closeChat}>
 *     <ChatContent />
 *   </FullscreenModal>
 */
import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface FullscreenModalProps {
  open: boolean;
  onClose: () => void;
  /** 是否允许 ESC 关闭（默认 true） */
  closeOnEsc?: boolean;
  /** 是否锁定背景滚动（默认 true） */
  lockScroll?: boolean;
  children: ReactNode;
}

export function FullscreenModal({
  open,
  onClose,
  closeOnEsc = true,
  lockScroll = true,
  children,
}: FullscreenModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEsc) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);

    let prevOverflow = '';
    if (lockScroll) {
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    return () => {
      window.removeEventListener('keydown', onKey);
      if (lockScroll) {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, [open, onClose, closeOnEsc, lockScroll]);

  if (!open) return null;

  return createPortal(
    <div className="fullscreen-modal" role="dialog" aria-modal="true">
      {children}
    </div>,
    document.body,
  );
}
