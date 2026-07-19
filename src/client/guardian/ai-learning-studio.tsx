import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import {
  LearningItemPayloadSchema,
  type AiDraftItemView,
  type AiDraftView,
  type AiProviderSettingsView,
  type AiStudioSettingsView,
  type GuardianAiReport,
  type LearningItemPayload,
  type LearningStep
} from "../../shared/learning";
import type { ApiClient } from "../api/client";

export type AiStudioPanel = "settings" | "generate-math" | "generate-korean" |
  "today-report" | "weekly-report";

export type AiLearningStudioApi = Pick<ApiClient,
  | "getAiStudioSettings"
  | "updateAiStudioProvider"
  | "createAiDraft"
  | "getAiDraft"
  | "updateAiDraftItem"
  | "publishAiDraft"
  | "getGuardianAiReport"
> & Partial<Pick<ApiClient,
  | "getAiStudioSettingsView"
  | "updateAiStudioBudget"
>>;

type TreeGroupId = "settings" | "generation" | "reports";
export type AiStudioTreeState = {
  selectedLeaf: string;
  openGroups: TreeGroupId[];
};
type TreeLeaf = {
  id: string;
  label: string;
  panel: AiStudioPanel;
};

type SettingsReloadResult =
  | { status: "applied"; settings: AiStudioSettingsView }
  | { status: "failed" }
  | { status: "stale" };

type ReloadAiStudioSettings = () => Promise<SettingsReloadResult>;

const TREE_GROUPS: Array<{
  id: TreeGroupId;
  label: string;
  leaves: TreeLeaf[];
}> = [
  {
    id: "settings",
    label: "AI 설정",
    leaves: [
      { id: "provider-model", label: "제공자·모델 선택", panel: "settings" },
      { id: "api-keys", label: "API 키 관리", panel: "settings" },
      { id: "budget", label: "월 예산·사용량", panel: "settings" }
    ]
  },
  {
    id: "generation",
    label: "문제 생성",
    leaves: [
      { id: "generate-math", label: "수학 문제 배치", panel: "generate-math" },
      { id: "generate-korean", label: "국어·받아쓰기 배치", panel: "generate-korean" }
    ]
  },
  {
    id: "reports",
    label: "보고서",
    leaves: [
      { id: "today-report", label: "오늘의 학습 요약", panel: "today-report" },
      { id: "weekly-report", label: "주간 변화", panel: "weekly-report" }
    ]
  }
];

const PROVIDER_LABELS = {
  gemini: "Gemini",
  openai: "OpenAI"
} as const;

function loadAiStudioSettings(api: AiLearningStudioApi): Promise<AiStudioSettingsView> {
  if (api.getAiStudioSettingsView !== undefined) return api.getAiStudioSettingsView();
  return api.getAiStudioSettings().then((providers) => ({
    providers,
    monthlyBudgetWon: 0,
    monthSpentWon: 0
  }));
}

function treeSelection(panel: AiStudioPanel): {
  groupId: TreeGroupId;
  leafId: string;
} {
  if (panel === "generate-math") {
    return { groupId: "generation", leafId: "generate-math" };
  }
  if (panel === "generate-korean") {
    return { groupId: "generation", leafId: "generate-korean" };
  }
  if (panel === "today-report") {
    return { groupId: "reports", leafId: "today-report" };
  }
  if (panel === "weekly-report") {
    return { groupId: "reports", leafId: "weekly-report" };
  }
  return { groupId: "settings", leafId: "provider-model" };
}

export function initialAiStudioTreeState(panel: AiStudioPanel): AiStudioTreeState {
  const selection = treeSelection(panel);
  return { selectedLeaf: selection.leafId, openGroups: [selection.groupId] };
}

function groupForLeaf(leafId: string): TreeGroupId | null {
  return TREE_GROUPS.find((group) => group.leaves.some((leaf) => leaf.id === leafId))
    ?.id ?? null;
}

