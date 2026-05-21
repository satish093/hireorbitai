import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { Modal } from '../Modal';
import { Button } from '../Button';
import { FormInput } from '../FormInput';
import { SelectInput } from '../SelectInput';
import { invalidate } from '../../hooks/useInvalidate';
import { TASK_PRIORITIES } from '../../types';
import type { TaskUser } from './types';

/** Minimal create-task dialog (title required; assignee/priority/due/tag optional). */
export function CreateTaskModal({
  open,
  onClose,
  users,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  users: TaskUser[];
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [due, setDue] = useState('');
  const [tag, setTag] = useState('');
  const [saving, setSaving] = useState(false);

  function reset() {
    setTitle('');
    setAssignee('');
    setPriority('MEDIUM');
    setDue('');
    setTag('');
  }

  async function save() {
    if (saving) return;
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    try {
      await api.post('/tasks', {
        title: title.trim(),
        priority,
        assignee_id: assignee || undefined,
        due_at: due || undefined,
        tags: tag.trim() ? [tag.trim()] : undefined,
      });
      toast.success('Task created');
      invalidate('tasks');
      reset();
      onClose();
      onCreated();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? 'Failed to create task');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Create task
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormInput
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <SelectInput
            label="Assignee"
            placeholder="Unassigned"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            options={users.map((u) => ({ value: u.id, label: u.full_name ?? u.email }))}
          />
          <SelectInput
            label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            options={TASK_PRIORITIES.map((p) => ({ value: p, label: p }))}
          />
          <FormInput label="Due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <FormInput
            label="Tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="e.g. interview"
          />
        </div>
      </div>
    </Modal>
  );
}
