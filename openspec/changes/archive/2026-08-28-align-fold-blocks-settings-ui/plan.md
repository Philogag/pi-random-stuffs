# Align fold-blocks settings UI with native pi settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the `/tui-fold-blocks` config page as a single English `SettingsList` page with space-cycling toggles and immediate save, aligned with pi's native settings interaction.

**Architecture:** Replace the multi-step `ctx.ui.select` menu in `src/settings.ts` with a `SettingsList` (from `@earendil-works/pi-tui`) mounted via `ctx.ui.custom`, themed by `getSettingsListTheme()` (from `@earendil-works/pi-coding-agent`). All options are `SettingItem`s with `values` arrays — space cycles each. `onChange` updates config in memory, calls the `onSave` callback (persisting + live mode sync in `index.ts`). Delete dead `nextMode()`.

**Tech Stack:** TypeScript ES2022 / NodeNext, vitest, `@earendil-works/pi-tui` (SettingsList, SettingItem), `@earendil-works/pi-coding-agent` (getSettingsListTheme, ctx.ui.custom, ExtensionUIContext).

**Spec:** `openspec/changes/align-fold-blocks-settings-ui/specs/tui-tool-block-collapse/spec.md`
**Design:** `openspec/changes/align-fold-blocks-settings-ui/design.md`

---
change: align-fold-blocks-settings-ui
design-doc: openspec/changes/align-fold-blocks-settings-ui/design.md
base-ref: 958cba8bcd8157af5fdf352f8ab1d2762f64b180
---

## Global Constraints

- Config schema (`FoldBlocksConfig` in `src/config.ts`) MUST NOT change: `mode: "native"|"fold"|"hide"`, `nerdFont: boolean`, `fileBlocks.collapse/pathStyle/foldGitWorktree`, `bashBlocks.collapse/smart/showStatus`.
- `settings.json` storage format MUST NOT change: JSON object under `"@philogag/pi-tui-fold-blocks"` key (see `config.ts` `PACKAGE_KEY`).
- All visible page text MUST be English (spec: 英文提示 requirement).
- Run from the monorepo root: `pnpm -F @philogag/pi-tui-fold-blocks <script>` (scripts: `build`, `typecheck`, `test`).
- Commits use conventional format: `feat(pi-tui-fold-blocks): ...`, `test(pi-tui-fold-blocks): ...`, `refactor(pi-tui-fold-blocks): ...`.
- Do NOT change `render.ts`, `overrides.ts`, `mode.ts`, `config.ts` logic. Only `settings.ts`, `index.ts`, tests, README.

---

## File Structure

- Modify: `packages/pi-tui-fold-blocks/src/settings.ts` — rewrite `openSettings`, delete `nextMode`
- Modify: `packages/pi-tui-fold-blocks/src/index.ts` — handler body (call-site only, unchanged signature)
- Modify: `packages/pi-tui-fold-blocks/test/command.test.ts` — remove `nextMode` tests, add settings mapping tests
- Create: `packages/pi-tui-fold-blocks/test/settings.test.ts` — pure helpers: boolean mapping, items builder
- Modify: `packages/pi-tui-fold-blocks/README.md` — config section

---

### Task 1: Extract pure mapping helpers into settings.ts

**Files:**
- Modify: `packages/pi-tui-fold-blocks/src/settings.ts`
- Create: `packages/pi-tui-fold-blocks/test/settings.test.ts`

**Interfaces:**
- Consumes: `FoldBlocksConfig` (from `./config.js`), `Mode` (from `./config.js`)
- Produces: `cfgToBool(value: string): boolean`, `boolToCfg(value: boolean): "on" | "off"`, `buildSettingItems(cfg: FoldBlocksConfig): SettingItem[]`, `applySettingChange(cfg: FoldBlocksConfig, id: string, newValue: string): FoldBlocksConfig`

- [x] **Step 1: Write failing test**