export function AiLearningStudio({
  api,
  panel,
  onPanelChange,
  treeState,
  onTreeStateChange
}: {
  api: AiLearningStudioApi;
  panel: AiStudioPanel;
  onPanelChange(panel: AiStudioPanel): void;
  treeState?: AiStudioTreeState;
  onTreeStateChange?(state: AiStudioTreeState): void;
}): JSX.Element {
  const [localTreeState, setLocalTreeState] = useState(() => initialAiStudioTreeState(panel));
  const usesControlledTreeState = treeState !== undefined && onTreeStateChange !== undefined;
  const currentTreeState = usesControlledTreeState ? treeState : localTreeState;

  useEffect(() => {
    if (!usesControlledTreeState) setLocalTreeState(initialAiStudioTreeState(panel));
  }, [panel, usesControlledTreeState]);

  const updateTreeState = (next: AiStudioTreeState) => {
    if (usesControlledTreeState) onTreeStateChange(next);
    else setLocalTreeState(next);
  };
  const openGroups = new Set(currentTreeState.openGroups);
  const selectedLeaf = currentTreeState.selectedLeaf;
  const [focusedItem, setFocusedItem] = useState(currentTreeState.selectedLeaf);
  const focusedItemRef = useRef(focusedItem);
  const previousSelectedLeafRef = useRef(selectedLeaf);
  const treeRef = useRef<HTMLElement>(null);
  const treeItemRefs = useRef(new Map<string, HTMLElement>());
  const treeHadFocusRef = useRef(false);
  const focusRequested = useRef(false);
  const [settings, setSettings] = useState<AiStudioSettingsView | null>(null);
  const [settingsFailed, setSettingsFailed] = useState(false);
  const settingsReadSequence = useRef(0);
  const activeSettingsRead = useRef<number | null>(null);
  const settingsContext = `${panel}:${selectedLeaf}`;
  const previousSettingsContext = useRef(settingsContext);
  const visibleTreeItems = TREE_GROUPS.flatMap((group) => [
    `group:${group.id}`,
    ...(openGroups.has(group.id) ? group.leaves.map((leaf) => leaf.id) : [])
  ]);
  const selectedOwner = groupForLeaf(selectedLeaf);
  const selectedVisibleItem = visibleTreeItems.includes(selectedLeaf)
    ? selectedLeaf
    : selectedOwner !== null && visibleTreeItems.includes(`group:${selectedOwner}`)
      ? `group:${selectedOwner}`
      : visibleTreeItems[0]!;
  const rovingItem = visibleTreeItems.includes(focusedItem)
    ? focusedItem
    : selectedVisibleItem;
  const openGroupsKey = currentTreeState.openGroups.join("|");
  focusedItemRef.current = focusedItem;

  useEffect(() => {
    const activeElement = document.activeElement;
    const treeOwnsFocus = activeElement instanceof HTMLElement &&
      treeRef.current?.contains(activeElement) === true;
    const treeFocusWasRemoved = treeHadFocusRef.current &&
      (activeElement === null || activeElement === document.body);
    const selectionChanged = previousSelectedLeafRef.current !== selectedLeaf;
    previousSelectedLeafRef.current = selectedLeaf;
    const currentFocusedItem = focusedItemRef.current;
    const nextFocusedItem = selectionChanged || !visibleTreeItems.includes(currentFocusedItem)
      ? selectedVisibleItem
      : currentFocusedItem;
    setFocusedItem(nextFocusedItem);
    if (treeOwnsFocus || treeFocusWasRemoved) {
      treeItemRefs.current.get(nextFocusedItem)?.focus();
    }
  }, [openGroupsKey, selectedLeaf, selectedVisibleItem]);

  useEffect(() => {
    if (!focusRequested.current) return;
    focusRequested.current = false;
    treeItemRefs.current.get(focusedItem)?.focus();
  }, [focusedItem, openGroupsKey]);

  const reloadSettings: ReloadAiStudioSettings = useCallback(async () => {
    const requestId = ++settingsReadSequence.current;
    activeSettingsRead.current = requestId;
    setSettingsFailed(false);
    try {
      const loaded = await loadAiStudioSettings(api);
      if (settingsReadSequence.current !== requestId) return { status: "stale" };
      setSettings(loaded);
      setSettingsFailed(false);
      return { status: "applied", settings: loaded };
    } catch {
      if (settingsReadSequence.current !== requestId) return { status: "stale" };
      setSettingsFailed(true);
      return { status: "failed" };
    } finally {
      if (activeSettingsRead.current === requestId) activeSettingsRead.current = null;
    }
  }, [api]);

  useEffect(() => {
    void reloadSettings();
    return () => {
      if (activeSettingsRead.current === null) return;
      settingsReadSequence.current += 1;
      activeSettingsRead.current = null;
    };
  }, [reloadSettings]);

  useEffect(() => {
    if (previousSettingsContext.current === settingsContext) return;
    previousSettingsContext.current = settingsContext;
    const replacePendingRead = activeSettingsRead.current !== null;
    settingsReadSequence.current += 1;
    activeSettingsRead.current = null;
    if (replacePendingRead) void reloadSettings();
  }, [reloadSettings, settingsContext]);

  const selectLeaf = (leaf: TreeLeaf) => {
    setFocusedItem(leaf.id);
    updateTreeState({
      ...currentTreeState,
      selectedLeaf: leaf.id,
      openGroups: Array.from(new Set([...currentTreeState.openGroups, groupForLeaf(leaf.id)!]))
    });
    onPanelChange(leaf.panel);
  };

  const toggleGroup = (groupId: TreeGroupId, forceOpen?: boolean) => {
    const next = new Set(openGroups);
    const open = forceOpen ?? !next.has(groupId);
    if (open) next.add(groupId);
    else next.delete(groupId);
    updateTreeState({ ...currentTreeState, openGroups: Array.from(next) });
  };

  const requestTreeFocus = (itemId: string) => {
    focusRequested.current = true;
    setFocusedItem(itemId);
  };

  const handleTreeKey = (
    event: ReactKeyboardEvent<HTMLElement>,
    itemId: string,
    groupId?: TreeGroupId
  ) => {
    const index = visibleTreeItems.indexOf(itemId);
    if (event.key === "ArrowDown" && index < visibleTreeItems.length - 1) {
      event.preventDefault();
      requestTreeFocus(visibleTreeItems[index + 1]!);
      return;
    }
    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      requestTreeFocus(visibleTreeItems[index - 1]!);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      requestTreeFocus(visibleTreeItems[0]!);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      requestTreeFocus(visibleTreeItems.at(-1)!);
      return;
    }
    if (event.key === "ArrowRight" && groupId !== undefined) {
      event.preventDefault();
      if (!openGroups.has(groupId)) toggleGroup(groupId, true);
      else {
        const firstLeaf = TREE_GROUPS.find((group) => group.id === groupId)?.leaves[0];
        if (firstLeaf !== undefined) requestTreeFocus(firstLeaf.id);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      if (groupId !== undefined && openGroups.has(groupId)) {
        event.preventDefault();
        toggleGroup(groupId, false);
        return;
      }
      const parentGroup = groupForLeaf(itemId);
      if (parentGroup !== null) {
        event.preventDefault();
        requestTreeFocus(`group:${parentGroup}`);
      }
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && groupId !== undefined) {
      event.preventDefault();
      toggleGroup(groupId);
    }
  };

  return (
    <section className="ai-studio" aria-labelledby="ai-studio-title">
      <h2 id="ai-studio-title">AI 학습실</h2>
      <p>두 제공자가 만든 문제를 서로 감리한 뒤 보호자가 확인해 발행해요.</p>
      <nav
        aria-label="AI 학습실 메뉴"
        className="ai-studio-tree"
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;
          treeHadFocusRef.current = nextTarget instanceof Node &&
            event.currentTarget.contains(nextTarget);
        }}
        onFocusCapture={() => {
          treeHadFocusRef.current = true;
        }}
        ref={treeRef}
        role="tree"
      >
        {TREE_GROUPS.map((group) => {
          const open = openGroups.has(group.id);
          const branchId = `group:${group.id}`;
          return (
            <div
              aria-expanded={open}
              aria-label={group.label}
              className="ai-studio-tree__group"
              key={group.id}
              onFocus={(event) => {
                if (event.target === event.currentTarget) setFocusedItem(branchId);
              }}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget) {
                  handleTreeKey(event, branchId, group.id);
                }
              }}
              ref={(element) => {
                if (element === null) treeItemRefs.current.delete(branchId);
                else treeItemRefs.current.set(branchId, element);
              }}
              role="treeitem"
              tabIndex={rovingItem === branchId ? 0 : -1}
            >
              <button
                className="ai-studio-tree__branch"
                onClick={() => {
                  requestTreeFocus(branchId);
                  toggleGroup(group.id);
                }}
                tabIndex={-1}
                type="button"
              >
                {group.label}
              </button>
              {open ? (
                <div className="ai-studio-tree__leaves" role="group">
                  {group.leaves.map((leaf) => (
                    <button
                      aria-selected={selectedLeaf === leaf.id}
                      key={leaf.id}
                      onClick={() => selectLeaf(leaf)}
                      onFocus={() => setFocusedItem(leaf.id)}
                      onKeyDown={(event) => handleTreeKey(event, leaf.id)}
                      ref={(element) => {
                        if (element === null) treeItemRefs.current.delete(leaf.id);
                        else treeItemRefs.current.set(leaf.id, element);
                      }}
                      role="treeitem"
                      tabIndex={rovingItem === leaf.id ? 0 : -1}
                      type="button"
                    >
                      {leaf.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      {settingsFailed ? (
        <p role="alert">AI 학습실 설정을 불러오지 못했어요.</p>
      ) : null}
      {panel === "settings" ? (
        <ProviderSettingsPanel
          api={api}
          selectedLeaf={selectedLeaf}
          settings={settings}
          onProviderUpdated={(updated) => setSettings((current) => {
            if (current === null) return null;
            return {
              ...current,
              providers: current.providers.map((item) => item.provider === updated.provider
                ? updated
                : item)
            };
          })}
          reloadSettings={reloadSettings}
        />
      ) : null}
      {panel === "generate-math" || panel === "generate-korean" ? (
        <DraftPanel
          api={api}
          key={panel}
          settings={settings?.providers ?? null}
          subject={panel === "generate-math" ? "math" : "korean"}
        />
      ) : null}
      {panel === "today-report" || panel === "weekly-report" ? (
        <ReportPanel api={api} period={panel === "today-report" ? "today" : "weekly"} />
      ) : null}
    </section>
  );
}

function ProviderSettingsPanel({
  api,
  settings,
  selectedLeaf,
  onProviderUpdated,
  reloadSettings
}: {
  api: AiLearningStudioApi;
  settings: AiStudioSettingsView | null;
  selectedLeaf: string;
  onProviderUpdated(settings: AiProviderSettingsView): void;
  reloadSettings: ReloadAiStudioSettings;
}) {
  if (settings === null) return <p aria-busy="true">제공자 설정을 불러오고 있어요.</p>;
  if (selectedLeaf === "budget") {
    return (
      <BudgetSettingsPanel
        api={api}
        reloadSettings={reloadSettings}
        settings={settings}
      />
    );
  }
  return (
    <div className="ai-provider-grid">
      {(["gemini", "openai"] as const).map((provider) => {
        const value = settings.providers.find((item) => item.provider === provider);
        if (value === undefined) return null;
        return (
          <ProviderCard
            api={api}
            key={provider}
            onUpdated={onProviderUpdated}
            reloadSettings={reloadSettings}
            settings={value}
          />
        );
      })}
      <p className="ai-studio-budget-note">
        월 예산과 사용량은 두 제공자가 함께 쓰는 서버 공통 한도로 관리돼요.
      </p>
    </div>
  );
}

const MAX_MONTHLY_BUDGET_WON = 10_000;
const MAX_RATE_WON_PER_1K = 1_000_000;

function parseBoundedInteger(value: string, maximum: number): number | null {
  if (!/^(0|[1-9]\d*)$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

function BudgetSettingsPanel({
  api,
  settings,
  reloadSettings
}: {
  api: AiLearningStudioApi;
  settings: AiStudioSettingsView;
  reloadSettings: ReloadAiStudioSettings;
}) {
  const provider = (id: "gemini" | "openai") =>
    settings.providers.find((item) => item.provider === id);
  const [monthlyBudget, setMonthlyBudget] = useState(String(settings.monthlyBudgetWon));
  const [geminiInput, setGeminiInput] = useState(String(provider("gemini")?.inputWonPer1K ?? 0));
  const [geminiOutput, setGeminiOutput] = useState(String(provider("gemini")?.outputWonPer1K ?? 0));
  const [openAiInput, setOpenAiInput] = useState(String(provider("openai")?.inputWonPer1K ?? 0));
  const [openAiOutput, setOpenAiOutput] = useState(String(provider("openai")?.outputWonPer1K ?? 0));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingReconciliation, setPendingReconciliation] = useState<
    "writes-succeeded" | "write-failed" | null
  >(null);

  useEffect(() => {
    setMonthlyBudget(String(settings.monthlyBudgetWon));
    setGeminiInput(String(provider("gemini")?.inputWonPer1K ?? 0));
    setGeminiOutput(String(provider("gemini")?.outputWonPer1K ?? 0));
    setOpenAiInput(String(provider("openai")?.inputWonPer1K ?? 0));
    setOpenAiOutput(String(provider("openai")?.outputWonPer1K ?? 0));
  }, [settings]);

  const parsedBudget = parseBoundedInteger(monthlyBudget, MAX_MONTHLY_BUDGET_WON);
  const parsedRates = {
    geminiInput: parseBoundedInteger(geminiInput, MAX_RATE_WON_PER_1K),
    geminiOutput: parseBoundedInteger(geminiOutput, MAX_RATE_WON_PER_1K),
    openAiInput: parseBoundedInteger(openAiInput, MAX_RATE_WON_PER_1K),
    openAiOutput: parseBoundedInteger(openAiOutput, MAX_RATE_WON_PER_1K)
  };
  const ratesValid = Object.values(parsedRates).every((value) => value !== null);
  const updateBudget = api.updateAiStudioBudget;
  const budgetApiReady = updateBudget !== undefined && api.getAiStudioSettingsView !== undefined;
  const invalidMessage = parsedBudget === null
    ? "월 예산은 0원에서 10,000원 사이의 정수로 입력해 주세요."
    : !ratesValid
      ? "예상 요금은 0원에서 1,000,000원 사이의 정수로 입력해 주세요."
      : "";
  const remaining = settings.monthlyBudgetWon - settings.monthSpentWon;

  const reconcileSettings = async (
    outcome: "writes-succeeded" | "write-failed",
    retry: boolean
  ): Promise<void> => {
    const result = await reloadSettings();
    if (result.status === "stale") return;
    if (result.status === "applied") {
      setPendingReconciliation(null);
      setMessage(outcome === "write-failed"
        ? "저장 요청 중 오류가 있었지만 서버의 최신 값을 다시 불러왔어요. 내용을 확인해 주세요."
        : retry
          ? "설정 저장을 완료했고 서버의 최신 값을 다시 확인했어요."
          : "예산과 예상 요금을 저장했어요.");
      return;
    }
    setPendingReconciliation(outcome);
    setMessage(outcome === "write-failed"
      ? "설정 저장 요청 중 오류가 있었고 현재 서버 상태를 확인하지 못했어요. 최신 설정을 다시 불러와 확인해 주세요."
      : "저장 요청은 완료했지만 현재 서버 상태를 확인하지 못했어요. 최신 설정을 다시 불러와 확인해 주세요.");
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { geminiInput: parsedGeminiInput, geminiOutput: parsedGeminiOutput,
      openAiInput: parsedOpenAiInput, openAiOutput: parsedOpenAiOutput } = parsedRates;
    if (saving || parsedBudget === null || parsedGeminiInput === null ||
        parsedGeminiOutput === null || parsedOpenAiInput === null ||
        parsedOpenAiOutput === null || updateBudget === undefined ||
        api.getAiStudioSettingsView === undefined) return;
    setSaving(true);
    setMessage("");
    setPendingReconciliation(null);
    let writeFailed = false;
    try {
      await updateBudget({ monthlyBudgetWon: parsedBudget });
      const rateResults = await Promise.allSettled([
        api.updateAiStudioProvider("gemini", {
          inputWonPer1K: parsedGeminiInput,
          outputWonPer1K: parsedGeminiOutput
        }),
        api.updateAiStudioProvider("openai", {
          inputWonPer1K: parsedOpenAiInput,
          outputWonPer1K: parsedOpenAiOutput
        })
      ]);
      writeFailed = rateResults.some((result) => result.status === "rejected");
    } catch {
      writeFailed = true;
    } finally {
      await reconcileSettings(writeFailed ? "write-failed" : "writes-succeeded", false);
      setSaving(false);
    }
  };

  const retryReconciliation = async () => {
    if (saving || pendingReconciliation === null) return;
    setSaving(true);
    await reconcileSettings(pendingReconciliation, true);
    setSaving(false);
  };

  return (
    <section className="ai-budget-panel" aria-labelledby="ai-budget-title">
      <div>
        <h3 id="ai-budget-title">월 예산·사용량</h3>
        <p>표시 금액은 보호자가 입력한 토큰 요금으로 계산한 예상치예요.</p>
      </div>
      <div className="ai-budget-summary" aria-label="이번 달 AI 예상 사용 현황">
        <p>월 예상 예산 {settings.monthlyBudgetWon.toLocaleString("ko-KR")}원</p>
        <p>이번 달 사용 {settings.monthSpentWon.toLocaleString("ko-KR")}원</p>
        <p className={remaining < 0 ? "ai-budget-summary__over" : ""}>
          {remaining < 0
            ? `예상 예산 초과 ${Math.abs(remaining).toLocaleString("ko-KR")}원`
            : `남은 예상 예산 ${remaining.toLocaleString("ko-KR")}원`}
        </p>
      </div>
      <form className="ai-budget-form" onSubmit={(event) => void save(event)}>
        <label>
          월 예산 (원)
          <input
            aria-label="월 예산 (원)"
            disabled={saving}
            inputMode="numeric"
            max={MAX_MONTHLY_BUDGET_WON}
            min="0"
            onChange={(event) => setMonthlyBudget(event.currentTarget.value)}
            step="1"
            type="number"
            value={monthlyBudget}
          />
        </label>
        {(["gemini", "openai"] as const).map((providerId) => {
          const label = PROVIDER_LABELS[providerId];
          const inputValue = providerId === "gemini" ? geminiInput : openAiInput;
          const outputValue = providerId === "gemini" ? geminiOutput : openAiOutput;
          return (
            <fieldset key={providerId}>
              <legend>{label} 보호자 예상 요금</legend>
              <label>
                {label} 예상 입력 요금 (원/1K 토큰)
                <input
                  aria-label={`${label} 예상 입력 요금 (원/1K 토큰)`}
                  disabled={saving}
                  inputMode="numeric"
                  max={MAX_RATE_WON_PER_1K}
                  min="0"
                  onChange={(event) => providerId === "gemini"
                    ? setGeminiInput(event.currentTarget.value)
                    : setOpenAiInput(event.currentTarget.value)}
                  step="1"
                  type="number"
                  value={inputValue}
                />
              </label>
              <label>
                {label} 예상 출력 요금 (원/1K 토큰)
                <input
                  aria-label={`${label} 예상 출력 요금 (원/1K 토큰)`}
                  disabled={saving}
                  inputMode="numeric"
                  max={MAX_RATE_WON_PER_1K}
                  min="0"
                  onChange={(event) => providerId === "gemini"
                    ? setGeminiOutput(event.currentTarget.value)
                    : setOpenAiOutput(event.currentTarget.value)}
                  step="1"
                  type="number"
                  value={outputValue}
                />
              </label>
            </fieldset>
          );
        })}
        {invalidMessage !== "" ? <p role="alert">{invalidMessage}</p> : null}
        {!budgetApiReady ? <p role="alert">예산 설정 기능을 사용할 수 없어요.</p> : null}
        <button
          disabled={saving || invalidMessage !== "" || !budgetApiReady}
          type="submit"
        >
          예산 저장
        </button>
      </form>
      {message !== "" ? <p role="status">{message}</p> : null}
      {pendingReconciliation !== null ? (
        <button
          className="button-secondary"
          disabled={saving}
          onClick={() => void retryReconciliation()}
          type="button"
        >
          최신 설정 다시 불러오기
        </button>
      ) : null}
    </section>
  );
}

function ProviderCard({
  api,
  settings,
  onUpdated,
  reloadSettings
}: {
  api: AiLearningStudioApi;
  settings: AiProviderSettingsView;
  onUpdated(settings: AiProviderSettingsView): void;
  reloadSettings: ReloadAiStudioSettings;
}) {
  const label = PROVIDER_LABELS[settings.provider];
  const [enabled, setEnabled] = useState(settings.enabled);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingReconciliation, setPendingReconciliation] = useState<{
    action: "save" | "delete";
    writeFailed: boolean;
  } | null>(null);

  useEffect(() => {
    setEnabled(settings.enabled);
    setModel(settings.model);
  }, [settings.enabled, settings.model]);

  const reconcileSettings = async (
    outcome: { action: "save" | "delete"; writeFailed: boolean },
    retry: boolean,
    acknowledged?: AiProviderSettingsView
  ): Promise<void> => {
    if (api.getAiStudioSettingsView === undefined) {
      if (!outcome.writeFailed && acknowledged !== undefined) {
        onUpdated(acknowledged);
        setMessage(outcome.action === "delete" ? "API 키를 삭제했어요." : "설정을 저장했어요.");
      } else {
        setMessage("설정 저장 요청 후 현재 서버 상태를 확인하지 못했어요. 페이지를 다시 열어 확인해 주세요.");
      }
      setPendingReconciliation(null);
      return;
    }
    const result = await reloadSettings();
    if (result.status === "stale") return;
    if (result.status === "applied") {
      setPendingReconciliation(null);
      setMessage(outcome.writeFailed
        ? "설정 저장 요청 중 오류가 있었지만 서버의 최신 설정을 다시 불러왔어요. 내용을 확인해 주세요."
        : retry
          ? "설정 저장을 완료했고 서버의 최신 설정을 다시 확인했어요."
          : outcome.action === "delete" ? "API 키를 삭제했어요." : "설정을 저장했어요.");
      return;
    }
    setPendingReconciliation(outcome);
    setMessage(outcome.writeFailed
      ? "설정 저장 요청 중 오류가 있었고 현재 서버 상태를 확인하지 못했어요. 최신 설정을 다시 불러와 확인해 주세요."
      : "설정 저장 요청은 완료했지만 현재 서버 상태를 확인하지 못했어요. 최신 설정을 다시 불러와 확인해 주세요.");
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage("");
    setPendingReconciliation(null);
    let updated: AiProviderSettingsView | undefined;
    let writeFailed = false;
    try {
      updated = await api.updateAiStudioProvider(settings.provider, {
        enabled,
        model,
        ...(apiKey === "" ? {} : { apiKey })
      });
    } catch {
      writeFailed = true;
    } finally {
      setApiKey("");
      await reconcileSettings({ action: "save", writeFailed }, false, updated);
      setSaving(false);
    }
  };

  const removeKey = async () => {
    if (saving || !settings.hasApiKey) return;
    setSaving(true);
    setMessage("");
    setPendingReconciliation(null);
    let updated: AiProviderSettingsView | undefined;
    let writeFailed = false;
    try {
      updated = await api.updateAiStudioProvider(settings.provider, {
        enabled: false,
        deleteApiKey: true
      });
    } catch {
      writeFailed = true;
    } finally {
      setApiKey("");
      await reconcileSettings({ action: "delete", writeFailed }, false, updated);
      setSaving(false);
    }
  };

  const retryReconciliation = async () => {
    if (saving || pendingReconciliation === null) return;
    setSaving(true);
    await reconcileSettings(pendingReconciliation, true);
    setSaving(false);
  };

  return (
    <article aria-label={`${label} 제공자 설정`} className="ai-provider-card">
      <h3>{label}</h3>
      <p>{settings.hasApiKey ? "API 키 저장됨" : "API 키 저장되지 않음"}</p>
      <form onSubmit={(event) => void save(event)}>
        <label className="guardian-checkbox">
          <input
            checked={enabled}
            disabled={saving}
            onChange={(event) => setEnabled(event.currentTarget.checked)}
            type="checkbox"
          />
          {label} 사용
        </label>
        <label>
          {label} 모델
          <input
            aria-label={`${label} 모델`}
            disabled={saving}
            maxLength={120}
            onChange={(event) => setModel(event.currentTarget.value)}
            pattern="[A-Za-z0-9._:-]{2,120}"
            required
            type="text"
            value={model}
          />
        </label>
        <label>
          {label} API 키
          <input
            aria-label={`${label} API 키`}
            autoComplete="new-password"
            disabled={saving}
            maxLength={500}
            onChange={(event) => setApiKey(event.currentTarget.value)}
            type="password"
            value={apiKey}
          />
        </label>
        <div className="ai-provider-card__actions">
          <button disabled={saving} type="submit">{label} 설정 저장</button>
          <button
            className="button-secondary"
            disabled={saving || !settings.hasApiKey}
            onClick={() => void removeKey()}
            type="button"
          >
            {label} API 키 삭제
          </button>
        </div>
      </form>
      {message !== "" ? <p role="status">{message}</p> : null}
      {pendingReconciliation !== null ? (
        <button
          className="button-secondary"
          disabled={saving}
          onClick={() => void retryReconciliation()}
          type="button"
        >
          최신 설정 다시 불러오기
        </button>
      ) : null}
    </article>
  );
}

type GenerationState = {
  requestId: number;
  subject: "math" | "korean";
  step: LearningStep;
  status: "idle" | "pending" | "failed" | "succeeded";
  draft: AiDraftView | null;
};

type DraftItemSaveResult = "applied" | "blocked" | "failed" | "rejected" | "stale";

function draftMatchesIdentity(
  draft: AiDraftView,
  id: string,
  subject: "math" | "korean",
  step: LearningStep
): boolean {
  return draft.id === id && draft.subject === subject && draft.step === step;
}

function DraftPanel({
  api,
  settings,
  subject
}: {
  api: Pick<ApiClient, "createAiDraft" | "updateAiDraftItem" | "publishAiDraft">;
  settings: AiProviderSettingsView[] | null;
  subject: "math" | "korean";
}) {
  const [step, setStep] = useState<LearningStep>("current");
  const [count, setCount] = useState(8);
  const [difficulty, setDifficulty] = useState(4);
  const [weakTopics, setWeakTopics] = useState("");
  const requestSequence = useRef(0);
  const draftMutationSequence = useRef(0);
  const activeDraftMutation = useRef<number | null>(null);
  const activeSelection = useRef({ subject, step });
  activeSelection.current = { subject, step };
  const [generation, setGeneration] = useState<GenerationState>({
    requestId: 0,
    subject,
    step,
    status: "idle",
    draft: null
  });
  const [publishing, setPublishing] = useState(false);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const providersReady = settings !== null &&
    (["gemini", "openai"] as const).every((provider) => settings.some((item) =>
      item.provider === provider && item.enabled && item.hasApiKey
    ));

  useEffect(() => {
    const requestId = ++requestSequence.current;
    draftMutationSequence.current += 1;
    activeDraftMutation.current = null;
    activeSelection.current = { subject, step };
    setGeneration({ requestId, subject, step, status: "idle", draft: null });
    setSavingItemId(null);
    setPublishing(false);
    setMessage("");
  }, [subject, step]);

  const isCurrentRequest = (
    requestId: number,
    requestSubject: "math" | "korean",
    requestStep: LearningStep
  ) => requestSequence.current === requestId &&
    activeSelection.current.subject === requestSubject &&
    activeSelection.current.step === requestStep;

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!providersReady || generation.status === "pending" || publishing) return;
    const requestId = ++requestSequence.current;
    draftMutationSequence.current += 1;
    activeDraftMutation.current = null;
    const requestSubject = subject;
    const requestStep = step;
    setGeneration({
      requestId,
      subject: requestSubject,
      step: requestStep,
      status: "pending",
      draft: null
    });
    setSavingItemId(null);
    setMessage("");
    try {
      const created = await api.createAiDraft({
        subject: requestSubject,
        step: requestStep,
        count,
        difficulty,
        weakTopics: weakTopics.split(/[,\n]/u).map((value) => value.trim()).filter(Boolean)
      });
      if (!isCurrentRequest(requestId, requestSubject, requestStep)) return;
      if (created.subject !== requestSubject || created.step !== requestStep ||
          created.status !== "draft") {
        setGeneration({
          requestId,
          subject: requestSubject,
          step: requestStep,
          status: "failed",
          draft: null
        });
        setMessage("초안의 과목이나 학습 단계 또는 상태가 요청과 달라서 표시하지 않았어요.");
        return;
      }
      setGeneration({
        requestId,
        subject: requestSubject,
        step: requestStep,
        status: "succeeded",
        draft: created
      });
    } catch {
      if (!isCurrentRequest(requestId, requestSubject, requestStep)) return;
      setGeneration({
        requestId,
        subject: requestSubject,
        step: requestStep,
        status: "failed",
        draft: null
      });
      setMessage("초안을 만들지 못했어요.");
    }
  };

  const matchingDraft = generation.status === "succeeded" &&
    generation.subject === subject && generation.step === step
    ? generation.draft
    : null;

  const saveDraftItem = async (
    itemId: string,
    payload: LearningItemPayload
  ): Promise<DraftItemSaveResult> => {
    if (matchingDraft === null || matchingDraft.status !== "draft" || publishing ||
        activeDraftMutation.current !== null || generation.status !== "succeeded") {
      return "blocked";
    }
    const requestId = generation.requestId;
    const requestSubject = generation.subject;
    const requestStep = generation.step;
    const draftId = matchingDraft.id;
    const mutationId = ++draftMutationSequence.current;
    activeDraftMutation.current = mutationId;
    setSavingItemId(itemId);
    try {
      const updated = await api.updateAiDraftItem(draftId, itemId, payload);
      if (activeDraftMutation.current !== mutationId ||
          draftMutationSequence.current !== mutationId ||
          !isCurrentRequest(requestId, requestSubject, requestStep)) return "stale";
      if (generation.status !== "succeeded" || generation.requestId !== requestId ||
          generation.draft?.id !== draftId || generation.draft.status !== "draft" ||
          !draftMatchesIdentity(updated, draftId, requestSubject, requestStep) ||
          updated.status !== "draft") return "rejected";
      setGeneration((current) => current.status === "succeeded" &&
        current.requestId === requestId && current.subject === requestSubject &&
        current.step === requestStep && current.draft?.id === draftId &&
        current.draft.status === "draft"
          ? { ...current, draft: updated }
          : current);
      return "applied";
    } catch {
      if (activeDraftMutation.current !== mutationId ||
          draftMutationSequence.current !== mutationId ||
          !isCurrentRequest(requestId, requestSubject, requestStep)) return "stale";
      return "failed";
    } finally {
      if (activeDraftMutation.current === mutationId) {
        activeDraftMutation.current = null;
        setSavingItemId(null);
      }
    }
  };

  const publish = async () => {
    if (matchingDraft === null || matchingDraft.status !== "draft" || publishing ||
        generation.status !== "succeeded" || activeDraftMutation.current !== null) return;
    const requestId = generation.requestId;
    const requestSubject = generation.subject;
    const requestStep = generation.step;
    const draftId = matchingDraft.id;
    setPublishing(true);
    setMessage("");
    try {
      const published = await api.publishAiDraft(draftId);
      if (!isCurrentRequest(requestId, requestSubject, requestStep)) return;
      if (generation.status !== "succeeded" || generation.requestId !== requestId ||
          generation.draft?.id !== draftId || generation.draft.status !== "draft" ||
          !draftMatchesIdentity(published, draftId, requestSubject, requestStep) ||
          published.status !== "published") {
        setMessage("발행 결과가 현재 초안과 달라서 반영하지 않았어요.");
        return;
      }
      setGeneration((current) => current.requestId === requestId &&
        current.subject === requestSubject && current.step === requestStep &&
        current.status === "succeeded" && current.draft?.id === draftId &&
        current.draft.status === "draft"
        ? { ...current, draft: published }
        : current);
      setMessage("발행을 완료했어요.");
    } catch {
      if (!isCurrentRequest(requestId, requestSubject, requestStep)) return;
      setMessage("초안을 발행하지 못했어요.");
    } finally {
      if (isCurrentRequest(requestId, requestSubject, requestStep)) setPublishing(false);
    }
  };

  const changeStep = (nextStep: LearningStep) => {
    const requestId = ++requestSequence.current;
    draftMutationSequence.current += 1;
    activeDraftMutation.current = null;
    activeSelection.current = { subject, step: nextStep };
    setStep(nextStep);
    setGeneration({ requestId, subject, step: nextStep, status: "idle", draft: null });
    setSavingItemId(null);
    setPublishing(false);
    setMessage("");
  };

  return (
    <section className="ai-draft-panel" aria-labelledby="ai-draft-panel-title">
      <h3 id="ai-draft-panel-title">
        {subject === "math" ? "수학 문제 배치" : "국어·받아쓰기 배치"}
      </h3>
      {!providersReady ? (
        <p className="ai-studio-readiness" role="status">
          Gemini와 OpenAI를 모두 켜고 두 API 키를 저장해야 초안을 만들 수 있어요.
        </p>
      ) : null}
      <form className="ai-draft-form" onSubmit={(event) => void create(event)}>
        <label>
          학습 단계
          <select
            onChange={(event) => changeStep(event.currentTarget.value as LearningStep)}
            value={step}
          >
            <option value="foundation">기초</option>
            <option value="current">현재 수준</option>
            <option value="challenge">도전</option>
          </select>
        </label>
        <label>
          문제 수
          <input
            max="40"
            min="2"
            onChange={(event) => setCount(event.currentTarget.valueAsNumber)}
            required
            type="number"
            value={count}
          />
        </label>
        <label>
          난이도
          <select onChange={(event) => setDifficulty(Number(event.currentTarget.value))} value={difficulty}>
            {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          자주 틀린 유형
          <input
            maxLength={327}
            onChange={(event) => setWeakTopics(event.currentTarget.value)}
            placeholder="쉼표로 나누어 입력"
            type="text"
            value={weakTopics}
          />
        </label>
        <button
          disabled={!providersReady || generation.status === "pending" || publishing}
          type="submit"
        >
          초안 만들기
        </button>
      </form>
      {matchingDraft !== null ? (
        <div className="ai-draft-results">
          <p>
            감리 통과 {matchingDraft.items.filter((item) => item.status !== "rejected").length}개 ·
            발행 제외 {matchingDraft.items.filter((item) => item.status === "rejected").length}개
          </p>
          {matchingDraft.items.map((item) => (
            <DraftItemEditor
              disabled={publishing || savingItemId !== null}
              item={item}
              key={item.id}
              onSave={(payload) => saveDraftItem(item.id, payload)}
            />
          ))}
          <button
            disabled={publishing || savingItemId !== null || matchingDraft.status !== "draft" ||
              generation.status !== "succeeded" ||
              !matchingDraft.items.some((item) => item.status === "accepted" || item.status === "edited")}
            onClick={() => void publish()}
            type="button"
          >
            초안 발행
          </button>
        </div>
      ) : null}
      {message !== "" ? <p role="status">{message}</p> : null}
    </section>
  );
}

function DraftItemEditor({
  disabled,
  item,
  onSave
}: {
  disabled: boolean;
  item: AiDraftItemView;
  onSave(payload: LearningItemPayload): Promise<DraftItemSaveResult>;
}) {
  const [payload, setPayload] = useState<LearningItemPayload>(item.payload);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const rejected = item.status === "rejected";

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || saving || rejected) return;
    const parsed = LearningItemPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      setMessage("문제 형식을 다시 확인해 주세요.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const result = await onSave(parsed.data);
      if (result === "applied") setMessage("수정한 문제를 저장했어요.");
      else if (result === "rejected") {
        setMessage("수정 결과가 현재 초안과 달라서 반영하지 않았어요.");
      } else if (result === "failed") setMessage("수정한 문제를 저장하지 못했어요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article aria-label={`${item.payload.title} 초안`} className="ai-draft-card">
      <header>
        <h4>{item.payload.title}</h4>
        <p>{PROVIDER_LABELS[item.sourceProvider]} 생성</p>
      </header>
      {rejected ? (
        <>
          <p className="ai-draft-card__rejected">감리 탈락 · 발행 제외</p>
          <ul>{item.review.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </>
      ) : (
        <form onSubmit={(event) => void save(event)}>
          <label>
            문제 제목
            <input
              disabled={disabled || saving}
              maxLength={200}
              onChange={(event) => {
                const title = event.currentTarget.value;
                setPayload((current) => ({ ...current, title }));
              }}
              required
              type="text"
              value={payload.title}
            />
          </label>
          {payload.kind === "math-story" ? (
            <>
              <label>
                문제
                <textarea
                  disabled={disabled || saving}
                  onChange={(event) => {
                    const question = event.currentTarget.value;
                    setPayload((current) => current.kind === "math-story"
                      ? { ...current, question }
                      : current);
                  }}
                  required
                  value={payload.question}
                />
              </label>
              <label>
                정답
                <input
                  disabled={disabled || saving}
                  onChange={(event) => {
                    const answer = event.currentTarget.valueAsNumber;
                    setPayload((current) => current.kind === "math-story"
                      ? { ...current, answer }
                      : current);
                  }}
                  required
                  type="number"
                  value={payload.answer}
                />
              </label>
            </>
          ) : payload.kind === "korean-dictation" ? (
            <>
              <label>
                제시 문장
                <input
                  disabled={disabled || saving}
                  onChange={(event) => {
                    const promptText = event.currentTarget.value;
                    setPayload((current) => current.kind === "korean-dictation"
                      ? { ...current, promptText }
                      : current);
                  }}
                  required
                  type="text"
                  value={payload.promptText}
                />
              </label>
              <label>
                정답 문장
                <input
                  disabled={disabled || saving}
                  onChange={(event) => {
                    const answerText = event.currentTarget.value;
                    setPayload((current) => current.kind === "korean-dictation"
                      ? { ...current, answerText }
                      : current);
                  }}
                  required
                  type="text"
                  value={payload.answerText}
                />
              </label>
            </>
          ) : null}
          <button disabled={disabled || saving} type="submit">수정 저장</button>
        </form>
      )}
      {message !== "" ? <p role="status">{message}</p> : null}
    </article>
  );
}

function reportRange(period: "today" | "weekly"): { from: string; to: string } {
  const now = new Date();
  const to = formatStudyDate(now);
  if (period === "today") return { from: to, to };
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - 6);
  return { from: formatStudyDate(fromDate), to };
}

function formatStudyDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function ReportPanel({
  api,
  period
}: {
  api: Pick<ApiClient, "getGuardianAiReport">;
  period: "today" | "weekly";
}) {
  const [report, setReport] = useState<GuardianAiReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const range = reportRange(period);
    setReport(null);
    setFailed(false);
    void api.getGuardianAiReport(range.from, range.to).then(
      (loaded) => {
        if (active) setReport(loaded);
      },
      () => {
        if (active) setFailed(true);
      }
    );
    return () => { active = false; };
  }, [api, period]);

  return (
    <section className="ai-report" aria-labelledby="ai-report-title">
      <h3 id="ai-report-title">{period === "today" ? "오늘의 학습 요약" : "주간 변화"}</h3>
      {report === null && !failed ? <p aria-busy="true">학습 보고서를 불러오고 있어요.</p> : null}
      {failed ? <p role="alert">학습 보고서를 불러오지 못했어요.</p> : null}
      {report !== null ? (
        <>
          <p>{report.summary}</p>
          <p>완료율 {report.completionRate}%</p>
          <p>{report.challengePerfect ? "도전 단계 만점" : "도전 단계를 연습 중이에요."}</p>
          {report.commonMistakes.length > 0 ? (
            <ul>{report.commonMistakes.map((mistake) => <li key={mistake}>{mistake}</li>)}</ul>
          ) : null}
          <small>{report.source === "llm" ? "AI 요약" : "로컬 요약"}</small>
        </>
      ) : null}
    </section>
  );
}
