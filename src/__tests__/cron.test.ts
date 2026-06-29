import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldCronFire } from '../cron';

describe('shouldCronFire', () => {
  it('returns true when lastPushedAt is undefined', () => {
    assert.equal(shouldCronFire('30 11 */2 * *', undefined), true);
  });

  it('returns false when no cron slot fired since lastPushedAt', () => {
    assert.equal(shouldCronFire('17 3 1 1 *', Date.now()), false);
  });

  it('detects a missed fire far outside the old 48h lookback window', () => {
    const lastPushedAt = Date.now() - 10 * 24 * 60 * 60 * 1000;
    assert.equal(shouldCronFire('30 8 */4 * *', lastPushedAt), true);
  });
});
