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
const commence = require('../src/stop.js');

describe('Purge-Stop Tests', () => {
  it('Stop for unexpected results', async () => {
    const scope = nock('https://main--helix-purge--adobe.hlx.page')
      .get('/OK.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(404, 'OK');
    assert.ok(!(await commence(logging.createTestLogger())));
    scope.done();
  });

  it('Commence for expected results', async () => {
    const scope = nock('https://main--helix-purge--adobe.hlx.page')
      .get('/OK.html')
      .reply(200, 'OK')
      .get('/ok.html')
      .reply(200, 'OK');
    assert.ok(await commence(logging.createTestLogger()));
    scope.done();
  });
});
