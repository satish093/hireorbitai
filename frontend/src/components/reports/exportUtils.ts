// Export helpers for the Reports tabs: CSV for tabular data, PNG for charts.

function triggerDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Download a 2D array of cells as a CSV file. */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  URL.revokeObjectURL(url);
}

/** Build CSV rows from a tab payload: KPIs plus a table if present. */
export function payloadToCsvRows(data: unknown): (string | number)[][] {
  const rows: (string | number)[][] = [];
  const d = data as {
    kpis?: { label: string; value: string; prior?: string; delta?: string }[];
    table?: Record<string, unknown>[];
  };
  if (d?.kpis?.length) {
    rows.push(['KPI', 'Value', 'Prior', 'Delta']);
    for (const k of d.kpis) rows.push([k.label, k.value, k.prior ?? '', k.delta ?? '']);
  }
  if (d?.table?.length) {
    if (rows.length) rows.push([]);
    const cols = Object.keys(d.table[0]!);
    rows.push(cols);
    for (const r of d.table) rows.push(cols.map((c) => String(r[c] ?? '')));
  }
  return rows;
}

/**
 * Serialize the first <svg> inside `containerId` to a PNG and download it.
 * Falls back to no-op if there's no chart in the active panel.
 */
export async function exportPanelPng(containerId: string, filename: string): Promise<boolean> {
  const svg = document.querySelector<SVGSVGElement>(`#${containerId} svg`);
  if (!svg) return false;
  const rect = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width)) * 2;
  const h = Math.max(1, Math.round(rect.height)) * 2;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // Inline the resolved background so the PNG isn't transparent.
  const bg = getComputedStyle(document.body).backgroundColor || '#fff';
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const xml = new XMLSerializer().serializeToString(clone);
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  await new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        triggerDownload(canvas.toDataURL('image/png'), filename);
      }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = svgUrl;
  });
  return true;
}
