import { describe, expect, it } from 'vitest';

import ci from '../../../../.github/workflows/ci.yml?raw';
import release from '../../../../.github/workflows/release.yml?raw';
import eslintConfig from '../../../../eslint.config.mjs?raw';
import gitattributes from '../../../../.gitattributes?raw';
import prettierConfig from '../../../../.prettierrc.json?raw';
import prettierIgnore from '../../../../.prettierignore?raw';
import packageJson from '../../../../package.json?raw';
import prePush from '../../../../.husky/pre-push?raw';
import lintChanged from '../../../../scripts/lint-changed.ts?raw';
import lintFrontend from '../../../../.github/scripts/lint-frontend.sh?raw';
import lintRust from '../../../../.github/scripts/lint-rust.sh?raw';
import { brokenSteps, readJobs } from './workflowScan';

/**
 * The linters of the repository.
 *
 * The tree is written in two languages, and each of them has a linter
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
 *
 * The same linters run before a push, through the hook under `.husky`, so
 * a mistake is found while it is still in the working tree rather than
 * after the branch is on the server.
 */

/** The lint scripts, by the language they lint. */
const SCRIPTS: Record<string, string> = {
  frontend: lintFrontend,
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

  it('give the Rust lint the libraries it compiles against', () => {
    // The Rust lint compiles the whole crate, and the crate sits on top of
    // Tauri, which needs the glib and webkit development libraries to
    // build against. A lint job without them stops with a message about
    // a missing pkg-config file rather than about the code.
    const commands = lintSteps()
      .flatMap((step) => step.command)
      .join('\n');

    expect(commands).toContain('.github/scripts/install-linux-deps.sh');
    expect(commands).toContain('libwebkit2gtk-4.1-dev');
  });

  it('lint the two languages of the tree', () => {
    // Each script says which tool it runs, so a script that stops running
    // its linter is a failure with a message that says what is wrong.
    expect(lintFrontend).toContain('eslint');
    expect(lintFrontend).toContain('prettier');
    expect(lintRust).toContain('cargo clippy');
    expect(lintRust).toContain('cargo fmt');
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
    // the dependabot file and the workflows by GitHub. A formatter would
    // change the quoting of their strings, and the tests that read them
    // would then look for a shape that the file no longer has.
    //
    // The generated files are written by a script of their own, and the
    // script writes them in its own shape, so a formatter here would only
    // make the next run of the script change them again.
    expect(prettierIgnore).toContain('*.yml');
    expect(prettierIgnore).toContain('*.yaml');
    expect(prettierIgnore).toContain('packages/protocol/src/fixtures/');

    // The Rust side has its own formatter, and the visual baselines are
    // inside it.
    expect(prettierIgnore).toContain('apps/desktop/src-tauri/');
  });
});

describe('the hook that runs before a push', () => {
  it('is installed by the install', () => {
    // The hooks are installed by `bun install`, because that is the one
    // command every contributor runs after a clone. A hook that has to be
    // installed by hand is a hook that half the contributors do not have.
    const manifest = JSON.parse(packageJson) as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(manifest.scripts.prepare).toContain('husky');
    expect(manifest.devDependencies.husky).toBeDefined();
  });

  it('calls the same linters the workflow calls', () => {
    // One set of lint rules and not two. A hook that ran a lint of its own
    // would be a lint that drifts away from the one the CI runs, and the
    // two would disagree about what a clean tree is.
    //
    // The hook names the scripts through a variable, because it runs the
    // ones that were selected. The two scripts it can reach are the two
    // the workflow calls.
    expect(prePush).toContain('sh ".github/scripts/lint-$name.sh"');
  });

  it('runs the scripts with a shell that is always there', () => {
    // The hook runner uses the same shell everywhere, so a script that
    // needed a shell that is not always there would fail on the machine of
    // the person who pushes rather than on a runner. The scripts carry the
    // shell they need in their shebang.
    expect(prePush).not.toContain('bash .github/scripts');
    expect(prePush).toContain('sh ".github/scripts/lint-$name.sh"');
  });

  it('asks which linters the changes reach', () => {
    // A hook that ran both linters on every push would pay for a Rust
    // compile for a push that only touched prose.
    expect(prePush).toContain('scripts/lint-changed.ts');
  });

  it('runs every linter when it cannot tell what changed', () => {
    // Not being able to tell what changed is not a reason to skip the
    // lint. A hook that decided nothing changed would let a broken push
    // through, and it would do so silently.
    expect(prePush).toContain('selection="all"');
    expect(prePush).toContain('frontend rust');
  });

  it('refuses the push when a linter fails', () => {
    // The refusal is the point of the hook. It is written in the hook
    // rather than left to the exit code of the script, so that the reason
    // the push was stopped is on the screen of the person who pushed.
    expect(prePush).toContain('exit 1');
    expect(prePush).toMatch(/The push was refused/);
  });

  it('leaves the escape hatch to the runner', () => {
    // A push that is deliberate and does not need the lint is pushed with
    // HUSKY=0. The runner is what honours it, so the hook does not carry
    // the check itself: a hook that honoured it would let a mistake
    // through on the first push after the environment variable was set.
    expect(prePush).not.toContain('HUSKY=0');
  });

  it('does not carry the shim that the next version of the runner drops', () => {
    // The runner warns that the two lines the older examples show fail in
    // the next version. A hook that carries them stops working when the
    // runner is updated, and it stops working silently.
    expect(prePush).not.toContain('_/husky.sh');
  });

  it('keeps the hooks on one line ending', () => {
    // The hook has no extension, so the rule that keeps the shell scripts
    // on one line ending does not reach it. A hook with a carriage return
    // at the end of its lines fails on the first line.
    expect(gitattributes).toContain('.husky/* text eol=lf');
  });

  it('is not installed on a runner', () => {
    // The hooks are for the machine of the person who pushes. A runner has
    // no push to guard, and pointing it at a directory of hooks that
    // nothing runs would only make the build depend on them.
    for (const workflow of [ci, release]) {
      expect(workflow).toContain('HUSKY: "0"');
    }
  });
});

describe('the script that says what changed', () => {
  it('asks git for the three parts of the changed set', () => {
    // The commits that are not on the upstream, the changes that are not
    // committed, and the files that are new. A file that has never been
    // committed has to count, or a new file would never be linted before
    // its first push.
    expect(lintChanged).toContain("'diff', '--name-only'");
    expect(lintChanged).toContain("'ls-files', '--others', '--exclude-standard'");
  });

  it('measures against the upstream of the branch', () => {
    // The upstream is where this branch was published, and the merge base
    // is where the two lines parted.
    expect(lintChanged).toContain("'rev-parse', '--abbrev-ref', '@{u}'");
    expect(lintChanged).toContain("'merge-base', 'HEAD'");
  });

  it('says everything when it cannot measure anything', () => {
    // Not being able to tell what changed is not a reason to skip the
    // lint. The safe reading is that everything changed.
    expect(lintChanged).toMatch(/write\('all/);
  });
});
