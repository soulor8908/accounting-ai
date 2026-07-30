/**
 * 前端导出工具（P2 报表导出）
 * - svgToPng：把 SVG 元素绘制到 canvas 并导出 PNG（纯前端，无后端、无第三方库）
 * - downloadBlob：触发浏览器下载
 */

/** 将 SVG 元素序列化为 PNG Blob（scale 为像素放大倍数，2 = 视网膜清晰） */
export function svgToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const xml = new XMLSerializer().serializeToString(clone);
  const svg64 = btoa(unescape(encodeURIComponent(xml)));
  const url = `data:image/svg+xml;base64,${svg64}`;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const vb = svg.viewBox.baseVal;
      const w = vb && vb.width ? vb.width : svg.clientWidth || 600;
      const h = vb && vb.height ? vb.height : svg.clientHeight || 320;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法获取 canvas 上下文'));
        return;
      }
      // 白底，避免透明背景在某些查看器下发黑
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出图片失败'))), 'image/png');
    };
    img.onerror = () => reject(new Error('图表渲染失败'));
    img.src = url;
  });
}

/** 触发浏览器下载一个 Blob */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 延迟释放，确保下载已开始
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
