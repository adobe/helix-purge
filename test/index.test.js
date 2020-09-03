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
const index = require('../src/index.js').main;

/* eslint-disable no-underscore-dangle, camelcase */
const __ow_logger = logging.createTestLogger();

describe('Index Tests', () => {
  it('index function is present', async () => {
    const scope = nock(/./)
      .get('/OK.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK');

    const result = await index({
      __ow_logger,
    });
    assert.deepEqual(result, {
      body: [],
      statusCode: 204,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    scope.done();
  });

  it('index function rejects purges when helix pages behaves funny', async () => {
    const scope = nock(/./)
      .get('/OK.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'Not OK');

    const result = await index({
      __ow_logger,
    });
    assert.deepEqual(result, {
      statusCode: 503,
      body: 'Refusing to purge while Helix Pages responses are inconsistent. Check status.project-helix.io for details.',
    });

    scope.done();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('index function purges outer cdn', async () => {
    const scope = nock(/./)
      .get('/OK.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK')
      .intercept(/\/index.*/, 'PURGE')
      .reply(200)
      .persist();

    const result = await index({
      __ow_logger,
      xfh: 'blog.adobe.com',
      path: '/index.html',
    });

    scope.done();
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, [
      { status: 'ok', url: 'https://blog.adobe.com/index.html' },
    ]);
  }).timeout(5000);

  it('index function also purges outer cdn without html extension', async () => {
    const purgedUrls = [];
    const spyLogger = Object.assign(
      __ow_logger,
      {
        info: (msg, url) => {
          purgedUrls.push(url);
        },
      },
    );
    const scope = nock(/./)
      .get('/OK.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK')
      .intercept(/\/en\/topics\/news.*/, 'PURGE')
      .twice()
      .reply(200);

    const result = await index({
      __ow_logger: spyLogger,
      xfh: 'blog.adobe.com',
      path: '/en/topics/news.html',
    });

    scope.done();
    assert.equal(result.statusCode, 200);
    assert.deepEqual(purgedUrls, [
      'https://blog.adobe.com/en/topics/news.html',
      'https://blog.adobe.com/en/topics/news',
    ]);
  }).timeout(5000);

  it('index function also purges outer cdn with html extension if missing', async () => {
    const purgedUrls = [];
    const spyLogger = Object.assign(
      __ow_logger,
      {
        info: (msg, url) => {
          purgedUrls.push(url);
        },
      },
    );
    const scope = nock(/./)
      .get('/OK.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK')
      .intercept(/\/en\/topics\/creativity.*/, 'PURGE')
      .twice()
      .reply(200);

    const result = await index({
      __ow_logger: spyLogger,
      xfh: 'blog.adobe.com',
      path: '/en/topics/creativity',
    });

    scope.done();
    assert.equal(result.statusCode, 200);
    assert.deepEqual(purgedUrls, [
      'https://blog.adobe.com/en/topics/creativity',
      'https://blog.adobe.com/en/topics/creativity.html',
    ]);
  }).timeout(5000);

  it('index function purges outer cdn with partial failure', async () => {
    const scope = nock(/./)
      .get('/OK.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK')
      .intercept('/index.html', 'PURGE')
      .reply(200)
      .intercept('/index', 'PURGE')
      .reply(200)
      .intercept('/index.html', 'PURGE')
      .reply(504);

    const result = await index({
      __ow_logger,
      xfh: 'blog.adobe.com, theblog--adobe.hlx.page',
      path: '/index.html',
    });

    scope.done();
    assert.equal(result.statusCode, 207);
    assert.deepEqual(result.body, [
      { status: 'ok', url: 'https://blog.adobe.com/index.html' },
      { status: 'error', url: 'https://theblog--adobe.hlx.page/index.html' },
    ]);
  }).timeout(5000);

  it('index function purges outer cdn and inner cdn', async () => {
    const scope = nock(/./)
      .get('/OK.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK')
      .intercept(/\/index.*/, 'PURGE')
      .reply(200)
      .persist()
      .post('/service/test-service/purge')
      .reply((_, body) => {
        assert.deepEqual(body, {
          surrogate_keys: [
            '3XuSp2sTopNwWfAN',
          ],
        });
        return [200, { '3XuSp2sTopNwWfAN': '19940-1591821325-42118515' }];
      });

    const result = await index({
      __ow_logger,
      xfh: 'blog.adobe.com, theblog--adobe.hlx.page',
      path: '/index.html',
      host: 'theblog--adobe.hlx.page',
      HLX_PAGES_FASTLY_SVC_ID: 'test-service',
      HLX_PAGES_FASTLY_TOKEN: 'dummy',
    });

    scope.done();
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, [
      { status: 'ok', url: 'https://theblog--adobe.hlx.page/index.html' },
      { status: 'ok', url: 'https://blog.adobe.com/index.html' },
    ]);
  }).timeout(5000);

  it('index function purges outer cdn and inner cdn (which fails)', async () => {
    const scope = nock(/./)
      .get('/OK.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK')
      .intercept(/\/index.*/, 'PURGE')
      .reply(200)
      .persist()
      .post('/service/test-service/purge')
      .reply((_, body) => {
        assert.deepEqual(body, {
          surrogate_keys: [
            '3XuSp2sTopNwWfAN',
          ],
        });
        return [504, { '3XuSp2sTopNwWfAN': '19940-1591821325-42118515' }];
      });

    const result = await index({
      __ow_logger,
      xfh: 'blog.adobe.com, theblog--adobe.hlx.page',
      path: '/index.html',
      host: 'theblog--adobe.hlx.page',
      HLX_PAGES_FASTLY_SVC_ID: 'test-service',
      HLX_PAGES_FASTLY_TOKEN: 'dummy',
    });

    scope.done();
    assert.equal(result.statusCode, 207);
    assert.deepEqual(result.body, [
      { status: 'error', url: 'https://theblog--adobe.hlx.page/index.html' },
      { status: 'ok', url: 'https://blog.adobe.com/index.html' },
    ]);
  }).timeout(5000);
});
