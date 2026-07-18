import { useState, type FormEvent, type JSX } from "react";
import type { KoreanDictationItem } from "../../shared/learning";

export function DictationPanel({
  item,
  disabled,
  onSubmit,
  onReplay
}: {
  item: KoreanDictationItem;
  disabled: boolean;
  onSubmit(text: string): void;
  onReplay(): void;
}): JSX.Element {
  const [text, setText] = useState("");

  function replay(): void {
    onReplay();
    if (
      typeof globalThis.speechSynthesis === "undefined" ||
      typeof globalThis.SpeechSynthesisUtterance === "undefined"
    ) return;
    const utterance = new SpeechSynthesisUtterance(item.promptText);
    utterance.lang = "ko-KR";
    globalThis.speechSynthesis.speak(utterance);
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (disabled || text.trim() === "") return;
    onSubmit(text);
  }

  return (
    <section className="dictation-panel" aria-label="받아쓰기 연습">
      <p>버튼을 눌러 다시 듣고, 들은 내용을 직접 써 보세요.</p>
      <button type="button" onClick={replay} disabled={disabled}>
        다시 듣기
      </button>
      <form autoComplete="off" onSubmit={submit}>
        <label>
          받아쓰기 답
          <textarea
            className="dictation-panel__input"
            lang="ko"
            maxLength={200}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={disabled}
          />
        </label>
        <button type="submit" disabled={disabled || text.trim() === ""}>
          받아쓰기 확인
        </button>
      </form>
    </section>
  );
}
