import { describe, expect, it } from 'vitest';

import ci from '../../../../.github/workflows/ci.yml?raw';

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
 */

/** One step of a job. */
interface Step {
  /** The step's name, when it has one. */
  name: string;
  /** The shell the step asks for, when it asks for one. */
  shell: string | null;
  /** The condition the step is under, when it has one. */
  condition: string | null;
  /** The lines of the command the step runs. */
  command: string[];
  /** The line the step starts on, counted from one. */
  line: number;
}

/** A job of the workflow. */
interface Job {
  /** The job's name in the file. */
  name: string;
  /** The runners the job can run on. */
  runsOn: string;
  /** The steps of the job. */
  steps: Step[];
}

/** The indentation a job's name is written at. */
const JOB_INDENT = 2;

/** The indentation a step starts at. */
const STEP_INDENT = 6;

/** The indentation a step's own attributes are written at. */
const ATTRIBUTE_INDENT = 8;

/** How many spaces a line is indented by. */
function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** The job a line belongs to, by its name. */
function jobNameAt(line: string): string | null {
  if (indentOf(line) !== JOB_INDENT) {
    return null;
  }

  const match = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
  return match ? match[1] : null;
}

/**
 * Reads the jobs of the workflow.
 *
 * The file is read as text rather than parsed, because neither toolchain
 * here has a YAML parser and the workflow is read the same way by the
 * other test that looks at it.
 */
function readJobs(source: string): Job[] {
  const lines = source.split('\n');
  const jobs: Job[] = [];

  let current: Job | null = null;
  let step: Step | null = null;
  let inCommand = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const number = index + 1;

    // A command runs until a line that is not indented as part of it.
    if (inCommand) {
      if (line.trim() === '' || indentOf(line) > ATTRIBUTE_INDENT) {
        step?.command.push(line);
        continue;
      }

      inCommand = false;
    }

    const name = jobNameAt(line);
    if (name) {
      current = { name, runsOn: '', steps: [] };
      jobs.push(current);
      step = null;
      continue;
    }

    if (!current) {
      continue;
    }

    const runner = /^ {4}runs-on:\s*(.+)$/.exec(line);
    if (runner) {
      current.runsOn = runner[1].trim();
      continue;
    }

    // A step starts with a dash and either a name or the action it uses.
    if (indentOf(line) === STEP_INDENT && /^ {6}-\s/.test(line)) {
      step = {
        name: '',
        shell: null,
        condition: null,
        command: [],
        line: number,
      };
      current.steps.push(step);

      // The first attribute is written on the same line as the dash.
      const inline = /^ {6}-\s+([A-Za-z-]+):\s*(.*)$/.exec(line);
      if (inline) {
        const [, key, value] = inline;
        if (key === 'name') {
          step.name = value.trim();
        } else if (key === 'shell') {
          step.shell = value.trim();
        } else if (key === 'if') {
          step.condition = value.trim();
        }
      }

      continue;
    }

    if (!step || indentOf(line) !== ATTRIBUTE_INDENT) {
      continue;
    }

    const attribute = /^ {8}([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (!attribute) {
      continue;
    }

    const [, key, value] = attribute;

    if (key === 'name') {
      step.name = value.trim();
    } else if (key === 'shell') {
      step.shell = value.trim();
    } else if (key === 'if') {
      step.condition = value.trim();
    } else if (key === 'run') {
      if (value.trim() === '|' || value.trim() === '>') {
        inCommand = true;
      } else {
        step.command.push(value);
      }
    }
  }

  return jobs;
}

/** Whether a job can run on a Windows runner. */
function runsOnWindows(job: Job): boolean {
  // A runner named in the file is known. A matrix is not, so a job that
  // uses one is treated as able to run anywhere, because the platform is
  // decided by the matrix rather than by the file.
  if (job.runsOn.includes('windows')) {
    return true;
  }

  return job.runsOn.includes('matrix');
}

/** Whether a step is under a condition that keeps it off Windows. */
function isKeptOffWindows(step: Step): boolean {
  if (!step.condition) {
    return false;
  }

  return (
    step.condition.includes("runner.os == 'Linux'") ||
    step.condition.includes('runner.os == "Linux"') ||
    step.condition.includes("runner.os == 'macOS'") ||
    step.condition.includes('runner.os == "macOS"')
  );
}

/** Whether a step asks for a shell that reads a backslash as a continuation. */
function asksForBash(step: Step): boolean {
  if (!step.shell) {
    return false;
  }

  const shell = step.shell.toLowerCase();
  return shell === 'bash' || shell === 'sh';
}

/** Whether a command is spread over several lines with backslashes. */
function usesContinuation(command: string[]): boolean {
  return command.some((line) => line.trimEnd().endsWith('\\'));
}

/** The steps that would break on a Windows runner. */
function brokenSteps(jobs: Job[]): string[] {
  const broken: string[] = [];

  for (const job of jobs) {
    if (!runsOnWindows(job)) {
      continue;
    }

    for (const step of job.steps) {
      if (!usesContinuation(step.command)) {
        continue;
      }

      if (asksForBash(step) || isKeptOffWindows(step)) {
        continue;
      }

      broken.push(
        `${job.name} / ${step.name || 'a step'} (line ${step.line}): ` +
          'a command spread over several lines needs a shell that reads a ' +
          'backslash as a continuation, so the step has to say `shell: bash`',
      );
    }
  }

  return broken;
}

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
});