```ts
// test/settings.test.ts
import { describe, expect, it } from "vitest";
import type { FoldBlocksConfig } from "../src/config.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { applySettingChange, boolToCfg, buildSettingItems, cfgToBool } from "../src/settings.js";

describe("settings mapping helpers", () => {
  it("boolToCfg / cfgToBool round-trip", () => {
    expect(boolToCfg(true)).toBe("on");
    expect(boolToCfg(false)).toBe("off");
    expect(cfgToBool("on")).toBe(true);
    expect(cfgToBool("off")).toBe(false);
  });

  it("buildSettingItems maps config to SettingItem[]", () => {
    const items = buildSettingItems(DEFAULT_CONFIG);
    const mode = items.find((i) => i.id === "mode")!;
    const nerd = items.find((i) => i.id === "nerdFont")!;
    expect(mode.values).toEqual(["fold", "hide", "native"]);
    expect(mode.currentValue).toBe("fold");
    expect(nerd.values).toEqual(["on", "off"]);
    expect(nerd.currentValue).toBe("on");
  });

  it("applySettingChange updates booleans and enums", () => {
    const cfg: FoldBlocksConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    const next = applySettingChange(cfg, "nerdFont", "off");
    expect(next.nerdFont).toBe(false);
    const next2 = applySettingChange(cfg, "mode", "hide");
    expect(next2.mode).toBe("hide");
    const next3 = applySettingChange(cfg, "fileBlocks.pathStyle", "absolute");
    expect(next3.fileBlocks.pathStyle).toBe("absolute");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm -F @philogag/pi-tui-fold-blocks test -- settings.test.ts`
Expected: FAIL — `buildSettingItems is not a function` / module import error.

- [x] **Step 3: Implement helpers in settings.ts**

```ts
// packages/pi-tui-fold-blocks/src/settings.ts
import type { SettingItem } from "@earendil-works/pi-tui";
import { type FoldBlocksConfig, type Mode } from "./config.js";

export function boolToCfg(value: boolean): "on" | "off" {
  return value ? "on" : "off";
}

export function cfgToBool(value: string): boolean {
  return value === "on";
}

export function buildSettingItems(cfg: FoldBlocksConfig): SettingItem[] {
  return [
    { id: "mode", label: "Mode", currentValue: cfg.mode, values: ["fold", "hide", "native"] },
    { id: "nerdFont", label: "Nerd font icons", currentValue: boolToCfg(cfg.nerdFont), values: ["on", "off"] },
    { id: "fileBlocks.pathStyle", label: "Path style", currentValue: cfg.fileBlocks.pathStyle, values: ["relative", "absolute", "basename"] },
    { id: "fileBlocks.foldGitWorktree", label: "Fold git worktree", currentValue: boolToCfg(cfg.fileBlocks.foldGitWorktree), values: ["on", "off"] },
    { id: "bashBlocks.smart", label: "Bash smart detection", currentValue: boolToCfg(cfg.bashBlocks.smart), values: ["on", "off"] },
    { id: "bashBlocks.showStatus", label: "Show status hints", currentValue: boolToCfg(cfg.bashBlocks.showStatus), values: ["on", "off"] },
  ];
}

export function applySettingChange(cfg: FoldBlocksConfig, id: string, newValue: string): FoldBlocksConfig {
  const next: FoldBlocksConfig = {
    ...cfg,
    fileBlocks: { ...cfg.fileBlocks },
    bashBlocks: { ...cfg.bashBlocks },
  };
  switch (id) {
    case "mode":
      next.mode = newValue as Mode;
      break;
    case "nerdFont":
      next.nerdFont = cfgToBool(newValue);
      break;
    case "fileBlocks.pathStyle":
      next.fileBlocks.pathStyle = newValue as FoldBlocksConfig["fileBlocks"]["pathStyle"];
      break;
    case "fileBlocks.foldGitWorktree":
      next.fileBlocks.foldGitWorktree = cfgToBool(newValue);
      break;
    case "bashBlocks.smart":
      next.bashBlocks.smart = cfgToBool(newValue);
      break;
    case "bashBlocks.showStatus":
      next.bashBlocks.showStatus = cfgToBool(newValue);
      break;
  }
  return next;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm -F @philogag/pi-tui-fold-blocks test -- settings.test.ts`
Expected: PASS — 3 cases green.

- [x] **Step 5: Commit**

