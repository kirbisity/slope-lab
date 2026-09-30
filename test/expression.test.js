import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileEquation, describeEquationError } from '../src/expression.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('evaluates every sample equation from the original game', () => {
  close(compileEquation('y=2')(7), 2);
  close(compileEquation('y=-0.5x')(4), -2);
  close(compileEquation('y=-0.3x-2')(10), -5);
  close(compileEquation('y=0.1x^2')(3), 0.9);
  close(compileEquation('y=0.05*(x+5)^2')(5), 5);
  close(compileEquation('y=sin(0.5x)-0.2x')(2), Math.sin(1) - 0.4);
  close(compileEquation('y=-3*log(0.1x+0.1)+0.4x-6')(9), -3 * Math.log(1) + 3.6 - 6);
});

test('follows paper precedence', () => {
  close(compileEquation('-x^2')(3), -9);
  close(compileEquation('2^3^2')(0), 512);
  close(compileEquation('1-2-3')(0), -4);
  close(compileEquation('8/4/2')(0), 1);
});

test('understands implicit multiplication and unicode', () => {
  close(compileEquation('y = 2x')(3), 6);
  close(compileEquation('3(x+1)')(1), 6);
  close(compileEquation('2sin(x)')(Math.PI / 2), 2);
  close(compileEquation('x(x-1)')(3), 6);
  close(compileEquation('y = 0.5x²')(2), 2);
  close(compileEquation('y = −πx')(1), -Math.PI);
  close(compileEquation('sqrt x')(9), 3);
  close(compileEquation('2pix')(1), 2 * Math.PI);
});

test('reports errors with a readable message', () => {
  assert.match(describeEquationError('y = 2 +'), /ends too early/);
  assert.match(describeEquationError('y = foo(x)'), /Unknown name/);
  assert.match(describeEquationError('y = (x'), /Expected/);
  assert.match(describeEquationError('z = x'), /left side/);
  assert.match(describeEquationError('y = 3 $ x'), /not something/);
  assert.equal(describeEquationError('y = x'), '');
});
