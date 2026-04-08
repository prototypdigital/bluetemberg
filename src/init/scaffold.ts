import { readFileSync, existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir } from '../utils/fs.js';
import { DEFAULT_TARGETS } from '../sync/transform.js';
import type { InitAnswers, BlueprintConfig, Platform, TargetConfig, SkillTargetConfig } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

export function scaffold(targetDir: string, answers: InitAnswers): string[] {
  const created: string[] = [];

  scaffoldConfig(targetDir, answers, created);
  scaffoldRules(targetDir, answers, created);

  if (answers.includeAgents) {
    scaffoldAgents(targetDir, answers, created);
  }

  if (answers.includeSkills) {
    scaffoldSkills(targetDir, answers, created);
  }

  scaffoldRootDocs(targetDir, answers, created);

  if (answers.includeMcp) {
    scaffoldMcp(targetDir, answers, created);
  }

  updatePackageScripts(targetDir);

  return created;
}

function safeWrite(filePath: string, content: string, created: string[]): void {
  ensureDir(dirname(filePath));
  writeFileSync(filePath, content);
  created.push(filePath);
}

function scaffoldConfig(targetDir: string, answers: InitAnswers, created: string[]): void {
  const targets: BlueprintConfig['targets'] = {};

  if (answers.rules.length > 0) {
    targets.rules = {};
    for (const p of answers.platforms) {
      const t = DEFAULT_TARGETS.rules[p];
      if (t) (targets.rules as Record<Platform, TargetConfig>)[p] = t;
    }
  }

  if (answers.includeAgents && answers.agents.length > 0) {
    targets.agents = {};
    for (const p of answers.platforms) {
      const t = DEFAULT_TARGETS.agents[p];
      if (t) (targets.agents as Record<Platform, TargetConfig>)[p] = t;
    }
  }

  if (answers.includeSkills && answers.skills.length > 0) {
    targets.skills = {};
    for (const p of answers.platforms) {
      const t = DEFAULT_TARGETS.skills[p];
      if (t) (targets.skills as Record<Platform, SkillTargetConfig>)[p] = t;
    }
  }

  const config: BlueprintConfig = {
    platforms: answers.platforms,
    source: 'llm',
    targets,
  };

  safeWrite(join(targetDir, 'blueprint.config.json'), JSON.stringify(config, null, 2) + '\n', created);
}

function scaffoldRules(targetDir: string, answers: InitAnswers, created: string[]): void {
  const destDir = join(targetDir, 'llm', 'rules');
  ensureDir(destDir);

  for (const ruleId of answers.rules) {
    const src = join(TEMPLATES_DIR, 'rules', `${ruleId}.md`);
    if (!existsSync(src)) continue;

    const dest = join(destDir, `${ruleId}.md`);
    copyFileSync(src, dest);
    created.push(dest);
  }
}

function scaffoldAgents(targetDir: string, answers: InitAnswers, created: string[]): void {
  const destDir = join(targetDir, 'llm', 'agents');
  ensureDir(destDir);

  for (const agentId of answers.agents) {
    const src = join(TEMPLATES_DIR, 'agents', `${agentId}.md`);
    if (!existsSync(src)) continue;

    const dest = join(destDir, `${agentId}.md`);
    copyFileSync(src, dest);
    created.push(dest);
  }
}

function scaffoldSkills(targetDir: string, answers: InitAnswers, created: string[]): void {
  for (const skillId of answers.skills) {
    const src = join(TEMPLATES_DIR, 'skills', skillId, 'SKILL.md');
    if (!existsSync(src)) continue;

    const destDir = join(targetDir, 'llm', 'skills', skillId);
    ensureDir(destDir);
    const dest = join(destDir, 'SKILL.md');
    copyFileSync(src, dest);
    created.push(dest);
  }
}

