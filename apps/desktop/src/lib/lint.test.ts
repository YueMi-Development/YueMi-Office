import { describe, expect, it } from 'vitest';

import ci from '../../../../.github/workflows/ci.yml?raw';
import dockerfile from '../../../../apps/api/Dockerfile?raw';
import eslintConfig from '../../../../eslint.config.mjs?raw';
import prettierConfig from '../../../../.prettierrc.json?raw';
import prettierIgnore from '../../../../.prettierignore?raw';
import packageJson from '../../../../package.json?raw';
import lintBackend from '../../../../.github/scripts/lint-backend.sh?raw';
import lintFrontend from '../../../../.github/scripts/lint-frontend.sh?raw';
import lintRust from '../../../../.github/scripts/lint-rust.sh?raw';
import { brokenSteps, readJobs } from './workflowScan';

/**
 * The linters of the repository.
 *
 * The tree is written in three languages, and each of them has a linter
 * that comes with its own toolchain. Nothing here is checked for its
 * formatting only: a rule that is switched off is a rule that is read
 * once and then ignored, and the test below says which rules are off and
 * why.
 *
 * The lint runs in the CI, and it runs there and not only on a
 * workstation, because a lint that only runs on the machine of the person
 * who wrote the code is a lint that is skipped on the day it matters.
 *
 * So the rule is checked here: every script under `.github/scripts` is
 * called by the workflow, and the workflow asks for a shell that can run a
 * shell script.
 */

/** The lint scripts, by the language they lint. */
const SCRIPTS: Record<string, string> = {
  frontend: lintFrontend,
  backend: lintBackend,
  rust: lintRust,
};

/** The steps of the lint job of the workflow. */
function lintSteps(): { name: string; shell: string | null; command: string[] }[] {
  const job = readJobs(ci).find((entry) => entry.name === 'lint');

  return job?.steps ?? [];
}

/**
 * The rules the ESLint configuration switches off.
 *
 * Each of them is returned with the comment that is written above it, so
 * that the test can ask whether the reason is there.
 */
function switchedOffRules(): { name: string; reason: string; group: string }[] {
  const lines = eslintConfig.split(/\r?\n/);
  const rules: { name: string; reason: string; group: string }[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /'(@typescript-eslint\/[^']+)':\s*'off'/.exec(lines[index]);

    if (!match) {
      continue;
    }

    // The rules that are switched off together share one reason, which is
    // written above the first of them.
    const previous = rules[rules.length - 1];
    const continues = previous !== undefined && previous.group === groupOf(match[1]);

    if (continues) {
      rules.push({ name: match[1], reason: previous.reason, group: previous.group });
      continue;
    }

    // The reason is written in the comment above the rule.
    const comment: string[] = [];

    for (let back = index - 1; back >= 0; back -= 1) {
      const line = lines[back].trim();

      if (line === '') {
        continue;
      }

      if (!line.startsWith('//')) {
        break;
      }

      comment.unshift(line);
    }

    rules.push({
      name: match[1],
      reason: comment.join(' '),
      group: groupOf(match[1]),
    });
  }

  return rules;
}

/**
 * The group a rule belongs to.
 *
 * The rules that are switched off for the same reason are written next to
 * each other, and the group is the reason itself, so that one comment
 * covers all of them.
 */
function groupOf(name: string): string {
  if (name.startsWith('@typescript-eslint/no-unsafe-')) {
    return 'no-unsafe';
  }

  return name;
}

