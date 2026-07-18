import {
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
>;

type TreeGroupId = "settings" | "generation" | "reports";
type TreeLeaf = {
  id: string;
  label: string;
  panel: AiStudioPanel;
};

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

function groupForLeaf(leafId: string): TreeGroupId | null {
  return TREE_GROUPS.find((group) => group.leaves.some((leaf) => leaf.id === leafId))
    ?.id ?? null;
}

export function AiLearningStudio({
  api,
  panel,
  onPanelChange
}: {
  api: AiLearningStudioApi;
  panel: AiStudioPanel;
  onPanelChange(panel: AiStudioPanel): void;
}): JSX.Element {
  const initialSelection = treeSelection(panel);
  const [openGroups, setOpenGroups] = useState<Set<TreeGroupId>>(
    () => new Set([initialSelection.groupId])
  );
  const [selectedLeaf, setSelectedLeaf] = useState(initialSelection.leafId);
  const [focusedItem, setFocusedItem] = useState(initialSelection.leafId);
  const treeItemRefs = useRef(new Map<string, HTMLElement>());
  const focusRequested = useRef(false);
  const [settings, setSettings] = useState<AiProviderSettingsView[] | null>(null);
  const [settingsFailed, setSettingsFailed] = useState(false);

  useEffect(() => {
    const selection = treeSelection(panel);
    setSelectedLeaf(selection.leafId);
    setFocusedItem(selection.leafId);
    setOpenGroups((current) => {
      if (current.has(selection.groupId)) return current;
      return new Set([...current, selection.groupId]);
    });
  }, [panel]);

  useEffect(() => {
    if (!focusRequested.current) return;
    focusRequested.current = false;
    treeItemRefs.current.get(focusedItem)?.focus();
  }, [focusedItem, openGroups]);

  useEffect(() => {
    let active = true;
    setSettingsFailed(false);
    void api.getAiStudioSettings().then(
      (loaded) => {
        if (active) setSettings(loaded);
      },
      () => {
        if (active) setSettingsFailed(true);
      }
    );
    return () => { active = false; };
  }, [api]);

  const selectLeaf = (leaf: TreeLeaf) => {
    setSelectedLeaf(leaf.id);
    setFocusedItem(leaf.id);
    onPanelChange(leaf.panel);
  };

  const toggleGroup = (groupId: TreeGroupId, forceOpen?: boolean) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      const open = forceOpen ?? !next.has(groupId);
      if (open) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
  };

  const requestTreeFocus = (itemId: string) => {
    focusRequested.current = true;
    setFocusedItem(itemId);
  };

  const visibleTreeItems = TREE_GROUPS.flatMap((group) => [
    `group:${group.id}`,
    ...(openGroups.has(group.id) ? group.leaves.map((leaf) => leaf.id) : [])
  ]);

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
      <nav aria-label="AI 학습실 메뉴" className="ai-studio-tree" role="tree">
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
              tabIndex={focusedItem === branchId ? 0 : -1}
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
                      tabIndex={focusedItem === leaf.id ? 0 : -1}
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
          settings={settings}
          onProviderUpdated={(updated) => setSettings((current) => {
            if (current === null) return [updated];
            return current.map((item) => item.provider === updated.provider
              ? updated
              : item);
          })}
        />
      ) : null}
      {panel === "generate-math" || panel === "generate-korean" ? (
        <DraftPanel
          api={api}
          settings={settings}
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
  onProviderUpdated
}: {
  api: Pick<ApiClient, "updateAiStudioProvider">;
  settings: AiProviderSettingsView[] | null;
  onProviderUpdated(settings: AiProviderSettingsView): void;
}) {
  if (settings === null) return <p aria-busy="true">제공자 설정을 불러오고 있어요.</p>;
  return (
    <div className="ai-provider-grid">
      {(["gemini", "openai"] as const).map((provider) => {
        const value = settings.find((item) => item.provider === provider);
        if (value === undefined) return null;
        return (
          <ProviderCard
            api={api}
            key={provider}
            onUpdated={onProviderUpdated}
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

function ProviderCard({
  api,
  settings,
  onUpdated
}: {
  api: Pick<ApiClient, "updateAiStudioProvider">;
  settings: AiProviderSettingsView;
  onUpdated(settings: AiProviderSettingsView): void;
}) {
  const label = PROVIDER_LABELS[settings.provider];
  const [enabled, setEnabled] = useState(settings.enabled);
  const [model, setModel] = useState(settings.model);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      const updated = await api.updateAiStudioProvider(settings.provider, {
        enabled,
        model,
        ...(apiKey === "" ? {} : { apiKey })
      });
      onUpdated(updated);
      setEnabled(updated.enabled);
      setModel(updated.model);
      setApiKey("");
      setMessage("설정을 저장했어요.");
    } catch {
      setMessage("설정을 저장하지 못했어요.");
    } finally {
      setSaving(false);
    }
  };

  const removeKey = async () => {
    if (saving || !settings.hasApiKey) return;
    setSaving(true);
    setMessage("");
    try {
      const updated = await api.updateAiStudioProvider(settings.provider, {
        enabled: false,
        deleteApiKey: true
      });
      onUpdated(updated);
      setEnabled(false);
      setApiKey("");
      setMessage("API 키를 삭제했어요.");
    } catch {
      setMessage("API 키를 삭제하지 못했어요.");
    } finally {
      setSaving(false);
    }
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
    </article>
  );
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
  const [draft, setDraft] = useState<AiDraftView | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const providersReady = settings !== null &&
    (["gemini", "openai"] as const).every((provider) => settings.some((item) =>
      item.provider === provider && item.enabled && item.hasApiKey
    ));

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!providersReady || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const created = await api.createAiDraft({
        subject,
        step,
        count,
        difficulty,
        weakTopics: weakTopics.split(/[,\n]/u).map((value) => value.trim()).filter(Boolean)
      });
      setDraft(created);
    } catch {
      setMessage("초안을 만들지 못했어요.");
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (draft === null || draft.status !== "draft" || saving) return;
    setSaving(true);
    setMessage("");
    try {
      setDraft(await api.publishAiDraft(draft.id));
      setMessage("발행을 완료했어요.");
    } catch {
      setMessage("초안을 발행하지 못했어요.");
    } finally {
      setSaving(false);
    }
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
          <select onChange={(event) => setStep(event.currentTarget.value as LearningStep)} value={step}>
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
        <button disabled={!providersReady || saving} type="submit">초안 만들기</button>
      </form>
      {draft !== null ? (
        <div className="ai-draft-results">
          <p>
            감리 통과 {draft.items.filter((item) => item.status !== "rejected").length}개 ·
            발행 제외 {draft.items.filter((item) => item.status === "rejected").length}개
          </p>
          {draft.items.map((item) => (
            <DraftItemEditor
              api={api}
              draftId={draft.id}
              item={item}
              key={item.id}
              onUpdated={setDraft}
            />
          ))}
          <button
            disabled={saving || draft.status !== "draft" ||
              !draft.items.some((item) => item.status === "accepted" || item.status === "edited")}
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
  api,
  draftId,
  item,
  onUpdated
}: {
  api: Pick<ApiClient, "updateAiDraftItem">;
  draftId: string;
  item: AiDraftItemView;
  onUpdated(draft: AiDraftView): void;
}) {
  const [payload, setPayload] = useState<LearningItemPayload>(item.payload);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const rejected = item.status === "rejected";

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || rejected) return;
    const parsed = LearningItemPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      setMessage("문제 형식을 다시 확인해 주세요.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      onUpdated(await api.updateAiDraftItem(draftId, item.id, parsed.data));
      setMessage("수정한 문제를 저장했어요.");
    } catch {
      setMessage("수정한 문제를 저장하지 못했어요.");
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
          <button disabled={saving} type="submit">수정 저장</button>
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
