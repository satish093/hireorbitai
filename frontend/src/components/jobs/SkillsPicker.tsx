import { useState } from 'react';
import { Button } from '../Button';

export function SkillsPicker({
  skills,
  onChange,
  onRecompute,
}: {
  skills: string[];
  onChange: (next: string[]) => void;
  onRecompute: () => void;
}) {
  const [input, setInput] = useState('');
  // Index of the chip currently being edited in place, plus its draft text.
  // Click a chip's label to edit it without having to delete + re-add.
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState('');

  function add() {
    const v = input.trim();
    if (!v) return;
    if (skills.some((s) => s.toLowerCase() === v.toLowerCase())) {
      setInput('');
      return;
    }
    onChange([...skills, v]);
    setInput('');
  }
  function remove(s: string) {
    onChange(skills.filter((x) => x !== s));
  }
  function startEdit(i: number) {
    setEditIdx(i);
    setEditText(skills[i] ?? '');
  }
  function commitEdit() {
    if (editIdx === null) return;
    const v = editText.trim();
    // Empty draft removes the skill; a duplicate of another chip collapses
    // (drop the edited one). Otherwise replace in place.
    if (!v) {
      onChange(skills.filter((_, i) => i !== editIdx));
    } else if (skills.some((s, i) => i !== editIdx && s.toLowerCase() === v.toLowerCase())) {
      onChange(skills.filter((_, i) => i !== editIdx));
    } else {
      onChange(skills.map((s, i) => (i === editIdx ? v : s)));
    }
    setEditIdx(null);
    setEditText('');
  }
  function cancelEdit() {
    setEditIdx(null);
    setEditText('');
  }

  return (
    <div className="bg-surface border border-border rounded-xl px-4 py-3 mb-3 flex items-center gap-2 flex-wrap">
      <span className="text-[10px] font-semibold tracking-widest text-muted uppercase">
        My skills
      </span>
      {skills.length === 0 && (
        <span className="text-xs text-muted italic">
          Add skills (React, Java, AWS, Python…) to tune recommendations.
        </span>
      )}
      {skills.map((s, i) =>
        editIdx === i ? (
          <input
            key={`edit-${i}`}
            autoFocus
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              else if (e.key === 'Escape') cancelEdit();
            }}
            className="text-xs bg-surface border border-brand-400 text-ink font-medium rounded-full px-2.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-brand-500/40 w-28"
          />
        ) : (
          <span
            key={s}
            className="inline-flex items-center gap-1 bg-hover text-ink text-xs font-medium px-2 py-0.5 rounded-full"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => startEdit(i)}
              className="!h-auto !px-0 !bg-transparent hover:text-brand-600"
              title="Click to edit"
            >
              {s}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              leftIcon={<span>×</span>}
              onClick={() => remove(s)}
              className="!h-auto !px-0 !bg-transparent text-muted hover:text-red-500 text-sm leading-none"
              title="Remove"
            />
          </span>
        ),
      )}
      <div className="flex items-center gap-1.5 ml-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
          placeholder="Add skill…"
          className="text-xs bg-hover border border-border rounded-full px-2.5 py-1 placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />
        <Button variant="primary" size="sm" pill onClick={add}>
          +
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRecompute}
          className="ml-1"
          title="Re-run AI ranking with these skills"
        >
          Recompute ⟳
        </Button>
      </div>
    </div>
  );
}
