/**
 * 极简 SVG 图标集（描边风格，与衬线/纸张视觉语言保持一致）
 *
 * 设计原则（乔布斯视角）：
 * - 一致的视觉语言：所有图标使用相同描边宽度、圆角端点
 * - 可访问性：默认带 aria-hidden，需可点击时由调用方设 aria-label
 * - 可组合：基于 currentColor，继承父元素颜色
 */
import type { CSSProperties, ReactNode } from 'react';

export type IconName =
  | 'bolt'        // 闪电：快捷输入
  | 'chevron'     // 折叠/展开（用 rotate 控制方向）
  | 'menu'        // 三横线：会话列表
  | 'plus'        // 新建
  | 'close'       // 关闭/删除
  | 'send'        // 发送
  | 'trash'       // 删除
  | 'edit'        // 编辑
  | 'chat'        // 对话
  | 'accounts'    // 账户
  | 'calendar'    // 日历
  | 'list'        // 流水
  | 'stats'       // 统计
  | 'settings';   // 设置

interface IconProps {
  name: IconName;
  size?: number;
  /** 旋转角度（度），例如 chevron 朝下用 180 */
  rotate?: number;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}

const PATHS: Record<IconName, ReactNode> = {
  // 闪电
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
  // 折叠箭头（默认朝上）
  chevron: <path d="m6 15 6-6 6 6" />,
  // 三横线菜单
  menu: (
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </>
  ),
  // 加号
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  // 关闭
  close: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  // 发送（纸飞机）
  send: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />,
  // 删除（垃圾桶）
  trash: (
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  // 编辑（铅笔）
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </>
  ),
  // 对话气泡
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  // 账户（卡片）
  accounts: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  // 日历
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  // 流水（列表）
  list: (
    <>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </>
  ),
  // 统计（柱状图）
  stats: (
    <>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </>
  ),
  // 设置（齿轮简化版）
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
};

export function Icon({ name, size = 18, rotate, className, style, ...rest }: IconProps) {
  const finalStyle: CSSProperties = { ...style };
  if (rotate !== undefined) finalStyle.transform = `rotate(${rotate}deg)`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={finalStyle}
      aria-hidden={rest['aria-label'] ? undefined : true}
      role={rest['aria-label'] ? 'img' : undefined}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