```bash
git add packages/pi-tui-fold-blocks/src/settings.ts packages/pi-tui-fold-blocks/test/settings.test.ts
git commit -m "test(pi-tui-fold-blocks): add settings mapping helpers"
```

---

### Task 2: Rewrite openSettings with SettingsList via ctx.ui.custom

**Files:**
- Modify: `packages/pi-tui-fold-blocks/src/settings.ts` (replace `openSettings` + delete `nextMode`)
- Modify: `packages/pi-tui-fold-blocks/test/command.test.ts` (remove nextMode tests)

**Interfaces:**
- Consumes: Task 1 helpers (`buildSettingItems`, `applySettingChange`); `ExtensionUIContext` (from `@earendil-works/pi-coding-agent`); `getSettingsListTheme` (from `@earendil-works/pi-coding-agent`); `SettingsList` (from `@earendil-works/pi-tui`); `ctx.ui.custom<T>` on the ui context.
- Produces: `openSettings(ui: ExtensionUIContext, config: FoldBlocksConfig, onSave: (cfg: FoldBlocksConfig) => void): Promise<void>` — same signature as today, so `index.ts` call site compiles unchanged.

- [x] **Step 1: Update command.test.ts to remove nextMode tests**

Replace the entire contents of `packages/pi-tui-fold-blocks/test/command.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { cfgToBool } from "../src/settings.js";

describe("settings bool helpers (replaces removed nextMode)", () => {
  it("maps on/off strings to booleans", () => {
    expect(cfgToBool("on")).toBe(true);
    expect(cfgToBool("off")).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails (nextMode still exported)**

Run: `pnpm -F @philogag/pi-tui-fold-blocks test`
Expected: FAIL — the old `nextMode` describe block still exists in `command.test.ts` (if the replacement was incomplete) OR import error. If all tests pass after Step 1 (because command.test.ts was fully replaced), proceed — the RED state for THIS task is that `src/settings.ts` still exports `nextMode`; confirm it is now unused: `grep -rn "nextMode" packages/pi-tui-fold-blocks/ --include="*.ts"` must return no matches after Step 3.

- [x] **Step 3: Rewrite openSettings and delete nextMode**

Replace the `nextMode` function and the entire `openSettings` function in `src/settings.ts` with:

```ts
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { SettingsList } from "@earendil-works/pi-tui";
import { type FoldBlocksConfig } from "./config.js";