describe('the linters', () => {
  it('have a job in the workflow', () => {
    // A lint that is not in the workflow runs on the machine of the person
    // who wrote the code and nowhere else.
    const jobs = readJobs(ci).map((job) => job.name);

    expect(jobs).toContain('lint');
  });

  it('are called by the workflow, one script each', () => {
    // The workflow says which script to run and nothing else. A script
    // that the workflow does not call is a script that never runs.
    const commands = lintSteps()
      .flatMap((step) => step.command)
      .join('\n');

    for (const script of Object.keys(SCRIPTS)) {
      expect(commands).toContain(`.github/scripts/lint-${script}.sh`);
    }
  });

  it('ask for the shell that can run a shell script', () => {
    // A runner on Windows runs a step in PowerShell by default, and
    // PowerShell cannot run a shell script. The lint job runs on Linux,
    // but the rule is kept here so that the job can be moved to a matrix
    // without the rule being forgotten.
    for (const step of lintSteps()) {
      if (step.command.some((line) => line.includes('.github/scripts/'))) {
        expect(step.shell).toBe('bash');
      }
    }
  });

  it('have no step that breaks on a Windows runner', () => {
    expect(brokenSteps(readJobs(ci))).toEqual([]);
  });

  it('lint the three languages of the tree', () => {
    // Each script says which tool it runs, so a script that stops running
    // its linter is a failure with a message that says what is wrong.
    expect(lintFrontend).toContain('eslint');
    expect(lintFrontend).toContain('prettier');
    expect(lintRust).toContain('cargo clippy');
    expect(lintRust).toContain('cargo fmt');
  });

  it('lint the render service inside the image it ships in', () => {
    // The service is deployed as that image, so a lint that ran against
    // another Python would report a different set of mistakes than the
    // one that ships. The image has a target for it, and the target runs
    // the linter of the service.
    expect(lintBackend).toContain('--target lint');
    expect(dockerfile).toContain('FROM base AS lint');
    expect(dockerfile).toContain('ruff check');
    expect(dockerfile).toContain('ruff format --check');
  });

  it('keep the warnings of the Rust linter as errors', () => {
    // A linter whose findings can be ignored is a linter that is read
    // once and then ignored.
    expect(lintRust).toContain('-D warnings');
  });

  it('have their rules in the tree, next to the code they apply to', () => {
    // The rules of a language live in that language's own configuration,
    // so the tree of each part carries its own rules.
    expect(eslintConfig).toContain('tseslint.config');
    expect(prettierConfig).toContain('printWidth');
  });

  it('keep the React rules on', () => {
    // The tree already carries `eslint-disable-next-line
    // react-hooks/exhaustive-deps` comments. A linter that does not know
    // that rule name would leave the directives behind as dead text, and
    // the rules themselves catch defects the type checker cannot: a ref
    // that is read while the component renders, a state that is set from
    // an effect.
    expect(eslintConfig).toContain('reactHooks');
    expect(eslintConfig).toContain('jsxA11y');
  });

  it('switch off only the rules that the tree cannot follow', () => {
    // Every rule that is off is off for a reason that is written down
    // next to it. A rule that is off without a reason is a rule that was
    // silenced rather than fixed.
    const rules = switchedOffRules();

    expect(rules.length).toBeGreaterThan(0);

    for (const rule of rules) {
      expect(rule.reason).not.toBe('');
      expect(rule.reason).toMatch(/\/\//);
    }
  });

  it('are run by the scripts at the root', () => {
    // The commands are the same on a workstation and in the CI, so the
    // lint that runs locally is the lint that runs there.
    const scripts = JSON.parse(packageJson).scripts as Record<string, string>;

    expect(scripts.lint).toContain('lint:eslint');
    expect(scripts.lint).toContain('lint:prettier');
    expect(scripts['lint:eslint']).toContain('eslint');
    expect(scripts['lint:prettier']).toContain('prettier --check');
    expect(scripts.format).toContain('prettier --write');
  });

  it('leave the prose alone', () => {
    // The prose is written to be read, and the way it is wrapped is part
    // of how it reads. A formatter would reflow the PRD and the
    // documentation, and the result would say nothing that the text did
    // not already say.
    expect(prettierIgnore).toContain('*.md');
    expect(prettierIgnore).toContain('docs/');
  });

  it('leave the files another program reads alone', () => {
    // The YAML files are read by another program rather than by a person:
    // the compose file by Docker, the dependabot file by GitHub. A
    // formatter would change the quoting of their strings, and the tests
    // that read them would then look for a shape that the file no longer
    // has.
    //
    // The generated files are written by a script of the service, and the
    // script writes them in its own shape, so a formatter here would only
    // make the next run of the script change them again.
    expect(prettierIgnore).toContain('*.yml');
    expect(prettierIgnore).toContain('*.yaml');
    expect(prettierIgnore).toContain('packages/protocol/src/fixtures/');
    expect(prettierIgnore).toContain('apps/api/tests/visual/baseline/');
  });
});
