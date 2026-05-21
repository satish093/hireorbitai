/** Centered empty/placeholder state for cards + charts with no data in range. */
export function EmptyChart({ message = 'No data in this range' }: { message?: string }) {
  return (
    <div className="grid place-items-center py-12 text-center text-sm text-muted">{message}</div>
  );
}
