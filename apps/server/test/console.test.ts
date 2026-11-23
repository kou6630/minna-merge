import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeInterruptGuard } from '../src/console.ts';

test('Ctrl+C は1回目は警告だけ、3秒以内の2回目で止める', () => {
  let t = 1000;
  const guard = makeInterruptGuard(3000, () => t);
  assert.equal(guard(), 'warn');
  t += 5000;
  assert.equal(guard(), 'warn', '時間がたってからの1回目は、また警告');
  t += 1500;
  assert.equal(guard(), 'stop');
});
