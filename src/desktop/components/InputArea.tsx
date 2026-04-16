/** @module desktop/components/InputArea — Auto-resizing textarea with send/stop controls. */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Send, Square, Plus } from "lucide-react";

interface InputAreaProps {
  onSend: (message: string) => void;
  disabled: boolean;
  onStop?: () => void;
  isStreaming: boolean;
  onNewSession?: () => void;
}

const MAX_ROWS = 4;
const LINE_HEIGHT = 24;
const PADDING_Y = 24; // py-3 top + bottom
const MAX_HEIGHT = LINE_HEIGHT * MAX_ROWS + PADDING_Y;

export function InputArea({
  onSend,
  disabled,
  onStop,
  isStreaming,
  onNewSession,
}: InputAreaProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const hasValue = value.trim().length > 0;

  return (
    <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-elevated)]">
      <div className="flex items-end gap-3 px-4 py-3">
        {/* Input field */}
        <div
          className={[
            "relative flex min-w-0 flex-1 rounded-lg border transition-all duration-150",
            focused
              ? "border-[var(--color-border-focus)] shadow-[var(--shadow-input-focus)]"
              : "border-[var(--color-border)] shadow-[var(--shadow-input)]",
            "bg-[var(--color-surface-input)]",
          ].join(" ")}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={
              disabled
                ? "Waiting for response..."
                : "Message (\u21b5 to send, Shift+\u21b5 for line breaks)"
            }
            disabled={disabled}
            rows={1}
            className="block w-full resize-none bg-transparent px-3.5 py-2.5 text-[14px] leading-[24px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-tertiary)] focus:outline-none disabled:opacity-40"
            style={{ maxHeight: MAX_HEIGHT }}
          />
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-2 pb-0.5">
          {/* New session button */}
          {onNewSession && (
            <button
              onClick={onNewSession}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
            >
              <Plus size={15} strokeWidth={2} />
              <span className="whitespace-nowrap">New session</span>
            </button>
          )}

          {/* Send / Stop button */}
          {isStreaming ? (
            <button
              onClick={onStop}
              className="flex h-9 items-center gap-2 rounded-lg bg-[var(--color-error)] px-3.5 text-[13px] font-medium text-white shadow-sm transition-all duration-150 hover:opacity-90 active:scale-[0.97]"
              title="Stop generating"
            >
              <Square size={14} strokeWidth={2.5} fill="currentColor" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!hasValue || disabled}
              className={[
                "flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-medium shadow-sm transition-all duration-150",
                hasValue && !disabled
                  ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] active:scale-[0.97]"
                  : "cursor-not-allowed bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)] shadow-none",
              ].join(" ")}
              title="Send message"
            >
              <Send size={14} strokeWidth={2.5} />
              <span>Send</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
