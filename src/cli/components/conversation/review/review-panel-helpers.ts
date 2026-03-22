import type {CliReviewAction} from '../../../app/view-state';

export function formatPermissionShortcut(action: CliReviewAction): string {
  switch (action.label) {
    case 'Allow once': return '(y) Allow once';
    case 'Allow always': return '(a) Allow always';
    case 'Reject': return '(n) Reject';
    default: return action.label;
  }
}

export function resolveActionColor(action: CliReviewAction, selected: boolean): string | undefined {
  if (!selected) return undefined;
  if (action.kind === 'danger') return 'red';
  return action.kind === 'primary' ? 'green' : 'cyan';
}

export function truncateLabel(label: string, maxLength: number): string {
  return label.length > maxLength ? `${label.slice(0, Math.max(0, maxLength - 3))}...` : label;
}
