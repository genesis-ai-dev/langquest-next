import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GROUPS } from './commands.mjs';

/**
 * `npm run help` (scripts/commands.mjs) says what every root script is for,
 * by group, and package.json lists them in that order, so the file reads as
 * the groups do. A script added to one and not the other fails here.
 */

const inPackage = Object.keys(JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>);
const described = GROUPS.flatMap((g) => Object.keys(g.scripts));

describe('npm scripts', () => {
  it('every script has a line in scripts/commands.mjs', () => {
    expect(inPackage.filter((name) => !described.includes(name)), 'add a line for it to a group in scripts/commands.mjs').toEqual([]);
  });

  it('every line in scripts/commands.mjs is a script', () => {
    expect(described.filter((name) => !inPackage.includes(name)), 'remove it from scripts/commands.mjs, or add the script').toEqual([]);
  });

  it('package.json lists them in the order of the groups', () => {
    expect(inPackage, 'move the script in package.json to where its group puts it').toEqual(described);
  });

  it('every line says something', () => {
    for (const g of GROUPS) for (const [name, line] of Object.entries(g.scripts)) expect(line.trim(), name).not.toBe('');
  });
});
