import { describe, expect, it } from 'vitest';

import ci from '../../../../.github/workflows/ci.yml?raw';
import { brokenSteps, readJobs } from './workflowScan';

/**
 * The workflow file.
 *
 * A runner on Windows runs a step in PowerShell by default, and PowerShell
 * does not read a trailing backslash as a line continuation. A command that
 * is spread over several lines with backslashes therefore works on Linux
 * and macOS and fails to parse on Windows, and it fails with a message
 * about an operator rather than about the shell, which makes it hard to
 * read.
 *
 * The visual check was broken that way for a whole run: the pages were
 * rendered, the comparison never ran, and the job failed with a parser
 * error rather than with a difference. Nothing in the test suite noticed,
 * because the workflow file itself was not looked at.
 *
 * So the rule is checked here: a step that can run on Windows may only use
 * a backslash continuation when it says which shell it wants.
 *
 * The rule itself lives in `workflowScan.ts`, because the release workflow
 * is checked against it too.
 */

describe('the workflow', () => {
  it('is read as jobs', () => {
    const jobs = readJobs(ci);

    expect(jobs.map((job) => job.name)).toContain('visual');
  });

  it('is read as jobs when the file has Windows line endings', () => {
    // A regular expression does not match a carriage return with a dot,
    // so a workflow read from a file with Windows line endings used to
    // look like a file with no jobs in it. Every rule checked against it
    // then passed, because there was nothing to check.
    //
    // The repository is checked out with Windows line endings on Windows,
    // so this is the shape the file actually has there.
    const jobs = readJobs(ci.replace(/\r?\n/g, '\r\n'));

    expect(jobs.map((job) => job.name)).toContain('visual');
    expect(jobs.find((job) => job.name === 'visual')?.runsOn).not.toBe('');
  });

  it('has a step that would break on a Windows runner', () => {
    // The rule is only worth having if it can fail, so the scanner is
    // shown a workflow with the mistake in it.
    const broken = brokenSteps(
      readJobs(
        [
          '  visual:',
          '    runs-on: windows-latest',
          '    steps:',
          '      - name: Compare',
          '        run: |',
          '          python compare.py \\',
          '            --tolerance 0.002',
        ].join('\n'),
      ),
    );

    expect(broken).toHaveLength(1);
    expect(broken[0]).toContain('shell: bash');
  });

  it('accepts a step that says which shell it wants', () => {
    const broken = brokenSteps(
      readJobs(
        [
          '  visual:',
          '    runs-on: windows-latest',
          '    steps:',
          '      - name: Compare',
          '        shell: bash',
          '        run: |',
          '          python compare.py \\',
          '            --tolerance 0.002',
        ].join('\n'),
      ),
    );

    expect(broken).toEqual([]);
  });

  it('has no step that breaks on a Windows runner', () => {
    expect(brokenSteps(readJobs(ci))).toEqual([]);
  });

  it('catches a step that runs a shell script without saying so', () => {
    // The scripts under `.github/scripts` are shell scripts, and a runner
    // on Windows runs a step in PowerShell by default. The rule is only
    // worth having if it can fail, so the scanner is shown a workflow with
    // the mistake in it.
    const broken = brokenSteps(
      readJobs(
        [
          '  visual:',
          '    runs-on: windows-latest',
          '    steps:',
          '      - name: Compare',
          '        run: .github/scripts/visual-check.sh',
        ].join('\n'),
      ),
    );

    expect(broken).toHaveLength(1);
    expect(broken[0]).toContain('shell: bash');
  });

  it('accepts a step that runs a shell script and says so', () => {
    const broken = brokenSteps(
      readJobs(
        [
          '  visual:',
          '    runs-on: windows-latest',
          '    steps:',
          '      - name: Compare',
          '        shell: bash',
          '        run: .github/scripts/visual-check.sh',
        ].join('\n'),
      ),
    );

    expect(broken).toEqual([]);
  });

  it('asks for bash where the visual check runs', () => {
    // The step that failed is named here so that removing the shell from
    // it is a failure with a message that says what is wrong.
    const visual = readJobs(ci).find((job) => job.name === 'visual');
    const compare = visual?.steps.find(
      (step) => step.name === 'Compare the pages with the baselines',
    );

    expect(compare).toBeDefined();
    expect(compare?.shell).toBe('bash');
  });

  it('uses the current line of the build action', () => {
    // The v0 line of the action is the old one. It still builds, but it
    // is no longer the line the documentation points at.
    expect(ci).toContain('tauri-apps/tauri-action@v1');
    expect(ci).not.toContain('tauri-action@v0');
  });

  it('checks that every place that carries the version agrees', () => {
    // The version of a build is decided by its tag, and the workflow
    // writes that version into the tree. A tree whose declarations
    // disagree would build an installer that says one version and a
    // package that says another, so the ordinary CI is where that is
    // caught rather than the release.
    expect(ci).toContain('version:report');
  });

  it('catches a step that writes an expression into its command', () => {
    // An expression in a command is put into the text of the command
    // before the shell reads it, so the value is quoted by whatever the
    // shell thinks it is looking at. A path with backslashes in it loses
    // them there, and the script never sees the path that was meant.
    //
    // The visual check on a Windows runner was broken that way for a whole
    // run, and the failure said nothing about the path.
    const broken = brokenSteps(
      readJobs(
        [
          '  visual:',
          '    runs-on: windows-latest',
          '    steps:',
          '      - name: Point the loader',
          '        shell: bash',
          '        run: .github/scripts/visual-check.sh ${{ matrix.target }}',
        ].join('\n'),
      ),
    );

    expect(broken).toHaveLength(1);
    expect(broken[0]).toContain('environment');
  });

  it('catches an expression in a command on a job that cannot run on Windows', () => {
    // The mangling of the value is not something Windows does and the
    // other systems do not. Every shell reads the command first.
    const broken = brokenSteps(
      readJobs(
        [
          '  lint:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - name: Lint',
          '        run: .github/scripts/lint-rust.sh ${{ matrix.target }}',
        ].join('\n'),
      ),
    );

    expect(broken).toHaveLength(1);
    expect(broken[0]).toContain('environment');
  });

  it('accepts a step that gets its value from the environment', () => {
    const broken = brokenSteps(
      readJobs(
        [
          '  visual:',
          '    runs-on: windows-latest',
          '    steps:',
          '      - name: Point the loader',
          '        shell: bash',
          '        env:',
          '          TARGET: ${{ matrix.target }}',
          '        run: .github/scripts/visual-check.sh',
        ].join('\n'),
      ),
    );

    expect(broken).toEqual([]);
  });

  it('gives the visual check a shell that can run the script', () => {
    // The script under `.github/scripts` is a shell script, and a runner
    // on Windows runs a step in PowerShell by default. The step is named
    // here so that removing the shell from it is a failure with a message
    // that says what is wrong.
    const visual = readJobs(ci).find((job) => job.name === 'visual');
    const compare = visual?.steps.find(
      (step) => step.name === 'Compare the pages with the baselines',
    );

    expect(compare).toBeDefined();
    expect(compare?.command.join(' ')).not.toContain('${{');
  });

  it('gives the lint job the libraries its Rust compile needs', () => {
    // The Rust lint compiles the whole crate, and the crate sits on top of
    // Tauri, which needs the glib and webkit development libraries to
    // build against. Without them the compile stops with a message about
    // a missing pkg-config file rather than about the code.
    const lint = readJobs(ci).find((job) => job.name === 'lint');
    const commands = (lint?.steps ?? []).flatMap((step) => step.command).join('\n');

    expect(commands).toContain('.github/scripts/install-linux-deps.sh');
    expect(commands).toContain('libwebkit2gtk-4.1-dev');
  });

  it('asks for bash where the lint job runs a script', () => {
    // The scripts under `.github/scripts` are shell scripts, and a runner
    // on Windows runs a step in PowerShell by default. The lint job runs
    // on Linux today, but the rule is kept here so that the job can be
    // moved onto a matrix of platforms without the rule being forgotten.
    const lint = readJobs(ci).find((job) => job.name === 'lint');

    expect(lint).toBeDefined();

    const steps = lint?.steps ?? [];

    expect(steps.length).toBeGreaterThan(0);

    for (const step of steps) {
      if (step.command.some((line) => line.includes('.github/scripts/'))) {
        expect(step.shell).toBe('bash');
      }
    }
  });
});
