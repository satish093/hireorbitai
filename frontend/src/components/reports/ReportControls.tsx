import { useState } from 'react';
import { Button } from '../Button';
import { ButtonGroup, ButtonGroupItem } from '../ButtonGroup';
import { Popover } from '../ui/Popover';
import { DateTimePicker } from '../DateTimePicker';
import { useReportContext } from './ReportContext';
import type { RangeKey } from './types';

const RANGES: { key: RangeKey; label: string }[] = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'qtd', label: 'QTD' },
  { key: 'ytd', label: 'YTD' },
];

export function ReportControls({ onExport }: { onExport: (fmt: 'csv' | 'png') => void }) {
  const { range, setRange, customRange, setCustomRange, compareToPrior, setCompare } =
    useReportContext();
  const [draft, setDraft] = useState<{ from: string; to: string }>(() => ({
    from: customRange?.from ?? '',
    to: customRange?.to ?? '',
  }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ButtonGroup>
        {RANGES.map((r) => (
          <ButtonGroupItem key={r.key} pressed={range === r.key} onClick={() => setRange(r.key)}>
            {r.label}
          </ButtonGroupItem>
        ))}
      </ButtonGroup>

      <Popover
        align="left"
        panelClassName="min-w-[280px] space-y-3"
        button={(open) => (
          <Button
            variant={range === 'custom' ? 'primary' : 'outline'}
            size="sm"
            aria-expanded={open}
          >
            Custom
          </Button>
        )}
      >
        {(close) => (
          <div className="space-y-3">
            <DateTimePicker
              label="From"
              value={draft.from}
              onChange={(v) => setDraft((d) => ({ ...d, from: v }))}
            />
            <DateTimePicker
              label="To"
              value={draft.to}
              onChange={(v) => setDraft((d) => ({ ...d, to: v }))}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!draft.from || !draft.to}
                onClick={() => {
                  setCustomRange({ from: draft.from, to: draft.to });
                  setRange('custom');
                  close();
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        )}
      </Popover>

      <Button
        variant={compareToPrior ? 'primary' : 'outline'}
        size="sm"
        aria-pressed={compareToPrior}
        onClick={() => setCompare(!compareToPrior)}
        title="Show a prior-period value + delta on every KPI"
      >
        vs. prior period
      </Button>

      <Popover
        align="right"
        panelClassName="min-w-[160px]"
        button={(open) => (
          <Button variant="outline" size="sm" aria-expanded={open}>
            Export
          </Button>
        )}
      >
        {(close) => (
          <div className="flex flex-col gap-0.5">
            <Button
              variant="ghost"
              size="sm"
              block
              className="!justify-start"
              onClick={() => {
                onExport('csv');
                close();
              }}
            >
              Download CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              block
              className="!justify-start"
              onClick={() => {
                onExport('png');
                close();
              }}
            >
              Download PNG
            </Button>
          </div>
        )}
      </Popover>
    </div>
  );
}
