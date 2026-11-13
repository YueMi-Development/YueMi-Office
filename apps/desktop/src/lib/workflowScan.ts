/**
 * Reading a workflow file, and the rules a workflow has to follow.
 *
 * A runner on Windows runs a step in PowerShell by default, and
 * PowerShell does not read a trailing backslash as a line continuation.
 * A command that is spread over several lines with backslashes
 * therefore works on Linux and macOS and fails to parse on Windows, and
 * it fails with a message about an operator rather than about the
 * shell, which makes it hard to read.
 *
 * The visual check was broken that way for a whole run: the pages were
 * rendered, the comparison never ran, and the job failed with a parser
 * error rather than with a difference. Nothing in the test suite
 * noticed, because the workflow file itself was not looked at.
 *
 * So the rule is checked here: a step that can run on Windows may only
 * use a backslash continuation when it says which shell it wants.
 *
 * The file is read as text rather than parsed, because neither
 * toolchain here has a YAML parser and the workflow is read the same way
 * by every test that looks at it.
 */

/** One step of a job. */
export interface Step {
  /** The step's name, when it has one. */
  name: string;
  /** The shell the step asks for, when it asks for one. */
  shell: string | null;
  /** The condition the step is under, when it has one. */
  condition: string | null;
  /** The lines of the command the step runs. */
  command: string[];
  /** The inputs the step gives to the action it uses. */
  with: Record<string, string>;
  /** The action the step runs, when it runs one. */
  uses: string | null;
  /** The line the step starts on, counted from one. */
  line: number;
}

/** A job of the workflow. */
export interface Job {
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
 */
export function readJobs(source: string): Job[] {
  const lines = source.split('\n');
  const jobs: Job[] = [];

  let current: Job | null = null;
  let step: Step | null = null;
  let inCommand = false;
  let inWith = false;

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
        with: {},
        uses: null,
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
        } else if (key === 'uses') {
          step.uses = value.trim();
        }
      }

      continue;
    }

    // The inputs of an action are written under a `with:` key, one per
    // line, further indented than the step's own attributes.
    if (inWith && step) {
      if (indentOf(line) === ATTRIBUTE_INDENT + 2) {
        const input = /^ {10}([A-Za-z-]+):\s*(.*)$/.exec(line);
        if (input) {
          step.with[input[1]] = input[2].trim();
        }
        continue;
      }

      inWith = false;
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
    } else if (key === 'uses') {
      step.uses = value.trim();
    } else if (key === 'run') {
      if (value.trim() === '|' || value.trim() === '>') {
        inCommand = true;
      } else {
        step.command.push(value);
      }
    } else if (key === 'with') {
      inWith = true;
    }
  }

  return jobs;
}

/** Whether a job can run on a Windows runner. */
export function runsOnWindows(job: Job): boolean {
  // A runner named in the file is known. A matrix is not, so a job that
  // uses one is treated as able to run anywhere, because the platform is
  // decided by the matrix rather than by the file.
  if (job.runsOn.includes('windows')) {
    return true;
  }

  return job.runsOn.includes('matrix');
}

/** Whether a step is under a condition that keeps it off Windows. */
export function isKeptOffWindows(step: Step): boolean {
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
export function asksForBash(step: Step): boolean {
  if (!step.shell) {
    return false;
  }

  const shell = step.shell.toLowerCase();
  return shell === 'bash' || shell === 'sh';
}

/** Whether a command is spread over several lines with backslashes. */
export function usesContinuation(command: string[]): boolean {
  return command.some((line) => line.trimEnd().endsWith('\\'));
}

/** The steps that would break on a Windows runner. */
export function brokenSteps(jobs: Job[]): string[] {
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
