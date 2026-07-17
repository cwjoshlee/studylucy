import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";
import { afterAll, describe, expect, it } from "vitest";
import {
  selectCompanionCue,
  type CompanionMoment
} from "../../src/client/companions/cues";
import {
  INITIAL_CONTENT_VERSION,
  INITIAL_ITEMS
} from "../../src/server/db/seed";

const ENGLISH_INSTRUCTION = /\b(?:read|look|find|add|slow|pause|sentence|number|finish)\b/i;
const FORBIDDEN_NAMES = /마이\s*리틀\s*포니|티니핑|시나모롤/i;
const CHILD_SHAMING = /바보|못하|틀렸잖|왜 이것도|느려|벌 받아/;
const READING_EVALUATION = /읽기\s*(?:PASS|FAIL)\b|\b(?:PASS|FAIL)\b/i;

const CHILD_UI_FILES = [
  "src/client/home/student-home.tsx",
  "src/client/learning/learning-session.tsx",
  "src/client/learning/problem-breakdown-view.tsx",
  "src/client/companions/cast.ts",
  "src/client/companions/cues.ts",
  "src/client/companions/companion-avatar.tsx",
  "src/client/companions/friend-stage.tsx",
  "src/client/companions/learning-companion.tsx",
  "src/client/delight/star-celebration.tsx",
  "src/client/delight/today-stars.tsx"
] as const;

const PURE_DISPLAY_FILES = [
  "src/client/companions/cast.ts",
  "src/client/companions/cues.ts",
  "src/client/learning/problem-breakdown.ts"
] as const;

const AUDITED_OBJECT_PROPERTIES = new Set([
  "text",
  "message",
  "name",
  "role",
  "alt",
  "mishap",
  "openingCue",
  "celebrationCue",
  "hint"
]);
const AUDITED_JSX_ATTRIBUTES = new Set([
  "aria-label",
  "alt",
  "title",
  "placeholder"
]);
const CHILD_COPY_SETTER = /(?:Feedback|Message|Guidance|Text)$/;
const ANALYTICS_MODULE = /(?:^|[/@-])(?:analytics|amplitude|mixpanel|posthog|segment|tracking|sentry|datadog|gtag|google-analytics|plausible|fullstory|heap)(?:[/@.-]|$)/i;
const LLM_MODULE = /(?:^|[/@-])(?:ai|openai|anthropic|cohere|mistral(?:ai)?|ollama|groq|langchain|bedrock|vertexai|gemini|generative-ai|genai|deepseek|xai|huggingface|transformers|replicate|together|perplexity|fireworks)(?:[/@.-]|$)/i;
const NETWORK_MODULE = /(?:^|[/@-])(?:axios|got|ky|node-fetch|undici|network|http|api|sync)(?:[/@.-]|$)/i;
const AUDIO_MODULE = /(?:^|[/@-])(?:howler|tone|audio|speech)(?:[/@.-]|$)/i;
const ANALYTICS_CALL = /\b(?:analytics|amplitude|mixpanel|posthog|sentry|datadog|fullstory|heap)\.[A-Za-z_$][\w$]*\s*\(|\bgtag\s*\(/i;
const LLM_CALL = /\b(?:openai|anthropic|cohere|mistral|ollama|groq|gemini|deepseek|xai|replicate|together|perplexity|fireworks)\.[A-Za-z_$][\w$]*\s*\(|\bnew\s+(?:OpenAI|Anthropic|Cohere|Mistral|Ollama|Groq|Gemini|DeepSeek)\b/i;
const VIRTUAL_FIXTURE_FILE = "/virtual/child-copy-audit-fixture.tsx";
const TECHNICAL_CLASS_FIXTURE = `
  const childView = (
    <section className="story-sentence" data-testid="number-clues">
      <strong className="number-clues">Read this</strong>
    </section>
  );
`;

const compilerApi = new API({
  cwd: process.cwd(),
  fs: {
    fileExists: (fileName) => fileName === VIRTUAL_FIXTURE_FILE ? true : undefined,
    readFile: (fileName) => fileName === VIRTUAL_FIXTURE_FILE
      ? TECHNICAL_CLASS_FIXTURE
      : undefined
  }
});
const compilerSnapshot = compilerApi.updateSnapshot({
  openProjects: [resolve("tsconfig.json")],
  openFiles: [VIRTUAL_FIXTURE_FILE]
});
const compilerProject = compilerSnapshot.getProjects().find(
  (project) => project.configFileName === resolve("tsconfig.json")
);

afterAll(() => {
  compilerSnapshot.dispose();
  compilerApi.close();
});

type CopyViolation =
  | "ENGLISH_INSTRUCTION"
  | "FORBIDDEN_COMMERCIAL_NAME"
  | "CHILD_SHAMING"
  | "READING_EVALUATION_LABEL";

function auditChildCopy(copy: readonly string[]): CopyViolation[] {
  const joined = copy.join("\n");
  const violations: CopyViolation[] = [];
  if (ENGLISH_INSTRUCTION.test(joined)) violations.push("ENGLISH_INSTRUCTION");
  if (FORBIDDEN_NAMES.test(joined)) violations.push("FORBIDDEN_COMMERCIAL_NAME");
  if (CHILD_SHAMING.test(joined)) violations.push("CHILD_SHAMING");
  if (READING_EVALUATION.test(joined)) violations.push("READING_EVALUATION_LABEL");
  return violations;
}

function collectStringDescendants(node: ts.Node, copy: string[]): void {
  if (ts.isJsxAttribute(node)) return;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    if (node.text.trim() !== "") copy.push(node.text.trim());
    return;
  }
  if (ts.isTemplateExpression(node)) {
    if (node.head.text.trim() !== "") copy.push(node.head.text.trim());
    for (const span of node.templateSpans) {
      collectStringDescendants(span.expression, copy);
      if (span.literal.text.trim() !== "") copy.push(span.literal.text.trim());
    }
    return;
  }
  node.forEachChild((child) => collectStringDescendants(child, copy));
}

function propertyName(node: ts.PropertyName): string | null {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)
    ? node.text
    : null;
}

function callName(node: ts.Node): string | null {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

function parsedSourceFile(fileName: string): ts.SourceFile {
  const project = fileName === VIRTUAL_FIXTURE_FILE
    ? compilerSnapshot.getDefaultProjectForFile(fileName)
    : compilerProject;
  const sourceFile = project?.program.getSourceFile(
    fileName === VIRTUAL_FIXTURE_FILE ? fileName : resolve(fileName)
  );
  if (sourceFile === undefined) throw new Error(`Missing compiler source file: ${fileName}`);
  return sourceFile;
}

function collectChildCopy(fileName: string): string[] {
  const sourceFile = parsedSourceFile(fileName);
  const copy: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isExportDeclaration(node)
    ) {
      return;
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sourceFile);
      if (!AUDITED_JSX_ATTRIBUTES.has(name) || node.initializer === undefined) return;
      if (ts.isStringLiteral(node.initializer)) {
        if (node.initializer.text.trim() !== "") copy.push(node.initializer.text.trim());
      } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression !== undefined) {
        collectStringDescendants(node.initializer.expression, copy);
      }
      return;
    }
    if (ts.isJsxText(node)) {
      if (node.text.trim() !== "") copy.push(node.text.trim());
    } else if (ts.isJsxExpression(node)) {
      if (node.expression !== undefined) collectStringDescendants(node.expression, copy);
    } else if (
      ts.isPropertyAssignment(node) &&
      AUDITED_OBJECT_PROPERTIES.has(propertyName(node.name) ?? "")
    ) {
      collectStringDescendants(node.initializer, copy);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text.endsWith("_TEXT") &&
      node.initializer !== undefined
    ) {
      collectStringDescendants(node.initializer, copy);
    } else if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      if (name !== null && CHILD_COPY_SETTER.test(name)) {
        for (const argument of node.arguments) collectStringDescendants(argument, copy);
      }
    }
    node.forEachChild(visit);
  }

  visit(sourceFile);
  return copy;
}

