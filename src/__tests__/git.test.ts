import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../git';

describe('slugify', () => {
  it('lowercases input', () => {
    assert.equal(slugify('FIX LOGIN BUG'), 'fix-login-bug');
  });

  it('replaces spaces with dashes', () => {
    assert.equal(slugify('fix login bug'), 'fix-login-bug');
  });

  it('removes special characters', () => {
    assert.equal(slugify('feat: add @user support!'), 'feat-add-user-support');
  });

  it('collapses multiple separators into one dash', () => {
    assert.equal(slugify('hello---world'), 'hello-world');
  });

  it('strips leading and trailing dashes', () => {
    assert.equal(slugify('---hello---'), 'hello');
  });

  it('truncates to 50 characters', () => {
    assert.equal(slugify('a'.repeat(100)).length, 50);
  });

  it('handles empty string', () => {
    assert.equal(slugify(''), '');
  });

  it('handles string with only special chars', () => {
    assert.equal(slugify('!!!'), '');
  });
});
