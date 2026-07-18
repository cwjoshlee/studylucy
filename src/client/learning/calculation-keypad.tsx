import type { JSX } from "react";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "지우기", "0"] as const;

export function CalculationKeypad({
  value,
  disabled,
  onChange,
  onSubmit
}: {
  value: string;
  disabled: boolean;
  onChange(value: string): void;
  onSubmit(): void;
}): JSX.Element {
  function pressKey(key: typeof KEYS[number]): void {
    if (disabled) return;
    if (key === "지우기") {
      onChange(value.slice(0, -1));
      return;
    }
    if (value.length < 2) onChange(`${value}${key}`);
  }

  return (
    <section className="calculation-keypad" aria-label="계산 답 입력">
      <output className="calculation-keypad__display" aria-live="polite" aria-label="입력한 답">
        {value || " "}
      </output>
      <div className="calculation-keypad__keys" aria-label="숫자 키패드">
        {KEYS.map((key) => (
          <button key={key} type="button" disabled={disabled} onClick={() => pressKey(key)}>
            {key}
          </button>
        ))}
      </div>
      <div className="calculation-keypad__actions">
        <button
          type="button"
          disabled={disabled || value === ""}
          onClick={onSubmit}
        >답 확인</button>
      </div>
    </section>
  );
}
