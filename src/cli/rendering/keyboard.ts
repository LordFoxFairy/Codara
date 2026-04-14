export interface KeyBinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  action: string;
}

export const DEFAULT_KEY_BINDINGS: KeyBinding[] = [
  {key: 'c', ctrl: true, action: 'interrupt'},
  {key: 'd', ctrl: true, action: 'exit'},
  {key: 'escape', action: 'cancel'},
  {key: 'tab', action: 'focus_next'},
  {key: 'return', action: 'submit'},
  {key: 'y', action: 'approve'},
  {key: 'n', action: 'reject'},
  {key: 'up', action: 'scroll_up'},
  {key: 'down', action: 'scroll_down'},
];

export function matchKeyBinding(
  bindings: KeyBinding[],
  input: {key: string; ctrl?: boolean; shift?: boolean},
): string | undefined {
  for (const binding of bindings) {
    if (
      binding.key === input.key &&
      (binding.ctrl ?? false) === (input.ctrl ?? false) &&
      (binding.shift ?? false) === (input.shift ?? false)
    ) {
      return binding.action;
    }
  }
  return undefined;
}
