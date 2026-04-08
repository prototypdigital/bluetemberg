import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sync, loadConfig } from "../src/sync/index.js";
import type { BlueprintConfig } from "../src/types.js";

function createTmpDir(): string {
  const dir = join(
    tmpdir(),
    `blueprint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("sync", () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("syncs rules to all platforms", () => {
    mkdirSync(join(root, "llm", "rules"), { recursive: true });
    writeFileSync(
      join(root, "llm", "rules", "test-rule.md"),
      '---\ndescription: A test rule\nscope: "**"\n---\n\n# Test Rule\n\nContent here.\n',
    );

    const config: BlueprintConfig = {
      platforms: ["cursor", "claude", "copilot"],
      source: "llm",
      targets: {
        rules: {
          cursor: { dir: ".cursor/rules", ext: ".mdc" },
          claude: { dir: ".claude/rules", ext: ".md" },
          copilot: { dir: ".github/instructions", ext: ".instructions.md" },
        },
      },
    };

    const results = sync(root, { config, silent: true });

    expect(results.synced).toBe(3);
    expect(existsSync(join(root, ".cursor", "rules", "test-rule.mdc"))).toBe(
      true,
    );
    expect(existsSync(join(root, ".claude", "rules", "test-rule.md"))).toBe(
      true,
    );
    expect(
      existsSync(
        join(root, ".github", "instructions", "test-rule.instructions.md"),
      ),
    ).toBe(true);

    const cursorContent = readFileSync(
      join(root, ".cursor", "rules", "test-rule.mdc"),
      "utf8",
    );
    expect(cursorContent).toContain("alwaysApply: true");

    const claudeContent = readFileSync(
      join(root, ".claude", "rules", "test-rule.md"),
      "utf8",
    );
    expect(claudeContent).toContain("paths:\n  - '**'");

    const copilotContent = readFileSync(
      join(root, ".github", "instructions", "test-rule.instructions.md"),
      "utf8",
    );
    expect(copilotContent).toContain("applyTo: '**'");
  });

  it("syncs scoped rules correctly", () => {
    mkdirSync(join(root, "llm", "rules"), { recursive: true });
    writeFileSync(
      join(root, "llm", "rules", "scoped.md"),
      '---\ndescription: Scoped rule\nscope: "src/**"\n---\n\n# Scoped\n',
    );

    const config: BlueprintConfig = {
      platforms: ["cursor"],
      source: "llm",
      targets: {
        rules: { cursor: { dir: ".cursor/rules", ext: ".mdc" } },
      },
    };

    sync(root, { config, silent: true });

    const content = readFileSync(
      join(root, ".cursor", "rules", "scoped.mdc"),
      "utf8",
    );
    expect(content).toContain("globs:");
    expect(content).toContain("src/**");
    expect(content).not.toContain("alwaysApply");
  });

  it("syncs agents verbatim", () => {
    mkdirSync(join(root, "llm", "agents"), { recursive: true });
    const agentContent =
      "---\nname: test-agent\ndescription: Test\n---\n\n# Test Agent\n";
    writeFileSync(join(root, "llm", "agents", "test-agent.md"), agentContent);

    const config: BlueprintConfig = {
      platforms: ["claude", "copilot"],
      source: "llm",
      targets: {
        agents: {
          claude: { dir: ".claude/agents", ext: ".md" },
          copilot: { dir: ".github/agents", ext: ".agent.md" },
        },
      },
    };

    sync(root, { config, silent: true });

    expect(
      readFileSync(join(root, ".claude", "agents", "test-agent.md"), "utf8"),
    ).toBe(agentContent);
    expect(
      readFileSync(
        join(root, ".github", "agents", "test-agent.agent.md"),
        "utf8",
      ),
    ).toBe(agentContent);
  });

  it("syncs skills verbatim", () => {
    mkdirSync(join(root, "llm", "skills", "test-skill"), { recursive: true });
    const skillContent = "---\nname: test-skill\n---\n\n# Test\n";
    writeFileSync(
      join(root, "llm", "skills", "test-skill", "SKILL.md"),
      skillContent,
    );

    const config: BlueprintConfig = {
      platforms: ["claude"],
      source: "llm",
      targets: {
        skills: { claude: { dir: ".claude/skills" } },
      },
    };

    sync(root, { config, silent: true });

    expect(
      readFileSync(
        join(root, ".claude", "skills", "test-skill", "SKILL.md"),
        "utf8",
      ),
    ).toBe(skillContent);
  });

  it("check mode reports out-of-sync files", () => {
    mkdirSync(join(root, "llm", "rules"), { recursive: true });
    writeFileSync(
      join(root, "llm", "rules", "check-test.md"),
      '---\ndescription: Check\nscope: "**"\n---\n\n# Check\n',
    );

    const config: BlueprintConfig = {
      platforms: ["cursor"],
      source: "llm",
      targets: {
        rules: { cursor: { dir: ".cursor/rules", ext: ".mdc" } },
      },
    };

    const results = sync(root, { check: true, config, silent: true });
    expect(results.outOfSync).toBe(1);
  });

  it("check mode reports in-sync after full sync", () => {
    mkdirSync(join(root, "llm", "rules"), { recursive: true });
    writeFileSync(
      join(root, "llm", "rules", "synced.md"),
      '---\ndescription: Synced\nscope: "**"\n---\n\n# Synced\n',
    );

    const config: BlueprintConfig = {
      platforms: ["cursor"],
      source: "llm",
      targets: {
        rules: { cursor: { dir: ".cursor/rules", ext: ".mdc" } },
      },
    };

    sync(root, { config, silent: true });
    const results = sync(root, { check: true, config, silent: true });
    expect(results.outOfSync).toBe(0);
  });

  it("syncs AGENTS.md to copilot instructions", () => {
    writeFileSync(join(root, "AGENTS.md"), "# My Project\n\nProject docs.\n");

    const config: BlueprintConfig = {
      platforms: ["copilot"],
      source: "llm",
      targets: {},
    };

    sync(root, { config, silent: true });

    const copilotInstructions = readFileSync(
      join(root, ".github", "copilot-instructions.md"),
      "utf8",
    );
    expect(copilotInstructions).toBe("# My Project\n\nProject docs.\n");
  });
});

describe("loadConfig", () => {
  let root: string;

  beforeEach(() => {
    root = createTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", () => {
    const config = loadConfig(root);
    expect(config.platforms).toEqual(["cursor", "claude", "copilot"]);
    expect(config.source).toBe("llm");
  });

  it("reads blueprint.config.json when present", () => {
    const custom = { platforms: ["cursor"], source: "ai", targets: {} };
    writeFileSync(join(root, "blueprint.config.json"), JSON.stringify(custom));

    const config = loadConfig(root);
    expect(config.platforms).toEqual(["cursor"]);
    expect(config.source).toBe("ai");
  });
});
