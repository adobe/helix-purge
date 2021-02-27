/*
 * Copyright 2020 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */

process.env.HELIX_FETCH_FORCE_HTTP1 = 'true';
const nock = require('nock');
const assert = require('assert');
const { logging } = require('@adobe/helix-testutils');
const { main } = require('../src/index.js');
const { retrofit } = require('./utils.js');

const index = retrofit(main);

/* eslint-disable no-underscore-dangle, camelcase */
const __ow_logger = logging.createTestLogger();

describe('Index Tests', () => {
  it('index function is present', async () => {
    const scope = nock(/./)
      .get('/OK.plain.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK');

    const result = await index({
      __ow_logger,
    });
    assert.deepStrictEqual(result, {
      body: [],
      statusCode: 204,
      headers: {
        'content-type': 'application/json',
      },
    });

    scope.done();
  }).timeout(10000);

  it('index function rejects purges when helix pages behaves funny', async () => {
    const scope = nock(/./)
      .get('/OK.plain.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'Not OK');

    const result = await index({
      __ow_logger,
    });
    assert.deepStrictEqual(result, {
      statusCode: 503,
      headers: {
        'content-type': 'application/json',
      },
      body: {
        status: 'error',
        message: 'Refusing to purge while Helix Pages responses are inconsistent. Check status.project-helix.io for details.',
      },
    });

    scope.done();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('index function purges outer cdn', async () => {
    const scope = nock(/./)
      .get('/OK.plain.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK')
      .intercept(/.*/, 'PURGE')
      .reply(200)
      .persist();

    const result = await index({
      __ow_logger,
      xfh: 'blog.adobe.com',
      path: '/index.html',
    });

    scope.done();
    assert.strictEqual(result.statusCode, 200);
    assert.deepStrictEqual(result.body, [
      { status: 'ok', url: 'https://blog.adobe.com/index.html' },
      { status: 'ok', url: 'https://blog.adobe.com/' },
      { status: 'ok', url: 'https://blog.adobe.com/index' },
    ]);
  }).timeout(5000);

  it('index function also purges outer cdn without html extension', async () => {
    const scope = nock(/./)
      .get('/OK.plain.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK')
      .intercept(/\/en\/topics\/news.*/, 'PURGE')
      .twice()
      .reply(200);

    const result = await index({
      __ow_logger,
      xfh: 'blog.adobe.com',
      path: '/en/topics/news.html',
    });

    scope.done();
    assert.strictEqual(result.statusCode, 200);
    assert.deepStrictEqual(result.body, [
      { status: 'ok', url: 'https://blog.adobe.com/en/topics/news.html' },
      { status: 'ok', url: 'https://blog.adobe.com/en/topics/news' },
    ]);
  }).timeout(5000);

  it('index function also purges outer cdn with html extension if extension is missing', async () => {
    const scope = nock(/./)
      .get('/OK.plain.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK')
      .intercept(/\/en\/topics\/creativity.*/, 'PURGE')
      .twice()
      .reply(200);

    const result = await index({
      __ow_logger,
      xfh: 'blog.adobe.com',
      path: '/en/topics/creativity',
    });

    scope.done();
    assert.strictEqual(result.statusCode, 200);
    assert.deepStrictEqual(result.body, [
      { status: 'ok', url: 'https://blog.adobe.com/en/topics/creativity' },
      { status: 'ok', url: 'https://blog.adobe.com/en/topics/creativity.html' },
    ]);
  }).timeout(5000);

  it('index function does not purge outer cdn without extension if non-html', async () => {
    const scope = nock(/./)
      .get('/OK.plain.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK')
      .intercept('/feed.xml', 'PURGE')
      .once()
      .reply(200);

    const result = await index({
      __ow_logger,
      xfh: 'blog.adobe.com',
      path: '/feed.xml',
    });

    scope.done();
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.length, 1);
  }).timeout(5000);

  it('index function purges outer cdn with partial failure', async () => {
    const stopScope = nock('https://main--helix-purge--adobe.hlx.page')
      .get(/.*/)
      .twice()
      .reply(200, 'OK');
    const outerScope = nock('https://blog.adobe.com')
      .intercept(/.*/, 'PURGE')
      .reply(200)
      .persist();
    const innerScope = nock('https://theblog--adobe.hlx.page')
      .intercept(/.*/, 'PURGE')
      .reply(504);

    const result = await index({
      __ow_logger,
      xfh: 'blog.adobe.com, theblog--adobe.hlx.page',
      path: '/index.html',
    });

    stopScope.done();
    outerScope.done();
    innerScope.done();
    assert.strictEqual(result.statusCode, 207);
    assert.deepStrictEqual(result.body, [
      { status: 'ok', url: 'https://blog.adobe.com/index.html' },
      { status: 'ok', url: 'https://blog.adobe.com/' },
      { status: 'ok', url: 'https://blog.adobe.com/index' },
      { status: 'error', url: 'https://theblog--adobe.hlx.page/index.html' },
    ]);
  }).timeout(5000);

  it('index function purges outer cdn and inner cdn', async () => {
    const scope = nock(/./)
      .get('/OK.plain.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK')
      .intercept(/.*/, 'PURGE')
      .reply(200)
      .persist()
      .post('/service/test-service/purge/3XuSp2sTopNwWfAN')
      .reply(() => [200, { '3XuSp2sTopNwWfAN': '19940-1591821325-42118515' }]);

    const result = await index({
      __ow_logger,
      xfh: 'blog.adobe.com, theblog--adobe.hlx.page',
      path: '/index.html',
      host: 'theblog--adobe.hlx.page',
    }, {
      HLX_PAGES_FASTLY_SVC_ID: 'test-service',
      HLX_PAGES_FASTLY_TOKEN: 'dummy',
    });

    scope.done();
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(
      result.body.filter((r) => r.status === 'ok' && r.url.includes('blog.adobe.com')).length,
      3, '3 URLs successfully purged on blog.adobe.com',
    );
    assert.strictEqual(
      result.body.filter((r) => r.status === 'ok' && r.url.includes('theblog--adobe.hlx.page')).length,
      4, '4 URLs successfully purged on theblog--adobe.hlx.page',
    );
  }).timeout(5000);

  it('index function purges outer cdn and inner cdn (which fails)', async () => {
    const scope = nock(/./)
      .get('/OK.plain.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK')
      .intercept(/.*/, 'PURGE')
      .reply(200)
      .persist()
      .post('/service/test-service/purge/3XuSp2sTopNwWfAN')
      .reply(() => [504, { '3XuSp2sTopNwWfAN': '19940-1591821325-42118515' }]);

    const result = await index({
      __ow_logger,
      xfh: 'blog.adobe.com, theblog--adobe.hlx.page',
      path: '/index.html',
      host: 'theblog--adobe.hlx.page',
    }, {
      HLX_PAGES_FASTLY_SVC_ID: 'test-service',
      HLX_PAGES_FASTLY_TOKEN: 'dummy',
    });

    scope.done();
    assert.strictEqual(result.statusCode, 207);
    assert.strictEqual(result.body.length, 7);
    assert.strictEqual(
      result.body.filter((r) => r.status === 'ok').length,
      6, '6 URLs successfully purged',
    );
    assert.ok(
      result.body.some((r) => r.status === 'error' && r.url.includes('theblog--adobe.hlx.page')),
      '1 URL failed to be purged on theblog--adobe.hlx.page',
    );
  }).timeout(5000);

  it('index function sanitizes x-forwarded-host before purging outer cdn', async () => {
    const scope = nock(/./)
      .get('/OK.plain.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK')
      .intercept(/.*/, 'PURGE')
      .reply(200)
      .persist()
      .post('/service/test-service/purge/3XuSp2sTopNwWfAN')
      .reply(() => [200, { '3XuSp2sTopNwWfAN': '19940-1591821325-42118515' }]);

    const result = await index({
      __ow_logger,
      xfh: 'blog.adobe.com, theblog--adobe.hlx.live, theblog--adobe.hlx.live, , theblog--adobe.hlx.page',
      path: '/index.html',
      host: 'theblog--adobe.hlx.page',
    }, {
      HLX_PAGES_FASTLY_SVC_ID: 'test-service',
      HLX_PAGES_FASTLY_TOKEN: 'dummy',
    });

    scope.done();
    assert.strictEqual(result.statusCode, 200);
    assert.strictEqual(result.body.length, 10, '10 URLS purged');
  }).timeout(5000);
});