function moduleSpecifiers(fileName: string): string[] {
  const sourceFile = parsedSourceFile(fileName);
  const specifiers: string[] = [];
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      specifiers.push(statement.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression !== undefined &&
      ts.isStringLiteral(statement.moduleReference.expression)
    ) {
      specifiers.push(statement.moduleReference.expression.text);
    }
  }
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      specifiers.push(node.arguments[0].text);
    }
    node.forEachChild(visit);
  }
  sourceFile.forEachChild(visit);
  return specifiers;
}

function auditChildUiSideEffects(sourceText: string, fileName: string): string[] {
  const violations: string[] = [];
  const imports = moduleSpecifiers(fileName);
  if (/(?:\b(?:globalThis|window)\.)?\bfetch\s*\(/.test(sourceText)) violations.push("FETCH_CALL");
  if (/\bnew\s+(?:window\.)?Audio\b/.test(sourceText)) violations.push("AUDIO_CONSTRUCTION");
  if (/<audio\b/i.test(sourceText)) violations.push("AUDIO_ELEMENT");
  if (/\bspeechSynthesis\b/.test(sourceText)) violations.push("SPEECH_SYNTHESIS");
  if (imports.some((specifier) => ANALYTICS_MODULE.test(specifier))) violations.push("ANALYTICS_IMPORT");
  if (imports.some((specifier) => LLM_MODULE.test(specifier))) violations.push("LLM_PROVIDER_IMPORT");
  return violations;
}

function auditPureDisplaySideEffects(sourceText: string, fileName: string): string[] {
  const violations = auditChildUiSideEffects(sourceText, fileName);
  const imports = moduleSpecifiers(fileName);
  if (imports.some((specifier) => /^react(?:[/.-]|$)|^react-dom(?:[/.-]|$)/i.test(specifier))) {
    violations.push("REACT_IMPORT");
  }
  if (/\bReact\.[A-Za-z_$][\w$]*\s*\(/.test(sourceText)) violations.push("REACT_ACCESS");
  if (
    imports.some((specifier) => /(?:^|[/@-])(?:idb|indexeddb)(?:[/@.-]|$)/i.test(specifier)) ||
    /\b(?:indexedDB|openDB|deleteDB)\b/.test(sourceText)
  ) {
    violations.push("INDEXED_DB_ACCESS");
  }
  if (
    imports.some((specifier) => NETWORK_MODULE.test(specifier)) ||
    /\b(?:XMLHttpRequest|WebSocket|EventSource)\b|\bnavigator\.sendBeacon\s*\(|\b(?:axios|got|ky)\s*\(|\b(?:http|https)\.(?:get|request)\s*\(/.test(sourceText)
  ) {
    violations.push("NETWORK_ACCESS");
  }
  if (imports.some((specifier) => AUDIO_MODULE.test(specifier))) violations.push("AUDIO_IMPORT");
  if (ANALYTICS_CALL.test(sourceText)) violations.push("ANALYTICS_CALL");
  if (LLM_CALL.test(sourceText)) violations.push("LLM_PROVIDER_CALL");
  return violations;
}

function activeItemChildCopy(item: (typeof INITIAL_ITEMS)[number]): string[] {
  const copy = [
    item.unit,
    item.title,
    item.level,
    item.readLabel,
    item.text,
    item.hint,
    ...item.tokens,
    item.delight?.mishap,
    item.delight?.openingCue,
    item.delight?.celebrationCue
  ];
  if (item.kind === "math-story") {
    copy.push(item.question, item.unitLabel, item.checkHint);
  }
  return copy.filter((value): value is string => typeof value === "string");
}

function readSource(fileName: string): string {
  return readFileSync(fileName, "utf8");
}

describe("approved magical companion seed content", () => {
  it("classifies English instructions and child-shaming copy", () => {
    expect(auditChildCopy(["Read this, 바보야"])).toEqual(expect.arrayContaining([
      "ENGLISH_INSTRUCTION",
      "CHILD_SHAMING"
    ]));
  });

  it("ignores technical class hooks while auditing visible JSX instructions", () => {
    const copy = collectChildCopy(VIRTUAL_FIXTURE_FILE);

    expect(copy).toEqual(["Read this"]);
    expect(auditChildCopy(copy)).toEqual(["ENGLISH_INSTRUCTION"]);
  });

  it("publishes exactly ten Korean and ten math v2 items", () => {
    expect(INITIAL_CONTENT_VERSION).toBe(2);
    expect(INITIAL_ITEMS.filter((item) => item.subject === "korean")).toHaveLength(10);
    expect(INITIAL_ITEMS.filter((item) => item.subject === "math")).toHaveLength(10);
  });

  it("gives every item distinct Korean delight copy and no commercial names", () => {
    const delight = INITIAL_ITEMS.map((item) => item.delight);
    expect(delight.every(Boolean)).toBe(true);
    expect(new Set(delight.map((entry) => entry!.mishap)).size).toBe(20);
    for (const item of INITIAL_ITEMS) {
      const childCopy = activeItemChildCopy(item);
      expect(childCopy.join("\n")).toMatch(/[가-힣]/);
      expect(auditChildCopy(childCopy), item.id).toEqual([]);
    }
  });

  it("keeps every math answer, unit and scaffold internally consistent", () => {
    for (const item of INITIAL_ITEMS) {
      if (item.kind !== "math-story") continue;
      expect(item.text.match(/\d+/g)).toHaveLength(2);
      expect(item.question).toContain("몇");
      expect(item.unitLabel.length).toBeGreaterThan(0);
      expect(item.checkHint).toMatch(/[가-힣]/);
      expect(Number.isInteger(item.answer)).toBe(true);
    }
  });

  it.each(CHILD_UI_FILES)("audits approved child-visible copy in %s", (fileName) => {
    const copy = collectChildCopy(fileName);
    expect(auditChildCopy(copy), copy.join(" | ")).toEqual([]);
  });

  it.each(CHILD_UI_FILES)("blocks direct child UI side effects in %s", (fileName) => {
    expect(auditChildUiSideEffects(readSource(fileName), fileName)).toEqual([]);
  });

  it.each(PURE_DISPLAY_FILES)("keeps pure display data side-effect free in %s", (fileName) => {
    expect(auditPureDisplaySideEffects(readSource(fileName), fileName)).toEqual([]);
  });

  it.each([
    "retry",
    "save-wait",
    "idle-confirm",
    "idle-paused"
  ] satisfies CompanionMoment[])("keeps restricted %s cues free of humor", (moment) => {
    expect(selectCompanionCue({
      moment,
      key: `audit:${moment}`,
      subject: "korean"
    }).tone).not.toBe("humor");
  });
});