export async function openSettings(
  ui: ExtensionUIContext,
  config: FoldBlocksConfig,
  onSave: (cfg: FoldBlocksConfig) => void,
): Promise<void> {
  let cfg = config;
  await ui.custom<void>((_tui, _theme, _kb, done) => {
    const items = buildSettingItems(cfg);
    const settingsList = new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      (id, newValue) => {
        cfg = applySettingChange(cfg, id, newValue);
        onSave(cfg);
      },
      () => done(undefined),
      { enableSearch: false },
    );
    return {
      render: (w: number) => settingsList.render(w),
      invalidate: () => settingsList.invalidate(),
      handleInput: (data: string) => settingsList.handleInput?.(data),
    };
  });
}
```

Note: the `SettingsList` `onChange` updates item values internally; the returned config object `cfg` is captured by the `onChange` closure so repeated toggles accumulate. The `onCancel` (`() => done(undefined)`) fires on ESC — no extra write (immediate save already happened per toggle).

- [x] **Step 4: Run full test suite**

Run: `pnpm -F @philogag/pi-tui-fold-blocks test`
Expected: PASS — all suites green (index, config, folders, mode, render, settings, command). `nextMode` no longer referenced anywhere.

- [x] **Step 5: Build + typecheck**

Run: `pnpm -F @philogag/pi-tui-fold-blocks build && pnpm -F @philogag/pi-tui-fold-blocks typecheck`
Expected: both exit 0.

- [x] **Step 6: Commit**

```bash
git add packages/pi-tui-fold-blocks/src/settings.ts packages/pi-tui-fold-blocks/test/command.test.ts
git commit -m "feat(pi-tui-fold-blocks): native SettingsList config page with space cycling"
```

---

### Task 3: Wire index.ts handler (call-site verification)

**Files:**
- Verify/possibly adjust: `packages/pi-tui-fold-blocks/src/index.ts`
- Verify: `packages/pi-tui-fold-blocks/test/index.test.ts`

**Interfaces:**
- Consumes: `openSettings(ui, config, onSave)` from Task 2 (signature unchanged from current code).
- Produces: no new exports — confirms the command handler still calls `openSettings(ctx.ui, config, onSave)` and the `onSave` closure still does `config = next; modeState.setMode(next.mode); saveConfig(config)`.

- [x] **Step 1: Verify call site unchanged**

Read `packages/pi-tui-fold-blocks/src/index.ts` lines ~24-34. The handler must still be:

```ts
pi.registerCommand("tui-fold-blocks", {
  description: "打开 tui-fold-blocks 配置页面",
  handler: async (args: string, ctx: ExtensionCommandContext) => {
    await openSettings(ctx.ui, config, (next) => {
      config = next;
      if (next.mode !== modeState.mode) modeState.setMode(next.mode);
      saveConfig(config);
    });
  },
});
```

No code change required IF the `openSettings` signature is unchanged (it is). If `ctx.ui` lacks `custom` in the typed `ExtensionCommandContext`, cast: `openSettings(ctx.ui as ExtensionUIContext, config, ...)` and add the import. Update the `description` to English: `"Open tui-fold-blocks settings page"` (spec: 英文提示).

- [x] **Step 2: Update English description**

If not already English, change the command description string in `index.ts` from `"打开 tui-fold-blocks 配置页面"` to `"Open tui-fold-blocks settings page"`.

- [x] **Step 3: Run full suite + build**

Run: `pnpm -F @philogag/pi-tui-fold-blocks test && pnpm -F @philogag/pi-tui-fold-blocks build && pnpm -F @philogag/pi-tui-fold-blocks typecheck`
Expected: all pass / exit 0.

- [x] **Step 4: Commit**

```bash
git add packages/pi-tui-fold-blocks/src/index.ts
git commit -m "refactor(pi-tui-fold-blocks): english command description for settings page"
```

---

### Task 4: Update README config section

**Files:**
- Modify: `packages/pi-tui-fold-blocks/README.md`

- [x] **Step 1: Update the config/usage section**

Locate the section describing the `/tui-fold-blocks` settings page (currently describes the multi-step Chinese menu). Replace with:

```markdown
## Settings

Run `/tui-fold-blocks` to open the settings page. The page follows pi's
native settings interaction:

- Single select list with all options (Mode, Nerd font icons, Path style,
  Fold git worktree, Bash smart detection, Show status hints).
- `↑`/`↓` to navigate, `Space` to cycle the selected option's value
  (booleans cycle `on`/`off`, enums cycle their choices).
