import fs from 'fs';
import * as diff from 'diff';

export interface DiffResult {
  diff: string;
  exitCode: number;
}

export function generateUnifiedDiff(
  oldPath: string,
  newPath: string,
): DiffResult {
  const oldIsDevNull = oldPath === '/dev/null' || oldPath === 'NUL';
  const newIsDevNull = newPath === '/dev/null' || newPath === 'NUL';

  const oldContent = oldIsDevNull ? '' : fs.readFileSync(oldPath, 'utf-8');
  const newContent = newIsDevNull ? '' : fs.readFileSync(newPath, 'utf-8');

  const oldLabel = oldIsDevNull ? '/dev/null' : oldPath;
  const newLabel = newIsDevNull ? '/dev/null' : newPath;

  const patch = diff.createTwoFilesPatch(
    oldLabel,
    newLabel,
    oldContent,
    newContent,
    '',
    '',
    { context: 3 },
  );

  const hasChanges = oldContent !== newContent;

  return {
    diff: patch,
    exitCode: hasChanges ? 1 : 0,
  };
}
