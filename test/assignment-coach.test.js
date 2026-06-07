const test = require('node:test');
const assert = require('node:assert/strict');

const { _test } = require('../lib/assignment-coach');

test('configured course URLs are validated and deduplicated', () => {
  assert.deepEqual(_test.parseConfiguredCourseUrls(`
    https://school.example/d2l/home/123,
    javascript:alert(1),
    https://school.example/d2l/home/123#content
    https://school.example/d2l/home/456
  `), [
    'https://school.example/d2l/home/123',
    'https://school.example/d2l/home/456',
  ]);
});

test('extracts common Brightspace due dates', () => {
  assert.match(_test.extractDueDate('Due date: June 15, 2026 at 11:59 PM'), /^2026-06-1[56]T/);
  assert.match(_test.extractDueDate('Due: 2026-06-15 23:59'), /^2026-06-1[56]T/);
});

test('detects submitted assignment statuses', () => {
  assert.equal(_test.looksSubmitted('Submission complete'), true);
  assert.equal(_test.looksSubmitted('No submission yet'), false);
});

test('recognizes an expired saved Brightspace session', () => {
  assert.match(_test.loginPageReason({
    url: 'https://school.example/login',
    title: 'Sign In',
    bodyText: 'Enter your credentials',
    hasPassword: true,
  }), /saved session expired/i);
  assert.equal(_test.loginPageReason({
    url: 'https://school.example/d2l/home/123',
    title: 'Course Home',
    bodyText: 'Assignments and announcements',
  }), '');
});
