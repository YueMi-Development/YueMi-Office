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
});
