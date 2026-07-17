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
type SideEffectCategory =
  | "NETWORK"
  | "AUDIO"
  | "ANALYTICS"
  | "LLM_PROVIDER"
  | "REACT"
  | "INDEXED_DB";
const SIDE_EFFECT_MODULES: readonly [SideEffectCategory, RegExp][] = [
  ["REACT", /^react(?:-dom)?(?:\/|$)/],
  ["INDEXED_DB", /^(?:idb(?:-keyval)?|fake-indexeddb)(?:\/|$)/],
  ["NETWORK", /^(?:(?:cross|isomorphic|node)-fetch|axios|got|ky|undici|superagent|https?|node:https?|@whatwg-node\/fetch)(?:\/|$)/],
  ["AUDIO", /(?:^|[/@._-])(?:audio|howler|speech|tone)(?:[/@._-]|$)/],
  ["ANALYTICS", /(?:^|[/@._-])(?:analytics|amplitude|datadog|fullstory|gtag|heap|mixpanel|plausible|posthog|segment|sentry|tracking)(?:[/@._-]|$)/],
  ["LLM_PROVIDER", /(?:^|[/@._-])(?:ai|anthropic|bedrock|cohere|deepseek|fireworks|gemini|genai|generative|groq|huggingface|langchain|mistral|ollama|openai|perplexity|replicate|together|transformers|vertexai|xai)(?:[/@._-]|$)/]
];
const VIRTUAL_FIXTURE_FILE = "/virtual/child-copy-audit-fixture.tsx";
const TECHNICAL_CLASS_FIXTURE = `
  const childView = (
    <section className="story-sentence" data-testid="number-clues">
      <strong className="number-clues">Read this</strong>
    </section>
  );
`;
const SIDE_EFFECT_FIXTURES = [
  {
    name: "comment-separated fetch",
    fileName: "/virtual/comment-separated-fetch.tsx",
    source: `fetch /* child audit must ignore trivia */ ("/x");`,
    expected: ["NETWORK_CALL"]
  },
  {
    name: "spaced sendBeacon",
    fileName: "/virtual/spaced-send-beacon.tsx",
    source: `navigator . sendBeacon("/x");`,
    expected: ["NETWORK_CALL"]
  },
  {
    name: "aliased network import",
    fileName: "/virtual/aliased-network-import.tsx",
    source: `import { fetch as load } from "cross-fetch"; load("/x");`,
    expected: ["NETWORK_IMPORT", "NETWORK_CALL"]
  }
] as const;
const VIRTUAL_FILES = new Map<string, string>([
  [VIRTUAL_FIXTURE_FILE, TECHNICAL_CLASS_FIXTURE],
  ...SIDE_EFFECT_FIXTURES.map(({ fileName, source }) => [fileName, source] as const)
]);

const compilerApi = new API({
  cwd: process.cwd(),
  fs: {
    fileExists: (fileName) => VIRTUAL_FILES.has(fileName) ? true : undefined,
    readFile: (fileName) => VIRTUAL_FILES.get(fileName)
  }
});
const compilerSnapshot = compilerApi.updateSnapshot({
  openProjects: [resolve("tsconfig.json")],
  openFiles: [...VIRTUAL_FILES.keys()]
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
  const project = VIRTUAL_FILES.has(fileName)
    ? compilerSnapshot.getDefaultProjectForFile(fileName)
    : compilerProject;
  const sourceFile = project?.program.getSourceFile(
    VIRTUAL_FILES.has(fileName) ? fileName : resolve(fileName)
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

function moduleCategory(specifier: string): SideEffectCategory | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) {
    return null;
  }
  return SIDE_EFFECT_MODULES.find(([, pattern]) => pattern.test(specifier.toLowerCase()))?.[0] ?? null;
}

function literalText(node: ts.Node | undefined): string | null {
  return node !== undefined && (
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
  ) ? node.text : null;
}

function importedBindingNames(node: ts.ImportDeclaration): string[] {
  const names: string[] = [];
  const clause = node.importClause;
  if (clause?.name !== undefined) names.push(clause.name.text);
  const bindings = clause?.namedBindings;
  if (bindings === undefined) return names;
  if (ts.isNamespaceImport(bindings)) {
    names.push(bindings.name.text);
  } else if (ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) names.push(element.name.text);
  }
  return names;
}

function accessPath(node: ts.Node): string[] {
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) {
    return accessPath(node.expression);
  }
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    return [...accessPath(node.expression), node.name.text];
  }
  if (ts.isElementAccessExpression(node)) {
    const property = literalText(node.argumentExpression);
    return property === null ? accessPath(node.expression) : [
      ...accessPath(node.expression),
      property
    ];
  }
  return [];
}

