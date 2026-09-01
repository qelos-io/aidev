import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Resolves a skill file under `.agents/skills/` using the first matching path:
 * 1. `<skillName>/SKILL.md`
 * 2. `<skillName>.md`
 * 3. `<skillName>` (plain file, no extension)
 */
export function resolveSkillContent(skillName: string, cwd?: string): string | null {
  const base = path.join(cwd ?? process.cwd(), '.agents', 'skills');
  const candidates = [
    path.join(base, skillName, 'SKILL.md'),
    path.join(base, `${skillName}.md`),
    path.join(base, skillName),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8').trim();
    }
  }

  return null;
}
