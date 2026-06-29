import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, shouldCronFire } from '../cron';

describe('parseCron', () => {
  it('parses step expressions like */2 and */4', () => {
    const everyOtherDay = parseCron('30 11 */2 * *');
    assert.ok(everyOtherDay.dayOfMonth.has(1));
    assert.ok(everyOtherDay.dayOfMonth.has(3));
    assert.ok(!everyOtherDay.dayOfMonth.has(2));

    const everyFourthDay = parseCron('30 8 */4 * *');
    assert.ok(everyFourthDay.dayOfMonth.has(1));
    assert.ok(everyFourthDay.dayOfMonth.has(5));
    assert.ok(!everyFourthDay.dayOfMonth.has(2));
  });
});

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

  it('detects a missed every-other-day fire after weeks without aidev run', () => {
    const lastPushedAt = Date.now() - 21 * 24 * 60 * 60 * 1000;
    assert.equal(shouldCronFire('30 11 */2 * *', lastPushedAt), true);
  });

  it('does not re-fire when lastPushedAt is after the most recent cron slot', () => {
    const now = new Date();
    now.setSeconds(0, 0);
    const lastPushedAt = now.getTime();
    assert.equal(shouldCronFire('30 11 */2 * *', lastPushedAt), false);
  });
});
