// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiLearningStudio,
  initialAiStudioTreeState,
  type AiLearningStudioApi,
  type AiStudioPanel,
  type AiStudioTreeState
} from "../../src/client/guardian/ai-learning-studio";

afterEach(cleanup);

function createApi(): AiLearningStudioApi {
  return {
    getAiStudioSettingsView: vi.fn().mockResolvedValue({
      providers: [],
      monthlyBudgetWon: 1000,
      monthSpentWon: 0
    }),
    updateAiStudioBudget: vi.fn(),
    updateAiStudioProvider: vi.fn(),
    createAiDraft: vi.fn(),
    getAiDraft: vi.fn(),
    updateAiDraftItem: vi.fn(),
    publishAiDraft: vi.fn(),
    getGuardianAiReport: vi.fn()
  };
}

describe("AiLearningStudio", () => {
  it("renders for direct consumers using only its approved public props", () => {
    render(
      <AiLearningStudio
        api={createApi()}
        onPanelChange={vi.fn()}
        panel="settings"
      />
    );

    expect(screen.getByRole("heading", { name: "AI 학습실" })).toBeVisible();
    expect(screen.getByRole("treeitem", { name: "AI 설정" }))
      .toHaveAttribute("aria-expanded", "true");
  });

  it("synchronizes its local tree selection when a direct consumer changes panels", () => {
    const api = createApi();
    const onPanelChange = vi.fn();
    const { rerender } = render(
      <AiLearningStudio
        api={api}
        onPanelChange={onPanelChange}
        panel="settings"
      />
    );

    rerender(
      <AiLearningStudio
        api={api}
        onPanelChange={onPanelChange}
        panel="generate-math"
      />
    );

    expect(screen.getByRole("treeitem", { name: "문제 생성" }))
      .toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("treeitem", { name: "수학 문제 배치" }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("uses caller-provided tree state when persistence props are supplied", async () => {
    const user = userEvent.setup();
    const onPanelChange = vi.fn();

    function ControlledStudio() {
      const [panel, setPanel] = useState<AiStudioPanel>("settings");
      const [treeState, setTreeState] = useState<AiStudioTreeState>(
        initialAiStudioTreeState("settings")
      );
      return (
        <AiLearningStudio
          api={createApi()}
          onPanelChange={(nextPanel) => {
            onPanelChange(nextPanel);
            setPanel(nextPanel);
          }}
          onTreeStateChange={setTreeState}
          panel={panel}
          treeState={treeState}
        />
      );
    }

    render(<ControlledStudio />);
    await user.click(screen.getByRole("button", { name: "문제 생성" }));
    await user.click(screen.getByRole("treeitem", { name: "수학 문제 배치" }));

    expect(onPanelChange).toHaveBeenCalledWith("generate-math");
    expect(screen.getByRole("heading", { name: "수학 문제 배치" })).toBeVisible();
    expect(screen.getByRole("treeitem", { name: "수학 문제 배치" }))
      .toHaveAttribute("aria-selected", "true");
  });
});
