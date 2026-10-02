import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatPrice} from '../src/format.js';
test('integer cents rendered in CNY',()=>assert.equal(formatPrice(9900),'¥99.00'));