function scaffoldRootDocs(targetDir: string, answers: InitAnswers, created: string[]): void {
  const pm = answers.packageManager === 'npm' ? 'npm run' : answers.packageManager;
  const desc = answers.projectDescription || `${answers.projectName} project.`;

  const agentsLines: string[] = [
    `# ${answers.projectName}`,
    '',
    desc,
    '',
    '## Commands',
    '',
    '```bash',
    `${pm} dev          # Start dev server`,
    `${pm} build        # Production build`,
    `${pm} lint:fix     # ESLint auto-fix`,
    `${pm} sync:llm-config   # Sync rules -> all AI tool directories`,
    '```',
    '',
    '## AI Config Architecture',
    '',
    'Source of truth for all AI tool configuration lives in `llm/`:',
    '',
    '- `llm/rules/` — scoped rules (frontmatter: `description`, `scope`)',
  ];

  if (answers.includeAgents) {
    agentsLines.push('- `llm/agents/` — specialist agent definitions');
  }
  if (answers.includeSkills) {
    agentsLines.push('- `llm/skills/` — on-demand skill workflows');
  }

  const targetDirs: string[] = [];
  if (answers.platforms.includes('cursor')) targetDirs.push('`.cursor/rules/`');
  if (answers.platforms.includes('claude')) targetDirs.push('`.claude/rules/`');
  if (answers.platforms.includes('copilot')) targetDirs.push('`.github/instructions/`');

  agentsLines.push(
    '',
    `Run \`${pm} sync:llm-config\` to generate tool-specific files in ${targetDirs.join(', ')}. These generated files should not be edited directly.`,
    '',
    '## Boundaries',
    '',
    '### Always',
    '',
    '- Run lint after editing code files',
    '- Follow existing patterns and conventions',
    '',
    '### Ask First',
    '',
    '- Adding new dependencies',
    '- Changing database schema or migrations',
    '',
    '### Never',
    '',
    '- Edit generated files (types, schemas)',
    '- Commit `.env` or secrets',
    '',
  );

  safeWrite(join(targetDir, 'AGENTS.md'), agentsLines.join('\n'), created);

  if (answers.platforms.includes('claude')) {
    const syncCmd = `${pm} sync:llm-config`;
    const editDirs = ['`llm/rules/`'];
    if (answers.includeAgents) editDirs.push('`llm/agents/`');
    if (answers.includeSkills) editDirs.push('`llm/skills/`');

    const claudeLines: string[] = [
      '@AGENTS.md',
      '',
      '## Claude-Specific',
      '',
      'Rules, agents, and skills are synced from vendor-neutral source directories.',
      `After creating or editing files in ${editDirs.join(', ')}, run:`,
      '',
      '```bash',
      syncCmd,
      '```',
      '',
    ];

    safeWrite(join(targetDir, 'CLAUDE.md'), claudeLines.join('\n'), created);
  }
}

interface McpServerConfig {
  command?: string;
  args?: string[];
  type: string;
  url?: string;
}

const MCP_SERVER_REGISTRY: Record<string, McpServerConfig> = {
  interactive: {
    command: 'npx',
    args: ['-y', '@rawwee/interactive-mcp', '-t', '1200', '--disable-tools', 'message_complete_notification'],
    type: 'stdio',
  },
  context7: {
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    type: 'stdio',
  },
  figma: {
    type: 'http',
    url: 'https://mcp.figma.com/mcp',
  },
  github: {
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
  },
};

function scaffoldMcp(targetDir: string, answers: InitAnswers, created: string[]): void {
  const servers = answers.mcpServers;
  if (servers.length === 0) return;

  const serverConfigs: Record<string, McpServerConfig> = {};
  for (const id of servers) {
    if (MCP_SERVER_REGISTRY[id]) serverConfigs[id] = MCP_SERVER_REGISTRY[id];
  }

  if (answers.platforms.includes('claude')) {
    const config = { mcpServers: serverConfigs };
    safeWrite(join(targetDir, '.claude', 'mcp.json'), JSON.stringify(config, null, 2) + '\n', created);
  }

  if (answers.platforms.includes('copilot')) {
    const config = { servers: serverConfigs };
    safeWrite(join(targetDir, '.github', 'mcp.json'), JSON.stringify(config, null, 2) + '\n', created);
  }
}

function updatePackageScripts(targetDir: string): void {
  const pkgPath = join(targetDir, 'package.json');
  if (!existsSync(pkgPath)) return;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.scripts = pkg.scripts || {};
  pkg.scripts['sync:llm-config'] = 'npx blueprint sync';
  pkg.scripts['sync:llm-config:check'] = 'npx blueprint sync --check';
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}