function operationCategory(
  path: readonly string[],
  importedBindings: ReadonlyMap<string, SideEffectCategory>
): SideEffectCategory | null {
  if (path.length === 0) return null;
  const lowerPath = path.map((part) => part.toLowerCase());
  const root = lowerPath[0]!;
  const last = lowerPath.at(-1)!;
  const imported = importedBindings.get(path[0]!);
  if (imported !== undefined) return imported;
  if (["fetch", "sendbeacon", "xmlhttprequest", "websocket", "eventsource"].includes(last)) {
    return "NETWORK";
  }
  if (
    lowerPath.includes("speechsynthesis") ||
    ["audio", "audiocontext", "webkitaudiocontext", "speechsynthesisutterance"].includes(last)
  ) {
    return "AUDIO";
  }
  if (root === "react") return "REACT";
  if (root === "indexeddb" || ["opendb", "deletedb"].includes(last)) return "INDEXED_DB";
  if ([
    "analytics", "amplitude", "datadog", "fullstory", "gtag", "heap",
    "mixpanel", "plausible", "posthog", "segment", "sentry"
  ].includes(root)) return "ANALYTICS";
  if ([
    "anthropic", "cohere", "deepseek", "fireworks", "gemini", "groq",
    "mistral", "ollama", "openai", "perplexity", "replicate", "together", "xai"
  ].includes(root)) return "LLM_PROVIDER";
  return null;
}

function importViolation(category: SideEffectCategory): string {
  return `${category}_IMPORT`;
}

function callViolation(category: SideEffectCategory): string {
  return `${category}_CALL`;
}

function inspectSideEffects(fileName: string): string[] {
  const sourceFile = parsedSourceFile(fileName);
  const violations = new Set<string>();
  const importedBindings = new Map<string, SideEffectCategory>();

  function recordImport(category: SideEffectCategory, bindings: readonly string[] = []): void {
    violations.add(importViolation(category));
    for (const binding of bindings) importedBindings.set(binding, category);
  }

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const category = moduleCategory(literalText(statement.moduleSpecifier) ?? "");
      if (category !== null) recordImport(category, importedBindingNames(statement));
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference)
    ) {
      const category = moduleCategory(literalText(statement.moduleReference.expression) ?? "");
      if (category !== null) recordImport(category, [statement.name.text]);
    } else if (ts.isExportDeclaration(statement)) {
      const category = moduleCategory(literalText(statement.moduleSpecifier) ?? "");
      if (category !== null) recordImport(category);
    }
  }

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if ((isDynamicImport || isRequire) && node.arguments.length === 1) {
        const category = moduleCategory(literalText(node.arguments[0]) ?? "");
        if (category !== null) recordImport(category);
      } else {
        const category = operationCategory(accessPath(node.expression), importedBindings);
        if (category !== null) violations.add(callViolation(category));
      }
    } else if (ts.isNewExpression(node)) {
      const category = operationCategory(accessPath(node.expression), importedBindings);
      if (category !== null) violations.add(callViolation(category));
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(sourceFile).toLowerCase() === "audio") {
        violations.add("AUDIO_ELEMENT");
      }
    }
    node.forEachChild(visit);
  }

  sourceFile.forEachChild(visit);
  return [...violations];
}

function auditChildUiSideEffects(fileName: string): string[] {
  return inspectSideEffects(fileName).filter((violation) =>
    !violation.startsWith("REACT_") && !violation.startsWith("INDEXED_DB_"));
}

function auditPureDisplaySideEffects(fileName: string): string[] {
  return inspectSideEffects(fileName);
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

  it.each(SIDE_EFFECT_FIXTURES)(
    "blocks $name in child UI modules",
    ({ fileName, source, expected }) => {
      expect(source).toBe(VIRTUAL_FILES.get(fileName));
      expect(auditChildUiSideEffects(fileName)).toEqual(expect.arrayContaining([...expected]));
    }
  );

  it.each(SIDE_EFFECT_FIXTURES)(
    "blocks $name in pure display modules",
    ({ fileName, source, expected }) => {
      expect(source).toBe(VIRTUAL_FILES.get(fileName));
      expect(auditPureDisplaySideEffects(fileName)).toEqual(expect.arrayContaining([...expected]));
    }
  );

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
    expect(auditChildUiSideEffects(fileName)).toEqual([]);
  });

  it.each(PURE_DISPLAY_FILES)("keeps pure display data side-effect free in %s", (fileName) => {
    expect(auditPureDisplaySideEffects(fileName)).toEqual([]);
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
