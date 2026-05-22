import { EmptyState } from '../EmptyState';

interface Props {
  resumeId: string;
  onSaved: () => void;
}

// Placeholder — markdown editor lands in the editor step.
export function ResumeEditor(_props: Props) {
  return (
    <EmptyState compact title="Editor" description="Markdown editor lands in the next step." />
  );
}
