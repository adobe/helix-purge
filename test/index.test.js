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
  afterEach(() => {
    nock.cleanAll();
  });

  it('index function is present', async () => {
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
  }).timeout(10000);

  it('index function purges outer cdn', async () => {
    const scope = nock(/./)
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

  [
    {
      xfh: 'blog.adobe.com, master--theblog--adobe.hlx.page',
      host: 'master--theblog--adobe.hlx.page',
      path: '/',
      spec: '/ also purges /index and /index.html and /index.md',
      purgeUrls: [
        'https://master--theblog--adobe.hlx.page/index.md',
        'https://blog.adobe.com/',
        'https://blog.adobe.com/index',
        'https://blog.adobe.com/index.html',
        'https://master--theblog--adobe.hlx.page/',
        'https://master--theblog--adobe.hlx.page/index',
        'https://master--theblog--adobe.hlx.page/index.html',
      ],
    },
    {
      xfh: 'blog.adobe.com, master--theblog--adobe.hlx.page',
      host: 'master--theblog--adobe.hlx.page',
      path: '/index.html',
      spec: '/index.html also purges / and /index and /index.md',
      purgeUrls: [
        'https://master--theblog--adobe.hlx.page/index.md',
        'https://blog.adobe.com/index.html',
        'https://blog.adobe.com/',
        'https://blog.adobe.com/index',
        'https://master--theblog--adobe.hlx.page/index.html',
        'https://master--theblog--adobe.hlx.page/',
        'https://master--theblog--adobe.hlx.page/index',
      ],
    },
    {
      xfh: 'blog.adobe.com, master--theblog--adobe.hlx.page',
      host: 'master--theblog--adobe.hlx.page',
      path: '/index',
      spec: '/index also purges / and /index.html and /index.md',
      purgeUrls: [
        'https://master--theblog--adobe.hlx.page/index.md',
        'https://blog.adobe.com/index',
        'https://blog.adobe.com/',
        'https://blog.adobe.com/index.html',
        'https://master--theblog--adobe.hlx.page/index',
        'https://master--theblog--adobe.hlx.page/',
        'https://master--theblog--adobe.hlx.page/index.html',
      ],
    },
    {
      xfh: 'blog.adobe.com, master--theblog--adobe.hlx.page',
      host: 'master--theblog--adobe.hlx.page',
      path: '/foo.html',
      spec: '/foo.html also purges /foo and /foo.md',
      purgeUrls: [
        'https://master--theblog--adobe.hlx.page/foo.md',
        'https://blog.adobe.com/foo.html',
        'https://blog.adobe.com/foo',
        'https://master--theblog--adobe.hlx.page/foo.html',
        'https://master--theblog--adobe.hlx.page/foo',
      ],
    },
    {
      xfh: 'spark-website--adobe.hlx.live, main--spark-website--adobe.hlx.page',
      host: 'main--spark-website--adobe.hlx.page',
      path: '/foo',
      spec: '/foo also purges /foo.html and /foo.md',
      purgeUrls: [
        'https://main--spark-website--adobe.hlx.page/foo.md',
        'https://spark-website--adobe.hlx.live/foo',
        'https://spark-website--adobe.hlx.live/foo.html',
        'https://main--spark-website--adobe.hlx.page/foo',
        'https://main--spark-website--adobe.hlx.page/foo.html',
      ],
    },
    {
      xfh: 'spark-website--adobe.hlx.live, main--spark-website--adobe.hlx.page',
      host: 'main--spark-website--adobe.hlx.page',
      path: '/foo.json',
      spec: '/foo.json also purges foo.json (content proxy)',
      purgeUrls: [
        'https://spark-website--adobe.hlx.live/foo.json',
        'https://main--spark-website--adobe.hlx.page/foo.json',
      ],
    },
    {
      xfh: 'spark-website--adobe.hlx.live, main--spark-website--adobe.hlx.page',
      host: 'main--spark-website--adobe.hlx.page',
      path: '/foo.xml',
      spec: '/foo.xml purges nothing else',
      purgeUrls: [
        'https://spark-website--adobe.hlx.live/foo.xml',
        'https://main--spark-website--adobe.hlx.page/foo.xml',
      ],
    },
  ].forEach(({
    xfh, host, path, purgeUrls,
  }) => {
    it(`index function purges outer cdn and inner cdn for ${path}`, async () => {
      const scope = nock(/./)
        .intercept(/.*/, 'PURGE')
        .reply(200)
        .persist();

      const result = await index({
        __ow_logger,
        xfh,
        path,
        host,
      });
      scope.done();
      assert.strictEqual(result.statusCode, 200);
      assert.strictEqual(result.body.length, purgeUrls.length, 'purged the expected number of urls');
      purgeUrls.forEach((purgeUrl) => {
        assert.ok(result.body.some((r) => r.status === 'ok' && r.url === purgeUrl), `purged url ${purgeUrl}`);
      });
    }).timeout(5000);
  });

  it('index function sanitizes x-forwarded-host before purging outer cdn', async () => {
    const scope = nock(/./)
      .intercept(/.*/, 'PURGE')
      .reply(200)
      .persist();

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
    assert.strictEqual(result.body.length, 10, '11 urls purged');
  }).timeout(5000);

  it('index function gracefully handles failed markdown purge', async () => {
    const scope = nock(/./)
      .intercept('/foo.md', 'PURGE')
      .reply(500);

    const result = await index({
      __ow_logger,
      path: '/foo.html',
      host: 'theblog--adobe.hlx.page',
    }, {
      HLX_PAGES_FASTLY_SVC_ID: 'test-service',
      HLX_PAGES_FASTLY_TOKEN: 'dummy',
    });

    scope.done();
    assert.strictEqual(result.statusCode, 207);
    assert.ok(result.body.some((r) => r.status === 'error' && r.url.endsWith('.md')), 'purging markdown failed');
  }).timeout(5000);

  it('index function fails gracefully on invalid host', async () => {
    const result = await index({
      __ow_logger,
      path: '/foo.html',
      host: 'theblog.hlx.page',
    }, {
      HLX_PAGES_FASTLY_SVC_ID: 'test-service',
      HLX_PAGES_FASTLY_TOKEN: 'dummy',
    });

    assert.strictEqual(result.body.length, 1, '1 url purged');
    assert.ok(result.body.some((r) => r.status === 'error'), 'purging invalid host failed');
  }).timeout(5000);
});
