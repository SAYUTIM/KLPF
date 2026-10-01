

/**
 * @file 制御可能な非同期処理で優先順位キューの実行順と失敗後の継続を検証する。
 * Chrome APIや実際のKu-Port通信には依存しない。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPriorityQueue } from '../background/modules/priority-queue.js';

test('requests arriving while busy run by priority, with FIFO ties', async () => {
    let release;
    const busy = new Promise(resolve => { release = resolve; });
    const queue = createPriorityQueue(() => busy);
    const order = [];
    const jobs = [3, 2, 1, 2].map((priority, index) =>
        queue(priority, async () => { order.push(index); }));
    release();
    await Promise.all(jobs);
    assert.deepEqual(order, [2, 1, 3, 0]);
});

test('running work finishes before a higher priority request; errors do not block the queue', async () => {
    let release;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const order = [];
    const queue = createPriorityQueue(async () => {});
    const first = queue(3, async () => { started(); await gate; order.push('first'); });
    await ready;
    const second = queue(1, async () => { order.push('second'); throw new Error('expected'); });
    const failure = assert.rejects(second, /expected/);
    const third = queue(2, async () => { order.push('third'); });
    release();
    await Promise.all([first, failure, third]);
    assert.deepEqual(order, ['first', 'second', 'third']);
});
