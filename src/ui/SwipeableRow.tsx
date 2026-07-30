/**
 * 左滑操作行：移动端常见的「左滑卡片露出编辑/删除」交互。
 *
 * 设计（乔布斯视角）：
 * - 卡片本体可水平拖拽（pointer events，同时支持触摸与鼠标）
 * - 向左拖出右侧操作区（编辑/删除），超过阈值吸附打开，否则回弹关闭
 * - 同一时刻只允许一行打开：打开新行时自动关闭前一行，避免视觉混乱
 * - 拖拽位移超过 4px 视为「拖动」而非「点击」，避免误触发行内点击
 * - 桌面端窄操作区，移动端全手势：无障碍优先，操作按钮始终可聚焦
 *
 * 用法：
 *   <SwipeableRow actions={<><button>编辑</button><button>删除</button></>}>
 *     <div className="tx-item">...卡片内容...</div>
 *   </SwipeableRow>
 */
import { useRef, useState, type ReactNode } from 'react';

interface SwipeableRowProps {
  /** 右侧操作区内容（编辑/删除按钮等） */
  actions: ReactNode;
  /** 卡片内容（已含卡片样式类，如 tx-item） */
  children: ReactNode;
  /** 操作区宽度（px），默认 132 */
  actionWidth?: number;
}

// 模块级：当前打开行的实例 id + 关闭函数，用于「打开新行时关闭旧行」
let activeId: symbol | null = null;
let closeActive: (() => void) | null = null;

const MOVE_THRESHOLD = 4; // 超过此位移视为拖拽，避免误触

export function SwipeableRow({ actions, children, actionWidth = 132 }: SwipeableRowProps) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startOffset = useRef(0);
  const moved = useRef(false);
  // 本行唯一标识，用于排他关闭
  const id = useRef<symbol>(Symbol('swipe')).current;

  const THRESHOLD = actionWidth * 0.4;

  const open = () => {
    setOffset(-actionWidth);
    // 排他：关闭前一个打开的行
    if (closeActive && activeId !== id) closeActive();
    activeId = id;
    closeActive = () => {
      setOffset(0);
      activeId = null;
      closeActive = null;
    };
  };

  const close = () => {
    setOffset(0);
    if (activeId === id) {
      activeId = null;
      closeActive = null;
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
    startOffset.current = offset;
    moved.current = false;
    setDragging(true);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > MOVE_THRESHOLD) moved.current = true;
    let next = startOffset.current + dx;
    if (next > 0) next = 0; // 禁止右滑超出
    if (next < -actionWidth) next = -actionWidth; // 最大左滑
    setOffset(next);
  };

  const endDrag = () => {
    if (!dragging) return;
    setDragging(false);
    // 超过阈值吸附打开，否则关闭
    if (offset <= -THRESHOLD) {
      open();
    } else {
      close();
    }
  };

  // 点击内容区：拖拽产生的点击吞掉；已打开时点击收起
  const onContentClick = (e: React.MouseEvent) => {
    if (moved.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (activeId === id) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className="swipe-row">
      <div className="swipe-actions" style={{ width: actionWidth }}>
        {actions}
      </div>
      <div
        className="swipe-content"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? 'none' : 'transform 0.22s ease',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onContentClick}
      >
        {children}
      </div>
    </div>
  );
}