- Changes are saved to `settings.json` immediately.
- `Esc` closes the page.
```

- [x] **Step 2: Verify + commit**

Run: `git diff --stat` (expect README.md only). Then:

```bash
git add packages/pi-tui-fold-blocks/README.md
git commit -m "docs(pi-tui-fold-blocks): document native settings page interaction"
```

---

### Task 5: Fix stale pre-existing tests (scope addition — user-approved)

**Context:** Base commit `958cba8` has 7 pre-existing test failures unrelated to this change: `test/render.test.ts` (6) imports `buildFoldLine`/`buildSingleLine`/`contentRows` which no longer exist (render API refactored to `buildReadBlockText`/`buildBashBlockText`/`buildEditBlockText`/`buildGrepBlockText`/`buildLsBlockText`/`buildBlockComponent`/`renderBlock`), and `test/index.test.ts` (1) asserts zero `registerTool` calls in non-TUI modes while `src/index.ts` now registers tools eagerly at factory top-level (only `registerCommand` is TUI-gated via `session_start` + `ctx.mode === "tui"`). User chose "Update stale tests".

**Files:**
- `packages/pi-tui-fold-blocks/test/render.test.ts` (rewrite against current API)
- `packages/pi-tui-fold-blocks/test/index.test.ts` (fix non-TUI expectation)

- [x] **Step 1: Rewrite `test/render.test.ts`** against the current exported API. Keep the valid `contentExitCode` tests (they pass today: `contentExitCode({ content: [{ type: "text", text: "boom\nexit code 2" }] }) === 2`). Add coverage for the current API using a minimal `ToolRenderContext` fixture (fields per `src/overrides.ts`: args/toolCallId/invalidate/lastComponent/state/cwd/executionStarted/argsComplete/isPartial/expanded/showImages/isError) and `RenderBlockOpts` (name/stage/args/result/cwd/config/theme — theme needs only `bg: (name) => (t) => t` identity for non-render tests):
  - `buildReadBlockText`: tool "read", `shown` contains folded path, `tips` contains `[ startLine - endLine ]` (offset 10 + limit 20 → `[ 10 - 29 ]`), `result` "" on call stage, "OK" on result stage, "FAILED" when `ctx.isError`.
  - `buildBashBlockText`: tool "exec", `shown` contains `foldCommand` output (e.g. command `"cd build && npm test"` → contains "npm test"), `result` "OK" on success / `FAILED(N)` when isError with exit code N.
  - `renderBlock`: mode `hide` → renders 0 rows (empty `Text`); mode `native` behavior is handled by overrides.ts, out of scope.
  Do NOT test internals (`buildLeft`/`buildRight`/`BgTruncatedText`/`BgPaddedBox` are private).

- [x] **Step 2: Fix `test/index.test.ts`** first test: in non-TUI modes (`print`/`json`/`rpc`) `registerTool` IS called (eager, 4 calls: read/bash/edit/write) but `registerCommand` is NOT called. Keep the TUI test (registerCommand contains "tui-fold-blocks") and idempotency test (registerTool stays 4 after repeated `session_start`).

- [x] **Step 3: Full suite green** — `pnpm -F @philogag/pi-tui-fold-blocks test` → all suites pass (settings 3, command 1, config 3, folders 8, mode 2, render ~6, index 3). Commit: `test(pi-tui-fold-blocks): fix stale render and index tests`.

### Task 6: Acceptance verification

**Files:**
- (none — verification only)

- [x] **Step 1: Full automated gate**

Run: `pnpm -F @philogag/pi-tui-fold-blocks test && pnpm -F @philogag/pi-tui-fold-blocks build && pnpm -F @philogag/pi-tui-fold-blocks typecheck`
Expected: tests PASS (all suites), build + typecheck exit 0.

- [x] **Step 2: grep for dead code + non-English UI strings**

Run: `grep -rn "nextMode" packages/pi-tui-fold-blocks/ --include="*.ts"` → no matches.
Run: `grep -rn "保存并退出\|显示模式\|tui-fold-blocks 设置" packages/pi-tui-fold-blocks/ --include="*.ts" --include="*.md"` → no matches (all English).

- [x] **Step 3: Manual smoke (TUI mode, if available)**

Launch pi with the extension loaded (TUI), run `/tui-fold-blocks`:
- All options visible in one list, English labels.
- Space cycles Mode fold→hide→native→fold; booleans on/off.
- `settings.json` updated immediately after each toggle.
- Esc closes the page.

If no interactive terminal is available, record this step as deferred with the automated coverage noted (unit tests cover mapping + onChange callback; SettingsList space behavior is library-tested upstream).

---

## Self-Review Notes

- **Spec coverage:** ADDED "原生 select 交互对齐" (single list, space-cycle enums, space-toggle booleans, immediate save, ESC close) → Tasks 1+2; ADDED "英文提示" → Task 2 labels + Task 3 description + Task 4 README; MODIFIED "配置存储与命令入口" (SettingsList wording) → Task 2. All covered.
- **Placeholder scan:** No TBD/TODO; every code step has full code.
- **Type consistency:** `openSettings(ui: ExtensionUIContext, config, onSave)` matches current `index.ts` call `openSettings(ctx.ui, config, ...)`; `ExtensionUIContext` includes `custom<T>` (verified in types.d.ts). `SettingItem` ids match `applySettingChange` switch cases exactly: `mode`, `nerdFont`, `fileBlocks.pathStyle`, `fileBlocks.foldGitWorktree`, `bashBlocks.smart`, `bashBlocks.showStatus`.
